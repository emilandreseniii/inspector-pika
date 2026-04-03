import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint, RawApiParameter } from '../../base'

export class GrpcJavaStubExtractor extends BaseApiExtractor {
  readonly extractorId = 'java.grpc_java_stub'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    // Find files that extend a generated *Grpc.*ImplBase class (Java: extends, Kotlin: :)
    const hits = await this.grep('**/*.{java,kt}', /\w+Grpc\.\w+ImplBase/, 2000)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseGrpcStubFile(content, file)
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
        filesScanned: uniqueFiles.length,
        surfacesFound: surfaces.length,
        endpointsFound,
        extractionTimeMs: Date.now() - start,
      },
    }
  }
}

// ---- File parser — may yield multiple surfaces if file has nested impl classes ----

function parseGrpcStubFile(content: string, file: string): RawApiSurface[] {
  const collapsed = collapseAnnotationParens(content)
  const lines = collapsed.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')

  const pkgMatch = content.match(/^package\s+([\w.]+)\s*;/m)
  const packageName = pkgMatch?.[1]

  const surfaces: RawApiSurface[] = []

  // Find all class declarations that extend *Grpc.*ImplBase
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    const implBaseMatch = trimmed.match(
      /(?:public\s+|private\s+|protected\s+|static\s+|final\s+|abstract\s+)*class\s+(\w+)\s+(?:extends\s+|:\s*)(\w+Grpc)\.(\w+ImplBase)\b/,
    )
    if (!implBaseMatch) continue

    const implClassName = implBaseMatch[1]
    const grpcOuterClass = implBaseMatch[2]  // e.g. "GreeterGrpc"
    const implBaseName = implBaseMatch[3]    // e.g. "GreeterImplBase"

    // Derive service name: strip "ImplBase" suffix from the inner class name
    const serviceName = implBaseName.replace(/ImplBase$/, '')
      || grpcOuterClass.replace(/Grpc$/, '')

    const endpoints = extractRpcMethods(lines, i, file)
    if (endpoints.length === 0) continue

    surfaces.push({
      name: implClassName,
      apiStyle: 'rpc',
      protocol: 'grpc',
      packageOrModule: packageName,
      endpoints,
      sourceFile: file,
      sourceLine: i + 1,
      // Store the proto service name as basePath so the UI can show it
      basePath: serviceName !== implClassName ? serviceName : undefined,
    })
  }

  return surfaces
}

// ---- Walk the class body collecting overridden RPC methods ----

function extractRpcMethods(lines: string[], classStartLine: number, file: string): RawEndpoint[] {
  const endpoints: RawEndpoint[] = []
  let braceDepth = 0
  let insideClass = false

  for (let i = classStartLine; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    // Record depth before counting this line's braces so we know the
    // depth at which this line "lives" (needed to detect class-member lines).
    const depthBefore = braceDepth
    for (const ch of trimmed) {
      if (ch === '{') braceDepth++
      else if (ch === '}') braceDepth--
    }

    if (!insideClass) {
      // The opening brace of the class puts us at depth 1
      if (braceDepth >= 1) insideClass = true
      continue
    }

    // End of class body
    if (braceDepth <= 0) break

    // Only process direct members of this class (lines that START at depth 1).
    // Using depthBefore avoids skipping method signatures whose { appears on
    // the same line (which would push braceDepth to 2 before the check).
    if (depthBefore > 1) continue

    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue

    // Skip non-override annotations; we want @Override methods
    if (trimmed.startsWith('@') && trimmed !== '@Override') continue

    // Look for gRPC method signatures:
    //   void methodName(ReqType request, StreamObserver<RespType> responseObserver)
    //   StreamObserver<ReqType> methodName(StreamObserver<RespType> responseObserver)
    let sigLine = trimmed
    if (sigLine.includes('(') && parenBalance(sigLine) > 0) {
      while (i + 1 < lines.length && parenBalance(sigLine) > 0) {
        i++
        sigLine += ' ' + lines[i].trim()
      }
    }

    const rpcMethod = parseGrpcMethodSignature(sigLine)
    if (!rpcMethod) continue

    const params: RawApiParameter[] = []
    if (rpcMethod.requestType) {
      params.push({ name: 'request', location: 'body', type: rpcMethod.requestType, required: true })
    }

    endpoints.push({
      rpcMethodName: rpcMethod.methodName,
      requestType: rpcMethod.requestType ?? undefined,
      responseType: rpcMethod.responseType ?? undefined,
      rpcStreaming: rpcMethod.streaming,
      parameters: params,
      tags: [],
      sourceFile: file,
      sourceLine: i + 1,
    })
  }

  return endpoints
}

