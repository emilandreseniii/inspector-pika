import { describe, it, expect, vi } from 'vitest'
import { ThriftExtractor } from '../thrift'
import type { ApiExtractorContext } from '../../base'

function makeExtractor(files: Record<string, string>): ThriftExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'cross-language', approach: 'thrift', apiStyle: 'rpc', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new ThriftExtractor(ctx)
  vi.spyOn(extractor as any, 'glob').mockImplementation(async () => Object.keys(files))
  vi.spyOn(extractor as any, 'readFile').mockImplementation(async (path: string) => {
    if (files[path] === undefined) throw new Error(`File not found: ${path}`)
    return files[path]
  })
  return extractor
}

describe('ThriftExtractor', () => {
  it('extracts services and methods from a Thrift file', async () => {
    const extractor = makeExtractor({
      'idl/user.thrift': `
namespace py user.v1
namespace java com.example.user

service UserService {
  User getUser(1: i32 id)
  User createUser(1: string email, 2: string name)
  void deleteUser(1: i32 id)
  list<User> listUsers()
}
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)
    expect(result.surfaces[0].name).toBe('UserService')
    expect(result.surfaces[0].apiStyle).toBe('rpc')

    const endpoints = result.surfaces[0].endpoints
    expect(endpoints.length).toBeGreaterThanOrEqual(2)

    const getUser = endpoints.find((e) => e.rpcMethodName === 'getUser')
    expect(getUser).toBeDefined()
    expect(getUser!.parameters.find((p) => p.name === 'id')).toBeDefined()
  })

  it('handles multiple services', async () => {
    const extractor = makeExtractor({
      'idl/services.thrift': `
service UserService {
  User getUser(1: i32 id)
}

service PostService {
  Post getPost(1: i32 id)
  void createPost(1: string title, 2: string body)
}
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(2)
    expect(result.surfaces.find((s) => s.name === 'UserService')).toBeDefined()
    expect(result.surfaces.find((s) => s.name === 'PostService')).toBeDefined()
  })

  it('extracts namespace', async () => {
    const extractor = makeExtractor({
      'idl/api.thrift': `
namespace go myapp.api

service ApiService {
  string ping()
}
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces[0].packageOrModule).toBe('myapp.api')
  })
})
