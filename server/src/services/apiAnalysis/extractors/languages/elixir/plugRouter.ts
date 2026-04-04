import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

/**
 * Extracts API surfaces from Plug.Router (Elixir).
 *
 * Key patterns:
 *   defmodule MyRouter do
 *     use Plug.Router
 *
 *     plug :match
 *     plug :dispatch
 *
 *     get "/users" do
 *       send_resp(conn, 200, "OK")
 *     end
 *
 *     match "/health", via: :get do
 *       send_resp(conn, 200, "OK")
 *     end
 *   end
 *
 * Path params use :param syntax.
 */

const METHOD_MAP: Record<string, HttpMethod> = {
  get: 'GET', post: 'POST', put: 'PUT', patch: 'PATCH',
  delete: 'DELETE', head: 'HEAD', options: 'OPTIONS',
}

export class PlugRouterExtractor extends BaseApiExtractor {
  readonly extractorId = 'elixir.plug_router'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep(
      '**/*.ex',
      /use\s+Plug\.Router|plug\s+:match|^\s*(?:get|post|put|patch|delete|match)\s+["\/]/,
      2000,
    )
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        if (!isPlugRouter(content)) continue
        const parsed = parsePlugRouter(content, file)
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

function isPlugRouter(content: string): boolean {
  return /use\s+Plug\.Router/.test(content)
}

function parsePlugRouter(content: string, file: string): RawApiSurface | null {
  const stripped = stripComments(content)
  const lines = stripped.split('\n')
  const endpoints: RawEndpoint[] = []

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    // get "/path" do  or  post "/path" do
    const verbMatch = trimmed.match(/^(get|post|put|patch|delete|head|options)\s+["']([^"']+)["']/)
    if (verbMatch) {
      const method = METHOD_MAP[verbMatch[1]]
      if (!method) continue
      const path = normalizePlugPath(verbMatch[2])
      endpoints.push({ httpMethod: method, path, parameters: extractPathParams(path), tags: [], sourceFile: file, sourceLine: i + 1 })
      continue
    }

    // match "/path", via: :get do
    const matchMatch = trimmed.match(/^match\s+["']([^"']+)["'][^,]*,\s*via:\s*:(\w+)/)
    if (matchMatch) {
      const path = normalizePlugPath(matchMatch[1])
      const method = METHOD_MAP[matchMatch[2]]
      if (method) {
        endpoints.push({ httpMethod: method, path, parameters: extractPathParams(path), tags: [], sourceFile: file, sourceLine: i + 1 })
      }
    }
  }

  if (endpoints.length === 0) return null

  return {
    name: file.split('/').pop()?.replace(/\.ex$/, '') ?? file,
    apiStyle: 'http',
    endpoints,
    sourceFile: file,
    sourceLine: 1,
  }
}

// ---- Helpers ----

function normalizePlugPath(path: string): string {
  return path.replace(/:(\w+)/g, '{$1}')
}

function extractPathParams(path: string): RawApiParameter[] {
  const params: RawApiParameter[] = []
  for (const m of path.matchAll(/\{(\w+)\}/g)) {
    params.push({ name: m[1], location: 'path', required: true })
  }
  return params
}

function stripComments(code: string): string {
  return code.replace(/#.*$/gm, '')
}
