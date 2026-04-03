import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

// Standard HTTP methods exposed by DRF ViewSets / APIViews
const VIEWSET_METHODS: Record<string, HttpMethod[]> = {
  ModelViewSet:       ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  ReadOnlyModelViewSet: ['GET'],
  ViewSet:            ['GET', 'POST'],
  GenericViewSet:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
}

const APIVIEW_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

export class DjangoRestFrameworkExtractor extends BaseApiExtractor {
  readonly extractorId = 'python.django_rest_framework'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep(
      '**/*.py',
      /(?:from\s+rest_framework|import\s+rest_framework\b|ModelViewSet|APIView|@api_view)/,
      2000,
    )
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseDrfFile(content, file)
        surfaces.push(...parsed)
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

// ---- File parser — returns one surface per class/function view ----

function parseDrfFile(content: string, file: string): RawApiSurface[] {
  if (!content.includes('rest_framework') && !/@api_view\b/.test(content)) return []

  const lines = joinLogicalLines(content.split('\n'))
  const surfaces: RawApiSurface[] = []
  const moduleName = file.replace(/\.py$/, '').replace(/\//g, '.').replace(/\.__init__$/, '')

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    // ── ViewSet classes ──────────────────────────────────────────────────────
    const classMatch = trimmed.match(
      /^class\s+(\w+)\s*\(\s*([\w.,\s]+)\s*\)\s*:/,
    )
    if (classMatch) {
      const className = classMatch[1]
      const bases = classMatch[2].split(',').map((b) => b.trim())

      // Check if it's a DRF ViewSet or APIView.
      // Sort by key length descending so ReadOnlyModelViewSet matches before ModelViewSet.
      const sortedViewsetKeys = Object.keys(VIEWSET_METHODS).sort((a, b) => b.length - a.length)
      const viewsetBase = bases.find((b) => sortedViewsetKeys.some((k) => b.endsWith(k)))
      const isApiView = bases.some((b) => b.endsWith('APIView') || b.endsWith('GenericAPIView'))

      if (viewsetBase || isApiView) {
        const endpoints = isApiView
          ? extractApiViewEndpoints(lines, i, className, file)
          : extractViewSetEndpoints(lines, i, className, viewsetBase!, file)

        if (endpoints.length > 0) {
          surfaces.push({
            name: className,
            apiStyle: 'http',
            packageOrModule: moduleName,
            endpoints,
            sourceFile: file,
            sourceLine: i + 1,
          })
        }
        continue
      }
    }

    // ── @api_view decorated functions ────────────────────────────────────────
    if (/^@api_view\s*\(/.test(trimmed)) {
      const methodsMatch = trimmed.match(/@api_view\s*\(\s*\[([^\]]*)\]/)
      const methods = methodsMatch
        ? extractMethodsList(methodsMatch[1])
        : ['GET' as HttpMethod]

      // Find following def
      let funcLine = ''
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        if (/^(?:async\s+)?def\s+\w+/.test(lines[j].trim())) { funcLine = lines[j].trim(); break }
      }
      if (!funcLine) continue

      const funcMatch = funcLine.match(/^(?:async\s+)?def\s+(\w+)\s*\((.*)\)/)
      if (!funcMatch) continue

      const operationName = funcMatch[1]
      const paramsStr = funcMatch[2]
      const parameters = parseDrfParams(paramsStr)

      const endpoints: RawEndpoint[] = methods.map((httpMethod) => ({
        httpMethod,
        path: undefined,   // path comes from URL conf, not extractable here
        operationName: methods.length > 1 ? `${operationName}_${(httpMethod as string).toLowerCase()}` : operationName,
        parameters,
        tags: [operationName],
        sourceFile: file,
        sourceLine: i + 1,
      }))

      surfaces.push({
        name: operationName,
        apiStyle: 'http',
        packageOrModule: moduleName,
        endpoints,
        sourceFile: file,
        sourceLine: i + 1,
      })
    }
  }

  return surfaces
}

// ---- Extract endpoints from a ViewSet class body ----

function extractViewSetEndpoints(
  lines: string[],
  classStartLine: number,
  className: string,
  viewsetBaseName: string,
  file: string,
): RawEndpoint[] {
  const endpoints: RawEndpoint[] = []

  // Determine standard methods from the base class.
  // Sort by key length descending to match ReadOnlyModelViewSet before ModelViewSet.
  const standardBase = Object.keys(VIEWSET_METHODS)
    .sort((a, b) => b.length - a.length)
    .find((k) => viewsetBaseName.endsWith(k))
  const standardMethods: HttpMethod[] = standardBase ? VIEWSET_METHODS[standardBase] : []

  // Scan class body for @action decorators (custom actions)
  const classLines = extractClassBody(lines, classStartLine)

  for (let i = 0; i < classLines.length; i++) {
    const trimmed = classLines[i].trim()

    const actionMatch = trimmed.match(/@action\s*\(\s*(.*)\s*\)/)
    if (actionMatch) {
      const actionArgs = actionMatch[1]
      const methods = extractMethodsFromArg(actionArgs)
      const detail = /\bdetail\s*=\s*True/i.test(actionArgs)
      const urlPath = extractKwarg(actionArgs, 'url_path')

      // Find following def
      let funcLine = ''
      for (let j = i + 1; j < Math.min(i + 4, classLines.length); j++) {
        if (/^def\s+\w+/.test(classLines[j].trim())) { funcLine = classLines[j].trim(); break }
      }
      if (!funcLine) continue

      const funcMatch = funcLine.match(/^def\s+(\w+)\s*\((.*)\)/)
      if (!funcMatch) continue

      const operationName = funcMatch[1]
      const params = parseDrfParams(funcMatch[2])
      const path = urlPath ? (detail ? `/{pk}/${urlPath}/` : `/${urlPath}/`) : undefined

      for (const httpMethod of methods) {
        endpoints.push({
          httpMethod,
          path,
          operationName,
          parameters: params,
          summary: `Custom action on ${className}`,
          tags: [className],
          sourceFile: file,
        })
      }
    }
  }

  // Add standard CRUD endpoints implied by the ViewSet type
  const crudEndpoints = buildViewSetCrudEndpoints(className, standardMethods, file)
  endpoints.unshift(...crudEndpoints)

  return endpoints
}

function buildViewSetCrudEndpoints(className: string, methods: HttpMethod[], file: string): RawEndpoint[] {
  const endpoints: RawEndpoint[] = []
  const singular = toSingular(toSnakeCase(className.replace(/ViewSet$/, '')))

  if (methods.includes('GET')) {
    endpoints.push({ httpMethod: 'GET', path: `/${singular}s/`, operationName: 'list', parameters: [], tags: [className], sourceFile: file })
    endpoints.push({ httpMethod: 'GET', path: `/${singular}s/{id}/`, operationName: 'retrieve', parameters: [{ name: 'id', location: 'path', required: true }], tags: [className], sourceFile: file })
  }
  if (methods.includes('POST')) {
    endpoints.push({ httpMethod: 'POST', path: `/${singular}s/`, operationName: 'create', parameters: [], tags: [className], sourceFile: file })
  }
  if (methods.includes('PUT')) {
    endpoints.push({ httpMethod: 'PUT', path: `/${singular}s/{id}/`, operationName: 'update', parameters: [{ name: 'id', location: 'path', required: true }], tags: [className], sourceFile: file })
  }
  if (methods.includes('PATCH')) {
    endpoints.push({ httpMethod: 'PATCH', path: `/${singular}s/{id}/`, operationName: 'partial_update', parameters: [{ name: 'id', location: 'path', required: true }], tags: [className], sourceFile: file })
  }
  if (methods.includes('DELETE')) {
    endpoints.push({ httpMethod: 'DELETE', path: `/${singular}s/{id}/`, operationName: 'destroy', parameters: [{ name: 'id', location: 'path', required: true }], tags: [className], sourceFile: file })
  }

  return endpoints
}

// ---- Extract endpoints from an APIView class body ----

function extractApiViewEndpoints(lines: string[], classStartLine: number, className: string, file: string): RawEndpoint[] {
  const endpoints: RawEndpoint[] = []
  const classLines = extractClassBody(lines, classStartLine)

  for (let i = 0; i < classLines.length; i++) {
    const trimmed = classLines[i].trim()
    const methodDefMatch = trimmed.match(/^def\s+(get|post|put|delete|patch|head|options)\s*\((.*)\)/)
    if (!methodDefMatch) continue

    const httpMethod = methodDefMatch[1].toUpperCase() as HttpMethod
    const paramsStr = methodDefMatch[2]
    const params = parseDrfParams(paramsStr)

    endpoints.push({
      httpMethod,
      path: undefined,
      operationName: methodDefMatch[1],
      parameters: params,
      tags: [className],
      sourceFile: file,
    })
  }

  return endpoints
}

// ---- Extract class body lines (indented content) ----

function extractClassBody(lines: string[], classStartLine: number): string[] {
  const body: string[] = []
  let foundBody = false
  const classIndent = lines[classStartLine].match(/^(\s*)/)?.[1].length ?? 0

  for (let i = classStartLine + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    const indent = line.match(/^(\s*)/)?.[1].length ?? 0
    if (!foundBody && indent > classIndent) { foundBody = true }
    if (foundBody && indent <= classIndent) break
    if (foundBody) body.push(line.trim())
  }

  return body
}

// ---- Parameter parsing ----

function parseDrfParams(paramsStr: string): RawApiParameter[] {
  if (!paramsStr.trim()) return []
  const params: RawApiParameter[] = []

  for (const part of splitOnCommas(paramsStr)) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const nameMatch = trimmed.match(/^(\w+)(?:\s*:\s*([^=]+?))?(?:\s*=\s*(.+))?$/)
    if (!nameMatch) continue
    const name = nameMatch[1]
    if (['self', 'cls', 'request', 'pk', 'format'].includes(name)) continue
    const rawType = nameMatch[2]?.trim()
    const hasDefault = nameMatch[3] !== undefined
    params.push({ name, location: 'query', type: rawType, required: !hasDefault })
  }

