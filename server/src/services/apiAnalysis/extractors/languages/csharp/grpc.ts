import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint } from '../../base'

/**
 * Extracts gRPC service implementations from Grpc.AspNetCore (C#).
 *
 * Key pattern — classes that inherit generated *Base stubs:
 *   public class GreeterService : Greeter.GreeterBase
 *   {
 *     public override async Task<HelloReply> SayHello(HelloRequest request, ServerCallContext context) { }
 *     public override async Task SayHellos(HelloRequest request, IServerStreamWriter<...> writer, ...) { }
 *   }
 *
 * Each override method becomes an RPC endpoint.
 * Schema detail is deferred to the proto extractor.
 */
export class CsharpGrpcExtractor extends BaseApiExtractor {
  readonly extractorId = 'csharp.grpc'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    // Find files with classes inheriting generated *Base stubs
    const hits = await this.grep(
      '**/*.cs',
      /:\s*\w+\.[\w]+Base\b|ServerCallContext/,
      2000,
    )
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        if (!isGrpcFile(content)) continue
        const parsed = parseGrpcFile(content, file)
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

function isGrpcFile(content: string): boolean {
  return /Grpc\.AspNetCore|Grpc\.Core|using\s+Grpc\b/.test(content)
    || /ServerCallContext/.test(content)
}

function parseGrpcFile(content: string, file: string): RawApiSurface | null {
  const stripped = stripComments(content)
  const lines = stripped.split('\n')
  const endpoints: RawEndpoint[] = []

  let inGrpcClass = false
  let serviceName = 'GrpcService'

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    // class FooService : SomeProto.SomeProtoBase  (or Greeter.GreeterBase etc.)
    const classMatch = trimmed.match(/(?:public\s+)?(?:partial\s+)?class\s+(\w+)\s*:\s*(\w+\.[\w]+Base)\b/)
    if (classMatch) {
      inGrpcClass = true
      serviceName = classMatch[1]
      continue
    }

    if (!inGrpcClass) continue

    // Close class at top-level brace (simple heuristic: } alone on a line at indent level 0)
    if (/^}\s*$/.test(trimmed) && !/^\s{4,}/.test(lines[i])) {
      inGrpcClass = false
      continue
    }

    // public override Task<Reply> MethodName(Request req, ServerCallContext ctx)
    // public override Task MethodName(Request req, IServerStreamWriter<Reply> writer, ServerCallContext ctx)
    const methodMatch = trimmed.match(
      /public\s+override\s+(?:async\s+)?Task(?:<[^>]+>)?\s+(\w+)\s*\(/,
    )
    if (methodMatch) {
      const methodName = methodMatch[1]
      // Skip compiler-generated or internal overrides
      if (methodName === 'BindService' || methodName.startsWith('__')) continue

      endpoints.push({
        httpMethod: 'POST',
        path: `/${serviceName}/${methodName}`,
        operationName: methodName,
        parameters: [],
        tags: ['grpc'],
        sourceFile: file,
        sourceLine: i + 1,
      })
    }
  }

  if (endpoints.length === 0) return null

  return {
    name: serviceName,
    apiStyle: 'rpc',
    endpoints,
    sourceFile: file,
    sourceLine: 1,
  }
}

function stripComments(code: string): string {
  return code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}
