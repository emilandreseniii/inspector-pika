import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

const LARAVEL_VERB_MAP: Record<string, HttpMethod> = {
  get: 'GET', post: 'POST', put: 'PUT', patch: 'PATCH',
  delete: 'DELETE', options: 'OPTIONS', any: 'GET',
}

export class LaravelExtractor extends BaseApiExtractor {
  readonly extractorId = 'php.laravel'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const routeFiles = await this.glob('**/routes/*.php')

    for (const file of routeFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseLaravelRouteFile(content, file, this.extractorId)
        if (parsed) surfaces.push(parsed)
      } catch (err) {
        warnings.push(`Failed to parse ${file}: ${(err as Error).message}`)
      }
    }

    const endpointsFound = surfaces.reduce((sum, s) => sum + s.endpoints.length, 0)
    return {
      surfaces,
      warnings,
      stats: { filesScanned: routeFiles.length, surfacesFound: surfaces.length, endpointsFound, extractionTimeMs: Date.now() - start },
    }
  }
}

// ---- File parser ----

function parseLaravelRouteFile(content: string, file: string, extractorId: string): RawApiSurface | null {
  const endpoints: RawEndpoint[] = []
  const stripped = stripComments(content)
  const lines = stripped.split('\n')

  const prefixStack: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    // Route::prefix('api/v1')->group(function () {
    const prefixMatch = trimmed.match(/Route::prefix\s*\(\s*['"]([^'"]+)['"]\s*\)/)
    if (prefixMatch && /->group/.test(trimmed)) {
      const seg = prefixMatch[1]
      prefixStack.push(seg.startsWith('/') ? seg : '/' + seg)
      continue
    }

    // }); — end of group
    if (trimmed === '});' || trimmed === '})' || trimmed === '}') {
      if (prefixStack.length > 0) prefixStack.pop()
      continue
    }

    const currentPrefix = prefixStack.join('')

    // Route::get('/path', ...) or Route::post(...)
    for (const [verb, method] of Object.entries(LARAVEL_VERB_MAP)) {
      const re = new RegExp("Route::" + verb + "\\s*\\(\\s*['\"]([^'\"]+)['\"](?:\\s*,\\s*(?:['\"]([^'\"]+)['\"]|\\[([^\\]]+)\\]))?")
      const m = trimmed.match(re)
      if (!m) continue

      const rawPath = m[1]
      const path = currentPrefix + (rawPath.startsWith('/') ? rawPath : '/' + rawPath)
      const controller = m[2] ?? extractControllerFromArray(m[3] ?? '')
      const parameters = extractPathParams(path)
      endpoints.push({
        httpMethod: method,
        path,
        operationName: controller?.split('@')[1],
        parameters,
        tags: controller ? [controller.split('@')[0].split('\\').pop() ?? ''] : [],
        sourceFile: file,
        sourceLine: i + 1,
      })
      break
    }

    // Route::resource('photos', PhotoController::class)
    const resourceMatch = trimmed.match(/Route::resource\s*\(\s*['"]([^'"]+)['"]/)
    if (resourceMatch) {
      const resource = resourceMatch[1]
      const basePath = currentPrefix + '/' + resource
      const RESOURCE_ACTIONS: Array<{ method: HttpMethod; suffix: string; action: string }> = [
        { method: 'GET', suffix: '', action: 'index' },
        { method: 'POST', suffix: '', action: 'store' },
        { method: 'GET', suffix: '/{id}', action: 'show' },
        { method: 'PUT', suffix: '/{id}', action: 'update' },
        { method: 'DELETE', suffix: '/{id}', action: 'destroy' },
      ]
      for (const a of RESOURCE_ACTIONS) {
        const path = basePath + a.suffix
        endpoints.push({
          httpMethod: a.method, path,
          operationName: a.action,
          parameters: a.suffix.includes('{id}') ? [{ name: 'id', location: 'path', required: true }] : [],
          tags: [resource],
          sourceFile: file, sourceLine: i + 1,
        })
      }
    }
  }

  if (endpoints.length === 0) return null

  return {
    name: file.split('/').pop()?.replace(/\.php$/, '') ?? 'Laravel Routes',
    apiStyle: 'http',
    endpoints,
    sourceFile: file,
    sourceLine: 1,
  }
}

function extractControllerFromArray(s: string): string | undefined {
  const m = s.match(/['"]([^'"]+)['"]\s*,\s*['"](\w+)['"]/)
  if (m) return `${m[1]}@${m[2]}`
  return undefined
}

function extractPathParams(path: string): RawApiParameter[] {
  const params: RawApiParameter[] = []
  for (const m of path.matchAll(/\{(\w+)\??\}/g)) {
    params.push({ name: m[1], location: 'path', required: !m[0].includes('?') })
  }
  return params
}

function stripComments(code: string): string {
  return code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}
