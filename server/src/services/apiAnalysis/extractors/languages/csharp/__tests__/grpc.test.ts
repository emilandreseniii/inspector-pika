import { describe, it, expect, vi } from 'vitest'
import { CsharpGrpcExtractor } from '../grpc'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): CsharpGrpcExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'C#', approach: 'grpc', apiStyle: 'rpc', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new CsharpGrpcExtractor(ctx)
  vi.spyOn(extractor as any, 'grep').mockImplementation(async (_glob: string, pattern: RegExp) => {
    const hits: Array<{ file: string; line: number; text: string }> = []
    for (const [file, content] of Object.entries(files)) {
      const lines = content.split('\n')
      lines.forEach((text, i) => {
        if (pattern.test(text)) hits.push({ file, line: i + 1, text })
      })
    }
    return hits
  })
  vi.spyOn(extractor as any, 'readFile').mockImplementation(async (path: string) => {
    if (files[path] === undefined) throw new Error(`File not found: ${path}`)
    return files[path]
  })
  return extractor
}

describe('CsharpGrpcExtractor', () => {
  it('extracts gRPC service methods from *Base subclasses', async () => {
    const extractor = makeExtractor({
      'Services/GreeterService.cs': `using Grpc.Core;
using GrpcGreeter;

namespace GrpcGreeter.Services;

public class GreeterService : Greeter.GreeterBase
{
    public override async Task<HelloReply> SayHello(HelloRequest request, ServerCallContext context)
    {
        return new HelloReply { Message = "Hello " + request.Name };
    }

    public override async Task SayHellos(
        HelloRequest request,
        IServerStreamWriter<HelloReply> responseStream,
        ServerCallContext context)
    {
        for (int i = 0; i < 5; i++)
        {
            await responseStream.WriteAsync(new HelloReply { Message = $"Hello {i}" });
        }
    }
}
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)

    const surface = result.surfaces[0]
    expect(surface.name).toBe('GreeterService')
    expect(surface.apiStyle).toBe('rpc')
    expect(surface.endpoints).toHaveLength(2)

    const sayHello = surface.endpoints.find((e) => e.operationName === 'SayHello')
    expect(sayHello).toBeDefined()
    expect(sayHello?.path).toBe('/GreeterService/SayHello')

    const sayHellos = surface.endpoints.find((e) => e.operationName === 'SayHellos')
    expect(sayHellos).toBeDefined()
  })

  it('returns empty when no gRPC usage', async () => {
    const extractor = makeExtractor({
      'Services/Foo.cs': `namespace App;\npublic class Foo {}\n`,
    })
    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(0)
  })
})
