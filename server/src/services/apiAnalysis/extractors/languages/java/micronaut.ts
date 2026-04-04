import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

/**
 * Extracts API surfaces from Micronaut HTTP controllers.
 *
 * Key annotations:
 *   @Controller("/base")  — marks the class and sets base path
 *   @Get("/path")         — method-level route
 *   @Post, @Put, @Delete, @Patch, @Head, @Options
 *
 * Parameter annotations:
 *   @PathVariable  — path segment
 *   @QueryValue    — query string
 *   @Body          — request body
 *   @Header        — HTTP header
 *   @CookieValue   — cookie
 */
export class MicronautExtractor extends BaseApiExtractor {
  readonly extractorId = 'java.micronaut'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep('**/*.{java,kt}', /@Controller\b/, 2000)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseMicronautFile(content, file)
        if (parsed) surfaces.push(parsed)
      } catch (err) {
        warnings.push(`Failed to parse ${file}: ${(err as Error).message}`)
      }
    }

    const endpointsFound = surfaces.reduce((sum, s) => sum + s.endpoints.length, 0)

    return {
      surfaces,
      warnings,
      stats: {
        filesScanned: uniqueFiles.length,
        surfacesFound: surfaces.length,
        endpointsFound,
        extractionTimeMs: Date.now() - start,
      },
    }
  }
}

// ---- File parser ----

function parseMicronautFile(content: string, file: string): RawApiSurface | null {
  if (!/@Controller\b/.test(content)) return null

  const collapsed = collapseAnnotationParens(content)
  const lines = collapsed.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')

  const pkgMatch = content.match(/^package\s+([\w.]+)\s*;?/m)
  const packageName = pkgMatch?.[1]

  const classMatch = collapsed.match(/(?:public\s+|abstract\s+|final\s+|open\s+)*(?:class|object)\s+(\w+)/)
  if (!classMatch) return null
  const className = classMatch[1]

  const classLineNo = lines.findIndex((l) => /(?:public\s+|abstract\s+|final\s+|open\s+)*(?:class|object)\s+\w+/.test(l)) + 1

  // Base path from @Controller("/base") or @Controller
  const basePath = extractControllerPath(lines)
  const endpoints = extractEndpoints(lines, basePath, className, file)

  if (endpoints.length === 0) return null

  return {
    name: className,
    apiStyle: 'http',
    basePath: basePath || undefined,
    packageOrModule: packageName,
    endpoints,
    sourceFile: file,
    sourceLine: classLineNo,
  }
}

function extractControllerPath(lines: string[]): string {
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('@Controller')) continue
    return extractAnnotationPath(trimmed) ?? ''
  }
  return ''
}

// ---- Method-level routing annotations ----

const HTTP_VERB_ANNOTS: Record<string, HttpMethod> = {
  Get: 'GET', Post: 'POST', Put: 'PUT', Delete: 'DELETE',
  Patch: 'PATCH', Head: 'HEAD', Options: 'OPTIONS',
}

function extractHttpMethodMapping(line: string): { method: HttpMethod; subPath: string } | null {
  for (const [annot, method] of Object.entries(HTTP_VERB_ANNOTS)) {
    if (new RegExp(`^@${annot}\\b`).test(line)) {
      return { method, subPath: extractAnnotationPath(line) ?? '' }
    }
  }
  return null
}

