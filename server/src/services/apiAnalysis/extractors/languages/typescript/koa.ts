import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']

/**
 * Extracts API surfaces from Koa applications using koa-router or @koa/router.
 *
 * Patterns detected:
 *   router.get('/path', handler)
 *   router.post('/path', handler)
 *   router.put('/path', handler)
 *   router.delete('/path', handler)
 *   router.patch('/path', handler)
 *
 * Path parameters use `:param` syntax (same as Express).
 */
export class KoaExtractor extends BaseApiExtractor {
  readonly extractorId = 'typescript.koa'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep(
      '**/*.{ts,js,mts,mjs}',
      /(?:require\s*\(\s*['"](?:koa-router|@koa\/router)['"]|from\s+['"](?:koa-router|@koa\/router)['"])/,
      2000,
    )
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseKoaFile(content, file)
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

function parseKoaFile(content: string, file: string): RawApiSurface | null {
  const routerVarNames = detectRouterVars(content)
  if (routerVarNames.size === 0) return null

  const varPattern = [...routerVarNames].map(escapeRegex).join('|')
  const routePattern = new RegExp(
    `(?:^|\\s)(?:${varPattern})\\.(get|post|put|delete|patch|head|options|all)\\s*\\(`,
    'i',
  )

  const stripped = stripComments(content)
  const lines = stripped.split('\n')
  const endpoints: RawEndpoint[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!routePattern.test(line)) continue

    const methodMatch = line.match(/(?:\w+)\.(get|post|put|delete|patch|head|options|all)\s*\(\s*(["'`][^"'`]*["'`])/i)
    if (!methodMatch) continue

    const methodStr = methodMatch[1].toLowerCase()
    const rawPath = methodMatch[2].slice(1, -1)

    if (!rawPath.startsWith('/') && !rawPath.startsWith('*')) continue

    const methods: HttpMethod[] = methodStr === 'all'
      ? HTTP_METHODS
      : [methodStr.toUpperCase() as HttpMethod]

    const pathParams: RawApiParameter[] = extractPathParams(rawPath).map((name) => ({
      name,
      in: 'path' as const,
      required: true,
    }))

    endpoints.push({
      httpMethod: methods[0],
      path: rawPath,
      parameters: pathParams,
    })

    // For 'all', emit remaining methods
    for (let m = 1; m < methods.length; m++) {
      endpoints.push({ httpMethod: methods[m], path: rawPath, parameters: pathParams })
    }
  }

  if (endpoints.length === 0) return null

  return {
    name: file.split('/').pop()?.replace(/\.[^.]+$/, '') ?? file,
    file,
    framework: 'koa',
    endpoints,
  }
}

// ---- Helpers ----

function detectRouterVars(content: string): Set<string> {
  const vars = new Set<string>()

  // const router = new Router()
  for (const m of content.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*new\s+(?:Router|KoaRouter)\s*\(/g)) {
    vars.add(m[1])
  }
  // const Router = require('koa-router') / import Router from 'koa-router'
  // then: const router = new Router()
  if (vars.size === 0 && /(?:koa-router|@koa\/router)/.test(content)) {
    // Try to pick up any 'new Router()' or 'new KoaRouter()' calls
    for (const m of content.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*new\s+\w*[Rr]outer\s*\(/g)) {
      vars.add(m[1])
    }
  }

  return vars
}

function extractPathParams(path: string): string[] {
  const params: string[] = []
  for (const m of path.matchAll(/:([a-zA-Z_]\w*)/g)) {
    params.push(m[1])
  }
  return params
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripComments(code: string): string {
  return code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}
