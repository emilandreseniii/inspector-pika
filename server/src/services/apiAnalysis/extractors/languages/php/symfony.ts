import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

const SYMFONY_VERB_MAP: Record<string, HttpMethod> = {
  GET: 'GET', POST: 'POST', PUT: 'PUT', PATCH: 'PATCH',
  DELETE: 'DELETE', HEAD: 'HEAD', OPTIONS: 'OPTIONS',
}

export class SymfonyExtractor extends BaseApiExtractor {
  readonly extractorId = 'php.symfony'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep('**/*.php', /#\[Route\s*\(|@Route\s*\(/)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseSymfonyFile(content, file, this.extractorId)
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

function parseSymfonyFile(content: string, file: string, extractorId: string): RawApiSurface | null {
  const endpoints: RawEndpoint[] = []
  const lines = content.split('\n')

  // Class-level prefix route: #[Route('/prefix')] directly before `class Foo`
  const classPrefixMatch = content.match(/#\[Route\s*\(\s*['"]([^'"]+)['"]\s*\)\]\s*(?:#\[[^\]]*\]\s*)*class\s+\w+/)
  const classPrefix = classPrefixMatch?.[1] ?? ''

  let pendingRoute: { path: string; methods: HttpMethod[] } | null = null

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    // #[Route('/path', name: 'route_name', methods: ['GET', 'POST'])]
    // @Route("/path", methods={"GET"})
    const routeMatch = trimmed.match(/(?:#\[Route|@Route)\s*\(\s*['"]([^'"]+)['"](.*)/)
    if (routeMatch) {
      const rawPath = routeMatch[1]
      const rest = routeMatch[2]
      const path = classPrefix + (rawPath.startsWith('/') ? rawPath : '/' + rawPath)

      // Extract methods: methods: ['GET', 'POST'] or methods={"GET"}
      const bracketMatch = rest.match(/methods[^[]*\[([^\]]+)\]/)
      const methods: HttpMethod[] = []
      if (bracketMatch) {
        for (const m of bracketMatch[1].matchAll(/[A-Z]+/g)) {
          const method = SYMFONY_VERB_MAP[m[0]]
          if (method) methods.push(method)
        }
      }
      if (methods.length === 0) methods.push('GET')

      pendingRoute = { path, methods }
      continue
    }

    // Method declaration
    if (pendingRoute) {
      const fnMatch = trimmed.match(/(?:public|protected|private)\s+function\s+(\w+)\s*\(/)
      if (fnMatch) {
        const operationName = fnMatch[1]
        const parameters = extractPathParams(pendingRoute.path)
        for (const method of pendingRoute.methods) {
          endpoints.push({
            httpMethod: method,
            path: pendingRoute.path,
            operationName,
            parameters,
            tags: [],
            sourceFile: file,
            sourceLine: i + 1,
          })
        }
        pendingRoute = null
      }
    }
  }

  if (endpoints.length === 0) return null

  // Get class name for surface name
  const className = content.match(/class\s+(\w+)/)?.[1] ?? file.split('/').pop()?.replace(/\.php$/, '') ?? 'Controller'

  return {
    name: className,
    apiStyle: 'http',
    basePath: classPrefix || undefined,
    endpoints,
    sourceFile: file,
    sourceLine: 1,
  }
}

function extractPathParams(path: string): RawApiParameter[] {
  const params: RawApiParameter[] = []
  for (const m of path.matchAll(/\{(\w+)\}/g)) {
    params.push({ name: m[1], location: 'path', required: true })
  }
  return params
}
