import { describe, it, expect, vi } from 'vitest'
import { TrpcExtractor } from '../trpc'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): TrpcExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'TypeScript', approach: 'trpc', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new TrpcExtractor(ctx)
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

describe('TrpcExtractor', () => {
  it('extracts queries and mutations from a tRPC router', async () => {
    const extractor = makeExtractor({
      'src/server/router.ts': `
import { initTRPC } from '@trpc/server'
import { z } from 'zod'

const t = initTRPC.create()
const publicProcedure = t.procedure

export const appRouter = t.router({
  getUser: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      return getUserById(input.id)
    }),
  createUser: publicProcedure
    .input(z.object({ name: z.string(), email: z.string() }))
    .mutation(async ({ input }) => {
      return createUser(input)
    }),
  listUsers: publicProcedure
    .query(async () => {
      return getAllUsers()
    }),
})
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)

    const surface = result.surfaces[0]
    expect(surface.framework).toBe('trpc')

    const getUser = surface.endpoints.find((e) => e.rpcMethodName === 'getUser')
    expect(getUser).toBeDefined()
    expect(getUser?.httpMethod).toBe('GET')
    expect(getUser?.metadata?.procedureType).toBe('query')

    const createUser = surface.endpoints.find((e) => e.rpcMethodName === 'createUser')
    expect(createUser?.httpMethod).toBe('POST')
    expect(createUser?.metadata?.procedureType).toBe('mutation')

    const listUsers = surface.endpoints.find((e) => e.rpcMethodName === 'listUsers')
    expect(listUsers?.httpMethod).toBe('GET')
  })

  it('handles subscription procedures', async () => {
    const extractor = makeExtractor({
      'src/router/events.ts': `
import { initTRPC } from '@trpc/server'
const t = initTRPC.create()

export const eventsRouter = t.router({
  onMessage: t.procedure.subscription(async function* () {
    yield { message: 'hello' }
  }),
})
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)
    const sub = result.surfaces[0].endpoints.find((e) => e.rpcMethodName === 'onMessage')
    expect(sub?.metadata?.procedureType).toBe('subscription')
  })

  it('returns empty when no @trpc/server import', async () => {
    const extractor = makeExtractor({
      'src/api.ts': `
import express from 'express'
const app = express()
app.get('/users', (req, res) => res.json([]))
`,
    })
    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(0)
  })
})
