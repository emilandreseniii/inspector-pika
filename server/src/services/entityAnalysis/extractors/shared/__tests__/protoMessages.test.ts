import { describe, it, expect, vi } from 'vitest'
import { ProtoMessagesExtractor } from '../protoMessages'
import type { ExtractorContext } from '../../base'

function makeExtractor(files: Record<string, string>): ProtoMessagesExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'cross-language', approach: 'proto_messages', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new ProtoMessagesExtractor(ctx)
  vi.spyOn(extractor as any, 'glob').mockImplementation(async () => Object.keys(files))
  vi.spyOn(extractor as any, 'readFile').mockImplementation(async (path: string) => {
    if (files[path] === undefined) throw new Error(`File not found: ${path}`)
    return files[path]
  })
  return extractor
}

describe('ProtoMessagesExtractor', () => {
  it('extracts messages from a proto file', async () => {
    const extractor = makeExtractor({
      'proto/user.proto': `
syntax = "proto3";
package user.v1;

message User {
  int32 id = 1;
  string email = 2;
  string name = 3;
  bool is_active = 4;
}

message CreateUserRequest {
  string email = 1;
  string name = 2;
}

message CreateUserResponse {
  User user = 1;
}
`,
    })

    const result = await extractor.extract()
    expect(result.entities).toHaveLength(3)

    const user = result.entities.find((e) => e.name === 'User')
    expect(user).toBeDefined()
    expect(user!.entityType).toBe('schema')

    const id = user!.fields.find((f) => f.name === 'id')
    expect(id!.type).toBe('integer')

    const email = user!.fields.find((f) => f.name === 'email')
    expect(email!.type).toBe('string')
  })

  it('handles repeated fields', async () => {
    const extractor = makeExtractor({
      'proto/posts.proto': `
syntax = "proto3";

message Post {
  int32 id = 1;
  string title = 2;
  repeated string tags = 3;
}
`,
    })

    const result = await extractor.extract()
    const post = result.entities[0]
    const tags = post.fields.find((f) => f.name === 'tags')
    expect(tags!.type).toBe('list<string>')
  })

  it('records package in metadata', async () => {
    const extractor = makeExtractor({
      'proto/service.proto': `
syntax = "proto3";
package myapp.v2;

message Request {
  string query = 1;
}
`,
    })

    const result = await extractor.extract()
    expect(result.entities[0].metadata.package).toBe('myapp.v2')
  })
})
