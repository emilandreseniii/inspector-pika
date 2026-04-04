import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

/**
 * Extracts API surfaces from .NET 6+ Minimal APIs.
 *
 * Key patterns in Program.cs / top-level statement files:
 *   app.MapGet("/users", handler)
 *   app.MapPost("/users", (UserDto dto) => …)
 *   app.MapPut("/users/{id}", …)
 *   app.MapDelete("/users/{id}", …)
 *   app.MapPatch("/users/{id}", …)
 *
 * Also handles route groups (MapGroup):
 *   var group = app.MapGroup("/api/v1")
 *   group.MapGet("/users", handler)
 */

const MAP_METHODS: Record<string, HttpMethod> = {
  MapGet: 'GET', MapPost: 'POST', MapPut: 'PUT',
  MapDelete: 'DELETE', MapPatch: 'PATCH',
}

export class MinimalApiExtractor extends BaseApiExtractor {
  readonly extractorId = 'csharp.minimal_api'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep('**/*.cs', /\.(MapGet|MapPost|MapPut|MapDelete|MapPatch|MapGroup)\s*\(/, 2000)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseMinimalApiFile(content, file)
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

function parseMinimalApiFile(content: string, file: string): RawApiSurface | null {
  const stripped = stripComments(content)
  const lines = stripped.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')

  // Track variable → prefix mapping for MapGroup
  const groupPrefixes = new Map<string, string>()
  // The root app variable name (usually 'app')
  const appVarNames = new Set<string>()

  // Seed: look for WebApplication.Create / builder.Build() → app
  for (const line of lines) {
    const appBuild = line.match(/(\w+)\s*=\s*(?:WebApplication\.Create|builder\.Build)\s*\(/)
    if (appBuild) { appVarNames.add(appBuild[1]); groupPrefixes.set(appBuild[1], '') }
    // var app = ... patterns
    const varApp = line.match(/(?:var|WebApplication)\s+(\w+)\s*=/)
    if (varApp && (line.includes('WebApplication') || line.includes('builder.Build'))) {
      appVarNames.add(varApp[1]); groupPrefixes.set(varApp[1], '')
    }
  }

  // If we couldn't detect explicitly, assume 'app' as the conventional name
  if (groupPrefixes.size === 0) groupPrefixes.set('app', '')

  // Scan for MapGroup and Map* calls
  for (const line of lines) {
    // var group = app.MapGroup("/prefix")  or  var group = app.MapGroup("/prefix").RequireAuthorization()
    const groupMatch = line.match(/(?:var\s+)?(\w+)\s*=\s*(\w+)\.MapGroup\s*\(\s*"([^"]*)"\s*\)/)
    if (groupMatch) {
      const [, newVar, parentVar, prefix] = groupMatch
      const parentPrefix = groupPrefixes.get(parentVar) ?? ''
      groupPrefixes.set(newVar, parentPrefix + prefix)
    }
  }

  const endpoints: RawEndpoint[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    for (const [mapMethod, httpMethod] of Object.entries(MAP_METHODS)) {
      // varName.MapGet("/path", handler)  — path is a string literal
      const re = new RegExp(`(\\w+)\\.${mapMethod}\\s*\\(\\s*"([^"]*)"`)
      const m = line.match(re)
      if (!m) continue

      const varName = m[1]
      if (!groupPrefixes.has(varName)) continue

      const subPath = m[2]
      const prefix = groupPrefixes.get(varName) ?? ''
      const fullPath = joinPaths(prefix, subPath)
      const params = extractParams(line, fullPath)

      endpoints.push({
        httpMethod,
        path: fullPath,
        parameters: params,
        tags: [],
        sourceFile: file,
        sourceLine: i + 1,
      })
    }
  }

  if (endpoints.length === 0) return null

  const surfaceName = file.split('/').pop()?.replace(/\.cs$/, '') ?? file
  return { name: surfaceName, apiStyle: 'http', endpoints, sourceFile: file, sourceLine: 1 }
}

// ---- Helpers ----

function extractParams(line: string, path: string): RawApiParameter[] {
  const params: RawApiParameter[] = []

  // Path params from {param} in the route template
  for (const m of path.matchAll(/\{(\w+)(?::[^}]*)?\}/g)) {
    params.push({ name: m[1], location: 'path', required: true })
  }

  // Lambda params that are typed — e.g. (int id, string name, [FromBody] MyDto dto)
  // Look for the lambda or handler after the first string literal (the route path)
  const afterPath = line.replace(/.*?"[^"]*"\s*,\s*/, '')
  // [FromBody] Type varName or (Type varName)
  for (const m of afterPath.matchAll(/\[FromBody\]\s+\w+\s+(\w+)/g)) {
    params.push({ name: m[1], location: 'body', required: true })
  }
  for (const m of afterPath.matchAll(/\[FromQuery\]\s+\w+\s+(\w+)/g)) {
    params.push({ name: m[1], location: 'query', required: false })
  }
  for (const m of afterPath.matchAll(/\[FromHeader\]\s+\w+\s+(\w+)/g)) {
    params.push({ name: m[1], location: 'header', required: false })
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
  return code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}
