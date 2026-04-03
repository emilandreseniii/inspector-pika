import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']

export class ExpressExtractor extends BaseApiExtractor {
  readonly extractorId = 'typescript.express'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep(
      '**/*.{ts,js,mts,mjs}',
      /(?:require\s*\(\s*['"]express['"]|from\s+['"]express['"]|Router\s*\(\s*\)|express\s*\(\s*\))/,
      2000,
    )
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseExpressFile(content, file)
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

function parseExpressFile(content: string, file: string): RawApiSurface | null {
  const routerVarNames = detectRouterVars(content)
  if (routerVarNames.size === 0) return null

  const varPattern = [...routerVarNames].map(escapeRegex).join('|')
  // Matches: app.get('/path', ...), router.post('/path', ...), app.use('/prefix', ...)
  const routePattern = new RegExp(
    `(?:^|\\s)(?:${varPattern})\\.(?:get|post|put|delete|patch|head|options|all|use)\\s*\\(`,
    'i',
  )

  // Remove single-line and multi-line comments before processing
  const stripped = stripComments(content)
  const lines = stripped.split('\n')
  const endpoints: RawEndpoint[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!routePattern.test(line)) continue

    // Extract method call
    const methodMatch = line.match(
      /(?:\w+)\.(get|post|put|delete|patch|head|options|all|use)\s*\(\s*(["'`][^"'`]*["'`])/i,
    )
    if (!methodMatch) continue

    const methodStr = methodMatch[1].toLowerCase()
    const rawPath = methodMatch[2].slice(1, -1)  // strip quotes

    // Skip middleware mounts without paths (app.use(handler))
    if (!rawPath.startsWith('/') && !rawPath.startsWith('*')) continue

    const methods: HttpMethod[] = methodStr === 'all'
      ? HTTP_METHODS
      : methodStr === 'use'
        ? ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']  // use mounts are for all methods
        : [methodStr.toUpperCase() as HttpMethod]

    const pathParams = extractPathParams(rawPath)

    for (const httpMethod of methods) {
      endpoints.push({
        httpMethod,
        path: rawPath,
        parameters: [...pathParams].map((name) => ({ name, location: 'path' as const, required: true })),
        tags: [],
        sourceFile: file,
        sourceLine: i + 1,
      })
    }
  }

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

// ---- Detect Express app/router variable names ----

function detectRouterVars(content: string): Set<string> {
  const vars = new Set<string>()

  // const app = express() or const router = express.Router() or const router = Router()
  for (const m of content.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:express\s*\(\s*\)|(?:express\.)?Router\s*\(\s*\))/g)) {
    vars.add(m[1])
  }

  // Detect from usage patterns: app.get(...), router.post(...)
  for (const m of content.matchAll(/\b(\w+)\.(get|post|put|delete|patch|head|options|all|use)\s*\(\s*["'`]\//g)) {
    if (!['this', 'req', 'res', 'request', 'response', 'module', 'exports'].includes(m[1])) {
      vars.add(m[1])
    }
  }

  return vars
}

// ---- Extract :param from Express path ----

function extractPathParams(path: string): Set<string> {
  const params = new Set<string>()
  // Express style: :paramName or :paramName(regex)
  for (const m of path.matchAll(/:(\w+)/g)) params.add(m[1])
  // Also handle {param} style (sometimes used)
  for (const m of path.matchAll(/\{(\w+)\}/g)) params.add(m[1])
  return params
}

// ---- Strip JS/TS comments (simplified) ----

function stripComments(code: string): string {
  // Remove single-line comments
  let result = code.replace(/\/\/.*$/gm, '')
  // Remove multi-line comments
  result = result.replace(/\/\*[\s\S]*?\*\//g, '')
  return result
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
