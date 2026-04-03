import { describe, it, expect, vi } from 'vitest'
import { GraphQLSchemaExtractor } from '../graphqlSchema'
import type { ApiExtractorContext } from '../../base'

function makeExtractor(files: Record<string, string>): GraphQLSchemaExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'cross-language', approach: 'graphql_schema', apiStyle: 'graphql', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new GraphQLSchemaExtractor(ctx)
  vi.spyOn(extractor as any, 'glob').mockImplementation(async () => Object.keys(files))
  vi.spyOn(extractor as any, 'readFile').mockImplementation(async (path: string) => {
    if (files[path] === undefined) throw new Error(`File not found: ${path}`)
    return files[path]
  })
  return extractor
}

describe('GraphQLSchemaExtractor', () => {
  describe('Query type', () => {
    it('extracts operations from type Query', async () => {
      const extractor = makeExtractor({
        'schema.graphql': `
type Query {
  users: [User!]!
  user(id: ID!): User
  posts(limit: Int, offset: Int): [Post!]!
}

type Mutation {
  createUser(name: String!, email: String!): User!
  deleteUser(id: ID!): Boolean!
}

type Subscription {
  userCreated: User!
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces).toHaveLength(1)

      const surface = result.surfaces[0]
      expect(surface.apiStyle).toBe('graphql')

      const endpoints = surface.endpoints
      expect(endpoints.find((e) => e.operationName === 'users')).toBeDefined()
      expect(endpoints.find((e) => e.operationName === 'user')).toBeDefined()
      expect(endpoints.find((e) => e.operationName === 'posts')).toBeDefined()
      expect(endpoints.find((e) => e.operationName === 'createUser')).toBeDefined()
      expect(endpoints.find((e) => e.operationName === 'deleteUser')).toBeDefined()
      expect(endpoints.find((e) => e.operationName === 'userCreated')).toBeDefined()
    })

    it('sets correct operationType tags', async () => {
      const extractor = makeExtractor({
        'schema.graphql': `
type Query {
  hello: String!
}
type Mutation {
  greet(name: String!): String!
}
`,
      })

      const result = await extractor.extract()
      const endpoints = result.surfaces[0].endpoints

      const query = endpoints.find((e) => e.operationName === 'hello')
      expect(query?.operationType).toBe('query')
      expect(query?.tags).toContain('Query')

      const mutation = endpoints.find((e) => e.operationName === 'greet')
      expect(mutation?.operationType).toBe('mutation')
      expect(mutation?.tags).toContain('Mutation')
    })
  })

  describe('argument extraction', () => {
    it('extracts arguments as parameters', async () => {
      const extractor = makeExtractor({
        'schema.graphql': `
type Query {
  user(id: ID!, includeDeleted: Boolean): User
}
`,
      })

      const result = await extractor.extract()
      const ep = result.surfaces[0].endpoints[0]
      const params = ep.parameters

      const idParam = params.find((p) => p.name === 'id')
      expect(idParam?.required).toBe(true)
      expect(idParam?.type).toBe('ID')

      const deletedParam = params.find((p) => p.name === 'includeDeleted')
      expect(deletedParam?.required).toBe(false)
    })
  })

  describe('return type metadata', () => {
    it('captures return type in metadata', async () => {
      const extractor = makeExtractor({
        'schema.graphql': `
type Query {
  users: [User!]!
  user(id: ID!): User
}
`,
      })

      const result = await extractor.extract()
      const usersEp = result.surfaces[0].endpoints.find((e) => e.operationName === 'users')
      expect(usersEp?.metadata?.returnType).toBeDefined()
    })
  })

  describe('multiple files', () => {
    it('extracts from multiple .graphql files', async () => {
      const extractor = makeExtractor({
        'users.graphql': `
type Query {
  users: [User!]!
}
`,
        'posts.gql': `
type Query {
  posts: [Post!]!
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces).toHaveLength(2)
      expect(result.stats.endpointsFound).toBe(2)
    })
  })
})