function extractEndpoints(
  lines: string[],
  classBasePath: string,
  className: string,
  file: string,
): RawEndpoint[] {
  const endpoints: RawEndpoint[] = []
  let pendingMappings: Array<{ method: HttpMethod; subPath: string }> = []
  let insideClass = false
  let braceDepth = 0

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    if (!insideClass) {
      if (/(?:public\s+|abstract\s+|final\s+|open\s+)*(?:class|object)\s+\w+/.test(trimmed)) {
        insideClass = true
      }
      continue
    }

    for (const ch of trimmed) {
      if (ch === '{') braceDepth++
      else if (ch === '}') braceDepth--
    }
    if (braceDepth > 1) { pendingMappings = []; continue }

    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue

    const mapping = extractHttpMethodMapping(trimmed)
    if (mapping) { pendingMappings.push(mapping); continue }
    if (trimmed.startsWith('@')) continue

    if (pendingMappings.length > 0) {
      let sigLine = trimmed
      if (sigLine.includes('(') && parenBalance(sigLine) > 0) {
        while (i + 1 < lines.length && parenBalance(sigLine) > 0) {
          i++
          sigLine += ' ' + lines[i].trim()
        }
      }
      const methodSig = parseMethodSignature(sigLine)
      if (methodSig) {
        const params = parseParameters(methodSig.paramsStr)
        for (const { method, subPath } of pendingMappings) {
          endpoints.push({
            httpMethod: method,
            path: joinPaths(classBasePath, subPath),
            parameters: params,
            returnType: methodSig.returnType || undefined,
            tags: [className],
            sourceFile: file,
            sourceLine: i + 1,
          })
        }
      }
      pendingMappings = []
    }
  }

  return endpoints
}

// ---- Parameter parsing ----

function parseParameters(paramsStr: string): RawApiParameter[] {
  if (!paramsStr.trim()) return []
  const params: RawApiParameter[] = []

  for (const part of splitOnCommas(paramsStr)) {
    const trimmed = part.trim()
    if (!trimmed) continue

    if (/@PathVariable\b/.test(trimmed)) {
      const nameMatch = trimmed.match(/@PathVariable\s*(?:\(\s*["']([^"']+)["']\s*\))?\s+(?:\S+\s+)?(\w+)\s*$/)
      const type = extractParamType(trimmed)
      params.push({ name: nameMatch?.[1] ?? nameMatch?.[2] ?? 'param', location: 'path', type, required: true })
      continue
    }
    if (/@QueryValue\b/.test(trimmed)) {
      const nameMatch = trimmed.match(/@QueryValue\s*(?:\(\s*["']([^"']+)["']\s*\))?.*?(\w+)\s*$/)
      const type = extractParamType(trimmed)
      params.push({ name: nameMatch?.[1] ?? nameMatch?.[2] ?? 'param', location: 'query', type, required: false })
      continue
    }
    if (/@Body\b/.test(trimmed)) {
      const type = extractParamType(trimmed)
      const varName = trimmed.match(/(\w+)\s*$/)?.[1] ?? 'body'
      params.push({ name: varName, location: 'body', type, required: true })
      continue
    }
    if (/@Header\b/.test(trimmed)) {
      const nameMatch = trimmed.match(/@Header\s*(?:\(\s*["']([^"']+)["']\s*\))?.*?(\w+)\s*$/)
      const type = extractParamType(trimmed)
      params.push({ name: nameMatch?.[1] ?? nameMatch?.[2] ?? 'header', location: 'header', type, required: false })
      continue
    }
    if (/@CookieValue\b/.test(trimmed)) {
      const nameMatch = trimmed.match(/@CookieValue\s*(?:\(\s*["']([^"']+)["']\s*\))?.*?(\w+)\s*$/)
      const type = extractParamType(trimmed)
      params.push({ name: nameMatch?.[1] ?? nameMatch?.[2] ?? 'cookie', location: 'cookie', type, required: false })
      continue
    }
  }

  return params
}

// ---- Shared helpers ----

function extractAnnotationPath(line: string): string | null {
  const parenStart = line.indexOf('(')
  if (parenStart === -1) return ''
  const inner = line.slice(parenStart + 1, line.lastIndexOf(')')).trim()
  if (!inner) return ''
  const namedMatch = inner.match(/(?:value|uri|uris)\s*=\s*["']([^"']*)["']/)
  if (namedMatch) return namedMatch[1]
  const arrayMatch = inner.match(/\{[^}]*?["']([^"']+)["']/)
  if (arrayMatch) return arrayMatch[1]
  const plainMatch = inner.match(/^["']([^"']*)["']/)
  if (plainMatch) return plainMatch[1]
  return ''
}

