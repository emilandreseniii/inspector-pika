import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter, RpcStreaming } from '../base'

export class GrpcProtoExtractor extends BaseApiExtractor {
  readonly extractorId = 'cross-language.grpc_proto'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const protoFiles = await this.glob('**/*.proto')

    for (const file of protoFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseProtoFile(content, file)
        surfaces.push(...parsed)
      } catch (err) {
        warnings.push(`Failed to parse ${file}: ${(err as Error).message}`)
      }
    }

    const endpointsFound = surfaces.reduce((sum, s) => sum + s.endpoints.length, 0)

    return {
      surfaces,
      warnings,
      stats: {
        filesScanned: protoFiles.length,
        surfacesFound: surfaces.length,
        endpointsFound,
        extractionTimeMs: Date.now() - start,
      },
    }
  }
}

// ---- Proto file parser ----

function parseProtoFile(content: string, file: string): RawApiSurface[] {
  const surfaces: RawApiSurface[] = []

  // Normalize line endings
  const text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  // Extract package declaration
  const pkgMatch = text.match(/^\s*package\s+([\w.]+)\s*;/m)
  const packageName = pkgMatch?.[1]

  // Extract all service blocks
  const serviceRegex = /\bservice\s+(\w+)\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g
  let serviceMatch: RegExpExecArray | null

  while ((serviceMatch = serviceRegex.exec(text)) !== null) {
    const serviceName = serviceMatch[1]
    const serviceBody = serviceMatch[2]
    const serviceStartLine = countLines(text, serviceMatch.index)

    const endpoints = parseServiceBody(serviceBody, file, serviceStartLine)

    if (endpoints.length > 0) {
      surfaces.push({
        name: serviceName,
        apiStyle: 'rpc',
        protocol: 'grpc',
        packageOrModule: packageName,
        endpoints,
        sourceFile: file,
        sourceLine: serviceStartLine,
      })
    }
  }

  return surfaces
}

// ---- Parse rpc methods from inside a service block ----

function parseServiceBody(body: string, file: string, serviceStartLine: number): RawEndpoint[] {
  const endpoints: RawEndpoint[] = []

  // rpc MethodName (RequestType) returns (ResponseType) ;
  // rpc MethodName (stream RequestType) returns (stream ResponseType) ;
  const rpcRegex = /\brpc\s+(\w+)\s*\(\s*(stream\s+)?(\w+)\s*\)\s*returns\s*\(\s*(stream\s+)?(\w+)\s*\)/g
  let m: RegExpExecArray | null

  while ((m = rpcRegex.exec(body)) !== null) {
    const methodName = m[1]
    const clientStream = !!m[2]
    const requestType = m[3]
    const serverStream = !!m[4]
    const responseType = m[5]

    let rpcStreaming: RpcStreaming = 'none'
    if (clientStream && serverStream) rpcStreaming = 'bidirectional'
    else if (clientStream) rpcStreaming = 'client'
    else if (serverStream) rpcStreaming = 'server'

    // Extract comments above the rpc declaration as summary
    const summary = extractLeadingComment(body, m.index)

    // Build parameter list from request type name (the actual message fields would
    // require deeper parsing — we record the message type as a single body param)
    const parameters: RawApiParameter[] = [
      { name: 'request', location: 'body', type: requestType, required: true },
    ]

    endpoints.push({
      rpcMethodName: methodName,
      requestType,
      responseType,
      rpcStreaming,
      summary,
      parameters,
      tags: [],
      sourceFile: file,
      sourceLine: serviceStartLine + countLines(body, m.index),
    })
  }

  return endpoints
}

// ---- Helpers ----

/** Count newlines before offset to get a 1-based line number */
function countLines(text: string, offset: number): number {
  let count = 1
  for (let i = 0; i < offset; i++) {
    if (text[i] === '\n') count++
  }
  return count
}

/** Extract a // or /* comment immediately preceding an rpc declaration */
function extractLeadingComment(body: string, rpcOffset: number): string | undefined {
  const before = body.slice(0, rpcOffset).trimEnd()
  // Single-line comment on the immediately preceding line
  const lineMatch = before.match(/\/\/\s*(.+)\s*$/)
  if (lineMatch) return lineMatch[1].trim()
  // Block comment ending just before this declaration
  const blockMatch = before.match(/\/\*\*?\s*([\s\S]*?)\s*\*\/\s*$/)
  if (blockMatch) return blockMatch[1].replace(/\s*\*\s*/g, ' ').trim()
  return undefined
}
