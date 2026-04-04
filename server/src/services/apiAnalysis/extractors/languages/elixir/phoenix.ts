import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

/**
 * Extracts API surfaces from Phoenix Framework (Elixir).
 *
 * Key patterns in router.ex:
 *   scope "/api", MyAppWeb do
 *     pipe_through :api
 *     get "/users", UserController, :index
 *     post "/users", UserController, :create
 *     get "/users/:id", UserController, :show
 *     resources "/posts", PostController
 *     resources "/comments", CommentController, only: [:index, :show]
 *   end
 *
 * Path params use :param syntax.
 * `resources` expands to standard CRUD routes.
 */

const METHOD_MAP: Record<string, HttpMethod> = {
  get: 'GET', post: 'POST', put: 'PUT', patch: 'PATCH',
  delete: 'DELETE', head: 'HEAD', options: 'OPTIONS',
}

// Standard Phoenix resource routes
const RESOURCE_ACTIONS: Array<{ method: HttpMethod; suffix: string }> = [
  { method: 'GET',    suffix: '' },          // index
  { method: 'POST',   suffix: '' },          // create
  { method: 'GET',    suffix: '/new' },       // new
  { method: 'GET',    suffix: '/:id' },       // show
  { method: 'GET',    suffix: '/:id/edit' },  // edit
  { method: 'PUT',    suffix: '/:id' },       // update
  { method: 'PATCH',  suffix: '/:id' },       // update
  { method: 'DELETE', suffix: '/:id' },       // delete
]

export class PhoenixExtractor extends BaseApiExtractor {
  readonly extractorId = 'elixir.phoenix'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep('**/router.ex', /\b(?:get|post|put|patch|delete|resources|scope)\s+["\/]/, 2000)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        if (!isPhoenixRouter(content)) continue
        const parsed = parsePhoenixRouter(content, file)
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

function isPhoenixRouter(content: string): boolean {
  return /use\s+\w+,\s*:router|Phoenix\.Router/.test(content)
}

function parsePhoenixRouter(content: string, file: string): RawApiSurface | null {
  const stripped = stripComments(content)
  const lines = stripped.split('\n')
  const endpoints: RawEndpoint[] = []

  // Track scope prefix stack
  const scopeStack: string[] = ['']

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    // scope "/prefix", ModuleName do
    const scopeMatch = trimmed.match(/^scope\s+["']([^"']+)["']/)
    if (scopeMatch) {
      const parent = scopeStack[scopeStack.length - 1] ?? ''
      scopeStack.push(joinPaths(parent, scopeMatch[1]))
      continue
    }

    // end → pop scope
    if (/^end\s*$/.test(trimmed) && scopeStack.length > 1) {
      scopeStack.pop()
      continue
    }

    const prefix = scopeStack[scopeStack.length - 1] ?? ''

    // HTTP verb: get "/path", Controller, :action
    const verbMatch = trimmed.match(/^(get|post|put|patch|delete|head|options)\s+["']([^"']+)["']/)
    if (verbMatch) {
      const method = METHOD_MAP[verbMatch[1]]
      if (!method) continue
      const path = normalizePhoenixPath(joinPaths(prefix, verbMatch[2]))
      endpoints.push({
        httpMethod: method,
        path,
        parameters: extractPathParams(path),
        tags: [],
        sourceFile: file,
        sourceLine: i + 1,
      })
      continue
    }

    // resources "/path", Controller
    const resourceMatch = trimmed.match(/^resources\s+["']([^"']+)["']/)
    if (resourceMatch) {
      const basePath = joinPaths(prefix, resourceMatch[1])

      // Check for only: [:action, ...]  or except: [...]
      const onlyMatch = trimmed.match(/\bonly:\s*\[([^\]]+)\]/)
      const exceptMatch = trimmed.match(/\bexcept:\s*\[([^\]]+)\]/)

      let actions = RESOURCE_ACTIONS
      if (onlyMatch) {
        const allowed = new Set(onlyMatch[1].split(',').map((s) => s.trim().replace(/^:/, '')))
        const actionNameMap: Record<string, string> = {
          index: 'GET', create: 'POST', new: 'GET', show: 'GET',
          edit: 'GET', update: 'PUT,PATCH', delete: 'DELETE',
        }
        actions = RESOURCE_ACTIONS.filter((a) => {
          // Map back from (method, suffix) to action name
          return [...allowed].some((name) => {
            const methods = actionNameMap[name] ?? ''
            const suffix = name === 'index' ? '' : name === 'create' ? '' : name === 'new' ? '/new' : name === 'show' ? '/:id' : name === 'edit' ? '/:id/edit' : '/:id'
            return methods.includes(a.method) && suffix === a.suffix
          })
        })
      } else if (exceptMatch) {
        const excluded = new Set(exceptMatch[1].split(',').map((s) => s.trim().replace(/^:/, '')))
        actions = RESOURCE_ACTIONS.filter((a) => !excluded.has(a.method.toLowerCase()))
      }

      for (const { method, suffix } of actions) {
        const path = normalizePhoenixPath(basePath + suffix)
        if (!endpoints.find((e) => e.path === path && e.httpMethod === method)) {
          endpoints.push({ httpMethod: method, path, parameters: extractPathParams(path), tags: [], sourceFile: file, sourceLine: i + 1 })
        }
      }
    }
  }

  if (endpoints.length === 0) return null

  return {
    name: file.split('/').pop()?.replace(/\.ex$/, '') ?? 'router',
    apiStyle: 'http',
    endpoints,
    sourceFile: file,
    sourceLine: 1,
  }
}

// ---- Helpers ----

function normalizePhoenixPath(path: string): string {
  return path.replace(/:(\w+)/g, '{$1}')
}

function extractPathParams(path: string): RawApiParameter[] {
  const params: RawApiParameter[] = []
  for (const m of path.matchAll(/\{(\w+)\}/g)) {
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
  return code.replace(/#.*$/gm, '')
}
