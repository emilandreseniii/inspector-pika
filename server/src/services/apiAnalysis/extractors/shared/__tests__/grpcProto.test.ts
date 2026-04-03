import { describe, it, expect, vi } from 'vitest'
import { GrpcProtoExtractor } from '../grpcProto'
import type { ApiExtractorContext } from '../../base'

function makeExtractor(files: Record<string, string>): GrpcProtoExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'cross-language', approach: 'grpc_proto', apiStyle: 'rpc', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new GrpcProtoExtractor(ctx)
  vi.spyOn(extractor as any, 'glob').mockImplementation(async () => Object.keys(files))
  vi.spyOn(extractor as any, 'readFile').mockImplementation(async (path: string) => {
    if (files[path] === undefined) throw new Error(`File not found: ${path}`)
    return files[path]
  })
  return extractor
}

describe('GrpcProtoExtractor', () => {
  describe('basic service extraction', () => {
    it('extracts a simple service with unary RPCs', async () => {
      const extractor = makeExtractor({
        'user.proto': `
syntax = "proto3";
package user.v1;

service UserService {
  rpc GetUser (GetUserRequest) returns (GetUserResponse);
  rpc ListUsers (ListUsersRequest) returns (ListUsersResponse);
  rpc CreateUser (CreateUserRequest) returns (CreateUserResponse);
  rpc DeleteUser (DeleteUserRequest) returns (DeleteUserResponse);
}

message GetUserRequest { string user_id = 1; }
message GetUserResponse { string name = 1; }
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces).toHaveLength(1)

      const surface = result.surfaces[0]
      expect(surface.name).toBe('UserService')
      expect(surface.apiStyle).toBe('rpc')
      expect(surface.protocol).toBe('grpc')
      expect(surface.packageOrModule).toBe('user.v1')
      expect(surface.endpoints).toHaveLength(4)
    })

    it('extracts RPC method names and types', async () => {
      const extractor = makeExtractor({
        'order.proto': `
syntax = "proto3";
package order.v1;

service OrderService {
  rpc GetOrder (GetOrderRequest) returns (GetOrderResponse);
}
`,
      })

      const result = await extractor.extract()
      const ep = result.surfaces[0].endpoints[0]
      expect(ep.rpcMethodName).toBe('GetOrder')
      expect(ep.requestType).toBe('GetOrderRequest')
      expect(ep.responseType).toBe('GetOrderResponse')
    })

    it('returns no surfaces for a proto file without service blocks', async () => {
      const extractor = makeExtractor({
        'types.proto': `
syntax = "proto3";
package common.v1;

message User { string id = 1; string name = 2; }
message Timestamp { int64 seconds = 1; }
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces).toHaveLength(0)
    })
  })

  describe('streaming detection', () => {
    it('detects server streaming', async () => {
      const extractor = makeExtractor({
        'stream.proto': `
syntax = "proto3";
service StreamService {
  rpc WatchUpdates (WatchRequest) returns (stream UpdateEvent);
}
`,
      })

      const result = await extractor.extract()
      const ep = result.surfaces[0].endpoints[0]
      expect(ep.rpcStreaming).toBe('server')
      expect(ep.responseType).toBe('UpdateEvent')
    })

    it('detects client streaming', async () => {
      const extractor = makeExtractor({
        'upload.proto': `
syntax = "proto3";
service UploadService {
  rpc Upload (stream Chunk) returns (UploadResponse);
}
`,
      })

      const result = await extractor.extract()
      const ep = result.surfaces[0].endpoints[0]
      expect(ep.rpcStreaming).toBe('client')
      expect(ep.requestType).toBe('Chunk')
    })

    it('detects bidirectional streaming', async () => {
      const extractor = makeExtractor({
        'chat.proto': `
syntax = "proto3";
service ChatService {
  rpc Chat (stream ChatMessage) returns (stream ChatMessage);
}
`,
      })

      const result = await extractor.extract()
      const ep = result.surfaces[0].endpoints[0]
      expect(ep.rpcStreaming).toBe('bidirectional')
    })

    it('marks unary RPC as none streaming', async () => {
      const extractor = makeExtractor({
        'basic.proto': `
syntax = "proto3";
service BasicService {
  rpc Ping (PingRequest) returns (PingResponse);
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].endpoints[0].rpcStreaming).toBe('none')
    })
  })

  describe('multiple services and files', () => {
    it('extracts multiple services from one file', async () => {
      const extractor = makeExtractor({
        'api.proto': `
syntax = "proto3";
package api.v1;

service UserService {
  rpc GetUser (GetUserRequest) returns (GetUserResponse);
}

service AuthService {
  rpc Login (LoginRequest) returns (LoginResponse);
  rpc Logout (LogoutRequest) returns (LogoutResponse);
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces).toHaveLength(2)
      const names = result.surfaces.map((s) => s.name)
      expect(names).toContain('UserService')
      expect(names).toContain('AuthService')

      const authSurface = result.surfaces.find((s) => s.name === 'AuthService')!
      expect(authSurface.endpoints).toHaveLength(2)
    })

    it('extracts services from multiple proto files', async () => {
      const extractor = makeExtractor({
        'user.proto': `
syntax = "proto3";
service UserService {
  rpc GetUser (GetUserRequest) returns (GetUserResponse);
}
`,
        'product.proto': `
syntax = "proto3";
service ProductService {
  rpc GetProduct (GetProductRequest) returns (GetProductResponse);
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces).toHaveLength(2)
    })
  })

  describe('package extraction', () => {
    it('extracts package declaration', async () => {
      const extractor = makeExtractor({
        'svc.proto': `
syntax = "proto3";
package com.example.api.v2;

service MyService {
  rpc DoThing (Req) returns (Resp);
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].packageOrModule).toBe('com.example.api.v2')
    })
  })

  describe('comment extraction', () => {
    it('extracts single-line comments as summary', async () => {
      const extractor = makeExtractor({
        'svc.proto': `
syntax = "proto3";
service NoteService {
  // Returns a note by ID
  rpc GetNote (GetNoteRequest) returns (GetNoteResponse);
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].endpoints[0].summary).toBe('Returns a note by ID')
    })
  })

  describe('parameter representation', () => {
    it('represents request type as a single body parameter', async () => {
      const extractor = makeExtractor({
        'svc.proto': `
syntax = "proto3";
service UserService {
  rpc GetUser (GetUserRequest) returns (GetUserResponse);
}
`,
      })

      const result = await extractor.extract()
      const params = result.surfaces[0].endpoints[0].parameters
      expect(params).toHaveLength(1)
      expect(params[0].name).toBe('request')
      expect(params[0].location).toBe('body')
      expect(params[0].type).toBe('GetUserRequest')
      expect(params[0].required).toBe(true)
    })
  })

  describe('stats', () => {
    it('reports correct stats', async () => {
      const extractor = makeExtractor({
        'a.proto': `
syntax = "proto3";
service ServiceA {
  rpc MethodA (Req) returns (Resp);
  rpc MethodB (Req) returns (Resp);
}
`,
        'b.proto': `
syntax = "proto3";
service ServiceB {
  rpc MethodC (Req) returns (Resp);
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
