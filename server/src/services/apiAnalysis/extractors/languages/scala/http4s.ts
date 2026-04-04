import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

/**
 * Extracts API surfaces from http4s (Scala).
 *
 * Key pattern — partial function routing:
 *   HttpRoutes.of[F] {
 *     case GET -> Root / "users"          => Ok(listUsers)
 *     case GET -> Root / "users" / id     => Ok(getUser(id))
 *     case POST -> Root / "users"         => Created(createUser)
 *     case DELETE -> Root / "users" / id  => NoContent()
 *   }
 *
 * Also handles:
 *   case req @ GET -> Root / "upload" => ...
 */

const METHOD_MAP: Record<string, HttpMethod> = {
  GET: 'GET', POST: 'POST', PUT: 'PUT', PATCH: 'PATCH',
  DELETE: 'DELETE', HEAD: 'HEAD', OPTIONS: 'OPTIONS',
}

export class Http4sExtractor extends BaseApiExtractor {
  readonly extractorId = 'scala.http4s'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep(
      '**/*.scala',
      /HttpRoutes\.of|case\s+(?:\w+\s*@\s*)?(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*->/,
      2000,
    )
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        if (!isHttp4sFile(content)) continue
        const parsed = parseHttp4sFile(content, file)
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

function isHttp4sFile(content: string): boolean {
  return /org\.http4s|import\s+org\.http4s/.test(content)
}

function parseHttp4sFile(content: string, file: string): RawApiSurface | null {
  const stripped = stripComments(content)
  const endpoints: RawEndpoint[] = []

  // Match: case GET -> Root / "users" / id =>
  // or:    case req @ GET -> Root / "users" =>
  // Capture: method, path segments
  const CASE_RE = /case\s+(?:\w+\s*@\s*)?(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*->\s*Root((?:\s*\/\s*(?:"[^"]*"|\w+))*)/g

  for (const m of stripped.matchAll(CASE_RE)) {
    const methodStr = m[1]
    const httpMethod = METHOD_MAP[methodStr]
    if (!httpMethod) continue

    const segmentsStr = m[2] ?? ''
    const segments: string[] = []
    const params: RawApiParameter[] = []

    for (const segMatch of segmentsStr.matchAll(/\/\s*(?:"([^"]+)"|(\w+))/g)) {
      if (segMatch[1] !== undefined) {
        // Quoted string — literal segment
        segments.push(segMatch[1])
      } else {
        // Unquoted identifier — path variable (unless it's a well-known keyword)
        const varName = segMatch[2]
        if (varName === 'Root') continue
        segments.push(`{${varName}}`)
        params.push({ name: varName, location: 'path', required: true })
      }
    }

    const path = segments.length > 0 ? `/${segments.join('/')}` : '/'

    endpoints.push({ httpMethod, path, parameters: params, tags: [], sourceFile: file })
  }

  if (endpoints.length === 0) return null

  return {
    name: file.split('/').pop()?.replace(/\.scala$/, '') ?? file,
    apiStyle: 'http',
    endpoints,
    sourceFile: file,
  }
}

function stripComments(code: string): string {
  return code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}
