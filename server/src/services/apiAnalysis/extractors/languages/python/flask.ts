import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

const ALL_HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']

export class FlaskExtractor extends BaseApiExtractor {
  readonly extractorId = 'python.flask'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep(
      '**/*.py',
      /(?:from\s+flask\s+import|import\s+flask\b|Flask\s*\(__name__\)|Blueprint\s*\()/,
      2000,
    )
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseFlaskFile(content, file)
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

function parseFlaskFile(content: string, file: string): RawApiSurface | null {
  const routerVarNames = detectFlaskVars(content)
  if (routerVarNames.size === 0) return null

  const varPattern = [...routerVarNames].map(escapeRegex).join('|')
  // Matches @app.route(...), @app.get(...), @bp.route(...) etc.
  const routePattern = new RegExp(`^@(?:${varPattern})\\.(?:route|get|post|put|delete|patch|head|options)\\s*\\(`, 'i')

  const lines = joinLogicalLines(content.split('\n'))
  const endpoints: RawEndpoint[] = []

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!routePattern.test(trimmed)) continue

    // @app.route("/path", methods=["GET", "POST"])
    // @app.get("/path")
    const decoratorMatch = trimmed.match(
      /^@\w+\.(route|get|post|put|delete|patch|head|options)\s*\(\s*(.*)\s*\)/i,
    )
    if (!decoratorMatch) continue

    const decoratorType = decoratorMatch[1].toLowerCase()
    const decoratorArgs = decoratorMatch[2]

    const path = extractStringArg(decoratorArgs, 0) ?? '/'
    const methods = decoratorType === 'route'
      ? extractMethodsArg(decoratorArgs)
      : [decoratorType.toUpperCase() as HttpMethod]

    // Find following function definition
    let funcLine = ''
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      const next = lines[j].trim()
      if (/^(?:async\s+)?def\s+\w+/.test(next)) { funcLine = next; break }
    }
    if (!funcLine) continue

    const funcMatch = funcLine.match(/^(?:async\s+)?def\s+(\w+)\s*\((.*)\)/)
    if (!funcMatch) continue

    const operationName = funcMatch[1]
    const paramsStr = funcMatch[2]
    const pathParams = extractPathParams(path)
    const parameters = parseFlaskParams(paramsStr, pathParams)

    for (const httpMethod of methods) {
      endpoints.push({
        httpMethod,
        path,
        operationName: methods.length > 1 ? `${operationName}_${httpMethod.toLowerCase()}` : operationName,
        parameters,
        tags: [],
        sourceFile: file,
        sourceLine: i + 1,
      })
    }
  }

  // Also scan for add_url_rule calls
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    const urlRuleMatch = trimmed.match(
      /(?:\w+)\.add_url_rule\s*\(\s*(.*)\s*\)/,
    )
    if (!urlRuleMatch) continue

    const args = urlRuleMatch[1]
    const path = extractStringArg(args, 0) ?? '/'
    const methods = extractMethodsArg(args)
    const viewFunc = extractKwarg(args, 'view_func')
    const operationName = viewFunc ?? extractStringArg(args, 1) ?? 'handler'
    const pathParams = extractPathParams(path)

    for (const httpMethod of methods.length > 0 ? methods : (['GET'] as HttpMethod[])) {
      endpoints.push({
        httpMethod,
        path,
        operationName,
        parameters: [...pathParams].map((name) => ({ name, location: 'path' as const, required: true })),
        tags: [],
        sourceFile: file,
        sourceLine: i + 1,
      })
    }
  }

  if (endpoints.length === 0) return null

  const surfaceName = file.split('/').pop()?.replace(/\.py$/, '') ?? file
  const moduleName = file.replace(/\.py$/, '').replace(/\//g, '.').replace(/\.__init__$/, '')

  return {
    name: surfaceName,
    apiStyle: 'http',
    packageOrModule: moduleName,
    endpoints,
    sourceFile: file,
    sourceLine: 1,
  }
}