// ---- Parse a gRPC stub method signature ----

interface GrpcMethodSig {
  methodName: string
  requestType: string | null
  responseType: string | null
  streaming: 'none' | 'client' | 'server' | 'bidirectional'
}

function parseGrpcMethodSignature(line: string): GrpcMethodSig | null {
  if (!line.includes('(') || !line.includes('StreamObserver')) return null
  if (/^\s*(?:if|for|while|switch|catch|return|throw|new)\b/.test(line)) return null

  const parenStart = line.indexOf('(')
  const beforeParens = line.slice(0, parenStart).trim()
  const paramsStr = extractToMatchingParen(line, parenStart)
  if (paramsStr === null) return null

  // Extract method name and return type
  const parts = beforeParens.split(/\s+/).filter(Boolean)
  if (parts.length < 2) return null
  const methodName = parts[parts.length - 1]
  if (!methodName || !/^[a-z][a-zA-Z0-9_]*$/.test(methodName)) return null

  const MODIFIERS = new Set(['public', 'protected', 'private', 'static', 'final', 'synchronized', 'native'])
  const returnType = parts.slice(0, -1).filter((p) => !MODIFIERS.has(p)).join(' ')

  // Determine streaming type from return type and params
  const returnsStreamObserver = /^StreamObserver\b/.test(returnType)

  // Parse params: should contain at least one StreamObserver<T>
  const paramParts = splitOnCommas(paramsStr)

  // Find the StreamObserver<ResponseType> param
  let responseType: string | null = null
  let requestType: string | null = null

  for (const param of paramParts) {
    const t = param.trim()
    const soMatch = t.match(/StreamObserver\s*<\s*([\w<>.,\s]+?)\s*>/)
    if (soMatch) {
      responseType = soMatch[1].trim()
      continue
    }
    // Non-StreamObserver param is the request
    const reqMatch = t.match(/^(?:[\w<>.,\s]+\s+)?(\w[\w<>.,\s]*\w|\w)\s+\w+\s*$/)
    if (reqMatch) {
      const typeAndName = t.trim().split(/\s+/)
      if (typeAndName.length >= 2) {
        requestType = typeAndName.slice(0, -1).join(' ')
      }
    }
  }

  if (!responseType) return null

  // Determine streaming:
  // - returnsStreamObserver + has requestType param → bidi (or client, but bidi is common)
  // - returnsStreamObserver + no requestType param → client streaming
  // - void return + requestType param → unary (or server streaming; can't distinguish without proto)
  let streaming: GrpcMethodSig['streaming']
  if (returnsStreamObserver) {
    streaming = requestType ? 'bidirectional' : 'client'
  } else {
    streaming = 'none'  // unary (or server streaming — indistinguishable from stub alone)
  }

  // Extract return type for client/bidi streaming (the StreamObserver generic)
  if (returnsStreamObserver) {
    const retSoMatch = returnType.match(/StreamObserver\s*<\s*([\w<>.,\s]+?)\s*>/)
    if (retSoMatch) requestType = retSoMatch[1].trim()
  }

  return { methodName, requestType, responseType, streaming }
}

// ---- Shared helpers ----

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
