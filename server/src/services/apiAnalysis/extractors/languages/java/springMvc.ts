import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, HttpMethod } from '../../base'

export class SpringMvcExtractor extends BaseApiExtractor {
  readonly extractorId = 'java.spring_mvc'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    // Quick filter: only files containing Spring controller annotations
    const hits = await this.grep(
      '**/*.{java,kt}',
      /@(?:Rest)?Controller\b/,
      2000,
    )
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseSpringMvcFile(content, file, this.extractorId)
        if (parsed) surfaces.push(parsed)
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

// ---- Spring MVC file parser ----

function parseSpringMvcFile(content: string, file: string, extractorId: string): RawApiSurface | null {
  // Must have a controller annotation
  if (!/@(?:Rest)?Controller\b/.test(content)) return null

  // Collapse newlines inside annotation parentheses so each annotation fits on one line
  const collapsed = collapseAnnotationParens(content)
  const lines = collapsed.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')

  // Package declaration
  const pkgMatch = content.match(/^package\s+([\w.]+)\s*;/m)
  const packageName = pkgMatch?.[1]

  // Class name and class-level @RequestMapping
  const classMatch = collapsed.match(/(?:public\s+|abstract\s+|final\s+)*(?:class|data\s+class)\s+(\w+)/)
  if (!classMatch) return null
  const className = classMatch[1]

  // Find class-level @RequestMapping base path
  const classBasePath = extractClassBasePath(lines)

  // Find the line number of the class declaration for sourceLine
  const classLineNo = lines.findIndex((l) => /(?:public\s+|abstract\s+|final\s+)*(?:class|data\s+class)\s+\w+/.test(l)) + 1

  const endpoints = extractEndpoints(lines, classBasePath, className, file)

  if (endpoints.length === 0) return null

  return {
    name: className,
    apiStyle: 'http',
    basePath: classBasePath || undefined,
    packageOrModule: packageName,
    endpoints,
    sourceFile: file,
    sourceLine: classLineNo,
  }
}

// ---- Extract the class-level @RequestMapping base path ----

function extractClassBasePath(lines: string[]): string {
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('@RequestMapping')) continue
    const path = extractAnnotationPath(trimmed)
    if (path !== null) return path
  }
  return ''
}

// ---- Walk lines collecting method-level mapping annotations then method signatures ----

function extractEndpoints(
  lines: string[],
  classBasePath: string,
  className: string,
  file: string,
): RawEndpoint[] {
  const endpoints: RawEndpoint[] = []
  // Pending mapping annotations above the current method
  let pendingMappings: Array<{ method: HttpMethod; subPath: string }> = []
  let insideClass = false
  let braceDepth = 0

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    // Track whether we've entered the class body
    if (!insideClass) {
      if (/(?:public\s+|abstract\s+|final\s+)*(?:class|data\s+class)\s+\w+/.test(trimmed)) {
        insideClass = true
      }
      continue
    }

    // Track brace depth to avoid parsing nested classes as methods of the outer class
    for (const ch of trimmed) {
      if (ch === '{') braceDepth++
      else if (ch === '}') braceDepth--
    }
    // Only parse methods at depth 1 (direct members of the class)
    if (braceDepth > 1) {
      pendingMappings = []
      continue
    }

    // Skip blank / comment / non-annotation, non-code lines
    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue
    }

    // Detect method-level mapping annotation
    const mapping = extractHttpMethodMapping(trimmed)
    if (mapping) {
      pendingMappings.push(mapping)
      continue
    }

    // Other annotations (e.g. @ResponseStatus, @Transactional): keep accumulating
    if (trimmed.startsWith('@')) {
      continue
    }

    // If we have pending mappings and see a non-annotation line, try to parse a method signature
    if (pendingMappings.length > 0) {
      // Join continuation lines when the method signature spans multiple lines
      // (e.g. params listed one per line). Stop once parens are balanced.
      let sigLine = trimmed
      if (sigLine.includes('(') && parenBalance(sigLine) > 0) {
        while (i + 1 < lines.length && parenBalance(sigLine) > 0) {
          i++
          sigLine += ' ' + lines[i].trim()
        }
      }

      const methodSig = parseMethodSignature(sigLine)
      if (methodSig) {
        const params = parseMethodParameters(methodSig.paramsStr)
        for (const { method, subPath } of pendingMappings) {
          const fullPath = joinPaths(classBasePath, subPath)
          endpoints.push({
            httpMethod: method,
            path: fullPath,
            parameters: params,
            returnType: methodSig.returnType || undefined,
            tags: [className],
            sourceFile: file,
            sourceLine: i + 1,
          })
        }
        pendingMappings = []
      } else {
        // Not a method signature — discard pending mappings
        pendingMappings = []
      }
    }
  }

  return endpoints
}

