import { describe, it, expect, vi } from 'vitest'
import { ExpressExtractor } from '../express'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): ExpressExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'TypeScript', approach: 'express', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new ExpressExtractor(ctx)
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

describe('ExpressExtractor', () => {
  describe('basic route extraction', () => {
    it('extracts app.get and app.post routes', async () => {
      const extractor = makeExtractor({
        'src/app.ts': `
import express from 'express'
const app = express()

app.get('/users', (req, res) => res.json([]))
app.post('/users', (req, res) => res.json({}))
app.delete('/users/:id', (req, res) => res.sendStatus(204))
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces).toHaveLength(1)

      const endpoints = result.surfaces[0].endpoints
      expect(endpoints).toHaveLength(3)
      expect(endpoints[0]).toMatchObject({ httpMethod: 'GET', path: '/users' })
      expect(endpoints[1]).toMatchObject({ httpMethod: 'POST', path: '/users' })
      expect(endpoints[2]).toMatchObject({ httpMethod: 'DELETE', path: '/users/:id' })
    })

    it('extracts router.get and router.post routes', async () => {
      const extractor = makeExtractor({
        'src/routes/items.ts': `
import { Router } from 'express'
const router = Router()

router.get('/items', handler)
router.post('/items', createHandler)
router.put('/items/:id', updateHandler)
`,
      })

      const result = await extractor.extract()
      const methods = result.surfaces[0].endpoints.map((e) => e.httpMethod)
      expect(methods).toEqual(['GET', 'POST', 'PUT'])
    })
  })

  describe('path parameter extraction', () => {
    it('extracts :param from path as path parameters', async () => {
      const extractor = makeExtractor({
        'app.ts': `
const app = express()
app.get('/users/:userId/posts/:postId', handler)
`,
      })

      const result = await extractor.extract()
      const params = result.surfaces[0].endpoints[0].parameters
      expect(params.map((p) => p.name)).toContain('userId')
      expect(params.map((p) => p.name)).toContain('postId')
      expect(params[0].location).toBe('path')
    })
  })

  describe('CommonJS require support', () => {
    it('detects express via require()', async () => {
      const extractor = makeExtractor({
        'app.js': `
const express = require('express')
const app = express()

app.get('/ping', (req, res) => res.send('pong'))
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].endpoints).toHaveLength(1)
      expect(result.surfaces[0].endpoints[0].path).toBe('/ping')
    })
  })

  describe('route deduplication', () => {
    it('skips commented-out routes', async () => {
      const extractor = makeExtractor({
        'app.ts': `
const app = express()
// app.get('/commented', handler)
app.get('/real', handler)
`,
      })

      const result = await extractor.extract()
      const paths = result.surfaces[0].endpoints.map((e) => e.path)
      expect(paths).not.toContain('/commented')
      expect(paths).toContain('/real')
    })
  })

  describe('stats', () => {
    it('reports correct stats', async () => {
      const extractor = makeExtractor({
        'a.ts': `
const app = express()
app.get('/a', h)
app.post('/a', h)
`,
        'b.ts': `
const router = Router()
router.get('/b', h)
`,
      })

      const result = await extractor.extract()
      expect(result.stats.filesScanned).toBe(2)
      expect(result.stats.surfacesFound).toBe(2)
      expect(result.stats.endpointsFound).toBe(3)
    })
  })
})
