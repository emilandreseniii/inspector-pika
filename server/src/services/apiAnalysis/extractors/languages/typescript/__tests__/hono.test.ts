import { describe, it, expect, vi } from 'vitest'
import { HonoExtractor } from '../hono'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): HonoExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'TypeScript', approach: 'hono', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new HonoExtractor(ctx)
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

describe('HonoExtractor', () => {
  describe('basic route extraction', () => {
    it('extracts routes from Hono app', async () => {
      const extractor = makeExtractor({
        'index.ts': `
import { Hono } from 'hono'
const app = new Hono()

app.get('/users', (c) => c.json([]))
app.post('/users', async (c) => c.json({}))
app.get('/users/:id', (c) => c.json({}))
app.delete('/users/:id', (c) => c.json(null))
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces).toHaveLength(1)

      const endpoints = result.surfaces[0].endpoints
      expect(endpoints).toHaveLength(4)
      expect(endpoints.find((e) => e.httpMethod === 'GET' && e.path === '/users')).toBeDefined()
      expect(endpoints.find((e) => e.httpMethod === 'POST' && e.path === '/users')).toBeDefined()

      const getOne = endpoints.find((e) => e.path === '/users/:id' && e.httpMethod === 'GET')
      expect(getOne?.parameters).toHaveLength(1)
      expect(getOne?.parameters[0]).toMatchObject({ name: 'id', location: 'path', required: true })
    })

    it('handles all HTTP method shortcuts', async () => {
      const extractor = makeExtractor({
        'routes.ts': `
import { Hono } from 'hono'
const app = new Hono()
app.get('/a', h)
app.post('/b', h)
app.put('/c', h)
app.delete('/d', h)
app.patch('/e', h)
app.head('/f', h)
app.options('/g', h)
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

    it('expands app.all() to multiple HTTP methods', async () => {
      const extractor = makeExtractor({
        'index.ts': `
import { Hono } from 'hono'
const app = new Hono()
app.all('/wildcard', (c) => c.text('ok'))
`,
      })

      const result = await extractor.extract()
      const methods = result.surfaces[0].endpoints.map((e) => e.httpMethod)
      expect(methods.length).toBeGreaterThan(1)
      expect(methods).toContain('GET')
      expect(methods).toContain('POST')
    })
  })

  describe('path parameters', () => {
    it('extracts multiple path params', async () => {
      const extractor = makeExtractor({
        'index.ts': `
import { Hono } from 'hono'
const app = new Hono()
app.get('/repos/:owner/:repo/issues/:issueId', (c) => c.json({}))
`,
      })

      const result = await extractor.extract()
      const ep = result.surfaces[0].endpoints[0]
      expect(ep.parameters).toHaveLength(3)
      expect(ep.parameters.find((p) => p.name === 'owner')).toBeDefined()
      expect(ep.parameters.find((p) => p.name === 'repo')).toBeDefined()
      expect(ep.parameters.find((p) => p.name === 'issueId')).toBeDefined()
    })
  })

  describe('typed Hono instance', () => {
    it('detects new Hono<Env>()', async () => {
      const extractor = makeExtractor({
        'index.ts': `
import { Hono } from 'hono'
type Env = { Variables: { user: User } }
const app = new Hono<Env>()
app.get('/profile', (c) => c.json(c.get('user')))
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].endpoints).toHaveLength(1)
      expect(result.surfaces[0].endpoints[0].path).toBe('/profile')
    })
  })

  describe('sub-router / route grouping', () => {
    it('detects routes on sub-routers', async () => {
      const extractor = makeExtractor({
        'api.ts': `
import { Hono } from 'hono'
const app = new Hono()
const api = new Hono()

api.get('/items', (c) => c.json([]))
api.post('/items', (c) => c.json({}))
app.route('/api', api)
`,
      })

      const result = await extractor.extract()
      // Both app and api are Hono instances — routes on api should be found
      const allEndpoints = result.surfaces.flatMap((s) => s.endpoints)
      expect(allEndpoints.find((e) => e.path === '/items' && e.httpMethod === 'GET')).toBeDefined()
    })
  })

  describe('stats', () => {
    it('reports correct stats', async () => {
      const extractor = makeExtractor({
        'a.ts': `
import { Hono } from 'hono'
const app = new Hono()
app.get('/x', h)
app.post('/y', h)
`,
        'b.ts': `
import { Hono } from 'hono'
const app = new Hono()
app.get('/z', h)
`,
      })

      const result = await extractor.extract()
      expect(result.stats.filesScanned).toBe(2)
      expect(result.stats.surfacesFound).toBe(2)
      expect(result.stats.endpointsFound).toBe(3)
    })
  })
})
