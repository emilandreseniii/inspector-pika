import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

const CHI_METHODS: Record<string, HttpMethod> = {
  Get: 'GET', Post: 'POST', Put: 'PUT', Delete: 'DELETE',
  Patch: 'PATCH', Head: 'HEAD', Options: 'OPTIONS',
}

export class ChiExtractor extends BaseApiExtractor {
  readonly extractorId = 'go.chi'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep(
      '**/*.go',
      /chi\.NewRouter\s*\(\s*\)|go-chi\/chi/,
      2000,
    )
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseChiFile(content, file)
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

function parseChiFile(content: string, file: string): RawApiSurface | null {
  const routerVars = detectChiVars(content)
  if (routerVars.size === 0) return null

  const stripped = stripComments(content)
  const lines = stripped.split('\n')
  const endpoints: RawEndpoint[] = []

  const methods = Object.keys(CHI_METHODS).join('|')
  const varPattern = [...routerVars].map(escapeRegex).join('|')
  const routeRe = new RegExp(`(?:${varPattern})\\.(${methods})\\s*\\(\\s*"([^"]*)"`)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const m = line.match(routeRe)
    if (!m) continue

    const httpMethod = CHI_METHODS[m[1]]
    if (!httpMethod) continue
    const path = m[2]
    if (!path.startsWith('/')) continue

    const parameters = extractPathParams(path)
    endpoints.push({ httpMethod, path, parameters, tags: [], sourceFile: file, sourceLine: i + 1 })
  }

  if (endpoints.length === 0) return null

  const surfaceName = file.split('/').pop()?.replace(/\.go$/, '') ?? file
  return { name: surfaceName, apiStyle: 'http', endpoints, sourceFile: file, sourceLine: 1 }
}

function detectChiVars(content: string): Set<string> {
  const vars = new Set<string>()
  for (const m of content.matchAll(/(\w+)\s*:?=\s*chi\.NewRouter\s*\(/g)) vars.add(m[1])
  // From usage: r.Get("/..."), router.Post("/...")
  for (const m of content.matchAll(/\b(\w+)\.(Get|Post|Put|Delete|Patch|Head|Options)\s*\(\s*"/g)) {
    if (!['c', 'ctx', 'w', 'req', 'r', 'resp'].includes(m[1])) vars.add(m[1])
  }
  return vars
}

function extractPathParams(path: string): RawApiParameter[] {
  const params: RawApiParameter[] = []
  // Chi uses {param} style
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
