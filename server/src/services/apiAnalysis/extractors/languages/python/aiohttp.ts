import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']

/**
 * Extracts API surfaces from aiohttp applications.
 *
 * Patterns detected:
 *   app.router.add_get("/path", handler)
 *   app.router.add_post("/path", handler)
 *   app.router.add_route("GET", "/path", handler)
 *   app.router.add_routes([web.get("/path", handler)])
 *
 *   @routes.get("/path")
 *   @routes.post("/path")
 */
export class AiohttpExtractor extends BaseApiExtractor {
  readonly extractorId = 'python.aiohttp'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep(
      '**/*.py',
      /(?:from\s+aiohttp\s+import|import\s+aiohttp\b|web\.Application\s*\(|RouteTableDef\s*\()/,
      2000,
    )
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseAiohttpFile(content, file)
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

function parseAiohttpFile(content: string, file: string): RawApiSurface | null {
  const endpoints: RawEndpoint[] = []
  const singleLine = content.replace(/\\\n/g, ' ')
  const lines = singleLine.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()

    // app.router.add_get("/path", handler) / app.router.add_post("/path", handler)
    const addMethodMatch = trimmed.match(/\w+\.router\.add_(get|post|put|delete|patch|head|options)\s*\(\s*["']([^"']+)["']/)
    if (addMethodMatch) {
      const method = addMethodMatch[1].toUpperCase() as HttpMethod
      const path = addMethodMatch[2]
      endpoints.push({ httpMethod: method, path, parameters: extractPathParams(path) })
      continue
    }

    // app.router.add_route("GET", "/path", handler)
    const addRouteMatch = trimmed.match(/\w+\.router\.add_route\s*\(\s*["']([A-Z]+)["']\s*,\s*["']([^"']+)["']/)
    if (addRouteMatch) {
      const method = addRouteMatch[1] as HttpMethod
      const path = addRouteMatch[2]
      if (HTTP_METHODS.includes(method)) {
        endpoints.push({ httpMethod: method, path, parameters: extractPathParams(path) })
      }
      continue
    }

    // web.get("/path", handler) or web.post("/path", handler) inside add_routes([...])
    const webMethodMatch = trimmed.match(/web\.(get|post|put|delete|patch|head|options)\s*\(\s*["']([^"']+)["']/)
    if (webMethodMatch) {
      const method = webMethodMatch[1].toUpperCase() as HttpMethod
      const path = webMethodMatch[2]
      endpoints.push({ httpMethod: method, path, parameters: extractPathParams(path) })
      continue
    }

    // @routes.get("/path") or @routes.post("/path")
    if (trimmed.startsWith('@')) {
      const decoratorMatch = trimmed.match(/@\w+\.(get|post|put|delete|patch|head|options)\s*\(\s*["']([^"']+)["']/)
      if (decoratorMatch) {
        const method = decoratorMatch[1].toUpperCase() as HttpMethod
        const path = decoratorMatch[2]
        endpoints.push({ httpMethod: method, path, parameters: extractPathParams(path) })
      }
    }
  }

  if (endpoints.length === 0) return null

  return {
    name: file.split('/').pop()?.replace(/\.py$/, '') ?? file,
    file,
    framework: 'aiohttp',
    endpoints,
  }
}

// ---- Helpers ----

function extractPathParams(path: string): RawApiParameter[] {
  const params: RawApiParameter[] = []
  // aiohttp uses {param} syntax
  for (const m of path.matchAll(/\{([^}]+)\}/g)) {
    params.push({ name: m[1], in: 'path', required: true })
  }
  return params
}
