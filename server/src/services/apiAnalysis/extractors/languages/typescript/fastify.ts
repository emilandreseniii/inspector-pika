import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']

export class FastifyExtractor extends BaseApiExtractor {
  readonly extractorId = 'typescript.fastify'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep(
      '**/*.{ts,js,mts,mjs}',
      /(?:require\s*\(\s*['"]fastify['"]|from\s+['"]fastify['"]|Fastify\s*\(\s*\)|fastify\s*\(\s*\))/,
      2000,
    )
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseFastifyFile(content, file)
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

function parseFastifyFile(content: string, file: string): RawApiSurface | null {
  const appVarNames = detectFastifyVars(content)
  if (appVarNames.size === 0) return null

  const stripped = stripComments(content)
  const endpoints: RawEndpoint[] = []

  // Extract shorthand routes: fastify.get('/path', ...) / app.post('/path', ...)
  endpoints.push(...extractShorthandRoutes(stripped, appVarNames, file))

  // Extract fastify.route({ method, url, handler }) calls
  endpoints.push(...extractRouteObjects(stripped, appVarNames, file))

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

// ---- Detect fastify instance variable names ----

function detectFastifyVars(content: string): Set<string> {
  const vars = new Set<string>()

  // const fastify = Fastify() / require('fastify')() / fastify({ logger: true })
  for (const m of content.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:require\s*\(\s*['"]fastify['"]\s*\)\s*|Fastify|fastify)\s*\(/g)) {
    vars.add(m[1])
  }

  // Plugin/prefix sub-instance: async (fastify, opts) => { fastify.get(...) }
  // Also detect from usage: app.get('/...'), fastify.get('/...')
  for (const m of content.matchAll(/\b(\w+)\.(get|post|put|delete|patch|head|options|route)\s*\(\s*["'`]\//gi)) {
    if (!['this', 'req', 'res', 'request', 'response', 'module', 'exports'].includes(m[1])) {
      vars.add(m[1])
    }
  }

  return vars
}

// ---- Extract shorthand route calls: fastify.get('/path', [opts,] handler) ----

function extractShorthandRoutes(content: string, appVars: Set<string>, file: string): RawEndpoint[] {
  const endpoints: RawEndpoint[] = []
  const varPattern = [...appVars].map(escapeRegex).join('|')
  const routeRe = new RegExp(
    '(?:' + varPattern + ')\\.(get|post|put|delete|patch|head|options)\\s*\\(\\s*([\'"`])([^\'"`]*)\\2',
    'i',
  )
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const m = line.match(routeRe)
    if (!m) continue

    const httpMethod = m[1].toUpperCase() as HttpMethod
    const path = m[3]
    if (!path.startsWith('/') && !path.startsWith('*')) continue

    const parameters = pathParamsFromRoute(path)
    endpoints.push({ httpMethod, path, parameters, tags: [], sourceFile: file, sourceLine: i + 1 })
  }

  return endpoints
}

// ---- Extract fastify.route({ method: 'GET', url: '/path', handler }) ----

function extractRouteObjects(content: string, appVars: Set<string>, file: string): RawEndpoint[] {
  const endpoints: RawEndpoint[] = []
  const varPattern = [...appVars].map(escapeRegex).join('|')

  // Find all .route({ ... }) calls
  const routeCallPattern = new RegExp(`(?:${varPattern})\\.route\\s*\\(`, 'gi')
  let match: RegExpExecArray | null

  while ((match = routeCallPattern.exec(content)) !== null) {
    const openBrace = content.indexOf('{', match.index + match[0].length - 1)
    if (openBrace === -1) continue
    const body = extractToMatchingBrace(content, openBrace)
    if (!body) continue

    // Extract method: 'GET' or method: ['GET', 'POST']
    let methods: HttpMethod[]
    const methodArrayMatch = body.match(/\bmethod\s*:\s*\[([^\]]*)\]/)
    const methodStringMatch = body.match(/\bmethod\s*:\s*['"`]([^'"`]*)['"`]/)
    if (methodArrayMatch) {
      // Array: ['GET', 'POST']
      methods = (methodArrayMatch[1].match(/['"`]([^'"`]+)['"`]/g) ?? [])
        .map((s) => s.slice(1, -1).toUpperCase() as HttpMethod)
    } else if (methodStringMatch) {
      methods = [methodStringMatch[1].toUpperCase() as HttpMethod]
    } else {
      continue  // no method specified
    }

    // Extract url: '/path'
    const urlMatch = body.match(/\burl\s*:\s*(['"`])([^"'`]*)['"`]/)
    if (!urlMatch) continue
    const path = urlMatch[2]
    if (!path.startsWith('/') && !path.startsWith('*')) continue

    const parameters = pathParamsFromRoute(path)
    const sourceLine = content.slice(0, match.index).split('\n').length

    for (const httpMethod of methods) {
      endpoints.push({ httpMethod, path, parameters, tags: [], sourceFile: file, sourceLine })
    }
  }

  return endpoints
}

// ---- Path param helpers ----

function pathParamsFromRoute(path: string): RawApiParameter[] {
  const params: RawApiParameter[] = []
  // Fastify uses :param and also Express-style :param
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

// ---- Extract content between matching braces ----

function extractToMatchingBrace(s: string, start: number): string | null {
  let depth = 0
  for (let i = start; i < s.length; i++) {
    if (s[i] === '{') depth++
    else if (s[i] === '}') {
      depth--
      if (depth === 0) return s.slice(start + 1, i)
    }
  }
  return null
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
