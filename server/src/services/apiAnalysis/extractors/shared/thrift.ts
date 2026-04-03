import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter } from '../base'

export class ThriftExtractor extends BaseApiExtractor {
  readonly extractorId = 'cross-language.thrift'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const thriftFiles = await this.glob('**/*.thrift')

    for (const file of thriftFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseThriftFile(content, file, this.extractorId)
        surfaces.push(...parsed)
      } catch (err) {
        warnings.push(`Failed to parse ${file}: ${(err as Error).message}`)
      }
    }

    const endpointsFound = surfaces.reduce((sum, s) => sum + s.endpoints.length, 0)
    return {
      surfaces,
      warnings,
      stats: { filesScanned: thriftFiles.length, surfacesFound: surfaces.length, endpointsFound, extractionTimeMs: Date.now() - start },
    }
  }
}

// ---- Parser ----

function parseThriftFile(content: string, file: string, extractorId: string): RawApiSurface[] {
  const surfaces: RawApiSurface[] = []
  const stripped = stripComments(content)

  // Extract namespace (e.g., namespace py myapp)
  const namespaceMatch = stripped.match(/^\s*namespace\s+\w+\s+([\w.]+)/m)
  const namespace = namespaceMatch?.[1]

  // Find all service blocks: service UserService { ... }
  const serviceRe = /\bservice\s+(\w+)(?:\s+extends\s+\w+)?\s*\{/g
  let m: RegExpExecArray | null

  while ((m = serviceRe.exec(stripped)) !== null) {
    const serviceName = m[1]
    const bodyStart = m.index + m[0].length
    const body = extractBlock(stripped, bodyStart - 1)
    if (body === null) continue

    const startLine = countLines(content, m.index)
    const endpoints = parseServiceBody(body, file, startLine)

    surfaces.push({
      name: serviceName,
      apiStyle: 'rpc',
      protocol: 'thrift',
      packageOrModule: namespace,
      endpoints,
      sourceFile: file,
      sourceLine: startLine,
    })
  }

  return surfaces
}

function parseServiceBody(body: string, file: string, serviceStartLine: number): RawEndpoint[] {
  const endpoints: RawEndpoint[] = []
  const lines = body.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue
    if (trimmed.startsWith('{') || trimmed.startsWith('}')) continue

    // returnType methodName( ... )
    // void|i32|string|bool|User|list<X>|map<K,V> methodName(args)
    const methodMatch = trimmed.match(/^(void|[\w<>, ]+?)\s+(\w+)\s*\(([^)]*)\)/)
    if (!methodMatch) continue

    const returnType = methodMatch[1].trim()
    const methodName = methodMatch[2]
    const argsStr = methodMatch[3]

    // Must start with a known type or PascalCase identifier
    if (!/^(?:void|bool|byte|i8|i16|i32|i64|double|string|binary|list|map|set|[A-Z]\w*)/.test(returnType)) continue

    const parameters = parseArgs(argsStr)

    endpoints.push({
      rpcMethodName: methodName,
      requestType: parameters.map((p) => p.type ?? p.name).join(', ') || 'void',
      responseType: returnType,
      rpcStreaming: 'none',
      parameters,
      tags: [],
      sourceFile: file,
      sourceLine: serviceStartLine + i,
    })
  }

  return endpoints
}

function parseArgs(argsStr: string): RawApiParameter[] {
  const params: RawApiParameter[] = []
  if (!argsStr.trim()) return params

  // 1: string name, 2: i32 age
  for (const part of argsStr.split(',')) {
    const trimmed = part.trim()
    const argMatch = trimmed.match(/\d+\s*:\s*(?:required\s+|optional\s+)?([\w<>, ]+?)\s+(\w+)\s*$/)
    if (argMatch) {
      params.push({ name: argMatch[2], type: argMatch[1].trim(), location: 'body', required: !/optional/.test(trimmed) })
    }
  }
  return params
}

function extractBlock(text: string, openIdx: number): string | null {
  let depth = 0
  let start = -1
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === '{') { depth++; if (start === -1) start = i }
    else if (text[i] === '}') { depth--; if (depth === 0) return text.slice(start + 1, i) }
  }
  return null
}

function countLines(text: string, offset: number): number {
  let count = 1
  for (let i = 0; i < offset; i++) { if (text[i] === '\n') count++ }
  return count
}

function stripComments(code: string): string {
  return code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '#')
}