// ---- Extract HTTP method + sub-path from a mapping annotation line ----

function extractHttpMethodMapping(line: string): { method: HttpMethod; subPath: string } | null {
  // @GetMapping, @PostMapping, @PutMapping, @DeleteMapping, @PatchMapping
  const shortMatch = line.match(/^@(Get|Post|Put|Delete|Patch)Mapping\b(.*)/)
  if (shortMatch) {
    const method = shortMatch[1].toUpperCase() as HttpMethod
    const rest = shortMatch[2].trim()
    const subPath = rest ? (extractAnnotationPath(line) ?? '') : ''
    return { method, subPath }
  }

  // @RequestMapping(method = RequestMethod.XXX, value = "/path")
  // @RequestMapping(value = "/path", method = RequestMethod.XXX)
  if (/^@RequestMapping\b/.test(line)) {
    const methods = extractRequestMappingMethods(line)
    const subPath = extractAnnotationPath(line) ?? ''
    if (methods.length === 0) return null
    // Return first method (multi-method mappings are uncommon; generate one endpoint per method)
    // Caller will only use first; we handle multi below
    return { method: methods[0], subPath }
  }

  return null
}

/** For @RequestMapping, may return multiple HTTP methods */
function extractRequestMappingMethods(line: string): HttpMethod[] {
  // method = RequestMethod.GET  OR  method = {RequestMethod.GET, RequestMethod.POST}
  const methodsMatch = line.match(/\bmethod\s*=\s*\{?([^}]+?)\}?(?:\s*[,)]|$)/)
  if (!methodsMatch) return []

  const raw = methodsMatch[1]
  const found: HttpMethod[] = []
  for (const m of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'] as HttpMethod[]) {
    if (raw.includes(m)) found.push(m)
  }
  return found
}

// ---- Extract the path string from an annotation line ----
// Handles: @GetMapping("/path"), @GetMapping(value="/path"), @RequestMapping({"/a","/b"})

function extractAnnotationPath(line: string): string | null {
  const parenStart = line.indexOf('(')
  if (parenStart === -1) return ''  // @GetMapping with no parens → root path

  const inner = line.slice(parenStart + 1, line.lastIndexOf(')')).trim()
  if (!inner) return ''

  // value="/path" or path="/path"
  const namedMatch = inner.match(/(?:value|path)\s*=\s*["']([^"']*)["']/)
  if (namedMatch) return namedMatch[1]

  // {"/path1", "/path2"} — take first
  const arrayMatch = inner.match(/\{[^}]*?["']([^"']+)["']/)
  if (arrayMatch) return arrayMatch[1]

  // Plain string: "/path"
  const plainMatch = inner.match(/^["']([^"']*)["']/)
  if (plainMatch) return plainMatch[1]

  return ''
}

// ---- Parse a Java/Kotlin method signature ----
// Returns null if the line does not look like a method signature

interface MethodSignature {
  returnType: string
  name: string
  paramsStr: string
}

