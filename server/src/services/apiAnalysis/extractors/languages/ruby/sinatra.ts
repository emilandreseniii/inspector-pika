import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

/**
 * Extracts API surfaces from Sinatra apps.
 *
 * Handles both top-level DSL (classic style):
 *   get '/users' do ... end
 *   post '/users' do ... end
 *
 * And modular-style subclasses:
 *   class MyApp < Sinatra::Base
 *     get '/users' do ... end
 *   end
 *
 * Path params use :param syntax.
 */

const SINATRA_METHODS: Record<string, HttpMethod> = {
  get: 'GET', post: 'POST', put: 'PUT', patch: 'PATCH',
  delete: 'DELETE', head: 'HEAD', options: 'OPTIONS',
}

export class SinatraExtractor extends BaseApiExtractor {
  readonly extractorId = 'ruby.sinatra'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep('**/*.rb', /Sinatra::(?:Base|Application)|require\s+['"]sinatra['"]/, 2000)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseSinatraFile(content, file)
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

function parseSinatraFile(content: string, file: string): RawApiSurface | null {
  const stripped = stripComments(content)
  const lines = stripped.split('\n')
  const endpoints: RawEndpoint[] = []

  // Determine surface name — class name or file name
  const classMatch = content.match(/class\s+(\w+)\s*<\s*Sinatra::(?:Base|Application)/)
  const surfaceName = classMatch?.[1] ?? file.split('/').pop()?.replace(/\.rb$/, '') ?? 'sinatra'

  // Verb regex: get '/path' do  OR  get "/path" do  OR  get %r{/re} do
  // Also handles: get '/:id' do, delete '/:id' do
  const verbRe = /^\s*(get|post|put|patch|delete|head|options)\s+(['"])([^'"]+)\2(?:\s*(?:do|,)|\s*$)/

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const m = line.match(verbRe)
    if (!m) continue

    const verb = m[1]
    const path = m[3]
    const httpMethod = SINATRA_METHODS[verb]
    if (!httpMethod) continue

    const parameters = extractPathParams(path)
    endpoints.push({
      httpMethod,
      path,
      parameters,
      tags: [surfaceName],
      sourceFile: file,
      sourceLine: i + 1,
    })
  }

  if (endpoints.length === 0) return null

  return {
    name: surfaceName,
    apiStyle: 'http',
    endpoints,
    sourceFile: file,
    sourceLine: 1,
  }
}

// ---- Helpers ----

function extractPathParams(path: string): RawApiParameter[] {
  const params: RawApiParameter[] = []
  // Sinatra uses :param style
  for (const m of path.matchAll(/:(\w+)/g)) {
    params.push({ name: m[1], location: 'path', required: true })
  }
  return params
}

function stripComments(code: string): string {
  return code.replace(/#[^{].*$/gm, '')
}
