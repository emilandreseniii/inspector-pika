import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

/**
 * Extracts API surfaces from Akka HTTP (Scala).
 *
 * Key patterns — directive DSL:
 *   path("users") { get { complete(...) } }
 *   path("users" / LongNumber) { id => get { complete(...) } }
 *   pathPrefix("api") { path("users") { ... } }
 *   (get & path("ping")) { complete(...) }
 *
 * HTTP method directives: get, post, put, patch, delete, head, options
 */

const METHOD_MAP: Record<string, HttpMethod> = {
  get: 'GET', post: 'POST', put: 'PUT', patch: 'PATCH',
  delete: 'DELETE', head: 'HEAD', options: 'OPTIONS',
}

export class AkkaHttpExtractor extends BaseApiExtractor {
  readonly extractorId = 'scala.akka_http'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep(
      '**/*.scala',
      /\bpath\s*\(|pathPrefix\s*\(|pathEnd\b|akka\.http/,
      2000,
    )
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        if (!isAkkaHttpFile(content)) continue
        const parsed = parseAkkaHttpFile(content, file)
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

function isAkkaHttpFile(content: string): boolean {
  return /akka\.http\.scaladsl|import\s+akka\.http/.test(content)
}

function parseAkkaHttpFile(content: string, file: string): RawApiSurface | null {
  const stripped = stripComments(content)
  const endpoints: RawEndpoint[] = []

  // Strategy: scan for path("segment") / pathPrefix("segment") directives
  // and find HTTP method directives nearby (within 500 chars forward)

  // Simple path: path("users")
  for (const m of stripped.matchAll(/\bpath\s*\(\s*"([^"]+)"\s*\)/g)) {
    const pathStr = `/${m[1]}`
    for (const method of findAllMethods(stripped, m.index ?? 0)) {
      endpoints.push({ httpMethod: method, path: pathStr, parameters: [], tags: [], sourceFile: file })
    }
  }

  // Path with segments: path("users" / LongNumber) or path("users" / Segment)
  for (const m of stripped.matchAll(/\bpath\s*\(\s*"([^"]+)"\s*\/\s*(\w+)\s*\)/g)) {
    const prefix = m[1]
    const segType = m[2]
    const paramName = segTypeToParam(segType)
    const pathStr = `/${prefix}/{${paramName}}`
    for (const method of findAllMethods(stripped, m.index ?? 0)) {
      endpoints.push({
        httpMethod: method,
        path: pathStr,
        parameters: [{ name: paramName, location: 'path', required: true }],
        tags: [],
        sourceFile: file,
      })
    }
  }

  // pathPrefix("segment") — look for nested path / pathEnd
  for (const m of stripped.matchAll(/\bpathPrefix\s*\(\s*"([^"]+)"\s*\)/g)) {
    const prefix = `/${m[1]}`
    const after = stripped.slice(m.index ?? 0, Math.min(stripped.length, (m.index ?? 0) + 800))
    // Find nested path directives
    for (const pm of after.matchAll(/\bpath\s*\(\s*"([^"]+)"\s*\)/g)) {
      const fullPath = `${prefix}/${pm[1]}`
      for (const method of findAllMethods(after, pm.index ?? 0)) {
        endpoints.push({ httpMethod: method, path: fullPath, parameters: [], tags: [], sourceFile: file })
      }
    }
    // pathEnd inside pathPrefix → the prefix itself is the route
    if (/\bpathEnd\b/.test(after.slice(0, 400))) {
      const endIdx = after.search(/\bpathEnd\b/)
      for (const method of findAllMethods(after, endIdx)) {
        if (!endpoints.find((e) => e.path === prefix && e.httpMethod === method)) {
          endpoints.push({ httpMethod: method, path: prefix, parameters: [], tags: [], sourceFile: file })
        }
      }
    }
  }

  if (endpoints.length === 0) return null

  return {
    name: file.split('/').pop()?.replace(/\.scala$/, '') ?? file,
    apiStyle: 'http',
    endpoints,
    sourceFile: file,
  }
}

// ---- Helpers ----

function findAllMethods(content: string, pos: number, windowSize = 600): HttpMethod[] {
  const window = content.slice(pos, Math.min(content.length, pos + windowSize))
  const methods: HttpMethod[] = []
  for (const m of window.matchAll(/\b(get|post|put|patch|delete|head|options)\s*(?:\{|&)/g)) {
    const method = METHOD_MAP[m[1]]
    if (method && !methods.includes(method)) methods.push(method)
  }
  return methods
}

function segTypeToParam(segType: string): string {
  const map: Record<string, string> = {
    LongNumber: 'id', IntNumber: 'id', JavaUUID: 'id',
    Segment: 'segment', RemainingPath: 'path',
  }
  return map[segType] ?? segType.toLowerCase()
}

function stripComments(code: string): string {
  return code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}
