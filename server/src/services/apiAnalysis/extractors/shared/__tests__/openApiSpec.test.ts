import { describe, it, expect, vi } from 'vitest'
import { OpenApiSpecExtractor } from '../openApiSpec'
import type { ApiExtractorContext } from '../../base'

function makeExtractor(files: Record<string, string>): OpenApiSpecExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'cross-language', approach: 'openapi_spec', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new OpenApiSpecExtractor(ctx)
  vi.spyOn(extractor as any, 'glob').mockImplementation(async () => Object.keys(files))
  vi.spyOn(extractor as any, 'readFile').mockImplementation(async (path: string) => {
    if (files[path] === undefined) throw new Error(`File not found: ${path}`)
    return files[path]
  })
  return extractor
}

describe('OpenApiSpecExtractor', () => {
  describe('OpenAPI 3.x YAML', () => {
    it('extracts endpoints from OpenAPI 3.x spec', async () => {
      const extractor = makeExtractor({
        'openapi.yaml': `
openapi: "3.0.0"
info:
  title: Pet Store API
  version: "1.0"
paths:
  /pets:
    get:
      operationId: listPets
      summary: List all pets
    post:
      operationId: createPet
      summary: Create a pet
  /pets/{petId}:
    get:
      operationId: showPetById
      parameters:
        - name: petId
          in: path
          required: true
    delete:
      operationId: deletePet
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces).toHaveLength(1)

      const surface = result.surfaces[0]
      expect(surface.name).toBe('Pet Store API')
      expect(surface.apiStyle).toBe('http')

      const endpoints = surface.endpoints
      expect(endpoints.find((e) => e.httpMethod === 'GET' && e.path === '/pets')).toBeDefined()
      expect(endpoints.find((e) => e.httpMethod === 'POST' && e.path === '/pets')).toBeDefined()
      expect(endpoints.find((e) => e.httpMethod === 'GET' && e.path === '/pets/{petId}')).toBeDefined()

      const getOne = endpoints.find((e) => e.path === '/pets/{petId}' && e.httpMethod === 'GET')
      expect(getOne?.operationName).toBe('showPetById')
      expect(getOne?.parameters.find((p) => p.name === 'petId')).toBeDefined()
    })
  })

  describe('Swagger 2.x YAML with basePath', () => {
    it('applies basePath to endpoint paths', async () => {
      const extractor = makeExtractor({
        'swagger.yaml': `
swagger: "2.0"
info:
  title: Users API
  version: "1"
basePath: /api/v1
paths:
  /users:
    get:
      operationId: listUsers
    post:
      operationId: createUser
  /users/{id}:
    get:
      operationId: getUser
      parameters:
        - name: id
          in: path
          required: true
`,
      })

      const result = await extractor.extract()
      const paths = result.surfaces[0].endpoints.map((e) => e.path)
      expect(paths).toContain('/api/v1/users')
      expect(paths).toContain('/api/v1/users/{id}')
    })
  })

  describe('query parameters', () => {
    it('extracts query parameters', async () => {
      const extractor = makeExtractor({
        'openapi.yaml': `
openapi: "3.0.0"
info:
  title: Search API
paths:
  /search:
    get:
      operationId: search
      parameters:
        - name: q
          in: query
          required: true
        - name: page
          in: query
          required: false
`,
      })

      const result = await extractor.extract()
      const ep = result.surfaces[0].endpoints[0]
      expect(ep.parameters.find((p) => p.name === 'q' && p.location === 'query')).toBeDefined()
      expect(ep.parameters.find((p) => p.name === 'page' && p.location === 'query')).toBeDefined()
    })
  })

  describe('ignores non-OpenAPI files', () => {
    it('skips files that are not OpenAPI specs', async () => {
      const extractor = makeExtractor({
        'openapi.yaml': `
# Just a regular YAML file
key: value
foo: bar
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces).toHaveLength(0)
    })
  })
})