// ---- Detect Flask app/blueprint variable names ----

function detectFlaskVars(content: string): Set<string> {
  const vars = new Set<string>()

  // app = Flask(__name__) or bp = Blueprint("name", __name__)
  for (const m of content.matchAll(/^(\w+)\s*=\s*(?:Flask|Blueprint)\s*\(/gm)) {
    vars.add(m[1])
  }

  // Fallback: detect from decorator patterns
  for (const m of content.matchAll(/^@(\w+)\.(?:route|get|post|put|delete|patch)\s*\(/gm)) {
    vars.add(m[1])
  }

  return vars
}

// ---- Parse Flask URL params: /users/<int:user_id> → ["user_id"] ----

function extractPathParams(path: string): Set<string> {
  const params = new Set<string>()
  // Flask style: <converter:name> or <name>
  for (const m of path.matchAll(/<(?:\w+:)?(\w+)>/g)) params.add(m[1])
  // FastAPI style (sometimes used with Flask extensions): {name}
  for (const m of path.matchAll(/\{(\w+)\}/g)) params.add(m[1])
  return params
}

function extractMethodsArg(args: string): HttpMethod[] {
  const m = args.match(/\bmethods\s*=\s*\[([^\]]*)\]/)
  if (!m) return ['GET']
  const methods: HttpMethod[] = []
  for (const t of m[1].matchAll(/["']([A-Za-z]+)["']/g)) {
    const upper = t[1].toUpperCase() as HttpMethod
    if (ALL_HTTP_METHODS.includes(upper)) methods.push(upper)
  }
  return methods.length > 0 ? methods : ['GET']
}

function parseFlaskParams(paramsStr: string, pathParams: Set<string>): RawApiParameter[] {
  if (!paramsStr.trim()) return []
  const params: RawApiParameter[] = []
  const parts = splitOnCommas(paramsStr)

  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed || ['self', 'cls'].includes(trimmed.split(/[\s:=]/)[0])) continue

    const nameMatch = trimmed.match(/^(\w+)(?:\s*:\s*([^=]+?))?(?:\s*=\s*(.+))?$/)
    if (!nameMatch) continue

    const name = nameMatch[1]
    if (['self', 'cls'].includes(name)) continue

    const rawType = nameMatch[2]?.trim()
    const hasDefault = nameMatch[3] !== undefined

    const location: RawApiParameter['location'] = pathParams.has(name) ? 'path' : 'query'
    params.push({ name, location, type: rawType, required: !hasDefault && location === 'path' })
  }

  return params
}

// ---- Shared helpers ----

function extractStringArg(args: string, index: number): string | null {
  const parts = splitOnCommas(args)
  const part = parts[index]?.trim()
  if (!part) return null
  const m = part.match(/^["'](.+?)["']$/)
  return m ? m[1] : null
}

function extractKwarg(args: string, key: string): string | null {
  const re = new RegExp(`\\b${key}\\s*=\\s*["']([^"']+)["']`)
  const m = args.match(re)
  return m ? m[1] : null
}

function joinLogicalLines(lines: string[]): string[] {
  const result: string[] = []
  let i = 0
  while (i < lines.length) {
    let line = lines[i]
    while (line.trimEnd().endsWith('\\') && i + 1 < lines.length) {
      i++
      line = line.trimEnd().slice(0, -1) + lines[i].trim()
    }
    let depth = 0
    for (const ch of line) { if (ch === '(') depth++; else if (ch === ')') depth-- }
    while (depth > 0 && i + 1 < lines.length) {
      i++
      const next = lines[i].trim()
      line += ' ' + next
      for (const ch of next) { if (ch === '(') depth++; else if (ch === ')') depth-- }
    }
    result.push(line)
    i++
  }
  return result
}

function splitOnCommas(s: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of s) {
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth--
    else if (ch === ',' && depth === 0) { parts.push(current); current = ''; continue }
    current += ch
  }
  if (current.trim()) parts.push(current)
  return parts
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
