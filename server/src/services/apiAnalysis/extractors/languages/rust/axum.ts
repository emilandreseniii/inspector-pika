import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

const AXUM_VERB_MAP: Record<string, HttpMethod> = {
  get: 'GET', post: 'POST', put: 'PUT', patch: 'PATCH',
  delete: 'DELETE', head: 'HEAD', options: 'OPTIONS',
}

export class AxumExtractor extends BaseApiExtractor {
  readonly extractorId = 'rust.axum'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep('**/*.rs', /Router::new\(\)|axum::routing::|\.route\s*\(/)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseAxumFile(content, file, this.extractorId)
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

function parseAxumFile(content: string, file: string, extractorId: string): RawApiSurface | null {
  const endpoints: RawEndpoint[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    // .route("/path", get(handler)) or .route("/path", post(handler).layer(...))
    const routeMatch = trimmed.match(/\.route\s*\(\s*["']([^"']+)["']\s*,\s*(.+)/)
    if (!routeMatch) continue

    const path = normalizePath(routeMatch[1])
    const verbPart = routeMatch[2]

    // Extract all verb(handler) calls from the verb part
    for (const [verb, method] of Object.entries(AXUM_VERB_MAP)) {
      const verbRe = new RegExp('\\b' + verb + '\\s*\\(\\s*(\\w+)')
      const m = verbPart.match(verbRe)
      if (m) {
        const parameters = extractPathParams(path)
        endpoints.push({
          httpMethod: method,
          path,
          operationName: m[1],
          parameters,
          tags: [],
          sourceFile: file,
          sourceLine: i + 1,
        })
      }
    }
  }

  if (endpoints.length === 0) return null

  return {
    name: file.split('/').pop()?.replace(/\.rs$/, '') ?? 'axum',
    apiStyle: 'http',
    endpoints,
    sourceFile: file,
    sourceLine: 1,
  }
}

function normalizePath(path: string): string {
  // Axum uses :param style, convert to standard
  return path.startsWith('/') ? path : '/' + path
}

function extractPathParams(path: string): RawApiParameter[] {
  const params: RawApiParameter[] = []
  for (const m of path.matchAll(/:(\w+)/g)) {
    params.push({ name: m[1], location: 'path', required: true })
  }
  return params
}
