import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

/**
 * Extracts API surfaces from Ktor routing DSL.
 *
 * Key patterns:
 *   routing {
 *     get("/users") { ... }
 *     post("/users") { ... }
 *     route("/users") {
 *       get { ... }
 *       get("/{id}") { ... }
 *       post { ... }
 *     }
 *   }
 *   // With Application.routing extension
 *   fun Application.configureRouting() {
 *     routing { get("/hello") { ... } }
 *   }
 *
 * Path params use {param} syntax.
 */

const KTOR_METHODS: Record<string, HttpMethod> = {
  get: 'GET', post: 'POST', put: 'PUT', patch: 'PATCH',
  delete: 'DELETE', head: 'HEAD', options: 'OPTIONS',
}

export class KtorExtractor extends BaseApiExtractor {
  readonly extractorId = 'kotlin.ktor'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep('**/*.{kt,kts}', /\brouting\s*\{|\broute\s*\(/, 2000)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseKtorFile(content, file)
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

function parseKtorFile(content: string, file: string): RawApiSurface | null {
  const stripped = stripComments(content)
  const lines = stripped.split('\n')
  const endpoints: RawEndpoint[] = []

  // Track depth and route prefix stack
  // Each entry in routeStack is { prefix: string, openedAtDepth: number }
  const routeStack: Array<{ prefix: string; openedAtDepth: number }> = [{ prefix: '', openedAtDepth: 0 }]
  let braceDepth = 0

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    // Count braces on this line
    const openBraces = (trimmed.match(/\{/g) ?? []).length
    const closeBraces = (trimmed.match(/\}/g) ?? []).length

    // route("/prefix") {  → push prefix at current depth
    const routeMatch = trimmed.match(/\broute\s*\(\s*["']([^"']+)["']\s*\)/)
    if (routeMatch && openBraces > closeBraces) {
      const parentPrefix = routeStack[routeStack.length - 1].prefix
      const newPrefix = joinPaths(parentPrefix, routeMatch[1])
      routeStack.push({ prefix: newPrefix, openedAtDepth: braceDepth + 1 })
    }

    braceDepth += openBraces - closeBraces

    // Pop prefixes that are no longer in scope
    while (routeStack.length > 1 && braceDepth < routeStack[routeStack.length - 1].openedAtDepth) {
      routeStack.pop()
    }

    // verb("/path") { }  or  verb { }
    for (const [verb, httpMethod] of Object.entries(KTOR_METHODS)) {
      const verbRe = new RegExp(`\\b${verb}\\s*(?:\\(\\s*["']([^"']+)["']\\s*\\))?\\s*\\{`)
      const m = trimmed.match(verbRe)
      if (!m) continue

      const subPath = m[1] ?? ''
      const parentPrefix = routeStack[routeStack.length - 1].prefix
      const fullPath = joinPaths(parentPrefix, subPath) || '/'

      endpoints.push({
        httpMethod,
        path: fullPath,
        parameters: extractPathParams(fullPath),
        tags: [],
        sourceFile: file,
        sourceLine: i + 1,
      })
      break
    }
  }

  if (endpoints.length === 0) return null

  const surfaceName = file.split('/').pop()?.replace(/\.kts?$/, '') ?? file
  return { name: surfaceName, apiStyle: 'http', endpoints, sourceFile: file, sourceLine: 1 }
}

// ---- Helpers ----

function extractPathParams(path: string): RawApiParameter[] {
  const params: RawApiParameter[] = []
  for (const m of path.matchAll(/\{(\w+)\}/g)) {
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