  return params
}

// ---- Helpers ----

function extractMethodsList(methodsStr: string): HttpMethod[] {
  const methods: HttpMethod[] = []
  for (const m of methodsStr.matchAll(/["']([A-Za-z]+)["']/g)) {
    methods.push(m[1].toUpperCase() as HttpMethod)
  }
  return methods.length > 0 ? methods : ['GET' as HttpMethod]
}

function extractMethodsFromArg(args: string): HttpMethod[] {
  const m = args.match(/\bmethods\s*=\s*\[([^\]]*)\]/)
  return m ? extractMethodsList(m[1]) : ['GET' as HttpMethod]
}

function extractKwarg(args: string, key: string): string | null {
  const re = new RegExp(`\\b${key}\\s*=\\s*["']([^"']+)["']`)
  const m = args.match(re)
  return m ? m[1] : null
}

function toSnakeCase(s: string): string {
  return s.replace(/([A-Z])/g, (_, c, i) => (i > 0 ? '_' : '') + c.toLowerCase())
}

function toSingular(s: string): string {
  if (s.endsWith('ies')) return s.slice(0, -3) + 'y'
  if (s.endsWith('s') && !s.endsWith('ss')) return s.slice(0, -1)
  return s
}

function joinLogicalLines(lines: string[]): string[] {
  const result: string[] = []
  let i = 0
  while (i < lines.length) {
    let line = lines[i]
    while (line.trimEnd().endsWith('\\') && i + 1 < lines.length) {
      i++
      line = line.trimEnd().slice(0, -1) + lines[i].trim()
    }
    let depth = 0
    for (const ch of line) { if (ch === '(') depth++; else if (ch === ')') depth-- }
    while (depth > 0 && i + 1 < lines.length) {
      i++
      const next = lines[i].trim()
      line += ' ' + next
      for (const ch of next) { if (ch === '(') depth++; else if (ch === ')') depth-- }
    }
    result.push(line)
    i++
  }
  return result
}

function splitOnCommas(s: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of s) {
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth--
    else if (ch === ',' && depth === 0) { parts.push(current); current = ''; continue }
    current += ch
  }
  if (current.trim()) parts.push(current)
  return parts
}
