import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

const METHOD_MAP: Record<string, HttpMethod> = {
  get: 'GET', post: 'POST', put: 'PUT', delete: 'DELETE',
  patch: 'PATCH', head: 'HEAD', options: 'OPTIONS',
}

/**
 * Extracts API surfaces from Vert.x Web applications.
 *
 * Vert.x Web patterns:
 *   router.get("/path").handler(ctx -> { ... })
 *   router.post("/api/users").handler(this::createUser)
 *   router.route("/api/*").handler(authHandler)
 *   router.route(HttpMethod.GET, "/users").handler(...)
 */
export class VertxWebExtractor extends BaseApiExtractor {
  readonly extractorId = 'java.vertx_web'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep(
      '**/*.{java,kt}',
      /(?:Router\.router|router\.(get|post|put|delete|patch|head|options|route)\s*\()/i,
      2000,
    )
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseVertxFile(content, file)
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

function parseVertxFile(content: string, file: string): RawApiSurface | null {
  // Must have a Router import or usage
  if (!/io\.vertx\.ext\.web|vertx\.web|Router/.test(content)) return null

  const stripped = stripComments(content)
  const lines = stripped.split('\n')
  const endpoints: RawEndpoint[] = []

  for (const line of lines) {
    const trimmed = line.trim()

    // router.get("/path").handler(...) or router.post("/path").handler(...)
    const methodMatch = trimmed.match(/\w+\.(get|post|put|delete|patch|head|options)\s*\(\s*"([^"]+)"\s*\)\.handler/i)
    if (methodMatch) {
      const method = METHOD_MAP[methodMatch[1].toLowerCase()]
      const path = methodMatch[2]
      if (method) {
        endpoints.push({ httpMethod: method, path, parameters: extractPathParams(path) })
        continue
      }
    }

    // router.route("/path").handler(...) — all methods
    const routeMatch = trimmed.match(/\w+\.route\s*\(\s*"([^"]+)"\s*\)\.handler/)
    if (routeMatch) {
      const path = routeMatch[1]
      const params = extractPathParams(path)
      for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as HttpMethod[]) {
        endpoints.push({ httpMethod: method, path, parameters: params })
      }
      continue
    }

    // router.route(HttpMethod.GET, "/path").handler(...)
    const httpMethodMatch = trimmed.match(/\w+\.route\s*\(\s*HttpMethod\.(\w+)\s*,\s*"([^"]+)"\s*\)\.handler/)
    if (httpMethodMatch) {
      const method = httpMethodMatch[1] as HttpMethod
      const path = httpMethodMatch[2]
      if (Object.values(METHOD_MAP).includes(method)) {
        endpoints.push({ httpMethod: method, path, parameters: extractPathParams(path) })
      }
    }
  }

  if (endpoints.length === 0) return null

  return {
    name: file.split('/').pop()?.replace(/\.(java|kt)$/, '') ?? file,
    file,
    framework: 'vertx_web',
    endpoints,
  }
}

// ---- Helpers ----

function extractPathParams(path: string): RawApiParameter[] {
  const params: RawApiParameter[] = []
  // Vert.x uses :param syntax
  for (const m of path.matchAll(/:([a-zA-Z_]\w*)/g)) {
    params.push({ name: m[1], in: 'path', required: true })
  }
  return params
}

function stripComments(code: string): string {
  return code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}
