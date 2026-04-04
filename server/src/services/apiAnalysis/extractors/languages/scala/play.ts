import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

/**
 * Extracts API surfaces from Play Framework (Scala/Java) routes files.
 *
 * Play routes file format (conf/routes):
 *   GET     /users              controllers.UserController.list()
 *   POST    /users              controllers.UserController.create()
 *   GET     /users/:id          controllers.UserController.show(id: Long)
 *   PUT     /users/:id          controllers.UserController.update(id: Long)
 *   DELETE  /users/:id          controllers.UserController.delete(id: Long)
 *
 * Path params use :param (dynamic segment) or *param (wildcard).
 * Also handles ->  prefix for sub-routes (reverse router).
 */

const HTTP_METHODS = new Set<HttpMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])

export class PlayExtractor extends BaseApiExtractor {
  readonly extractorId = 'scala.play'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    // Find Play routes files
    const routesFiles = await this.glob('**/conf/routes')
    const additionalRoutes = await this.glob('**/conf/*.routes')

    const allFiles = [...new Set([...routesFiles, ...additionalRoutes])]

    for (const file of allFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseRoutesFile(content, file)
        if (parsed) surfaces.push(parsed)
      } catch (err) {
        warnings.push(`Failed to parse ${file}: ${(err as Error).message}`)
      }
    }

    const endpointsFound = surfaces.reduce((sum, s) => sum + s.endpoints.length, 0)
    return {
      surfaces,
      warnings,
      stats: { filesScanned: allFiles.length, surfacesFound: surfaces.length, endpointsFound, extractionTimeMs: Date.now() - start },
    }
  }
}

// ---- File parser ----

function parseRoutesFile(content: string, file: string): RawApiSurface | null {
  const endpoints: RawEndpoint[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Strip comments and blank lines
    const trimmed = line.replace(/#.*$/, '').trim()
    if (!trimmed) continue

    // Route line: METHOD  /path  controller.action(params)
    // Columns are whitespace-separated
    const parts = trimmed.split(/\s+/)
    if (parts.length < 3) continue

    const method = parts[0].toUpperCase() as HttpMethod
    if (!HTTP_METHODS.has(method)) continue

    const path = parts[1]
    if (!path.startsWith('/')) continue

    // Extract path params: :id or *rest (wildcard)
    const parameters: RawApiParameter[] = []
    for (const m of path.matchAll(/[:*](\w+)/g)) {
      parameters.push({ name: m[1], location: 'path', required: true })
    }

    // Controller action: controllers.UserController.show(id: Long, page: Option[Int])
    // Extract query params from action signature (those not in path)
    const actionStr = parts.slice(2).join(' ')
    const actionMatch = actionStr.match(/(\w+(?:\.\w+)*)\.(\w+)\s*\(([^)]*)\)/)
    if (actionMatch) {
      const actionParams = actionMatch[3]
      if (actionParams.trim()) {
        const pathParamNames = new Set(parameters.map((p) => p.name))
        for (const param of actionParams.split(',')) {
          const paramMatch = param.trim().match(/(\w+)\s*:\s*(\S+)/)
          if (!paramMatch) continue
          const [, name, type] = paramMatch
          if (pathParamNames.has(name)) continue
          // Option[T] or Option[String] → optional query param
          const optional = type.startsWith('Option')
          parameters.push({ name, location: 'query', required: !optional })
        }
      }
    }

    endpoints.push({
      httpMethod: method,
      path: normalizePlayPath(path),
      parameters,
      tags: [],
      sourceFile: file,
      sourceLine: i + 1,
    })
  }

  if (endpoints.length === 0) return null

  return {
    name: file.split('/').pop() ?? 'routes',
    apiStyle: 'http',
    endpoints,
    sourceFile: file,
    sourceLine: 1,
  }
}

// ---- Helpers ----

function normalizePlayPath(path: string): string {
  // Convert :id → {id} and *rest → {rest} for consistency
  return path.replace(/:(\w+)/g, '{$1}').replace(/\*(\w+)/g, '{$1}')
}
