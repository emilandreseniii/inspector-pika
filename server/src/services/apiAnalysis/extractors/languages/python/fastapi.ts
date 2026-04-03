import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

export class FastApiExtractor extends BaseApiExtractor {
  readonly extractorId = 'python.fastapi'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    // Find Python files importing FastAPI or APIRouter
    const hits = await this.grep(
      '**/*.py',
      /(?:from\s+fastapi\s+import|import\s+fastapi\b|FastAPI\s*\(|APIRouter\s*\()/,
      2000,
    )
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseFastApiFile(content, file)
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

function parseFastApiFile(content: string, file: string): RawApiSurface | null {
  // Determine module name from file path
  const moduleName = file.replace(/\.py$/, '').replace(/\//g, '.').replace(/\.__init__$/, '')

  // Collect router/app variable names defined in this file
  const routerVarNames = detectRouterVars(content)
  if (routerVarNames.size === 0) return null

  // Build a pattern that matches any of the router variable names
  const varPattern = [...routerVarNames].map(escapeRegex).join('|')
  const routePattern = new RegExp(`^@(?:${varPattern})\\.(?:get|post|put|delete|patch|head|options)\\s*\\(`, 'i')

  const lines = joinLogicalLines(content.split('\n'))
  const endpoints: RawEndpoint[] = []

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!routePattern.test(trimmed)) continue

    // Parse the decorator: @router.get("/path", ...)
    const decoratorMatch = trimmed.match(
      /^@\w+\.(get|post|put|delete|patch|head|options)\s*\(\s*(.*)\s*\)/i,
    )
    if (!decoratorMatch) continue

    const httpMethod = decoratorMatch[1].toUpperCase() as HttpMethod
    const decoratorArgs = decoratorMatch[2]

    const path = extractStringArg(decoratorArgs, 0) ?? '/'
    const summary = extractKwarg(decoratorArgs, 'summary')
    const responseModel = extractKwarg(decoratorArgs, 'response_model')
    const tags = extractTagsArg(decoratorArgs)

    // Find the function definition on the next non-empty line(s)
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
    const parameters = parseFuncParams(paramsStr, pathParams)

    endpoints.push({
      httpMethod,
      path,
      operationName,
      summary: summary ?? undefined,
      returnType: responseModel ?? undefined,
      parameters,
      tags: tags.length > 0 ? tags : [moduleName],
      sourceFile: file,
      sourceLine: i + 1,
    })
  }

  if (endpoints.length === 0) return null

  // Surface name: module basename or file name
  const surfaceName = file.split('/').pop()?.replace(/\.py$/, '') ?? file

  return {
    name: surfaceName,
    apiStyle: 'http',
    packageOrModule: moduleName,
    endpoints,
    sourceFile: file,
    sourceLine: 1,
  }
}

// ---- Detect FastAPI / APIRouter variable names ----

function detectRouterVars(content: string): Set<string> {
  const vars = new Set<string>()

  // app = FastAPI() or router = APIRouter() or api = FastAPI(prefix=...)
  for (const m of content.matchAll(/^(\w+)\s*=\s*(?:FastAPI|APIRouter)\s*\(/gm)) {
    vars.add(m[1])
  }

  // include_router: the file uses an app that might be named differently
  // If no direct instantiation found, look for include_router calls (sub-routers)
  if (vars.size === 0) {
    for (const m of content.matchAll(/^(\w+)\.include_router\s*\(/gm)) {
      vars.add(m[1])
    }
  }

  // Fallback: if file just has @app.get / @router.get patterns, detect the names
  for (const m of content.matchAll(/^@(\w+)\.(get|post|put|delete|patch|head|options)\s*\(/gm)) {
    vars.add(m[1])
  }

  return vars
}

// ---- Extract path template parameters: /items/{item_id} → ["item_id"] ----

function extractPathParams(path: string): Set<string> {
  const params = new Set<string>()
  for (const m of path.matchAll(/\{(\w+)\}/g)) params.add(m[1])
  return params
}

// ---- Parse Python function parameters ----

function parseFuncParams(paramsStr: string, pathParams: Set<string>): RawApiParameter[] {
  if (!paramsStr.trim()) return []
  const params: RawApiParameter[] = []

  // Split on commas at depth 0
  const parts = splitOnCommas(paramsStr)

  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed || trimmed === '*' || trimmed.startsWith('**')) continue

    // Skip common FastAPI injection types
    if (/\b(?:Request|Response|BackgroundTasks|HTTPException|Depends|Security|OAuth2PasswordRequestForm)\b/.test(trimmed)) continue

    // Extract name: type = default or name = default or name: type
    const nameMatch = trimmed.match(/^(\w+)\s*(?::\s*([^=]+?))?\s*(?:=\s*(.+))?$/)
    if (!nameMatch) continue

    const name = nameMatch[1]
    if (['self', 'cls'].includes(name)) continue

    const rawType = nameMatch[2]?.trim()
    const defaultVal = nameMatch[3]?.trim()

    // Determine location
    let location: RawApiParameter['location']
    let required = true

    if (pathParams.has(name)) {
      location = 'path'
    } else if (defaultVal !== undefined) {
      // Has a default — could be Query(...) or Body(...) or just a value
      if (/^Body\s*\(/.test(defaultVal)) {
        location = 'body'
        required = !/\bnone\b/i.test(defaultVal)
      } else if (/^Header\s*\(/.test(defaultVal)) {
        location = 'header'
        required = false
      } else {
        // Optional query param
        location = 'query'
        required = false
      }
    } else if (rawType && isBodyType(rawType)) {
      // Pydantic model or complex type without default → request body
      location = 'body'
    } else {
      location = 'query'
      required = true
    }

    params.push({ name, location, type: rawType, required })
  }

  return params
}

/** Heuristic: is this type likely a Pydantic body model (not a primitive)? */
function isBodyType(type: string): boolean {
  const primitives = /^(?:int|str|float|bool|bytes|None|Optional|List|Dict|Tuple|Set|Any|datetime|date|UUID|EmailStr)\b/
  const clean = type.replace(/^Optional\[(.+)\]$/, '$1').trim()
  return !primitives.test(clean)
}

// ---- Decorator argument parsing ----

/** Extract the n-th positional string arg: @router.get("/path", ...) → "/path" */
function extractStringArg(args: string, index: number): string | null {
  const parts = splitOnCommas(args)
  const part = parts[index]?.trim()
  if (!part) return null
  const m = part.match(/^["'](.+?)["']$/)
  return m ? m[1] : null
}

/** Extract a keyword argument value: summary="Foo" → "Foo", response_model=list[Foo] → "list[Foo]" */
function extractKwarg(args: string, key: string): string | null {
  // Try quoted string first
  const quotedRe = new RegExp(`\\b${key}\\s*=\\s*["']([^"']+)["']`)
  const quotedMatch = args.match(quotedRe)
  if (quotedMatch) return quotedMatch[1]

  // Try unquoted identifier/type expression (e.g. response_model=list[Item])
  const idx = args.search(new RegExp(`\\b${key}\\s*=`))
  if (idx === -1) return null
  const afterEq = args.slice(idx).replace(new RegExp(`^${key}\\s*=\\s*`), '')
  // Collect until next comma at depth 0, or end of string
  let depth = 0
  let value = ''
  for (const ch of afterEq) {
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth--
    else if (ch === ',' && depth === 0) break
    if (depth < 0) break  // hit closing paren of decorator
    value += ch
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Extract tags=[\"Foo\", \"Bar\"] → ["Foo", "Bar"] */
function extractTagsArg(args: string): string[] {
  const m = args.match(/\btags\s*=\s*\[([^\]]*)\]/)
  if (!m) return []
  const tags: string[] = []
  for (const t of m[1].matchAll(/["']([^"']+)["']/g)) tags.push(t[1])
  return tags
}

// ---- Logical line joining (handles backslash continuation and open parens) ----

function joinLogicalLines(lines: string[]): string[] {
  const result: string[] = []
  let i = 0
  while (i < lines.length) {
    let line = lines[i]
    // Backslash continuation
    while (line.trimEnd().endsWith('\\') && i + 1 < lines.length) {
      i++
      line = line.trimEnd().slice(0, -1) + lines[i].trim()
    }
    // Open paren continuation
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

// ---- Helpers ----

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
