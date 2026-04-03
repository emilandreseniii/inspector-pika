import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, GraphQLOperationType } from '../../base'

export class SpringGraphqlExtractor extends BaseApiExtractor {
  readonly extractorId = 'java.spring_graphql'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep(
      '**/*.{java,kt}',
      /@(?:QueryMapping|MutationMapping|SubscriptionMapping|SchemaMapping|BatchMapping)\b/,
      2000,
    )
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseSpringGraphqlFile(content, file)
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

// ---- File parser ----

function parseSpringGraphqlFile(content: string, file: string): RawApiSurface | null {
  if (!/@(?:QueryMapping|MutationMapping|SubscriptionMapping|SchemaMapping|BatchMapping)\b/.test(content)) return null

  const collapsed = collapseAnnotationParens(content)
  const lines = collapsed.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')

  const pkgMatch = content.match(/^package\s+([\w.]+)\s*;/m)
  const packageName = pkgMatch?.[1]

  const classMatch = collapsed.match(/(?:public\s+|abstract\s+|final\s+)*(?:class|data\s+class)\s+(\w+)/)
  if (!classMatch) return null
  const className = classMatch[1]

  const classLineNo = lines.findIndex((l) => /(?:class|data\s+class)\s+\w+/.test(l)) + 1

  const endpoints = extractEndpoints(lines, className, file)
  if (endpoints.length === 0) return null

  return {
    name: className,
    apiStyle: 'graphql',
    packageOrModule: packageName,
    endpoints,
    sourceFile: file,
    sourceLine: classLineNo,
  }
}

// ---- Pending mapping annotation ----

interface PendingMapping {
  operationType: GraphQLOperationType | null   // null = field resolver on non-root type
  operationName: string | null                 // null = derive from method name
  typeName: string | null                      // for @SchemaMapping
  isBatch: boolean
}

// ---- Walk lines collecting GraphQL mapping annotations then method signatures ----

function extractEndpoints(lines: string[], className: string, file: string): RawEndpoint[] {
  const endpoints: RawEndpoint[] = []
  let pending: PendingMapping | null = null
  let insideClass = false
  let braceDepth = 0

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    if (!insideClass) {
      if (/(?:public\s+|abstract\s+|final\s+)*(?:class|data\s+class)\s+\w+/.test(trimmed)) insideClass = true
      continue
    }

    for (const ch of trimmed) {
      if (ch === '{') braceDepth++
      else if (ch === '}') braceDepth--
    }
    if (braceDepth > 1) { pending = null; continue }

    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue

    // Detect GraphQL mapping annotations
    const mapping = extractMappingAnnotation(trimmed)
    if (mapping !== undefined) {
      pending = mapping
      // Handle same-line case: "@QueryMapping public String foo(...)"
      const rest = trimmed.replace(/^@\w+(?:\s*\([^)]*\))?\s*/, '').trim()
      if (rest && !rest.startsWith('@')) {
        let sigLine = rest
        if (sigLine.includes('(') && parenBalance(sigLine) > 0) {
          while (i + 1 < lines.length && parenBalance(sigLine) > 0) {
            i++
            sigLine += ' ' + lines[i].trim()
          }
        }
        const methodSig = parseMethodSignature(sigLine)
        if (methodSig) {
          const operationType = pending.operationType
          const operationName = pending.operationName ?? methodSig.name
          endpoints.push({
            operationType: operationType ?? undefined,
            operationName,
            parameters: parseGraphqlParameters(methodSig.paramsStr),
            returnType: methodSig.returnType || undefined,
            summary: pending.typeName && !operationType
              ? `Field resolver for ${pending.typeName}.${operationName}`
              : undefined,
            tags: [className],
            sourceFile: file,
            sourceLine: i + 1,
          })
          pending = null
        }
      }
      continue
    }

    // Other annotations — keep accumulating
    if (trimmed.startsWith('@')) continue

    // Method signature
    if (pending !== null) {
      let sigLine = trimmed
      if (sigLine.includes('(') && parenBalance(sigLine) > 0) {
        while (i + 1 < lines.length && parenBalance(sigLine) > 0) {
          i++
          sigLine += ' ' + lines[i].trim()
        }
      }

      const methodSig = parseMethodSignature(sigLine)
      if (methodSig) {
        const operationType = pending.operationType
        const operationName = pending.operationName ?? methodSig.name
        const params = parseGraphqlParameters(methodSig.paramsStr)

        endpoints.push({
          operationType: operationType ?? undefined,
          operationName,
          parameters: params,
          returnType: methodSig.returnType || undefined,
          summary: pending.typeName && !operationType
            ? `Field resolver for ${pending.typeName}.${operationName}`
            : undefined,
          tags: [className],
          sourceFile: file,
          sourceLine: i + 1,
        })
      }
      pending = null
    }
  }

  return endpoints
}