interface MethodSig { returnType: string; name: string; paramsStr: string }

function parseMethodSignature(line: string): MethodSig | null {
  if (!line.includes('(')) return null
  if (line.startsWith('@') || /^\s*(?:if|for|while|switch|catch|return|throw|new)\b/.test(line)) return null
  const parenStart = line.indexOf('(')
  const beforeParens = line.slice(0, parenStart).trim()
  const paramsStr = extractToMatchingParen(line, parenStart)
  if (paramsStr === null) return null

  // Kotlin fun
  if (/\bfun\s+\w+\s*$/.test(beforeParens)) {
    const name = beforeParens.match(/\bfun\s+(\w+)\s*$/)?.[1] ?? ''
    const afterClose = line.slice(parenStart + paramsStr.length + 2).trim()
    const returnType = afterClose.startsWith(':') ? afterClose.slice(1).split(/[{;]/)[0].trim() : ''
    return name ? { returnType, name, paramsStr } : null
  }

  const parts = beforeParens.split(/\s+/).filter(Boolean)
  if (parts.length < 2) return null
  const methodName = parts[parts.length - 1]
  if (!methodName || !/^[a-zA-Z_$]/.test(methodName)) return null
  if (['if', 'for', 'while', 'switch', 'catch', 'new', 'return'].includes(methodName)) return null
  const MODIFIERS = new Set(['public', 'protected', 'private', 'static', 'final', 'abstract', 'synchronized', 'override', 'suspend'])
  const returnType = parts.slice(0, -1).filter((p) => !MODIFIERS.has(p)).join(' ')
  return { returnType, name: methodName, paramsStr }
}

function extractToMatchingParen(s: string, start: number): string | null {
  let depth = 0
  for (let i = start; i < s.length; i++) {
    if (s[i] === '(') depth++
    else if (s[i] === ')') { depth--; if (depth === 0) return s.slice(start + 1, i) }
  }
  return null
}

function parenBalance(s: string): number {
  let depth = 0
  for (const ch of s) { if (ch === '(') depth++; else if (ch === ')') depth-- }
  return depth
}

function extractParamType(paramDecl: string): string | undefined {
  const stripped = paramDecl.replace(/@\w+(?:\s*\([^)]*\))?\s*/g, '').trim()
  const m = stripped.match(/^([\w<>.,\s\[\]]+?)\s+\w+\s*$/)
  return m ? m[1].trim() : undefined
}

function splitOnCommas(s: string): string[] {
  const parts: string[] = []
  let depth = 0; let current = ''
  for (const ch of s) {
    if (ch === '<' || ch === '(' || ch === '[') depth++
    else if (ch === '>' || ch === ')' || ch === ']') depth--
    else if (ch === ',' && depth === 0) { parts.push(current); current = ''; continue }
    current += ch
  }
  if (current.trim()) parts.push(current)
  return parts
}

function joinPaths(base: string, sub: string): string {
  if (!base && !sub) return '/'
  if (!sub) return base || '/'
  if (!base) return sub.startsWith('/') ? sub : '/' + sub
  const b = base.endsWith('/') ? base.slice(0, -1) : base
  const s = sub.startsWith('/') ? sub : '/' + sub
  return b + s
}

function collapseAnnotationParens(content: string): string {
  let result = ''; let depth = 0; let inAnnot = false
  for (let i = 0; i < content.length; i++) {
    const ch = content[i]
    if (ch === '@') inAnnot = true
    if (inAnnot && ch === '(') depth++
    if (inAnnot && ch === ')') { depth--; if (depth === 0) inAnnot = false }
    if (inAnnot && depth > 0 && (ch === '\n' || ch === '\r')) result += ' '
    else result += ch
  }
  return result
}
