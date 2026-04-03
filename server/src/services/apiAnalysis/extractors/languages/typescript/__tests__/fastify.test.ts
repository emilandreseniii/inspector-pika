import { describe, it, expect, vi } from 'vitest'
import { FastifyExtractor } from '../fastify'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): FastifyExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'TypeScript', approach: 'fastify', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new FastifyExtractor(ctx)
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

describe('FastifyExtractor', () => {
  describe('shorthand route methods', () => {
    it('extracts routes from fastify shorthand methods', async () => {
      const extractor = makeExtractor({
        'server.ts': `
import Fastify from 'fastify'
const fastify = Fastify({ logger: true })

fastify.get('/users', async (req, reply) => {
  return []
})

fastify.post('/users', async (req, reply) => {
  return {}
})

fastify.get('/users/:id', async (req, reply) => {
  return {}
})

fastify.delete('/users/:id', async (req, reply) => {
  return null
})
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces).toHaveLength(1)

      const endpoints = result.surfaces[0].endpoints
      expect(endpoints).toHaveLength(4)

      const getUsers = endpoints.find((e) => e.path === '/users' && e.httpMethod === 'GET')
      expect(getUsers).toBeDefined()

      const postUsers = endpoints.find((e) => e.path === '/users' && e.httpMethod === 'POST')
      expect(postUsers).toBeDefined()

      const getOne = endpoints.find((e) => e.path === '/users/:id' && e.httpMethod === 'GET')
      expect(getOne?.parameters).toHaveLength(1)
      expect(getOne?.parameters[0]).toMatchObject({ name: 'id', location: 'path', required: true })
    })

    it('handles all HTTP methods', async () => {
      const extractor = makeExtractor({
        'routes.ts': `
const fastify = require('fastify')()
fastify.get('/a', handler)
fastify.post('/b', handler)
fastify.put('/c', handler)
fastify.delete('/d', handler)
fastify.patch('/e', handler)
fastify.head('/f', handler)
fastify.options('/g', handler)
`,
      })

      const result = await extractor.extract()
      const methods = result.surfaces[0].endpoints.map((e) => e.httpMethod)
      expect(methods).toContain('GET')
      expect(methods).toContain('POST')
      expect(methods).toContain('PUT')
      expect(methods).toContain('DELETE')
      expect(methods).toContain('PATCH')
      expect(methods).toContain('HEAD')
      expect(methods).toContain('OPTIONS')
    })
  })

  describe('fastify.route() object form', () => {
    it('extracts routes from fastify.route()', async () => {
      const extractor = makeExtractor({
        'server.ts': `
import Fastify from 'fastify'
const fastify = Fastify()

fastify.route({
  method: 'GET',
  url: '/items',
  handler: async (req, reply) => { return [] }
})

fastify.route({
  method: 'POST',
  url: '/items',
  handler: async (req, reply) => { return {} }
})
`,
      })

      const result = await extractor.extract()
      const endpoints = result.surfaces[0].endpoints
      expect(endpoints).toHaveLength(2)
      expect(endpoints.find((e) => e.httpMethod === 'GET' && e.path === '/items')).toBeDefined()
      expect(endpoints.find((e) => e.httpMethod === 'POST' && e.path === '/items')).toBeDefined()
    })

    it('handles method arrays in fastify.route()', async () => {
      const extractor = makeExtractor({
        'server.ts': `
import Fastify from 'fastify'
const fastify = Fastify()

fastify.route({
  method: ['GET', 'HEAD'],
  url: '/health',
  handler: async () => ({ status: 'ok' })
})
`,
      })

      const result = await extractor.extract()
      const endpoints = result.surfaces[0].endpoints
      expect(endpoints).toHaveLength(2)
      expect(endpoints.find((e) => e.httpMethod === 'GET' && e.path === '/health')).toBeDefined()
      expect(endpoints.find((e) => e.httpMethod === 'HEAD' && e.path === '/health')).toBeDefined()
    })
  })

  describe('path parameters', () => {
    it('extracts :param style path params', async () => {
      const extractor = makeExtractor({
        'server.ts': `
import Fastify from 'fastify'
const app = Fastify()

app.get('/users/:userId/posts/:postId', async (req, reply) => {})
`,
      })

      const result = await extractor.extract()
      const ep = result.surfaces[0].endpoints[0]
      expect(ep.parameters).toHaveLength(2)
      expect(ep.parameters.find((p) => p.name === 'userId')).toBeDefined()
      expect(ep.parameters.find((p) => p.name === 'postId')).toBeDefined()
    })
  })

  describe('plugin pattern', () => {
    it('detects fastify instance in plugin functions', async () => {
      const extractor = makeExtractor({
        'plugin.ts': `
import Fastify from 'fastify'
const fastify = Fastify()

async function routes(fastify, opts) {
  fastify.get('/ping', async () => 'pong')
  fastify.post('/echo', async (req) => req.body)
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].endpoints.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('require() style', () => {
    it('detects fastify from require()', async () => {
      const extractor = makeExtractor({
        'server.js': `
const fastify = require('fastify')({ logger: false })

fastify.get('/hello', async () => 'world')
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].endpoints).toHaveLength(1)
      expect(result.surfaces[0].endpoints[0].path).toBe('/hello')
    })
  })

  describe('stats', () => {
    it('reports correct stats', async () => {
      const extractor = makeExtractor({
        'a.ts': `
import Fastify from 'fastify'
const fastify = Fastify()
fastify.get('/a', handler)
fastify.post('/b', handler)
`,
        'b.ts': `
import Fastify from 'fastify'
const app = Fastify()
app.get('/c', handler)
`,
      })

      const result = await extractor.extract()
      expect(result.stats.filesScanned).toBe(2)
      expect(result.stats.surfacesFound).toBe(2)
      expect(result.stats.endpointsFound).toBe(3)
    })
  })
})
