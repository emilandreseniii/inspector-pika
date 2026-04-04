import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

/**
 * Extracts API surfaces from Vapor (Swift web framework).
 *
 * Key patterns:
 *   app.get("users") { req in ... }
 *   app.post("users") { req in ... }
 *   app.get("users", ":id") { req in ... }
 *   app.grouped("api", "v1").get("users") { req in ... }
 *
 * Also supports RouteBuilder / grouped routes:
 *   let users = app.grouped("users")
 *   users.get { req in ... }
 *   users.post { req in ... }
 *
 * Path params use ":name" string literals.
 */

const METHOD_MAP: Record<string, HttpMethod> = {
  get: 'GET', post: 'POST', put: 'PUT', patch: 'PATCH',
  delete: 'DELETE', head: 'HEAD', options: 'OPTIONS',
}

export class VaporExtractor extends BaseApiExtractor {
  readonly extractorId = 'swift.vapor'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep(
      '**/*.swift',
      /app\.(get|post|put|patch|delete)\s*\(|\.grouped\s*\(/,
      2000,
    )
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        if (!isVaporFile(content)) continue
        const parsed = parseVaporFile(content, file)
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

function isVaporFile(content: string): boolean {
  return /import\s+Vapor/.test(content)
}

function parseVaporFile(content: string, file: string): RawApiSurface | null {
  const stripped = stripComments(content)
  const lines = stripped.split('\n')
  const endpoints: RawEndpoint[] = []

  // Track grouped route vars: let users = app.grouped("users")
  const groupPrefixes = new Map<string, string>()
  // Default app var has empty prefix
  groupPrefixes.set('app', '')

  // First pass: collect grouped vars
  for (const line of lines) {
    // let groupVar = parentVar.grouped("prefix1", "prefix2")
    const groupMatch = line.match(/(?:let|var)\s+(\w+)\s*=\s*(\w+)\.grouped\s*\(([^)]+)\)/)
    if (groupMatch) {
      const [, newVar, parentVar, argsStr] = groupMatch
      const parentPrefix = groupPrefixes.get(parentVar) ?? ''
      const segments = extractStringLiterals(argsStr).map(normalizeSeg)
      const newPrefix = joinSegments([parentPrefix, ...segments])
      groupPrefixes.set(newVar, newPrefix)
    }
  }

  // Second pass: collect routes
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // varName.get("segment1", "segment2") { ... }
    // or  varName.get { ... }  (no path args)
    const routeMatch = line.match(
      /(\w+)\.(get|post|put|patch|delete|head|options)\s*\(([^{]*)\)/,
    )
    if (!routeMatch) continue

    const [, varName, methodStr, argsStr] = routeMatch
    const prefix = groupPrefixes.get(varName)
    if (prefix === undefined) continue

    const method = METHOD_MAP[methodStr]
    if (!method) continue

    // Extract string literal segments from args (ignore non-string args)
    const segments = extractStringLiterals(argsStr).map(normalizeSeg)
    const fullPath = joinSegments([prefix, ...segments])

    const params = extractPathParams(fullPath)
    endpoints.push({ httpMethod: method, path: fullPath, parameters: params, tags: [], sourceFile: file, sourceLine: i + 1 })
  }

  if (endpoints.length === 0) return null

  return {
    name: file.split('/').pop()?.replace(/\.swift$/, '') ?? file,
    apiStyle: 'http',
    endpoints,
    sourceFile: file,
    sourceLine: 1,
  }
}

// ---- Helpers ----

function extractStringLiterals(argsStr: string): string[] {
  const results: string[] = []
  for (const m of argsStr.matchAll(/"([^"]*)"/g)) {
    results.push(m[1])
  }
  return results
}

function normalizeSeg(seg: string): string {
  // :id → {id} for param segments
  if (seg.startsWith(':')) return `{${seg.slice(1)}}`
  return seg
}

function joinSegments(parts: string[]): string {
  const filtered = parts.filter(Boolean)
  if (filtered.length === 0) return '/'
  return '/' + filtered.join('/')
}

function extractPathParams(path: string): RawApiParameter[] {
  const params: RawApiParameter[] = []
  for (const m of path.matchAll(/\{(\w+)\}/g)) {
    params.push({ name: m[1], location: 'path', required: true })
  }
  return params
}

function stripComments(code: string): string {
  return code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}
