import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

// NestJS HTTP method decorators
const METHOD_DECORATORS: Record<string, HttpMethod> = {
  Get: 'GET', Post: 'POST', Put: 'PUT', Delete: 'DELETE',
  Patch: 'PATCH', Head: 'HEAD', Options: 'OPTIONS',
}

export class NestJsExtractor extends BaseApiExtractor {
  readonly extractorId = 'typescript.nestjs'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep(
      '**/*.{ts,mts}',
      /@(?:Controller|Get|Post|Put|Delete|Patch|Head|Options)\s*\(/,
      2000,
    )
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseNestFile(content, file)
        if (parsed) surfaces.push(parsed)
      } catch (err) {
        warnings.push(`Failed to parse ${file}: ${(err as Error).message}`)
      }
    }

    const endpointsFound = surfaces.reduce((sum, s) => sum + s.endpoints.length, 0)
    return {
      surfaces,
      warnings,
      stats: { filesScanned: uniqueFiles.length, surfacesFound: surfaces.length, endpointsFound, extractionTimeMs: Date.now() - start },
    }
  }
}

// ---- File parser ----

function parseNestFile(content: string, file: string): RawApiSurface | null {
  if (!/@Controller\s*\(/.test(content)) return null

  // Extract controller base path from @Controller('/base-path') or @Controller()
  let controllerPath = ''
  const ctrlMatch = content.match(/@Controller\s*\(\s*(?:["'`]([^"'`]*)["'`])?\s*\)/)
  if (ctrlMatch?.[1]) controllerPath = ctrlMatch[1].startsWith('/') ? ctrlMatch[1] : '/' + ctrlMatch[1]

  // Extract class name
  const classMatch = content.match(/(?:export\s+)?class\s+(\w+)/)
  if (!classMatch) return null
  const className = classMatch[1]

  // Strip comments and join logical lines so multi-line method signatures become single lines
  const stripped = stripComments(content)
  const logicalLines = joinLogicalLines(stripped.split('\n'))

  const endpoints: RawEndpoint[] = []
  let pendingMethod: { httpMethod: HttpMethod; path: string } | null = null

  for (let i = 0; i < logicalLines.length; i++) {
    const line = logicalLines[i]
    const trimmed = line.trim()
    if (!trimmed) continue

    // Detect @Get('/path'), @Post(), etc. — possibly on same line as method: @Get() findAll() {}
    const methodDecoMatch = trimmed.match(
      /^@(Get|Post|Put|Delete|Patch|Head|Options)\s*\(\s*(?:["'`]([^"'`]*)["'`])?\s*\)(.*)/,
    )
    if (methodDecoMatch) {
      const httpMethod = METHOD_DECORATORS[methodDecoMatch[1]]
      const routePath = methodDecoMatch[2] ?? ''
      const fullPath = joinPaths(controllerPath, routePath)
      pendingMethod = { httpMethod, path: fullPath }

      // Check if handler is on the same line as decorator: @Get() findAll() {...}
      const rest = methodDecoMatch[3]?.trim()
      if (rest && /^(?:async\s+)?\w+\s*\(/.test(rest)) {
        const ep = emitEndpoint(rest, pendingMethod, className, controllerPath, file, i + 1)
        if (ep) { endpoints.push(ep); pendingMethod = null }
      }
      continue
    }

    // Skip other decorators (like @UseGuards, @Roles, etc.) while we have a pending method
    if (trimmed.startsWith('@')) continue

    // Handler method declaration (with pending method decorator)
    if (pendingMethod && /^(?:async\s+)?\w+\s*\(/.test(trimmed)) {
      const ep = emitEndpoint(trimmed, pendingMethod, className, controllerPath, file, i + 1)
      if (ep) endpoints.push(ep)
      pendingMethod = null
    }
  }

  if (endpoints.length === 0) return null

  return {
    name: className,
    apiStyle: 'http',
    basePath: controllerPath || undefined,
    endpoints,
    sourceFile: file,
    sourceLine: 1,
  }
}

// ---- Emit endpoint from handler line ----

function emitEndpoint(
  handlerLine: string,
  pendingMethod: { httpMethod: HttpMethod; path: string },
  className: string,
  _controllerPath: string,
  file: string,
  sourceLine: number,
): RawEndpoint | null {
  const handlerMatch = handlerLine.match(/^(?:async\s+)?(\w+)\s*\(/)
  if (!handlerMatch) return null

  const operationName = handlerMatch[1]
  if (['constructor', 'if', 'for', 'while', 'switch', 'catch'].includes(operationName)) return null

  // Extract full params string
  const parenStart = handlerLine.indexOf('(')
  const paramsStr = extractToMatchingParen(handlerLine, parenStart)

  const parameters: RawApiParameter[] = paramsStr !== null
    ? parseNestMethodParams(paramsStr)
    : []

  // Add path params inferred from URL pattern that aren't already in parameters
  const pathParams = extractPathParams(pendingMethod.path)
  for (const pp of pathParams) {
    if (!parameters.find((p) => p.name === pp)) {
      parameters.push({ name: pp, location: 'path', required: true })
    }
  }

  return {
    httpMethod: pendingMethod.httpMethod,
    path: pendingMethod.path,
    operationName,
    parameters,
    tags: [className],
    sourceFile: file,
    sourceLine,
  }
}

// ---- Parse method params string for @Param/@Query/@Body inline decorators ----

function parseNestMethodParams(paramsStr: string): RawApiParameter[] {
  const params: RawApiParameter[] = []
  const parts = splitOnCommas(paramsStr)

  for (const part of parts) {
    const trimmed = part.trim()
    const decoMatch = trimmed.match(/@(Param|Query|Body|Headers?)\s*\(\s*(?:["'`]([^"'`]*)["'`])?\s*\)/)
    if (!decoMatch) continue

    const kind = decoMatch[1]
    const location: RawApiParameter['location'] =
      kind === 'Param' ? 'path' :
      kind === 'Query' ? 'query' :
      kind === 'Body' ? 'body' :
      'header'

    // Get variable name and type from after decorator: @Param('id') id: string
    const afterDeco = trimmed.slice(trimmed.indexOf(')') + 1).trim()
    const varNameMatch = afterDeco.match(/^(\w+)\??:/)
    // Prefer explicit name in decorator arg; fall back to variable name; then kind
    const name = decoMatch[2] ?? varNameMatch?.[1] ?? kind.toLowerCase()
    const typeMatch = afterDeco.match(/\w+\??:\s*([\w<>[\],\s|]+)/)
    const type = typeMatch?.[1]?.trim()
    const isOptional = trimmed.includes('?:') || (kind === 'Query')

    params.push({ name, location, type, required: !isOptional })
  }

  return params
}

// ---- Path helpers ----

function extractPathParams(path: string): string[] {
  const params: string[] = []
  for (const m of path.matchAll(/:(\w+)/g)) params.push(m[1])
  return params
}

function joinPaths(base: string, route: string): string {
  if (!base && !route) return '/'
  if (!route) return base || '/'
  const b = base.endsWith('/') ? base.slice(0, -1) : base
  const r = route.startsWith('/') ? route : '/' + route
  return b + r || '/'
}

// ---- Join logical lines (open brace/paren continuation) ----

function joinLogicalLines(lines: string[]): string[] {
  const result: string[] = []
  let i = 0
  while (i < lines.length) {
    let line = lines[i]
    let depth = 0
    for (const ch of line) {
      if (ch === '(' || ch === '[') depth++
      else if (ch === ')' || ch === ']') depth--
    }
    while (depth > 0 && i + 1 < lines.length) {
      i++
      const next = lines[i].trim()
      line += ' ' + next
      for (const ch of next) {
        if (ch === '(' || ch === '[') depth++
        else if (ch === ')' || ch === ']') depth--
      }
    }
    result.push(line)
    i++
  }
  return result
}

// ---- Helpers ----

function extractToMatchingParen(s: string, start: number): string | null {
  let depth = 0
  for (let i = start; i < s.length; i++) {
    if (s[i] === '(') depth++
    else if (s[i] === ')') { depth--; if (depth === 0) return s.slice(start + 1, i) }
  }
  return null
}

function splitOnCommas(s: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of s) {
    if (ch === '(' || ch === '[' || ch === '{' || ch === '<') depth++
    else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') depth--
    else if (ch === ',' && depth === 0) { parts.push(current); current = ''; continue }
    current += ch
  }
  if (current.trim()) parts.push(current)
  return parts
}

function stripComments(code: string): string {
  let result = code.replace(/\/\/.*$/gm, '')
  result = result.replace(/\/\*[\s\S]*?\*\//g, '')
  return result
}
