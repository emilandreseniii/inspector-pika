import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, HttpMethod } from '../../base'

const ALL_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']

/**
 * Extracts API surfaces from Next.js API routes.
 *
 * Two patterns:
 *
 * 1. Pages Router: `pages/api/**\/*.{ts,js}` with default export handler
 *    export default function handler(req, res) { ... }
 *    Supports req.method === 'GET' branching to infer methods.
 *
 * 2. App Router: app/api/** /route.ts with named HTTP method exports
 *    export async function GET(request) { ... }
 *    export async function POST(request) { ... }
 */
export class NextJsApiExtractor extends BaseApiExtractor {
  readonly extractorId = 'typescript.nextjs_api'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    // Pages Router: pages/api/**/*.{ts,js,tsx,jsx}
    const pagesHits = await this.grep('pages/api/**/*.{ts,js,tsx,jsx}', /export\s+default/, 2000)
    const pagesFiles = [...new Set(pagesHits.map((h) => h.file))]

    for (const file of pagesFiles) {
      try {
        const content = await this.readFile(file)
        const surface = parsePagesApiFile(content, file)
        if (surface) surfaces.push(surface)
      } catch (err) {
        warnings.push(`Failed to parse ${file}: ${(err as Error).message}`)
      }
    }

    // App Router: app/**/route.{ts,js,tsx,jsx}
    const appHits = await this.glob('app/**/route.{ts,js,tsx,jsx}')
    for (const file of appHits) {
      try {
        const content = await this.readFile(file)
        const surface = parseAppRouteFile(content, file)
        if (surface) surfaces.push(surface)
      } catch (err) {
        warnings.push(`Failed to parse ${file}: ${(err as Error).message}`)
      }
    }

    const endpointsFound = surfaces.reduce((sum, s) => sum + s.endpoints.length, 0)
    return {
      surfaces,
      warnings,
      stats: { filesScanned: pagesFiles.length + appHits.length, surfacesFound: surfaces.length, endpointsFound, extractionTimeMs: Date.now() - start },
    }
  }
}

// ---- Pages Router parser ----

function parsePagesApiFile(content: string, file: string): RawApiSurface | null {
  // Extract route path from file path: pages/api/users/[id].ts → /api/users/[id]
  const routePath = fileToRoutePath(file, 'pages')
  if (!routePath) return null

  const stripped = stripComments(content)
  const methods = detectPagesMethods(stripped)

  const endpoints: RawEndpoint[] = methods.map((method) => ({
    httpMethod: method,
    path: routePath,
    parameters: extractDynamicParams(routePath),
  }))

  if (endpoints.length === 0) return null

  return {
    name: file.split('/').pop()?.replace(/\.[^.]+$/, '') ?? file,
    file,
    framework: 'nextjs',
    endpoints,
  }
}

function detectPagesMethods(content: string): HttpMethod[] {
  // Look for req.method === 'METHOD' or req.method === "METHOD"
  const methods = new Set<HttpMethod>()
  for (const m of content.matchAll(/req\.method\s*[=!]=+\s*['"]([A-Z]+)['"]/g)) {
    const method = m[1] as HttpMethod
    if (ALL_METHODS.includes(method)) methods.add(method)
  }
  if (methods.size === 0) {
    // Default: handler accepts all methods
    return ALL_METHODS.slice(0, 5)  // GET, POST, PUT, DELETE, PATCH
  }
  return [...methods]
}

// ---- App Router parser ----

function parseAppRouteFile(content: string, file: string): RawApiSurface | null {
  const routePath = fileToRoutePath(file, 'app')
  if (!routePath) return null

  const stripped = stripComments(content)
  const methods: HttpMethod[] = []

  // export async function GET(...) or export function POST(...)
  for (const m of stripped.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s*\(/g)) {
    methods.push(m[1] as HttpMethod)
  }
  // export const GET = async (...) =>
  for (const m of stripped.matchAll(/export\s+const\s+(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s*=/g)) {
    methods.push(m[1] as HttpMethod)
  }

  if (methods.length === 0) return null

  const endpoints: RawEndpoint[] = [...new Set(methods)].map((method) => ({
    httpMethod: method,
    path: routePath,
    parameters: extractDynamicParams(routePath),
  }))

  return {
    name: file.split('/').pop()?.replace(/\.[^.]+$/, '') ?? file,
    file,
    framework: 'nextjs',
    endpoints,
  }
}

// ---- Helpers ----

function fileToRoutePath(file: string, routerType: 'pages' | 'app'): string | null {
  // Strip file extension
  const withoutExt = file.replace(/\.(ts|js|tsx|jsx)$/, '')

  let relative: string
  if (routerType === 'pages') {
    // pages/api/users/[id] → /api/users/[id]
    const match = withoutExt.match(/pages\/(.+)$/)
    if (!match) return null
    relative = match[1]
    // Strip index
    relative = relative.replace(/\/index$/, '')
  } else {
    // app/api/users/[id]/route → /api/users/[id]
    const match = withoutExt.match(/app\/(.+)\/route$/)
    if (!match) return null
    relative = match[1]
  }

  return `/${relative}`
}

function extractDynamicParams(routePath: string) {
  // Next.js uses [param] and [...param] syntax
  const params: Array<{ name: string; in: 'path'; required: boolean }> = []
  for (const m of routePath.matchAll(/\[(?:\.\.\.)?([^\]]+)\]/g)) {
    params.push({ name: m[1], in: 'path', required: true })
  }
  return params
}

function stripComments(code: string): string {
  return code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}
