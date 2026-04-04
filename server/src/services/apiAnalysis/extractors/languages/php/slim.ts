import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

/**
 * Extracts API surfaces from Slim Framework apps.
 *
 * Key patterns (Slim 4):
 *   $app->get('/users', handler)
 *   $app->post('/users', handler)
 *   $app->group('/api', function (RouteCollectorProxy $group) {
 *       $group->get('/users', handler)
 *   })
 *
 * Also Slim 3:
 *   $app->get('/users', function (Request $req, Response $res) { ... })
 *
 * Path params use {param} syntax.
 */

const SLIM_METHODS: Record<string, HttpMethod> = {
  get: 'GET', post: 'POST', put: 'PUT', patch: 'PATCH',
  delete: 'DELETE', options: 'OPTIONS', head: 'HEAD',
}

export class SlimExtractor extends BaseApiExtractor {
  readonly extractorId = 'php.slim'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep('**/*.php', /\$app->(get|post|put|patch|delete|options|group)\s*\(/, 2000)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseSlimFile(content, file)
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

function parseSlimFile(content: string, file: string): RawApiSurface | null {
  const stripped = stripComments(content)
  const lines = stripped.split('\n')
  const endpoints: RawEndpoint[] = []

  // Track router variable names and group prefixes
  // "$app" is the common root; "$group" / "$api" are sub-routers from ->group()
  const routerPrefixes = new Map<string, string>()

  // Seed common Slim app variable names
  for (const line of lines) {
    // $app = AppFactory::create(); or $app = new App();
    const appMatch = line.match(/(\$\w+)\s*=\s*(?:AppFactory::create|new\s+(?:\\?Slim\\)?App)\s*\(/)
    if (appMatch) routerPrefixes.set(appMatch[1], '')
  }
  if (routerPrefixes.size === 0) routerPrefixes.set('$app', '')

  // Two-pass: first collect group closures, then collect routes
  // We use a simple line-by-line approach with a prefix stack
  const prefixStack: string[] = ['']

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    // $app->group('/prefix', function (RouteCollectorProxy $group) {
    // $app->group('/prefix', function () use ($container) {
    const groupMatch = trimmed.match(/\$\w+->group\s*\(\s*['"]([^'"]+)['"]\s*,/)
    if (groupMatch) {
      const prefix = prefixStack[prefixStack.length - 1] + groupMatch[1]
      prefixStack.push(prefix)
      continue
    }

    // End of group closure: });
    if (/^\}\s*\)\s*;?\s*$/.test(trimmed) || /^\}\s*\)\s*->/.test(trimmed)) {
      if (prefixStack.length > 1) prefixStack.pop()
      continue
    }

    // Route registration: $app->get('/path', handler) or $group->post('/path', handler)
    const routeMatch = trimmed.match(/\$\w+->(get|post|put|patch|delete|options|head)\s*\(\s*['"]([^'"]+)['"]/)
    if (routeMatch) {
      const verb = routeMatch[1]
      const subPath = routeMatch[2]
      const httpMethod = SLIM_METHODS[verb]
      if (!httpMethod) continue

      const prefix = prefixStack[prefixStack.length - 1] ?? ''
      const fullPath = joinPaths(prefix, subPath)
      const params = extractPathParams(fullPath)

      endpoints.push({ httpMethod, path: fullPath, parameters: params, tags: [], sourceFile: file, sourceLine: i + 1 })
    }
  }

  if (endpoints.length === 0) return null

  const surfaceName = file.split('/').pop()?.replace(/\.php$/, '') ?? file
  return { name: surfaceName, apiStyle: 'http', endpoints, sourceFile: file, sourceLine: 1 }
}

// ---- Helpers ----

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
  return code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/#.*$/gm, '')
}
