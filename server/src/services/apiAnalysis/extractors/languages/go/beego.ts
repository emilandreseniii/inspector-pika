import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

/**
 * Extracts API surfaces from Beego framework applications.
 *
 * Beego patterns:
 *   beego.Router("/path", &UserController{})
 *   beego.Router("/path", &UserController{}, "get:GetAll;post:Create")
 *   web.Router("/path", &UserController{})
 *   beego.AutoRouter(&UserController{})
 *
 * Controller method conventions:
 *   Get() → GET
 *   Post() → POST
 *   Put() → PUT
 *   Delete() → DELETE
 *   Patch() → PATCH
 *   Head() → HEAD
 *   Options() → OPTIONS
 */
export class BeegoExtractor extends BaseApiExtractor {
  readonly extractorId = 'go.beego'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep(
      '**/*.go',
      /(?:beego|web)\.(?:Router|AutoRouter|RESTRouter|NS|NewNamespace|NSRouter)/,
      2000,
    )
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseBeegoFile(content, file)
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

const DEFAULT_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
const METHOD_MAP: Record<string, HttpMethod> = {
  get: 'GET', post: 'POST', put: 'PUT', delete: 'DELETE',
  patch: 'PATCH', head: 'HEAD', options: 'OPTIONS',
}

function parseBeegoFile(content: string, file: string): RawApiSurface | null {
  const stripped = stripComments(content)
  const lines = stripped.split('\n')
  const endpoints: RawEndpoint[] = []

  for (const line of lines) {
    const trimmed = line.trim()

    // beego.Router("/path", &Controller{}) or beego.Router("/path", &Controller{}, "get:Method;post:Other")
    // web.Router("/path", &Controller{})
    const routerMatch = trimmed.match(/(?:beego|web)\.(?:NS)?Router\s*\(\s*"([^"]+)"\s*,\s*&[\w.]+\s*\{[^}]*\}(?:\s*,\s*"([^"]*)")?/)
    if (routerMatch) {
      const path = routerMatch[1]
      const methodsStr = routerMatch[2]
      const params = extractPathParams(path)

      if (methodsStr) {
        // Parse method mapping: "get:GetAll;post:Create"
        const methods = parseBeegoMethods(methodsStr)
        for (const method of methods) {
          endpoints.push({ httpMethod: method, path, parameters: params, tags: [], sourceFile: file })
        }
      } else {
        // Default: controller handles all HTTP methods via Get/Post/etc methods
        for (const method of DEFAULT_METHODS) {
          endpoints.push({ httpMethod: method, path, parameters: params, tags: [], sourceFile: file })
        }
      }
      continue
    }

    // NSRouter("/path", &Controller{}) inside namespace
    const nsRouterMatch = trimmed.match(/NSRouter\s*\(\s*"([^"]+)"\s*,\s*&[\w.]+/)
    if (nsRouterMatch) {
      const path = nsRouterMatch[1]
      const params = extractPathParams(path)
      for (const method of DEFAULT_METHODS) {
        endpoints.push({ httpMethod: method, path, parameters: params, tags: [], sourceFile: file })
      }
    }
  }

  if (endpoints.length === 0) return null

  return {
    name: file.split('/').pop()?.replace(/\.go$/, '') ?? file,
    apiStyle: 'http',
    endpoints,
    sourceFile: file,
  }
}

// ---- Helpers ----

function parseBeegoMethods(methodsStr: string): HttpMethod[] {
  const methods: HttpMethod[] = []
  // Format: "get:GetAll;post:Create;delete:Delete"
  for (const part of methodsStr.split(';')) {
    const httpMethod = part.split(':')[0].toLowerCase().trim()
    const mapped = METHOD_MAP[httpMethod]
    if (mapped) methods.push(mapped)
  }
  return methods.length > 0 ? methods : DEFAULT_METHODS
}

function extractPathParams(path: string): RawApiParameter[] {
  const params: RawApiParameter[] = []
  // Beego uses :param syntax
  for (const m of path.matchAll(/:([a-zA-Z_]\w*)/g)) {
    params.push({ name: m[1], location: 'path', required: true })
  }
  return params
}

function stripComments(code: string): string {
  return code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}
