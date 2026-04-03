import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

const ECHO_METHODS: Record<string, HttpMethod> = {
  GET: 'GET', POST: 'POST', PUT: 'PUT', DELETE: 'DELETE',
  PATCH: 'PATCH', HEAD: 'HEAD', OPTIONS: 'OPTIONS',
}

export class EchoExtractor extends BaseApiExtractor {
  readonly extractorId = 'go.echo'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep(
      '**/*.go',
      /echo\.New\s*\(\s*\)|echo\.Echo|labstack\/echo/,
      2000,
    )
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseEchoFile(content, file)
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

function parseEchoFile(content: string, file: string): RawApiSurface | null {
  const routerVars = detectEchoVars(content)
  if (routerVars.size === 0) return null

  const stripped = stripComments(content)
  const lines = stripped.split('\n')
  const endpoints: RawEndpoint[] = []

  const methods = Object.keys(ECHO_METHODS).join('|')
  const varPattern = [...routerVars].map(escapeRegex).join('|')
  const routeRe = new RegExp(`(?:${varPattern})\\.(${methods})\\s*\\(\\s*"([^"]*)"`, 'i')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const m = line.match(routeRe)
    if (!m) continue

    const httpMethod = ECHO_METHODS[m[1].toUpperCase()]
    const path = m[2]
    if (!path.startsWith('/')) continue

    const parameters = extractPathParams(path)
    endpoints.push({ httpMethod, path, parameters, tags: [], sourceFile: file, sourceLine: i + 1 })
  }

  if (endpoints.length === 0) return null

  const surfaceName = file.split('/').pop()?.replace(/\.go$/, '') ?? file
  return { name: surfaceName, apiStyle: 'http', endpoints, sourceFile: file, sourceLine: 1 }
}

function detectEchoVars(content: string): Set<string> {
  const vars = new Set<string>()
  for (const m of content.matchAll(/(\w+)\s*:?=\s*echo\.New\s*\(/g)) vars.add(m[1])
  // Groups: g := e.Group("/api")
  for (const m of content.matchAll(/(\w+)\s*:?=\s*\w+\.Group\s*\(/g)) vars.add(m[1])
  // From usage
  for (const m of content.matchAll(/\b(\w+)\.(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s*\(\s*"/gi)) {
    if (!['c', 'ctx', 'w', 'r', 'req', 'resp'].includes(m[1])) vars.add(m[1])
  }
  return vars
}

function extractPathParams(path: string): RawApiParameter[] {
  const params: RawApiParameter[] = []
  // Echo uses :param style
  for (const m of path.matchAll(/:(\w+)/g)) {
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
