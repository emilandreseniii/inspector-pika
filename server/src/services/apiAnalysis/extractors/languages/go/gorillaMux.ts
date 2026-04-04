import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

/**
 * Extracts API surfaces from gorilla/mux routers.
 *
 * Key patterns:
 *   r := mux.NewRouter()
 *   r.HandleFunc("/path", handler).Methods("GET", "POST")
 *   s := r.PathPrefix("/api").Subrouter()
 *   s.HandleFunc("/users", handler).Methods("GET")
 *
 * Path params use {param} or {param:regex} syntax (same as Chi).
 */
export class GorillaMuxExtractor extends BaseApiExtractor {
  readonly extractorId = 'go.gorilla_mux'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep('**/*.go', /mux\.NewRouter\s*\(\s*\)|gorilla\/mux/, 2000)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseGorillaMuxFile(content, file)
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

function parseGorillaMuxFile(content: string, file: string): RawApiSurface | null {
  const stripped = stripComments(content)
  const lines = stripped.split('\n')

  // Collect all router/subrouter variable names and their path prefixes
  // mux.NewRouter() → prefix ""
  // r.PathPrefix("/api").Subrouter() → prefix "/api"
  const routerPrefixes = new Map<string, string>()

  for (const line of lines) {
    // r := mux.NewRouter()
    const newRouter = line.match(/(\w+)\s*:?=\s*mux\.NewRouter\s*\(/)
    if (newRouter) { routerPrefixes.set(newRouter[1], ''); continue }

    // s := r.PathPrefix("/api").Subrouter()
    const subrouter = line.match(/(\w+)\s*:?=\s*(\w+)\.PathPrefix\s*\(\s*"([^"]*)"\s*\)\.Subrouter\s*\(/)
    if (subrouter) {
      const [, newVar, parentVar, prefix] = subrouter
      const parentPrefix = routerPrefixes.get(parentVar) ?? ''
      routerPrefixes.set(newVar, parentPrefix + prefix)
    }
  }

  if (routerPrefixes.size === 0) return null

  const endpoints: RawEndpoint[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // r.HandleFunc("/path", handler)   — optionally chained with .Methods(...)
    // May span two lines when .Methods(...) is on the next line
    const handleFuncMatch = line.match(/(\w+)\.HandleFunc\s*\(\s*"([^"]*)"/)
    if (!handleFuncMatch) continue

    const routerVar = handleFuncMatch[1]
    if (!routerPrefixes.has(routerVar)) continue

    const subPath = handleFuncMatch[2]
    const prefix = routerPrefixes.get(routerVar) ?? ''
    const fullPath = joinPaths(prefix, subPath)

    // Look for .Methods(...) on same line or next non-blank line
    let methodsLine = line
    if (!/\.Methods\s*\(/.test(line) && i + 1 < lines.length) {
      const next = lines[i + 1].trim()
      if (next.startsWith('.Methods')) methodsLine = next
    }

    const methods = extractMethods(methodsLine)
    const params = extractPathParams(fullPath)

    if (methods.length === 0) {
      // No method constraint → treat as ANY (use GET as placeholder)
      endpoints.push({ httpMethod: undefined, path: fullPath, parameters: params, tags: [], sourceFile: file, sourceLine: i + 1 })
    } else {
      for (const method of methods) {
        endpoints.push({ httpMethod: method, path: fullPath, parameters: params, tags: [], sourceFile: file, sourceLine: i + 1 })
      }
    }
  }

  if (endpoints.length === 0) return null

  const surfaceName = file.split('/').pop()?.replace(/\.go$/, '') ?? file
  return { name: surfaceName, apiStyle: 'http', endpoints, sourceFile: file, sourceLine: 1 }
}

// ---- Helpers ----

function extractMethods(line: string): HttpMethod[] {
  const m = line.match(/\.Methods\s*\(\s*((?:"[A-Z]+"(?:\s*,\s*"[A-Z]+")*)\s*)\)/)
  if (!m) return []
  const methods: HttpMethod[] = []
  for (const mm of m[1].matchAll(/"([A-Z]+)"/g)) {
    methods.push(mm[1] as HttpMethod)
  }
  return methods
}

function extractPathParams(path: string): RawApiParameter[] {
  const params: RawApiParameter[] = []
  for (const m of path.matchAll(/\{(\w+)(?::[^}]*)?\}/g)) {
    params.push({ name: m[1], location: 'path', required: true })
  }
  return params
}

function joinPaths(base: string, sub: string): string {
  if (!base && !sub) return '/'
  if (!sub) return base || '/'
  if (!base) return sub.startsWith('/') ? sub : '/' + sub
  const b = base.endsWith('/') ? base.slice(0, -1) : base
  const s = sub.startsWith('/') ? sub : '/' + sub
  return b + s
}

function stripComments(code: string): string {
  return code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}
