import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

// Map C# HTTP method attributes to HttpMethod
const HTTP_VERB_MAP: Record<string, HttpMethod> = {
  HttpGet: 'GET',
  HttpPost: 'POST',
  HttpPut: 'PUT',
  HttpPatch: 'PATCH',
  HttpDelete: 'DELETE',
  HttpHead: 'HEAD',
  HttpOptions: 'OPTIONS',
}

export class AspNetCoreExtractor extends BaseApiExtractor {
  readonly extractorId = 'csharp.aspnet_core'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep(
      '**/*.cs',
      /\[ApiController\]|\[(?:Http(?:Get|Post|Put|Patch|Delete|Head|Options)|Route)\s*[(\]]/,
      2000,
    )
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseAspNetFile(content, file, this.extractorId)
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

function parseAspNetFile(content: string, file: string, extractorId: string): RawApiSurface | null {
  // Collapse multi-line attribute stacks so we can parse line-by-line
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')

  // Find class-level [Route("...")] — applies as prefix
  const classRouteMatch = normalized.match(/\[Route\s*\(\s*["']([^"']+)["']\s*\)\][\s\S]*?class\s+(\w+)/)
  const classRoute = classRouteMatch ? classRouteMatch[1] : ''
  const className = normalized.match(/class\s+(\w+)/)?.[1] ?? file.split('/').pop()?.replace(/\.cs$/, '') ?? 'Controller'

  // Namespace
  const namespace = normalized.match(/namespace\s+([\w.]+)/)?.[1]

  const endpoints: RawEndpoint[] = []
  let pendingMethod: HttpMethod | null = null
  let pendingPath: string | null = null
  let pendingOperationName: string | null = null

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    // [HttpGet], [HttpGet("path")], [HttpGet("{id}")]
    for (const [attr, method] of Object.entries(HTTP_VERB_MAP)) {
      // [HttpGet] or [HttpGet("...")] or [HttpGet("{id}")]
      const attrRe = new RegExp('\\[' + attr + '(?:\\s*\\(\\s*["\'](.*?)["\']\\s*\\))?\\]')
      const m = trimmed.match(attrRe)
      if (m) {
        pendingMethod = method
        pendingPath = m[1] ?? null
        break
      }
    }

    // [Route("path")] as method-level override (after verb already set, or standalone)
    if (!pendingMethod) {
      const routeMatch = trimmed.match(/\[Route\s*\(\s*["']([^"']+)["']\s*\)\]/)
      if (routeMatch) {
        pendingPath = routeMatch[1]
      }
    }

    // Method declaration: public Task<IActionResult> GetUser(...)
    const methodMatch = trimmed.match(/(?:public|protected|private|internal)(?:\s+(?:async|static|virtual|override))*\s+\S+\s+(\w+)\s*\(/)
    if (methodMatch && (pendingMethod || pendingPath)) {
      const operationName = methodMatch[1]

      // Build full path
      let routePath = buildPath(classRoute, pendingPath ?? '')
      // Replace [controller] and [action] tokens
      routePath = routePath
        .replace(/\[controller\]/gi, controllerName(className))
        .replace(/\[action\]/gi, operationName.toLowerCase())

      const parameters = extractPathParams(routePath)

      endpoints.push({
        httpMethod: pendingMethod ?? 'GET',
        path: routePath,
        operationName,
        parameters,
        tags: [namespace ? `${namespace}.${className}` : className],
        sourceFile: file,
        sourceLine: i + 1,
      })

      pendingMethod = null
      pendingPath = null
      pendingOperationName = null
    }
  }

  if (endpoints.length === 0) return null

  return {
    name: className,
    apiStyle: 'http',
    basePath: classRoute || undefined,
    endpoints,
    sourceFile: file,
    sourceLine: 1,
  }
}

// ---- Helpers ----

function buildPath(base: string, suffix: string): string {
  if (!base && !suffix) return '/'
  const b = base.startsWith('/') ? base : base ? '/' + base : ''
  const s = suffix ? (suffix.startsWith('/') ? suffix : '/' + suffix) : ''
  const combined = (b + s) || '/'
  // Normalise double slashes
  return combined.replace(/\/+/g, '/')
}

function controllerName(className: string): string {
  return className.replace(/Controller$/, '').toLowerCase()
}

function extractPathParams(path: string): RawApiParameter[] {
  const params: RawApiParameter[] = []
  for (const m of path.matchAll(/\{(\w+)(?::[^}]*)?\}/g)) {
    params.push({ name: m[1], location: 'path', required: true })
  }
  return params
}
