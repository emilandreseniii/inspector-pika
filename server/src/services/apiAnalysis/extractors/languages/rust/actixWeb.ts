import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

const ACTIX_ATTR_MAP: Record<string, HttpMethod> = {
  get: 'GET', post: 'POST', put: 'PUT', patch: 'PATCH',
  delete: 'DELETE', head: 'HEAD', options: 'OPTIONS',
}

export class ActixWebExtractor extends BaseApiExtractor {
  readonly extractorId = 'rust.actix_web'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep('**/*.rs', /#\[(?:get|post|put|patch|delete|head|options)\s*\(|web::(?:get|post|put|patch|delete)\(\)|App::new\(\)/)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseActixFile(content, file, this.extractorId)
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

function parseActixFile(content: string, file: string, extractorId: string): RawApiSurface | null {
  const endpoints: RawEndpoint[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    // #[get("/path")] or #[post("/path")]
    for (const [attr, method] of Object.entries(ACTIX_ATTR_MAP)) {
      const attrRe = new RegExp('^#\\[' + attr + '\\s*\\(\\s*["\'](/[^"\']*)["\']')
      const m = trimmed.match(attrRe)
      if (m) {
        const path = m[1]
        const parameters = extractPathParams(path)
        // Find the fn name on the next non-empty line
        let operationName: string | undefined
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
          const fnMatch = lines[j].trim().match(/^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/)
          if (fnMatch) { operationName = fnMatch[1]; break }
        }
        endpoints.push({ httpMethod: method, path, operationName, parameters, tags: [], sourceFile: file, sourceLine: i + 1 })
        break
      }
    }

    // web::get().to(handler) pattern: .route("/path", web::get().to(handler))
    const routeMatch = trimmed.match(/\.route\s*\(\s*["']([^"']+)["']\s*,\s*web::(\w+)\(\)/)
    if (routeMatch) {
      const path = routeMatch[1].startsWith('/') ? routeMatch[1] : '/' + routeMatch[1]
      const verb = routeMatch[2].toLowerCase()
      const method = ACTIX_ATTR_MAP[verb]
      if (method) {
        const parameters = extractPathParams(path)
        endpoints.push({ httpMethod: method, path, parameters, tags: [], sourceFile: file, sourceLine: i + 1 })
      }
    }
  }

  if (endpoints.length === 0) return null

  return {
    name: file.split('/').pop()?.replace(/\.rs$/, '') ?? 'actix',
    apiStyle: 'http',
    endpoints,
    sourceFile: file,
    sourceLine: 1,
  }
}

function extractPathParams(path: string): RawApiParameter[] {
  const params: RawApiParameter[] = []
  // Actix uses {param} style
  for (const m of path.matchAll(/\{(\w+)(?::[^}]*)?\}/g)) {
    params.push({ name: m[1], location: 'path', required: true })
  }
  return params
}
