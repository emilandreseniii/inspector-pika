import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

/**
 * Extracts API surfaces from Lumen (Laravel micro-framework) apps.
 *
 * Key patterns (routes/web.php):
 *   $router->get('/users', 'UserController@index');
 *   $router->post('/users', 'UserController@store');
 *   $router->group(['prefix' => 'api'], function () use ($router) {
 *     $router->get('/users', 'UserController@index');
 *   });
 *
 * Path params use {param} syntax.
 */

const LUMEN_METHODS: Record<string, HttpMethod> = {
  get: 'GET', post: 'POST', put: 'PUT', patch: 'PATCH',
  delete: 'DELETE', options: 'OPTIONS', head: 'HEAD',
}

export class LumenExtractor extends BaseApiExtractor {
  readonly extractorId = 'php.lumen'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep(
      '**/*.php',
      /\$router->(get|post|put|patch|delete|options|group)\s*\(/,
      2000,
    )
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseLumenFile(content, file)
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

function parseLumenFile(content: string, file: string): RawApiSurface | null {
  const stripped = stripComments(content)
  const lines = stripped.split('\n')
  const endpoints: RawEndpoint[] = []

  // Lumen groups use array options: $router->group(['prefix' => '/api'], function () use ($router) {
  // We track a prefix stack for nested groups.
  const prefixStack: string[] = ['']

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    // Group: $router->group(['prefix' => 'api', ...], function () use ($router) {
    // or:    $router->group(['prefix' => '/api'], function () {
    const groupMatch = trimmed.match(/\$\w+->group\s*\(\s*\[/)
    if (groupMatch) {
      // Find the prefix value in the array
      const prefixMatch = trimmed.match(/['"]prefix['"]\s*=>\s*['"]([^'"]+)['"]/)
      const prefix = prefixMatch ? prefixMatch[1] : ''
      const parent = prefixStack[prefixStack.length - 1] ?? ''
      prefixStack.push(joinPaths(parent, prefix))
      continue
    }

    // End of group closure: });
    if (/^\}\s*\)\s*;?\s*$/.test(trimmed) || /^\}\s*\)\s*->/.test(trimmed)) {
      if (prefixStack.length > 1) prefixStack.pop()
      continue
    }

    // Route: $router->get('/path', handler) or $router->post(...)
    const routeMatch = trimmed.match(/\$\w+->(get|post|put|patch|delete|options|head)\s*\(\s*['"]([^'"]+)['"]/)
    if (routeMatch) {
      const verb = routeMatch[1]
      const subPath = routeMatch[2]
      const httpMethod = LUMEN_METHODS[verb]
      if (!httpMethod) continue

      const prefix = prefixStack[prefixStack.length - 1] ?? ''
      const fullPath = joinPaths(prefix, subPath)
      const parameters = extractPathParams(fullPath)

      endpoints.push({ httpMethod, path: fullPath, parameters, tags: [], sourceFile: file, sourceLine: i + 1 })
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
