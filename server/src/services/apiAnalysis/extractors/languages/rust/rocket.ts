import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

/**
 * Extracts API surfaces from Rocket web framework handlers.
 *
 * Key patterns:
 *   #[get("/users")]
 *   #[post("/users")]
 *   #[put("/users/<id>")]
 *   #[delete("/users/<id>")]
 *   #[patch("/users/<id>")]
 *
 * Path params use <param> syntax (optionally <param..> for rest segments).
 * Query params can appear in the function signature as standalone typed args.
 */

const ROCKET_ATTR_MAP: Record<string, HttpMethod> = {
  get: 'GET', post: 'POST', put: 'PUT', patch: 'PATCH',
  delete: 'DELETE', head: 'HEAD', options: 'OPTIONS',
}

export class RocketExtractor extends BaseApiExtractor {
  readonly extractorId = 'rust.rocket'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep('**/*.rs', /#\[(?:get|post|put|patch|delete|head|options)\s*\(/, 2000)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        // Only include files that also look like Rocket (import or macro usage)
        if (!isRocketFile(content)) continue
        const parsed = parseRocketFile(content, file)
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

function isRocketFile(content: string): boolean {
  return /rocket::|\brocket\b|#\!\[feature\s*\(proc_macro/.test(content) ||
    /extern\s+crate\s+rocket|use\s+rocket::/.test(content) ||
    /launch\s*\(\s*\)|Rocket::build/.test(content) ||
    // The grep already matched a route attribute — check Rocket-specific path syntax
    /<\w+>/.test(content)
}

function parseRocketFile(content: string, file: string): RawApiSurface | null {
  const endpoints: RawEndpoint[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    for (const [attr, method] of Object.entries(ROCKET_ATTR_MAP)) {
      // #[get("/path")] or #[get("/path?<query_param>")]
      const attrRe = new RegExp('^#\\[' + attr + '\\s*\\(\\s*["\']([^"\']*)["\']')
      const m = trimmed.match(attrRe)
      if (!m) continue

      const fullRoute = m[1]
      // Split route and optional query string: "/path?<q>"
      const [pathPart, queryPart] = fullRoute.split('?')
      const path = pathPart

      const parameters: RawApiParameter[] = [
        ...extractPathParams(path),
        ...extractQueryParams(queryPart ?? ''),
      ]

      // Find fn name on next non-empty line
      let operationName: string | undefined
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const fnMatch = lines[j].trim().match(/^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/)
        if (fnMatch) { operationName = fnMatch[1]; break }
      }

      endpoints.push({ httpMethod: method, path, operationName, parameters, tags: [], sourceFile: file, sourceLine: i + 1 })
    }
  }

  if (endpoints.length === 0) return null

  const surfaceName = file.split('/').pop()?.replace(/\.rs$/, '') ?? file
  return { name: surfaceName, apiStyle: 'http', endpoints, sourceFile: file, sourceLine: 1 }
}

// ---- Helpers ----

function extractPathParams(path: string): RawApiParameter[] {
  const params: RawApiParameter[] = []
  // Rocket uses <param> and <param..> (multi-segment)
  for (const m of path.matchAll(/<(\w+)\.{0,2}>/g)) {
    params.push({ name: m[1], location: 'path', required: true })
  }
  return params
}

function extractQueryParams(queryStr: string): RawApiParameter[] {
  if (!queryStr) return []
  const params: RawApiParameter[] = []
  // ?<name>&<other>  or just <name>
  for (const m of queryStr.matchAll(/<(\w+)>/g)) {
    params.push({ name: m[1], location: 'query', required: false })
  }
  return params
}
