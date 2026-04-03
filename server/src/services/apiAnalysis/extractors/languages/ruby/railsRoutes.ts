import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

// Rails resources generates standard CRUD routes
const RESOURCES_ACTIONS: Array<{ action: string; method: HttpMethod; pathSuffix: string }> = [
  { action: 'index',   method: 'GET',    pathSuffix: '' },
  { action: 'show',    method: 'GET',    pathSuffix: '/:id' },
  { action: 'new',     method: 'GET',    pathSuffix: '/new' },
  { action: 'edit',    method: 'GET',    pathSuffix: '/:id/edit' },
  { action: 'create',  method: 'POST',   pathSuffix: '' },
  { action: 'update',  method: 'PUT',    pathSuffix: '/:id' },
  { action: 'destroy', method: 'DELETE', pathSuffix: '/:id' },
]

const VERB_MAP: Record<string, HttpMethod> = {
  get: 'GET', post: 'POST', put: 'PUT', patch: 'PATCH',
  delete: 'DELETE', head: 'HEAD', options: 'OPTIONS',
  match: 'GET',  // simplified
}

export class RailsRoutesExtractor extends BaseApiExtractor {
  readonly extractorId = 'ruby.rails_routes'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const files = await this.glob('**/config/routes.rb')

    let filesScanned = 0

    for (const file of files) {
      try {
        const content = await this.readFile(file)
        filesScanned++
        const parsed = parseRoutesFile(content, file)
        if (parsed) surfaces.push(parsed)
      } catch (err) {
        warnings.push(`Failed to parse ${file}: ${(err as Error).message}`)
      }
    }

    const endpointsFound = surfaces.reduce((sum, s) => sum + s.endpoints.length, 0)
    return {
      surfaces,
      warnings,
      stats: { filesScanned, surfacesFound: surfaces.length, endpointsFound, extractionTimeMs: Date.now() - start },
    }
  }
}

// ---- File parser ----

function parseRoutesFile(content: string, file: string): RawApiSurface | null {
  const stripped = stripComments(content)
  const lines = stripped.split('\n')
  const endpoints: RawEndpoint[] = []

  // Prefix stack for namespace/scope tracking
  const prefixStack: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed) continue

    // Track end blocks (closing do...end)
    if (trimmed === 'end') {
      prefixStack.pop()
      continue
    }

    // namespace :admin do or scope '/api/v1' do
    const namespaceMatch = trimmed.match(/^(?:namespace|scope)\s+(?::(\w+)|['"]([^'"]+)['"])\s*(?:,.*?)?do/)
    if (namespaceMatch) {
      const prefix = namespaceMatch[1] ? `/${namespaceMatch[1]}` : namespaceMatch[2]
      prefixStack.push(prefix.startsWith('/') ? prefix : '/' + prefix)
      continue
    }

    const currentPrefix = prefixStack.join('')

    // resources :users do ... end → generates CRUD routes
    const resourcesMatch = trimmed.match(/^resources\s+:(\w+)(?:\s*,\s*(?:only:|except:)\s*\[([^\]]*)\])?/)
    if (resourcesMatch) {
      const resource = resourcesMatch[1]
      const basePath = `${currentPrefix}/${resource}`
      const onlyStr = resourcesMatch[2]

      let actions = RESOURCES_ACTIONS
      if (onlyStr) {
        const onlyNames = onlyStr.match(/:(\w+)/g)?.map((s) => s.slice(1)) ?? []
        actions = RESOURCES_ACTIONS.filter((a) => onlyNames.includes(a.action))
      }

      for (const action of actions) {
        const path = basePath + action.pathSuffix
        const parameters: RawApiParameter[] = action.pathSuffix.includes(':id')
          ? [{ name: 'id', location: 'path', required: true }]
          : []
        endpoints.push({
          httpMethod: action.method,
          path,
          operationName: action.action,
          parameters,
          tags: [resource],
          sourceFile: file,
          sourceLine: i + 1,
        })
      }
      continue
    }

    // resource :profile → singular resource (no :id routes)
    const resourceMatch = trimmed.match(/^resource\s+:(\w+)/)
    if (resourceMatch) {
      const resource = resourceMatch[1]
      const basePath = `${currentPrefix}/${resource}`
      const singularActions: Array<{ action: string; method: HttpMethod; pathSuffix: string }> = [
        { action: 'show', method: 'GET', pathSuffix: '' },
        { action: 'new', method: 'GET', pathSuffix: '/new' },
        { action: 'edit', method: 'GET', pathSuffix: '/edit' },
        { action: 'create', method: 'POST', pathSuffix: '' },
        { action: 'update', method: 'PUT', pathSuffix: '' },
        { action: 'destroy', method: 'DELETE', pathSuffix: '' },
      ]
      for (const action of singularActions) {
        endpoints.push({
          httpMethod: action.method,
          path: basePath + action.pathSuffix,
          operationName: action.action,
          parameters: [],
          tags: [resource],
          sourceFile: file,
          sourceLine: i + 1,
        })
      }
      continue
    }

    // Explicit routes: get '/path', to: 'controller#action'
    // or: get :path => 'controller#action'
    // or: get '/path' => 'controller#action'
    for (const [verb, method] of Object.entries(VERB_MAP)) {
      const verbRe = new RegExp(`^${verb}\\s+['"]([^'"]+)['"](?:\\s*(?:,\\s*to:|=>)\\s*['"]([^'"]+)['"])?`)
      const verbMatch = trimmed.match(verbRe)
      if (!verbMatch) continue

      const rawPath = verbMatch[1]
      const path = currentPrefix + (rawPath.startsWith('/') ? rawPath : '/' + rawPath)
      const controller = verbMatch[2]

      const parameters = extractPathParams(path)
      endpoints.push({
        httpMethod: method,
        path,
        operationName: controller?.split('#')[1],
        parameters,
        tags: controller ? [controller.split('#')[0]] : [],
        sourceFile: file,
        sourceLine: i + 1,
      })
      break
    }
  }

  if (endpoints.length === 0) return null

  return {
    name: 'Rails Routes',
    apiStyle: 'http',
    endpoints,
    sourceFile: file,
    sourceLine: 1,
  }
}

// ---- Extract :param from Rails path ----

function extractPathParams(path: string): RawApiParameter[] {
  const params: RawApiParameter[] = []
  for (const m of path.matchAll(/:(\w+)/g)) {
    if (m[1] !== 'id') params.push({ name: m[1], location: 'path', required: true })
    else params.push({ name: 'id', location: 'path', required: true })
  }
  return params
}

function stripComments(code: string): string {
  return code.replace(/#.*$/gm, '')
}
