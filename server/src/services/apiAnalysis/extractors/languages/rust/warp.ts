import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

const METHOD_MAP: Record<string, HttpMethod> = {
  get: 'GET', post: 'POST', put: 'PUT', delete: 'DELETE',
  patch: 'PATCH', head: 'HEAD', options: 'OPTIONS',
}

/**
 * Extracts API surfaces from Warp framework (Rust).
 *
 * Warp uses filter combinators:
 *   let route = warp::path("users")
 *     .and(warp::get())
 *     .and_then(list_users);
 *
 *   let route = warp::path!("users" / u32)
 *     .and(warp::get())
 *     .and_then(get_user);
 *
 *   let route = warp::post()
 *     .and(warp::path("users"))
 *     .and(warp::body::json())
 *     .and_then(create_user);
 */
export class WarpExtractor extends BaseApiExtractor {
  readonly extractorId = 'rust.warp'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep(
      '**/*.rs',
      /warp::(?:path|get|post|put|delete|patch|filter)/,
      2000,
    )
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseWarpFile(content, file)
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

function parseWarpFile(content: string, file: string): RawApiSurface | null {
  if (!/use\s+warp|extern\s+crate\s+warp/.test(content)) return null

  const stripped = stripComments(content)
  const endpoints: RawEndpoint[] = []

  // Strategy: find warp::path!("a" / "b") or warp::path("a") patterns
  // and correlate with HTTP method filters on the same filter chain

  // Find all warp::path! macro usages
  // warp::path!("users" / u32) → /users/{_}
  // warp::path("users") → /users
  for (const m of stripped.matchAll(/warp::path!\s*\(([^)]+)\)/g)) {
    const pathExpr = m[1]
    const path = parsWarpPath(pathExpr)
    const method = findNearbyMethod(stripped, m.index ?? 0)
    if (method) {
      endpoints.push({
        httpMethod: method,
        path,
        parameters: extractPathParams(path),
        tags: [],
        sourceFile: file,
      })
    }
  }

  // warp::path("segment") simple form
  for (const m of stripped.matchAll(/warp::path\s*\(\s*"([^"]+)"\s*\)/g)) {
    const path = `/${m[1]}`
    const method = findNearbyMethod(stripped, m.index ?? 0)
    if (method) {
      endpoints.push({
        httpMethod: method,
        path,
        parameters: [],
        tags: [],
        sourceFile: file,
      })
    }
  }

  if (endpoints.length === 0) return null

  return {
    name: file.split('/').pop()?.replace(/\.rs$/, '') ?? file,
    apiStyle: 'http',
    endpoints,
    sourceFile: file,
  }
}

// ---- Helpers ----

function parsWarpPath(pathExpr: string): string {
  // "users" / u32 / "posts" → /users/{u32}/posts
  const parts = pathExpr.split('/').map((s) => {
    const trimmed = s.trim()
    // If quoted, it's a string literal segment
    if (/^["']/.test(trimmed)) {
      return trimmed.replace(/^["']|["']$/g, '')
    }
    // Otherwise it's a Rust type — treat as path parameter
    if (/^[A-Za-z][A-Za-z0-9_]*$/.test(trimmed)) {
      return `{${trimmed}}`
    }
    return trimmed
  })
  return '/' + parts.join('/')
}

function findNearbyMethod(content: string, pos: number): HttpMethod | null {
  // Look in the 400 chars AFTER the path definition for the HTTP method
  // (warp filter chains are .and(warp::get()).and(...))
  const forward = content.slice(pos, Math.min(content.length, pos + 400))
  const methodMatch = forward.match(/warp::(get|post|put|delete|patch|head|options)\s*\(\s*\)/)
  if (methodMatch) {
    return METHOD_MAP[methodMatch[1]] ?? null
  }
  // Also check 200 chars before (some patterns put method first)
  const backward = content.slice(Math.max(0, pos - 200), pos)
  const backMatch = backward.match(/warp::(get|post|put|delete|patch|head|options)\s*\(\s*\)\s*$/)
  if (backMatch) {
    return METHOD_MAP[backMatch[1]] ?? null
  }
  return null
}

function extractPathParams(path: string): RawApiParameter[] {
  const params: RawApiParameter[] = []
  for (const m of path.matchAll(/\{([^}]+)\}/g)) {
    params.push({ name: m[1], location: 'path', required: true })
  }
  return params
}

function stripComments(code: string): string {
  return code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}
