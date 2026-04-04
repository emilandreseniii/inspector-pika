import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']

/**
 * Extracts API surfaces from Starlette applications.
 *
 * Patterns detected:
 *   routes = [
 *     Route("/users", endpoint=list_users, methods=["GET"]),
 *     Route("/users/{id}", endpoint=get_user, methods=["GET", "DELETE"]),
 *     Mount("/api", routes=[...]),
 *   ]
 *
 *   @app.route("/path", methods=["GET", "POST"])
 */
export class StarletteExtractor extends BaseApiExtractor {
  readonly extractorId = 'python.starlette'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep(
      '**/*.py',
      /(?:from\s+starlette\s+import|import\s+starlette\b|from\s+starlette\.routing\s+import|Starlette\s*\()/,
      2000,
    )
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseStarletteFile(content, file)
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

function parseStarletteFile(content: string, file: string): RawApiSurface | null {
  const endpoints: RawEndpoint[] = []

  // Pattern 1: Route("/path", endpoint=..., methods=[...])
  // Join logical lines first
  const singleLine = content.replace(/\\\n/g, ' ').replace(/\n\s+/g, ' ')
  const routePattern = /Route\s*\(\s*["']([^"']+)["'][^)]*methods\s*=\s*\[([^\]]*)\]/g
  for (const m of singleLine.matchAll(routePattern)) {
    const path = m[1]
    const methodsStr = m[2]
    const methods = parseMethodsList(methodsStr)
    const params = extractPathParams(path)
    for (const method of methods) {
      endpoints.push({
        httpMethod: method,
        path,
        parameters: params,
      })
    }
  }

  // Route without explicit methods (defaults to GET)
  const routeNoMethod = /Route\s*\(\s*["']([^"']+)["']\s*,\s*endpoint\s*=\s*\w+\s*\)/g
  for (const m of singleLine.matchAll(routeNoMethod)) {
    const path = m[1]
    // Skip if already captured above
    if (endpoints.some((e) => e.path === path)) continue
    endpoints.push({
      httpMethod: 'GET',
      path,
      parameters: extractPathParams(path),
    })
  }

  // Pattern 2: @app.route("/path", methods=["GET"])
  const decoratorPattern = /@\w+\.route\s*\(\s*["']([^"']+)["'][^)]*methods\s*=\s*\[([^\]]*)\]/g
  for (const m of singleLine.matchAll(decoratorPattern)) {
    const path = m[1]
    const methods = parseMethodsList(m[2])
    const params = extractPathParams(path)
    for (const method of methods) {
      endpoints.push({ httpMethod: method, path, parameters: params })
    }
  }

  if (endpoints.length === 0) return null

  return {
    name: file.split('/').pop()?.replace(/\.py$/, '') ?? file,
    file,
    framework: 'starlette',
    endpoints,
  }
}

// ---- Helpers ----

function parseMethodsList(methodsStr: string): HttpMethod[] {
  const methods: HttpMethod[] = []
  for (const m of methodsStr.matchAll(/["']([A-Z]+)["']/g)) {
    const method = m[1] as HttpMethod
    if (HTTP_METHODS.includes(method)) methods.push(method)
  }
  return methods.length > 0 ? methods : ['GET']
}

function extractPathParams(path: string): RawApiParameter[] {
  const params: RawApiParameter[] = []
  // Starlette uses {param} syntax
  for (const m of path.matchAll(/\{([^}:]+)(?::[^}]*)?\}/g)) {
    params.push({ name: m[1], in: 'path', required: true })
  }
  return params
}
