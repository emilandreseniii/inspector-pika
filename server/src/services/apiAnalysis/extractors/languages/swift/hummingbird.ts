import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

/**
 * Extracts API surfaces from Hummingbird (Swift web framework).
 *
 * Key patterns:
 *   app.router.get("/users") { ... }
 *   app.router.post("/users") { ... }
 *   app.router.get("/users/:id") { ... }
 *
 * Also RouterGroup:
 *   let userRoutes = app.router.group("users")
 *   userRoutes.get { ... }
 *   userRoutes.get(":id") { ... }
 */

const METHOD_MAP: Record<string, HttpMethod> = {
  get: 'GET', post: 'POST', put: 'PUT', patch: 'PATCH',
  delete: 'DELETE', head: 'HEAD', options: 'OPTIONS',
}

export class HummingbirdExtractor extends BaseApiExtractor {
  readonly extractorId = 'swift.hummingbird'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep(
      '**/*.swift',
      /\.router\.(get|post|put|patch|delete)\s*\(|HBApplication|HBRouter/,
      2000,
    )
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        if (!isHummingbirdFile(content)) continue
        const parsed = parseHummingbirdFile(content, file)
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

function isHummingbirdFile(content: string): boolean {
  return /import\s+Hummingbird/.test(content)
}

function parseHummingbirdFile(content: string, file: string): RawApiSurface | null {
  const stripped = stripComments(content)
  const lines = stripped.split('\n')
  const endpoints: RawEndpoint[] = []

  // Track group vars: let groupVar = parentVar.group("prefix")
  const groupPrefixes = new Map<string, string>()
  groupPrefixes.set('router', '')

  // Find router var name: let router = app.router
  for (const line of lines) {
    const routerVar = line.match(/(?:let|var)\s+(\w+)\s*=\s*\w+\.router\b/)
    if (routerVar) groupPrefixes.set(routerVar[1], '')

    const groupMatch = line.match(/(?:let|var)\s+(\w+)\s*=\s*(\w+)\.group\s*\(\s*"([^"]*)"\s*\)/)
    if (groupMatch) {
      const [, newVar, parentVar, prefix] = groupMatch
      const parentPrefix = groupPrefixes.get(parentVar) ?? ''
      groupPrefixes.set(newVar, joinPaths(parentPrefix, prefix))
    }
  }

  // Collect routes
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // app.router.get("/path") { ... } or groupVar.get("/path") { ... } or groupVar.get { ... }
    const routeMatch = line.match(/(\w+)\.(get|post|put|patch|delete|head|options)\s*\((?:\s*"([^"]*)")?\s*\)/)
    if (!routeMatch) continue

    const [, varName, methodStr, pathArg] = routeMatch

    // Check if varName is known as router or group
    const prefix = groupPrefixes.get(varName)
    if (prefix === undefined) {
      // Could be app.router.get(...) — check for .router. in the line
      if (!/\.router\./.test(line)) continue
    }

    const method = METHOD_MAP[methodStr]
    if (!method) continue

    const actualPrefix = prefix ?? ''
    const fullPath = pathArg
      ? joinPaths(actualPrefix, normalizeSwiftPath(pathArg))
      : (actualPrefix || '/')

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

function normalizeSwiftPath(path: string): string {
  return path.replace(/:(\w+)/g, '{$1}')
}

function extractPathParams(path: string): RawApiParameter[] {
  const params: RawApiParameter[] = []
  for (const m of path.matchAll(/\{(\w+)\}/g)) {
    params.push({ name: m[1], location: 'path', required: true })
  }
  return params
}

function joinPaths(base: string, sub: string): string {
  if (!base && !sub) return '/'
  if (!sub) return base || '/'
  if (!base) return sub.startsWith('/') ? sub : '/' + sub
  const b = base.endsWith('/') ? base.slice(0, -1) : base
  const s = sub.startsWith('/') ? sub : '/' + sub
  return b + s
}

function stripComments(code: string): string {
  return code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}
