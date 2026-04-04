import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']

/**
 * Extracts API surfaces from Sanic applications.
 *
 * Patterns detected:
 *   @app.get("/path")
 *   @app.post("/path")
 *   @bp.route("/path", methods=["GET", "POST"])
 *
 * Path parameters use <param> syntax.
 */
export class SanicExtractor extends BaseApiExtractor {
  readonly extractorId = 'python.sanic'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep(
      '**/*.py',
      /(?:from\s+sanic\s+import|import\s+sanic\b|Sanic\s*\()/,
      2000,
    )
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseSanicFile(content, file)
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

const DECORATOR_RE = /^@(\w+)\.(get|post|put|delete|patch|head|options|route)\s*\(\s*["']([^"']+)["']/i
const ROUTE_METHODS_RE = /methods\s*=\s*\[([^\]]*)\]/

function parseSanicFile(content: string, file: string): RawApiSurface | null {
  const appVarNames = detectAppVars(content)
  if (appVarNames.size === 0) return null

  const lines = content.split('\n')
  const endpoints: RawEndpoint[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('@')) continue

    const m = trimmed.match(DECORATOR_RE)
    if (!m) continue

    const varName = m[1]
    if (!appVarNames.has(varName)) continue

    const methodStr = m[2].toLowerCase()
    const path = m[3]
    const params = extractPathParams(path)

    if (methodStr === 'route') {
      const methodsMatch = trimmed.match(ROUTE_METHODS_RE)
      const methods = methodsMatch ? parseMethodsList(methodsMatch[1]) : (['GET'] as HttpMethod[])
      for (const method of methods) {
        endpoints.push({ httpMethod: method, path, parameters: params, tags: [], sourceFile: file })
      }
    } else {
      endpoints.push({ httpMethod: methodStr.toUpperCase() as HttpMethod, path, parameters: params, tags: [], sourceFile: file })
    }
  }

  if (endpoints.length === 0) return null

  return {
    name: file.split('/').pop()?.replace(/\.py$/, '') ?? file,
    apiStyle: 'http',
    endpoints,
    sourceFile: file,
  }
}

// ---- Helpers ----

function detectAppVars(content: string): Set<string> {
  const vars = new Set<string>()
  // app = Sanic("name") or bp = Blueprint("name")
  for (const m of content.matchAll(/^(\w+)\s*=\s*(?:Sanic|Blueprint)\s*\(/gm)) {
    vars.add(m[1])
  }
  return vars
}

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
  // Sanic uses <param> and <param:type> syntax
  for (const m of path.matchAll(/<([^>:]+)(?::[^>]*)?>\/*/g)) {
    params.push({ name: m[1], location: 'path', required: true })
  }
  return params
}
