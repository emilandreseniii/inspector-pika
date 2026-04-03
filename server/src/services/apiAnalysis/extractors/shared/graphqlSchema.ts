import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter } from '../base'

export class GraphQLSchemaExtractor extends BaseApiExtractor {
  readonly extractorId = 'cross-language.graphql_schema'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const files = await this.glob('**/*.{graphql,gql}')

    let filesScanned = 0

    for (const file of files) {
      try {
        const content = await this.readFile(file)
        if (!content) continue
        filesScanned++
        const parsed = parseGraphQLSchema(content, file)
        if (parsed) surfaces.push(parsed)
      } catch (err) {
        warnings.push(`Failed to parse ${file}: ${(err as Error).message}`)
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

// ---- Parse GraphQL schema file ----

function parseGraphQLSchema(content: string, file: string): RawApiSurface | null {
  const stripped = stripComments(content)
  const endpoints: RawEndpoint[] = []

  // Extract type Query { ... }, type Mutation { ... }, type Subscription { ... }
  for (const operationType of ['Query', 'Mutation', 'Subscription'] as const) {
    const ops = extractOperations(stripped, operationType, file)
    endpoints.push(...ops)
  }

  if (endpoints.length === 0) return null

  // Try to extract schema name from file or from schema { query: ... }
  const surfaceName = file.split('/').pop()?.replace(/\.(graphql|gql)$/, '') ?? 'GraphQL Schema'

  return {
    name: surfaceName,
    apiStyle: 'graphql',
    endpoints,
    sourceFile: file,
    sourceLine: 1,
  }
}

// ---- Extract operations from a root type ----

function extractOperations(
  content: string,
  operationType: 'Query' | 'Mutation' | 'Subscription',
  file: string,
): RawEndpoint[] {
  const endpoints: RawEndpoint[] = []

  // Find: type Query { or type Query implements ... {
  const typePattern = new RegExp(`^type\\s+${operationType}(?:\\s+implements[^{]*)?\\s*\\{`, 'm')
  const typeMatch = content.match(typePattern)
  if (!typeMatch) return endpoints

  const bodyStart = typeMatch.index! + typeMatch[0].length
  const body = extractToMatchingBrace(content, typeMatch.index! + typeMatch[0].length - 1)
  if (!body) return endpoints

  // Parse each field in the type body
  // fieldName(args): ReturnType or fieldName: ReturnType
  const lines = body.split('\n')
  const lineOffset = content.slice(0, bodyStart).split('\n').length

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.startsWith('#')) continue

    // fieldName(arg1: Type1, arg2: Type2): ReturnType
    const fieldMatch = line.match(/^(\w+)\s*(?:\([^)]*\))?\s*:\s*([\w!\[\]]+)/)
    if (!fieldMatch) continue

    const operationName = fieldMatch[1]
    const returnType = fieldMatch[2]

    // Extract arguments from the field signature
    const argsMatch = line.match(/^(\w+)\s*\(([^)]*)\)/)
    const parameters: RawApiParameter[] = []
    if (argsMatch) {
      parameters.push(...parseGraphQLArgs(argsMatch[2]))
    }

    endpoints.push({
      httpMethod: 'POST',  // GraphQL always uses POST
      path: `/${operationType.toLowerCase()}/${operationName}`,
      operationType: operationType === 'Query' ? 'query' : operationType === 'Mutation' ? 'mutation' : 'subscription',
      operationName,
      parameters,
      tags: [operationType],
      sourceFile: file,
      sourceLine: lineOffset + i + 1,
      metadata: { returnType },
    })
  }

  return endpoints
}

// ---- Parse GraphQL argument list ----

function parseGraphQLArgs(argsStr: string): RawApiParameter[] {
  const params: RawApiParameter[] = []
  if (!argsStr.trim()) return params

  // Split on commas not inside brackets
  const args = splitOnCommas(argsStr)
  for (const arg of args) {
    const trimmed = arg.trim()
    // argName: Type! or argName: Type = default
    const m = trimmed.match(/^(\w+)\s*:\s*([\w!\[\]]+)/)
    if (!m) continue

    const name = m[1]
    const typeStr = m[2]
    const required = typeStr.endsWith('!') || typeStr.includes('!')
    const type = typeStr.replace(/!/g, '').replace(/[\[\]]/g, '')

    params.push({ name, location: 'body', type, required })
  }

  return params
}

// ---- Helpers ----

function extractToMatchingBrace(s: string, start: number): string | null {
  let depth = 0
  for (let i = start; i < s.length; i++) {
    if (s[i] === '{') depth++
    else if (s[i] === '}') {
      depth--
      if (depth === 0) return s.slice(start + 1, i)
    }
  }
  return null
}

function splitOnCommas(s: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    else if (ch === ',' && depth === 0) { parts.push(current); current = ''; continue }
    current += ch
  }
  if (current.trim()) parts.push(current)
  return parts
}

function stripComments(code: string): string {
  // Remove GraphQL # comments
  return code.replace(/#.*$/gm, '')
}
