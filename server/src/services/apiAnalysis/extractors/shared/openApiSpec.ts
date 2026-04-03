import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../base'

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']

export class OpenApiSpecExtractor extends BaseApiExtractor {
  readonly extractorId = 'cross-language.openapi_spec'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    // Candidates: standard names + any openapi/swagger .yaml/.json at root or api/ dir
    const candidates = [
      'openapi.yaml', 'openapi.json', 'openapi.yml',
      'swagger.yaml', 'swagger.json', 'swagger.yml',
      'api-spec.yaml', 'api-spec.json', 'api.yaml', 'api.json',
    ]

    const globFiles = await this.glob('**/{openapi,swagger,api,api-spec}.{yaml,yml,json}')
    const allCandidates = [...new Set([...candidates, ...globFiles])]

    let filesScanned = 0

    for (const file of allCandidates) {
      try {
        const content = await this.readFile(file)
        if (!content || !isOpenApiContent(content)) continue
        filesScanned++
        const parsed = parseOpenApiSpec(content, file)
        if (parsed) surfaces.push(parsed)
      } catch {
        // File doesn't exist or can't be read — skip silently
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

// ---- Quick content check ----

function isOpenApiContent(content: string): boolean {
  return /(?:openapi:|swagger:|paths:)/i.test(content)
}

// ---- Parse OpenAPI spec (YAML or JSON) ----

function parseOpenApiSpec(content: string, file: string): RawApiSurface | null {
  const endpoints: RawEndpoint[] = []

  // Determine version
  const isV3 = /openapi\s*:\s*['"]?3/.test(content)
  const isV2 = /swagger\s*:\s*['"]?2/.test(content)
  if (!isV3 && !isV2) return null

  // Extract info.title
  const titleMatch = content.match(/title\s*:\s*['"]?([^\n'"]+?)['"]?\s*\n/)
  const title = titleMatch?.[1]?.trim() ?? 'API'

  // Extract base path (Swagger 2.0) or servers (OpenAPI 3.x)
  let basePath = ''
  if (isV2) {
    const baseMatch = content.match(/basePath\s*:\s*['"]?([^\n'"]+)/)
    if (baseMatch) basePath = baseMatch[1].trim()
  }

  // Parse paths section
  // Find 'paths:' block
  const pathsMatch = content.match(/^paths\s*:/m)
  if (!pathsMatch) return null

  const pathsStart = pathsMatch.index! + pathsMatch[0].length

  // Extract path entries using indentation-aware parsing
  // Pattern: /path-with-slashes:
  const pathPattern = /^  (\/[^\n:]*)\s*:\s*$/gm
  pathPattern.lastIndex = pathsStart

  let pathMatch: RegExpExecArray | null
  while ((pathMatch = pathPattern.exec(content)) !== null) {
    const rawPath = pathMatch[1].trim()
    const pathStart = pathMatch.index + pathMatch[0].length

    // Find the next top-level path entry or end of paths section
    const nextPathMatch = /^  \/[^\n:]*\s*:\s*$/m.exec(content.slice(pathStart))
    const pathEnd = nextPathMatch ? pathStart + nextPathMatch.index : content.length

    const pathBlock = content.slice(pathStart, pathEnd)

    // Extract HTTP methods within this path block
    for (const method of HTTP_METHODS) {
      const methodLower = method.toLowerCase()
      const methodPattern = new RegExp(`^    ${methodLower}\\s*:\\s*$`, 'm')
      if (!methodPattern.test(pathBlock)) continue

      const methodStart = pathBlock.search(methodPattern)
      const methodBlock = pathBlock.slice(methodStart, methodStart + 2000)

      // Extract parameters
      const parameters = extractParameters(methodBlock, rawPath)

      // Extract operation ID
      const opIdMatch = methodBlock.match(/operationId\s*:\s*['"]?([^\n'"]+)/)
      const operationName = opIdMatch?.[1]?.trim()

      const fullPath = basePath ? basePath.replace(/\/$/, '') + rawPath : rawPath

      endpoints.push({
        httpMethod: method,
        path: fullPath,
        operationName,
        parameters,
        tags: [],
        sourceFile: file,
        sourceLine: 1,
      })
    }
  }

  if (endpoints.length === 0) return null

  return {
    name: title,
    apiStyle: 'http',
    endpoints,
    sourceFile: file,
    sourceLine: 1,
  }
}

// ---- Extract parameters from method block ----

function extractParameters(methodBlock: string, path: string): RawApiParameter[] {
  const params: RawApiParameter[] = []
  const seen = new Set<string>()

  // Path params from URL pattern: {paramName}
  for (const m of path.matchAll(/\{(\w+)\}/g)) {
    if (!seen.has(m[1])) {
      params.push({ name: m[1], location: 'path', required: true })
      seen.add(m[1])
    }
  }

  // Parameters listed in spec: - name: foo\n  in: query\n  required: true
  const paramBlocks = [...methodBlock.matchAll(/- name\s*:\s*['"]?(\w+)['"]?[\s\S]*?in\s*:\s*(\w+)(?:[\s\S]*?required\s*:\s*(true|false))?/g)]
  for (const p of paramBlocks) {
    const name = p[1]
    const location = p[2] as RawApiParameter['location']
    const required = p[3] === 'true' || location === 'path'
    if (!seen.has(name)) {
      params.push({ name, location, required })
      seen.add(name)
    }
  }

  return params
}
