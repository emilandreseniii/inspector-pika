import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

const METHOD_MAP: Record<string, HttpMethod> = {
  get: 'GET', post: 'POST', put: 'PUT', delete: 'DELETE',
  patch: 'PATCH', head: 'HEAD', options: 'OPTIONS',
}

/**
 * Extracts API surfaces from the poem web framework (Rust).
 *
 * Key pattern:
 *   Route::new()
 *     .at("/users", get(list_users).post(create_user))
 *     .at("/users/:id", get(get_user).delete(delete_user));
 *
 * Handler functions are marked with #[handler].
 * Path params use :param syntax.
 */
export class PoemExtractor extends BaseApiExtractor {
  readonly extractorId = 'rust.poem'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep('**/*.rs', /Route::new\s*\(\s*\)|#\[handler\]|\.at\s*\(/, 2000)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        if (!isPoemFile(content)) continue
        const parsed = parsePoemFile(content, file)
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

function isPoemFile(content: string): boolean {
  return /use\s+poem::|extern\s+crate\s+poem/.test(content)
}

function parsePoemFile(content: string, file: string): RawApiSurface | null {
  const stripped = stripComments(content)
  const endpoints: RawEndpoint[] = []

  // Find .at("/path", <methods>) patterns
  // The method chain after the path can look like: get(handler), get(h).post(h2), etc.
  // We join continuation lines to handle multi-line chains
  const joined = stripped.replace(/\n\s*/g, ' ')

  const AT_PATH_RE = /\.at\s*\(\s*"([^"]+)"\s*,\s*/g
  let atMatch: RegExpExecArray | null
  while ((atMatch = AT_PATH_RE.exec(joined)) !== null) {
    const path = atMatch[1]
    const methodStart = atMatch.index + atMatch[0].length
    // Find the matching closing paren for .at( using depth counting
    const methodEnd = findBalancedParenEnd(joined, methodStart)
    if (methodEnd === -1) continue
    const methodExpr = joined.slice(methodStart, methodEnd)

    const methods: HttpMethod[] = []
    for (const mm of methodExpr.matchAll(/\b(get|post|put|delete|patch|head|options)\s*\(/g)) {
      const method = METHOD_MAP[mm[1]]
      if (method && !methods.includes(method)) methods.push(method)
    }

    if (methods.length === 0) continue

    const parameters = extractPathParams(path)
    for (const method of methods) {
      endpoints.push({ httpMethod: method, path, parameters, tags: [], sourceFile: file })
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

/**
 * Starting at `pos` (just after the opening paren of a call), scan forward
 * and return the index of the matching closing paren. Returns -1 if not found.
 */
function findBalancedParenEnd(text: string, pos: number): number {
  let depth = 1
  for (let i = pos; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function extractPathParams(path: string): RawApiParameter[] {
  const params: RawApiParameter[] = []
  // poem uses :param syntax
  for (const m of path.matchAll(/:(\w+)/g)) {
    params.push({ name: m[1], location: 'path', required: true })
  }
  return params
}

function stripComments(code: string): string {
  return code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}