function parseMethodSignature(line: string): MethodSignature | null {
  if (!line.includes('(')) return null
  if (line.startsWith('@') || line.startsWith('//') || /^\s*(?:if|for|while|switch|catch|return|throw|new)\b/.test(line)) {
    return null
  }

  // Kotlin: fun methodName(...)
  const parenStart = line.indexOf('(')
  const beforeParens = line.slice(0, parenStart).trim()
  const paramsStr = extractToMatchingParen(line, parenStart)
  if (paramsStr === null) return null

  if (/\bfun\s+\w+\s*$/.test(beforeParens)) {
    const name = beforeParens.match(/\bfun\s+(\w+)\s*$/)?.[1] ?? ''
    const afterClose = line.slice(parenStart + paramsStr.length + 2).trim()
    const returnType = afterClose.startsWith(':') ? afterClose.slice(1).split(/[{;]/)[0].trim() : ''
    return name ? { returnType, name, paramsStr } : null
  }

  // Java: [modifiers] ReturnType methodName
  const parts = beforeParens.split(/\s+/).filter(Boolean)
  if (parts.length < 2) return null
  const methodName = parts[parts.length - 1]
  if (!methodName || !/^[a-zA-Z_$]/.test(methodName)) return null
  if (['if', 'for', 'while', 'switch', 'catch', 'new', 'return'].includes(methodName)) return null

  const MODIFIERS = new Set(['public', 'protected', 'private', 'static', 'final', 'abstract', 'synchronized', 'default', 'native'])
  const returnType = parts.slice(0, -1).filter((p) => !MODIFIERS.has(p)).join(' ')

  return { returnType, name: methodName, paramsStr }
}

/** Extract the content between balanced outer parens starting at index `start`. */
function extractToMatchingParen(s: string, start: number): string | null {
  let depth = 0
  for (let i = start; i < s.length; i++) {
    if (s[i] === '(') depth++
    else if (s[i] === ')') { depth--; if (depth === 0) return s.slice(start + 1, i) }
  }
  return null
}

/** Count net open parens (positive = unbalanced open). */
function parenBalance(s: string): number {
  let depth = 0
  for (const ch of s) { if (ch === '(') depth++; else if (ch === ')') depth-- }
  return depth
}

// ---- Parse method parameters to extract @PathVariable, @RequestParam, @RequestBody ----

function parseMethodParameters(paramsStr: string): RawApiParameter[] {
  if (!paramsStr.trim()) return []

  const params: RawApiParameter[] = []
  const parts = splitOnCommas(paramsStr)

  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue

    // @PathVariable [("name")] Type varName
    const pathVarMatch = trimmed.match(/@PathVariable\s*(?:\(\s*(?:value\s*=\s*)?["']([^"']+)["']\s*\))?\s+(?:\S+\s+)?(\w+)\s*$/)
    if (pathVarMatch) {
      const type = extractParamType(trimmed)
      params.push({
        name: pathVarMatch[1] ?? pathVarMatch[2],
        location: 'path',
        type,
        required: true,
      })
      continue
    }

    // @RequestParam [("name")] [required=...] Type varName
    const reqParamMatch = trimmed.match(/@RequestParam\b/)
    if (reqParamMatch) {
      const nameMatch = trimmed.match(/@RequestParam\s*\([^)]*(?:value|name)\s*=\s*["']([^"']+)["']/)
      const requiredMatch = trimmed.match(/required\s*=\s*(true|false)/)
      const varNameMatch = trimmed.match(/(\w+)\s*$/)
      const type = extractParamType(trimmed)
      params.push({
        name: nameMatch?.[1] ?? varNameMatch?.[1] ?? 'param',
        location: 'query',
        type,
        required: requiredMatch ? requiredMatch[1] === 'true' : true,
      })
      continue
    }

    // @RequestBody Type varName
    if (/@RequestBody\b/.test(trimmed)) {
      const type = extractParamType(trimmed)
      const varNameMatch = trimmed.match(/(\w+)\s*$/)
      params.push({
        name: varNameMatch?.[1] ?? 'body',
        location: 'body',
        type,
        required: true,
      })
      continue
    }

    // @RequestHeader
    if (/@RequestHeader\b/.test(trimmed)) {
      const nameMatch = trimmed.match(/@RequestHeader\s*\([^)]*(?:value|name)\s*=\s*["']([^"']+)["']/)
      const varNameMatch = trimmed.match(/(\w+)\s*$/)
      const type = extractParamType(trimmed)
      params.push({
        name: nameMatch?.[1] ?? varNameMatch?.[1] ?? 'header',
        location: 'header',
        type,
        required: false,
      })
      continue
    }
  }

  return params
}

/** Extract the Java type from a param declaration, stripping annotations and trailing variable name */
function extractParamType(paramDecl: string): string | undefined {
  // Remove all annotations
  const stripped = paramDecl.replace(/@\w+(?:\s*\([^)]*\))?\s*/g, '').trim()
  // Pattern: Type varName → extract Type (may include generics)
  const m = stripped.match(/^([\w<>.,\s\[\]]+?)\s+\w+\s*$/)
  if (m) return m[1].trim()
  return undefined
}

/** Split a parameter string on commas, respecting angle-bracket generic nesting */
function splitOnCommas(s: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''

  for (const ch of s) {
    if (ch === '<' || ch === '(' || ch === '[') depth++
    else if (ch === '>' || ch === ')' || ch === ']') depth--
    else if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim()) parts.push(current)
  return parts
}

/** Join a base path and a sub-path, normalizing double slashes */
function joinPaths(base: string, sub: string): string {
  if (!base && !sub) return '/'
  if (!sub) return base || '/'
  if (!base) return sub.startsWith('/') ? sub : '/' + sub
  const b = base.endsWith('/') ? base.slice(0, -1) : base
  const s = sub.startsWith('/') ? sub : '/' + sub
  return b + s
}

/**
 * Collapse newlines inside annotation parentheses to spaces so that multi-line
 * annotations fit on a single line and are easier to regex-match.
 */
function collapseAnnotationParens(content: string): string {
  let result = ''
  let depth = 0
  let inAnnot = false

  for (let i = 0; i < content.length; i++) {
    const ch = content[i]
    if (ch === '@') inAnnot = true
    if (inAnnot && ch === '(') depth++
    if (inAnnot && ch === ')') {
      depth--
      if (depth === 0) inAnnot = false
    }
    if (inAnnot && depth > 0 && (ch === '\n' || ch === '\r')) {
      result += ' '
    } else {
      result += ch
    }
  }
  return result
}
