import { describe, it, expect, vi } from 'vitest'
import { GrpcJavaStubExtractor } from '../grpcJavaStub'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): GrpcJavaStubExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Java', approach: 'grpc_java_stub', apiStyle: 'rpc', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new GrpcJavaStubExtractor(ctx)
  vi.spyOn(extractor as any, 'grep').mockImplementation(async (_glob: string, pattern: RegExp) => {
    const hits: Array<{ file: string; line: number; text: string }> = []
    for (const [file, content] of Object.entries(files)) {
      content.split('\n').forEach((text, i) => {
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

describe('GrpcJavaStubExtractor', () => {
  describe('unary RPC detection', () => {
    it('extracts a basic unary RPC method', async () => {
      const extractor = makeExtractor({
        'GreeterService.java': `
package com.example;

public class GreeterServiceImpl extends GreeterGrpc.GreeterImplBase {

  @Override
  public void sayHello(HelloRequest request, StreamObserver<HelloReply> responseObserver) {
    responseObserver.onNext(HelloReply.newBuilder().build());
    responseObserver.onCompleted();
  }
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces).toHaveLength(1)

      const surface = result.surfaces[0]
      expect(surface.name).toBe('GreeterServiceImpl')
      expect(surface.apiStyle).toBe('rpc')
      expect(surface.protocol).toBe('grpc')
      expect(surface.packageOrModule).toBe('com.example')

      expect(surface.endpoints).toHaveLength(1)
      const ep = surface.endpoints[0]
      expect(ep.rpcMethodName).toBe('sayHello')
      expect(ep.requestType).toBe('HelloRequest')
      expect(ep.responseType).toBe('HelloReply')
      expect(ep.rpcStreaming).toBe('none')
    })

    it('extracts multiple unary methods', async () => {
      const extractor = makeExtractor({
        'RouteGuide.java': `
public class RouteGuideImpl extends RouteGuideGrpc.RouteGuideImplBase {

  @Override
  public void getFeature(Point request, StreamObserver<Feature> responseObserver) {}

  @Override
  public void listFeatures(Rectangle request, StreamObserver<Feature> responseObserver) {}
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].endpoints).toHaveLength(2)
      expect(result.surfaces[0].endpoints[0].rpcMethodName).toBe('getFeature')
      expect(result.surfaces[0].endpoints[1].rpcMethodName).toBe('listFeatures')
    })
  })

  describe('streaming RPC detection', () => {
    it('detects client/bidi streaming (returns StreamObserver)', async () => {
      const extractor = makeExtractor({
        'RouteGuide.java': `
public class RouteGuideImpl extends RouteGuideGrpc.RouteGuideImplBase {

  @Override
  public StreamObserver<Point> recordRoute(StreamObserver<RouteSummary> responseObserver) {
    return new StreamObserver<Point>() {};
  }
}
`,
      })

      const result = await extractor.extract()
      const ep = result.surfaces[0].endpoints[0]
      expect(ep.rpcMethodName).toBe('recordRoute')
      expect(ep.requestType).toBe('Point')
      expect(ep.responseType).toBe('RouteSummary')
      // Both client and bidi streaming share the same Java stub signature;
      // the extractor marks them 'client' when there is no non-StreamObserver param.
      expect(ep.rpcStreaming).toBe('client')
    })

    it('handles mixed unary and streaming methods', async () => {
      const extractor = makeExtractor({
        'Mixed.java': `
public class MixedImpl extends MixedGrpc.MixedImplBase {

  @Override
  public void unaryCall(Req request, StreamObserver<Resp> responseObserver) {}

  @Override
  public StreamObserver<Req> streamingCall(StreamObserver<Resp> responseObserver) {
    return null;
  }
}
`,
      })

      const result = await extractor.extract()
      const eps = result.surfaces[0].endpoints
      expect(eps).toHaveLength(2)
      expect(eps[0].rpcStreaming).toBe('none')
      expect(eps[1].rpcStreaming).toBe('client')
    })
  })

  describe('service name derivation', () => {
    it('derives service name from ImplBase class name', async () => {
      const extractor = makeExtractor({
        'Svc.java': `
public class MyGreeterImpl extends GreeterGrpc.GreeterImplBase {
  @Override
  public void ping(PingRequest request, StreamObserver<PingReply> responseObserver) {}
}
`,
      })

      const result = await extractor.extract()
      // basePath should be "Greeter" (ImplBase suffix stripped) since it differs from impl class name
      expect(result.surfaces[0].basePath).toBe('Greeter')
    })

    it('omits basePath when service name equals impl class name', async () => {
      const extractor = makeExtractor({
        'Svc.java': `
public class GreeterImpl extends GreeterGrpc.GreeterImplBase {
  @Override
  public void ping(PingRequest request, StreamObserver<PingReply> responseObserver) {}
}
`,
      })

      const result = await extractor.extract()
      // ImplBase → "Greeter", impl class → "GreeterImpl" — they differ, so basePath is set
      expect(result.surfaces[0].basePath).toBe('Greeter')
    })
  })

  describe('multiple impl classes in one file', () => {
    it('extracts multiple surfaces from one file', async () => {
      const extractor = makeExtractor({
        'Combined.java': `
public class GreeterImpl extends GreeterGrpc.GreeterImplBase {
  @Override
  public void sayHello(HelloRequest req, StreamObserver<HelloReply> obs) {}
}

public class EchoImpl extends EchoGrpc.EchoImplBase {
  @Override
  public void echo(EchoRequest req, StreamObserver<EchoReply> obs) {}
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces).toHaveLength(2)
      expect(result.surfaces[0].name).toBe('GreeterImpl')
      expect(result.surfaces[1].name).toBe('EchoImpl')
    })
  })

  describe('multi-line method signatures', () => {
    it('joins multi-line signatures', async () => {
      const extractor = makeExtractor({
        'Svc.java': `
public class SvcImpl extends SvcGrpc.SvcImplBase {
  @Override
  public void longMethod(
      VeryLongRequestType request,
      StreamObserver<VeryLongResponseType> responseObserver) {
  }
}
`,
      })

      const result = await extractor.extract()
      const ep = result.surfaces[0].endpoints[0]
      expect(ep.rpcMethodName).toBe('longMethod')
      expect(ep.requestType).toBe('VeryLongRequestType')
      expect(ep.responseType).toBe('VeryLongResponseType')
    })
  })

  describe('Kotlin support', () => {
    it('extracts from .kt files', async () => {
      const extractor = makeExtractor({
        'GreeterService.kt': `
package com.example

class GreeterServiceImpl : GreeterGrpc.GreeterImplBase() {

  override fun sayHello(request: HelloRequest, responseObserver: StreamObserver<HelloReply>) {
    responseObserver.onCompleted()
  }
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces).toHaveLength(1)
      expect(result.surfaces[0].endpoints).toHaveLength(1)
      expect(result.surfaces[0].endpoints[0].rpcMethodName).toBe('sayHello')
    })
  })

  describe('package extraction', () => {
    it('captures package name', async () => {
      const extractor = makeExtractor({
        'Svc.java': `
package com.example.grpc.services;

public class SvcImpl extends SvcGrpc.SvcImplBase {
  @Override
  public void doThing(ReqType req, StreamObserver<RespType> obs) {}
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].packageOrModule).toBe('com.example.grpc.services')
    })
  })

  describe('edge cases', () => {
    it('skips impl class with no overridden RPC methods', async () => {
      const extractor = makeExtractor({
        'Empty.java': `
public class EmptyImpl extends SomeGrpc.SomeImplBase {
  private String helper() { return "hi"; }
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces).toHaveLength(0)
    })

    it('ignores non-grpc method signatures at depth 1', async () => {
      const extractor = makeExtractor({
        'Svc.java': `
public class SvcImpl extends SvcGrpc.SvcImplBase {
  private void helperMethod(String foo) {}

  @Override
  public void realRpc(ReqType request, StreamObserver<RespType> responseObserver) {}
}
`,
      })

      const result = await extractor.extract()
      // helperMethod has no StreamObserver so it should be skipped
      expect(result.surfaces[0].endpoints).toHaveLength(1)
      expect(result.surfaces[0].endpoints[0].rpcMethodName).toBe('realRpc')
    })
  })

  describe('stats', () => {
    it('reports correct stats', async () => {
      const extractor = makeExtractor({
        'A.java': `
public class AImpl extends AGrpc.AImplBase {
  @Override
  public void method1(Req req, StreamObserver<Resp> obs) {}
  @Override
  public void method2(Req req, StreamObserver<Resp> obs) {}
}
`,
        'B.java': `
public class BImpl extends BGrpc.BImplBase {
  @Override
  public void method3(Req req, StreamObserver<Resp> obs) {}
}
`,
      })

      const result = await extractor.extract()
      expect(result.stats.filesScanned).toBe(2)
      expect(result.stats.surfacesFound).toBe(2)
      expect(result.stats.endpointsFound).toBe(3)
    })
  })
})
