import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter } from '../../base'

export class NetHttpExtractor extends BaseApiExtractor {
  readonly extractorId = 'go.net_http'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep(
      '**/*.go',
      /http\.HandleFunc\s*\(|http\.Handle\s*\(|mux\.Handle|ServeMux/,
      2000,
    )
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseNetHttpFile(content, file)
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

function parseNetHttpFile(content: string, file: string): RawApiSurface | null {
  const stripped = stripComments(content)
  const lines = stripped.split('\n')
  const endpoints: RawEndpoint[] = []

  // Detect mux variable names: mux := http.NewServeMux()
  const muxVars = new Set<string>(['http'])
  for (const m of content.matchAll(/(\w+)\s*:?=\s*http\.NewServeMux\s*\(/g)) {
    muxVars.add(m[1])
  }

  const varPattern = [...muxVars].map(escapeRegex).join('|')
  // http.HandleFunc("/path", handler) or mux.HandleFunc("/path", handler) or mux.Handle("/path", handler)
  const routeRe = new RegExp(
    `(?:${varPattern})\\.Handle(?:Func)?\\s*\\(\\s*"([^"]+)"`,
  )

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const m = line.match(routeRe)
    if (!m) continue

    const path = m[1]
    if (!path.startsWith('/')) continue

    const parameters = extractPathParams(path)
    // net/http handlers respond to all methods — emit a generic GET as sentinel
    endpoints.push({
      httpMethod: 'GET',
      path,
      parameters,
      tags: [],
      sourceFile: file,
      sourceLine: i + 1,
      metadata: { allMethods: true },
    })
  }

  if (endpoints.length === 0) return null

  const surfaceName = file.split('/').pop()?.replace(/\.go$/, '') ?? file
  return { name: surfaceName, apiStyle: 'http', endpoints, sourceFile: file, sourceLine: 1 }
}

function extractPathParams(path: string): RawApiParameter[] {
  const params: RawApiParameter[] = []
  for (const m of path.matchAll(/\{(\w+)(?::[^}]*)?\}/g)) {
    params.push({ name: m[1], location: 'path', required: true })
  }
  return params
}

function stripComments(code: string): string {
  let result = code.replace(/\/\/.*$/gm, '')
  result = result.replace(/\/\*[\s\S]*?\*\//g, '')
  return result
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
