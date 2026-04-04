import { describe, it, expect, vi } from 'vitest'
import { KoaExtractor } from '../koa'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): KoaExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'TypeScript', approach: 'koa', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new KoaExtractor(ctx)
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

describe('KoaExtractor', () => {
  it('extracts routes from a koa-router file', async () => {
    const extractor = makeExtractor({
      'src/routes/users.ts': `
import Router from 'koa-router'

const router = new Router()

router.get('/users', async (ctx) => {
  ctx.body = await getUsers()
})

router.post('/users', async (ctx) => {
  ctx.body = await createUser(ctx.request.body)
})

router.get('/users/:id', async (ctx) => {
  ctx.body = await getUser(ctx.params.id)
})

router.delete('/users/:id', async (ctx) => {
  await deleteUser(ctx.params.id)
  ctx.status = 204
})

export default router
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)

    const surface = result.surfaces[0]
    expect(surface.endpoints).toHaveLength(4)

    const getAll = surface.endpoints.find((e) => e.httpMethod === 'GET' && e.path === '/users')
    expect(getAll).toBeDefined()

    const post = surface.endpoints.find((e) => e.httpMethod === 'POST')
    expect(post?.path).toBe('/users')

    const getById = surface.endpoints.find((e) => e.path === '/users/:id' && e.httpMethod === 'GET')
    expect(getById?.parameters).toHaveLength(1)
    expect(getById?.parameters[0].name).toBe('id')
    expect(getById?.parameters[0].location).toBe('path')
  })

  it('handles @koa/router import', async () => {
    const extractor = makeExtractor({
      'src/router.ts': `
import Router from '@koa/router'

const router = new Router()

router.get('/health', (ctx) => { ctx.body = 'ok' })
router.put('/items/:id', (ctx) => { ctx.body = {} })
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)
    expect(result.surfaces[0].endpoints).toHaveLength(2)
  })

  it('returns empty when no koa-router import', async () => {
    const extractor = makeExtractor({
      'src/server.ts': `
import express from 'express'
const app = express()
app.get('/ping', (req, res) => res.send('pong'))
`,
    })
    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(0)
  })
})
