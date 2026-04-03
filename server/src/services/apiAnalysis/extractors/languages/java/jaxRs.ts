import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

export class JaxRsExtractor extends BaseApiExtractor {
  readonly extractorId = 'java.jax_rs'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    // Find files containing @Path annotation (class or method level)
    const hits = await this.grep('**/*.{java,kt}', /@Path\s*\(/, 2000)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    // Also look for @ApplicationPath to determine global prefix
    const appPathPrefix = await detectApplicationPath(this)

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseJaxRsFile(content, file, appPathPrefix, this.extractorId)
        if (parsed.length > 0) surfaces.push(...parsed)
      } catch (err) {
        warnings.push(`Failed to parse ${file}: ${(err as Error).message}`)
      }
    }

    const endpointsFound = surfaces.reduce((sum, s) => sum + s.endpoints.length, 0)

    return {
      surfaces,
      warnings,
      stats: {
        filesScanned: uniqueFiles.length,
        surfacesFound: surfaces.length,
        endpointsFound,
        extractionTimeMs: Date.now() - start,
      },
    }
  }
}

// ---- Detect @ApplicationPath prefix ----

async function detectApplicationPath(extractor: JaxRsExtractor): Promise<string> {
  try {
    const hits = await (extractor as any).grep('**/*.{java,kt}', /@ApplicationPath\s*\(/, 5)
    for (const hit of hits) {
      const m = hit.text.match(/@ApplicationPath\s*\(\s*["']([^"']+)["']/)
      if (m) return m[1]
    }
  } catch { /* ignore */ }
  return ''
}

// ---- JAX-RS file parser ----

function parseJaxRsFile(content: string, file: string, appPathPrefix: string, _extractorId: string): RawApiSurface[] {
  if (!/@Path\s*\(/.test(content)) return []

  const collapsed = collapseAnnotationParens(content)
  const lines = collapsed.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')

  // Package
  const pkgMatch = content.match(/^package\s+([\w.]+)\s*;/m)
  const packageName = pkgMatch?.[1]

  // Class name
  const classMatch = collapsed.match(/(?:public\s+|abstract\s+|final\s+)*class\s+(\w+)/)
  if (!classMatch) return []
  const className = classMatch[1]

  // Class-level @Path
  const classPath = extractJaxRsPath(lines, /* classLevel */ true)
  const fullBasePath = joinPaths(appPathPrefix, classPath)

  const endpoints = extractJaxRsEndpoints(lines, fullBasePath, className, file)
  if (endpoints.length === 0) return []

  return [{
    name: className,
    apiStyle: 'http',
    basePath: fullBasePath || undefined,
    packageOrModule: packageName,
    endpoints,
    sourceFile: file,
  }]
}

// ---- Find class-level @Path value ----

function extractJaxRsPath(lines: string[], _classLevel: boolean): string {
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('@Path')) continue
    // Don't match method-level @Path after we've already found the class @Path;
    // a simple approach: take the first @Path we encounter in the file
    const m = trimmed.match(/@Path\s*\(\s*["']([^"']*)["']/)
    if (m) return m[1]
  }
  return ''
}

// ---- Walk lines collecting JAX-RS HTTP method annotations then method signatures ----

function extractJaxRsEndpoints(
  lines: string[],
  classBasePath: string,
  className: string,
  file: string,
): RawEndpoint[] {
  const endpoints: RawEndpoint[] = []
  let pendingHttpMethod: HttpMethod | null = null
  let pendingSubPath = ''
  let insideClass = false
  let braceDepth = 0

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    if (!insideClass) {
      if (/(?:public\s+|abstract\s+|final\s+)*class\s+\w+/.test(trimmed)) insideClass = true
      continue
    }

    for (const ch of trimmed) {
      if (ch === '{') braceDepth++
      else if (ch === '}') braceDepth--
    }
    if (braceDepth > 1) {
      pendingHttpMethod = null
      pendingSubPath = ''
      continue
    }

    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue

    // @GET / @POST / @PUT / @DELETE / @PATCH / @HEAD / @OPTIONS
    const httpMethod = extractJaxRsHttpMethod(trimmed)
    if (httpMethod) {
      pendingHttpMethod = httpMethod
      continue
    }

    // Method-level @Path
    if (/^@Path\s*\(/.test(trimmed)) {
      const m = trimmed.match(/@Path\s*\(\s*["']([^"']*)["']/)
      if (m) pendingSubPath = m[1]
      continue
    }

    // Other annotations — keep accumulating
    if (trimmed.startsWith('@')) continue

    // Method signature — join continuation lines if params span multiple lines
    if (pendingHttpMethod !== null) {
      let sigLine = trimmed
      if (sigLine.includes('(') && parenBalance(sigLine) > 0) {
        while (i + 1 < lines.length && parenBalance(sigLine) > 0) {
          i++
          sigLine += ' ' + lines[i].trim()
        }
      }

      const methodSig = parseMethodSignature(sigLine)
      if (methodSig) {
        const fullPath = joinPaths(classBasePath, pendingSubPath)
        const params = parseJaxRsParameters(methodSig.paramsStr)
        addPathTemplateParams(fullPath, params)

        endpoints.push({
          httpMethod: pendingHttpMethod,
          path: fullPath,
          parameters: params,
          returnType: methodSig.returnType || undefined,
          tags: [className],
          sourceFile: file,
          sourceLine: i + 1,
        })
      }
      pendingHttpMethod = null
      pendingSubPath = ''
    }
  }

  return endpoints
}

// ---- Extract JAX-RS HTTP method annotation ----

function extractJaxRsHttpMethod(line: string): HttpMethod | null {
  if (/^@GET\b/.test(line)) return 'GET'
  if (/^@POST\b/.test(line)) return 'POST'
  if (/^@PUT\b/.test(line)) return 'PUT'
  if (/^@DELETE\b/.test(line)) return 'DELETE'
  if (/^@PATCH\b/.test(line)) return 'PATCH'
  if (/^@HEAD\b/.test(line)) return 'HEAD'
  if (/^@OPTIONS\b/.test(line)) return 'OPTIONS'
  return null
}

// ---- Parse JAX-RS method parameters ----

function parseJaxRsParameters(paramsStr: string): RawApiParameter[] {
  if (!paramsStr.trim()) return []
  const params: RawApiParameter[] = []
  const parts = splitOnCommas(paramsStr)

  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue

    // @PathParam("name")
    const pathParamMatch = trimmed.match(/@PathParam\s*\(\s*["']([^"']+)["']\s*\)/)
    if (pathParamMatch) {
      const type = extractParamType(trimmed)
      params.push({ name: pathParamMatch[1], location: 'path', type, required: true })
      continue
    }

    // @QueryParam("name")
    const queryParamMatch = trimmed.match(/@QueryParam\s*\(\s*["']([^"']+)["']\s*\)/)
    if (queryParamMatch) {
      const type = extractParamType(trimmed)
      params.push({ name: queryParamMatch[1], location: 'query', type, required: false })
      continue
    }

    // @FormParam("name")
    const formParamMatch = trimmed.match(/@FormParam\s*\(\s*["']([^"']+)["']\s*\)/)
    if (formParamMatch) {
      const type = extractParamType(trimmed)
      params.push({ name: formParamMatch[1], location: 'body', type, required: false })
      continue
    }

    // @HeaderParam("name")
    const headerParamMatch = trimmed.match(/@HeaderParam\s*\(\s*["']([^"']+)["']\s*\)/)
    if (headerParamMatch) {
      const type = extractParamType(trimmed)
      params.push({ name: headerParamMatch[1], location: 'header', type, required: false })
      continue
    }

    // Body parameter: no annotation, not a JAX-RS injection type
    if (!/@\w+/.test(trimmed)) {
      const jaxRsInjections = /\b(?:UriInfo|HttpHeaders|Request|SecurityContext|Application|Providers|ResourceContext|Configuration)\b/
      if (!jaxRsInjections.test(trimmed)) {
        const type = extractParamType(trimmed)
        const varMatch = trimmed.match(/(\w+)\s*$/)
        if (type && varMatch) {
          params.push({ name: varMatch[1], location: 'body', type, required: true })
        }
      }
    }
  }

  return params
}

/** Add any path template parameters not already declared in the params list */
function addPathTemplateParams(path: string, params: RawApiParameter[]): void {
  const templateParamRegex = /\{(\w+)(?::[^}]*)?\}/g
  let m: RegExpExecArray | null
  while ((m = templateParamRegex.exec(path)) !== null) {
    const name = m[1]
    if (!params.some((p) => p.name === name && p.location === 'path')) {
      params.push({ name, location: 'path', required: true })
    }
  }
}

// ---- Shared helpers (duplicated from springMvc.ts to keep extractors independent) ----

interface MethodSignature { returnType: string; name: string; paramsStr: string }

function parseMethodSignature(line: string): MethodSignature | null {
  if (!line.includes('(')) return null
  if (line.startsWith('@') || line.startsWith('//') || /^\s*(?:if|for|while|switch|catch|return|throw|new)\b/.test(line)) return null

  const parenStart = line.indexOf('(')
  const beforeParens = line.slice(0, parenStart).trim()
  const paramsStr = extractToMatchingParen(line, parenStart)
  if (paramsStr === null) return null

  if (/\bfun\s+\w+\s*$/.test(beforeParens)) {
    const name = beforeParens.match(/\bfun\s+(\w+)\s*$/)?.[1] ?? ''
    return name ? { returnType: '', name, paramsStr } : null
  }

  const parts = beforeParens.split(/\s+/).filter(Boolean)
  if (parts.length < 2) return null
  const methodName = parts[parts.length - 1]
  if (!methodName || !/^[a-zA-Z_$]/.test(methodName)) return null
  if (['if', 'for', 'while', 'switch', 'catch', 'new', 'return'].includes(methodName)) return null

  const MODIFIERS = new Set(['public', 'protected', 'private', 'static', 'final', 'abstract', 'synchronized', 'default', 'native'])
  const returnType = parts.slice(0, -1).filter((p) => !MODIFIERS.has(p)).join(' ')
  return { returnType, name: methodName, paramsStr }
}

function extractToMatchingParen(s: string, start: number): string | null {
  let depth = 0
  for (let i = start; i < s.length; i++) {
    if (s[i] === '(') depth++
    else if (s[i] === ')') { depth--; if (depth === 0) return s.slice(start + 1, i) }
  }
  return null
}

function parenBalance(s: string): number {
  let depth = 0
  for (const ch of s) { if (ch === '(') depth++; else if (ch === ')') depth-- }
  return depth
}

function extractParamType(paramDecl: string): string | undefined {
  const stripped = paramDecl.replace(/@\w+(?:\s*\([^)]*\))?\s*/g, '').trim()
  const m = stripped.match(/^([\w<>.,\s\[\]]+?)\s+\w+\s*$/)
  if (m) return m[1].trim()
  return undefined
}

function splitOnCommas(s: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of s) {
    if (ch === '<' || ch === '(' || ch === '[') depth++
    else if (ch === '>' || ch === ')' || ch === ']') depth--
    else if (ch === ',' && depth === 0) { parts.push(current); current = ''; continue }
    current += ch
  }
  if (current.trim()) parts.push(current)
  return parts
}

function joinPaths(base: string, sub: string): string {
  if (!base && !sub) return '/'
  if (!sub) return base || '/'
  if (!base) return sub.startsWith('/') ? sub : '/' + sub
  const b = base.endsWith('/') ? base.slice(0, -1) : base
  const s = sub.startsWith('/') ? sub : '/' + sub
  return b + s
}

function collapseAnnotationParens(content: string): string {
  let result = ''
  let depth = 0
  let inAnnot = false
  for (let i = 0; i < content.length; i++) {
    const ch = content[i]
    if (ch === '@') inAnnot = true
    if (inAnnot && ch === '(') depth++
    if (inAnnot && ch === ')') { depth--; if (depth === 0) inAnnot = false }
    if (inAnnot && depth > 0 && (ch === '\n' || ch === '\r')) result += ' '
    else result += ch
  }
  return result
}
