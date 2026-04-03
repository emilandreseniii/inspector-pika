import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

export class HonoExtractor extends BaseApiExtractor {
  readonly extractorId = 'typescript.hono'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep(
      '**/*.{ts,js,mts,mjs}',
      /(?:require\s*\(\s*['"]hono['"]|from\s+['"]hono['"]|new\s+Hono\s*\(\s*\))/,
      2000,
    )
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseHonoFile(content, file)
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

function parseHonoFile(content: string, file: string): RawApiSurface | null {
  const appVarNames = detectHonoVars(content)
  if (appVarNames.size === 0) return null

  const stripped = stripComments(content)
  const endpoints = extractHonoRoutes(stripped, appVarNames, file)

  if (endpoints.length === 0) return null

  const surfaceName = file.split('/').pop()?.replace(/\.(ts|js|mts|mjs)$/, '') ?? file
  const moduleName = file.replace(/\.(ts|js|mts|mjs)$/, '').replace(/\//g, '.')

  return {
    name: surfaceName,
    apiStyle: 'http',
    packageOrModule: moduleName,
    endpoints,
    sourceFile: file,
    sourceLine: 1,
  }
}

// ---- Detect Hono instance variable names ----

function detectHonoVars(content: string): Set<string> {
  const vars = new Set<string>()

  // const app = new Hono() or const app = new Hono<Env>()
  for (const m of content.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*new\s+Hono\s*[(<]/g)) {
    vars.add(m[1])
  }

  // Sub-router: const api = new Hono()
  // Also detect from usage patterns: app.get('/...'), router.post('/...')
  for (const m of content.matchAll(/\b(\w+)\.(get|post|put|delete|patch|head|options|all)\s*\(\s*['"`]\//gi)) {
    if (!['this', 'req', 'res', 'c', 'ctx', 'context', 'module', 'exports'].includes(m[1])) {
      vars.add(m[1])
    }
  }

  return vars
}

// ---- Extract routes: app.get('/path', handler) / app.all('/path', handler) ----

function extractHonoRoutes(content: string, appVars: Set<string>, file: string): RawEndpoint[] {
  const endpoints: RawEndpoint[] = []
  const varPattern = [...appVars].map(escapeRegex).join('|')
  const routeRe = new RegExp(
    '(?:' + varPattern + ')\\.(get|post|put|delete|patch|head|options|all)\\s*\\(\\s*([\'"`])([^\'"`]*)\\2',
    'gi',
  )
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Reset lastIndex for sticky match per line
    const lineRe = new RegExp(routeRe.source, 'i')
    const m = line.match(lineRe)
    if (!m) continue

    const methodStr = m[1].toLowerCase()
    const path = m[3]
    if (!path.startsWith('/') && !path.startsWith('*')) continue

    const methods: HttpMethod[] = methodStr === 'all'
      ? ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
      : [methodStr.toUpperCase() as HttpMethod]

    const parameters = pathParamsFromRoute(path)

    for (const httpMethod of methods) {
      endpoints.push({ httpMethod, path, parameters, tags: [], sourceFile: file, sourceLine: i + 1 })
    }
  }

  return endpoints
}

// ---- Path param helpers ----

function pathParamsFromRoute(path: string): RawApiParameter[] {
  const params: RawApiParameter[] = []
  // Hono uses :param style
  for (const m of path.matchAll(/:(\w+)/g)) {
    params.push({ name: m[1], location: 'path', required: true })
  }
  // Also handle {param} style
  for (const m of path.matchAll(/\{(\w+)\}/g)) {
    if (!params.find((p) => p.name === m[1])) {
      params.push({ name: m[1], location: 'path', required: true })
    }
  }
  return params
}

// ---- Strip JS/TS comments ----

function stripComments(code: string): string {
  let result = code.replace(/\/\/.*$/gm, '')
  result = result.replace(/\/\*[\s\S]*?\*\//g, '')
  return result
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