// ---- Parse a GraphQL mapping annotation line ----
// Returns undefined if the line is not a GraphQL mapping annotation.

function extractMappingAnnotation(line: string): PendingMapping | undefined {
  // @QueryMapping, @QueryMapping("name"), @QueryMapping(value="name")
  if (/^@QueryMapping\b/.test(line)) {
    return { operationType: 'Query', operationName: extractSingleNameArg(line), typeName: null, isBatch: false }
  }
  if (/^@MutationMapping\b/.test(line)) {
    return { operationType: 'Mutation', operationName: extractSingleNameArg(line), typeName: null, isBatch: false }
  }
  if (/^@SubscriptionMapping\b/.test(line)) {
    return { operationType: 'Subscription', operationName: extractSingleNameArg(line), typeName: null, isBatch: false }
  }
  if (/^@BatchMapping\b/.test(line)) {
    // BatchMapping is always a field resolver — typeName + field name
    const typeName = extractAnnotationAttr(line, 'typeName') ?? extractAnnotationAttr(line, 'type')
    const field = extractSingleNameArg(line) ?? extractAnnotationAttr(line, 'field')
    const operationType = resolveRootType(typeName)
    return { operationType, operationName: field, typeName: typeName ?? null, isBatch: true }
  }
  if (/^@SchemaMapping\b/.test(line)) {
    const typeName = extractAnnotationAttr(line, 'typeName') ?? extractAnnotationAttr(line, 'type')
    const field = extractAnnotationAttr(line, 'field') ?? extractSingleNameArg(line)
    const operationType = resolveRootType(typeName)
    return { operationType, operationName: field, typeName: typeName ?? null, isBatch: false }
  }
  return undefined
}

/** Returns Query/Mutation/Subscription if typeName matches a root GraphQL type, else null */
function resolveRootType(typeName: string | null | undefined): GraphQLOperationType | null {
  if (!typeName) return null
  if (typeName === 'Query') return 'Query'
  if (typeName === 'Mutation') return 'Mutation'
  if (typeName === 'Subscription') return 'Subscription'
  return null
}

/** Extract plain string arg: @Foo("value") or @Foo(value="value") or @Foo(name="value") */
function extractSingleNameArg(line: string): string | null {
  const plain = line.match(/@\w+\s*\(\s*["']([^"']+)["']/)
  if (plain) return plain[1]
  const named = line.match(/@\w+\s*\([^)]*(?:value|name)\s*=\s*["']([^"']+)["']/)
  if (named) return named[1]
  return null
}

/** Extract a named attribute from an annotation: typeName="Foo" → "Foo" */
function extractAnnotationAttr(line: string, attr: string): string | null {
  const re = new RegExp(`\\b${attr}\\s*=\\s*["']([^"']+)["']`)
  const m = line.match(re)
  return m ? m[1] : null
}

// ---- Parse method parameters for @Argument annotations ----

function parseGraphqlParameters(paramsStr: string): RawApiParameter[] {
  if (!paramsStr.trim()) return []
  const params: RawApiParameter[] = []
  const parts = splitOnCommas(paramsStr)

  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue

    // @Argument("name") or @Argument(name="name") or @Argument(value="name")
    const explicitName = trimmed.match(/@Argument\s*\(\s*(?:(?:name|value)\s*=\s*)?["']([^"']+)["']\s*\)/)
    if (explicitName) {
      const type = extractParamType(trimmed)
      params.push({ name: explicitName[1], location: 'field', type, required: true })
      continue
    }

    // @Argument with no name arg — use variable name
    if (/@Argument\b/.test(trimmed)) {
      const varName = trimmed.match(/(\w+)\s*$/)
      const type = extractParamType(trimmed)
      if (varName) params.push({ name: varName[1], location: 'field', type, required: true })
      continue
    }

    // Skip Spring/GraphQL context injections
    const injections = /\b(?:DataFetchingEnvironment|GraphQLContext|Principal|Authentication|HttpServletRequest|WebRequest|Locale|TimeZone|ZoneId)\b/
    if (injections.test(trimmed)) continue

    // Skip @ContextValue, @LocalContextValue injections
    if (/@ContextValue\b|@LocalContextValue\b/.test(trimmed)) continue
  }

  return params
}

// ---- Shared helpers (duplicated to keep extractors independent) ----

interface MethodSignature { returnType: string; name: string; paramsStr: string }

function parseMethodSignature(line: string): MethodSignature | null {
  if (!line.includes('(')) return null
  if (line.startsWith('@') || line.startsWith('//') || /^\s*(?:if|for|while|switch|catch|return|throw|new)\b/.test(line)) return null

  const parenStart = line.indexOf('(')
  const beforeParens = line.slice(0, parenStart).trim()
  const paramsStr = extractToMatchingParen(line, parenStart)
  if (paramsStr === null) return null

  // Kotlin: fun methodName(...)
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
