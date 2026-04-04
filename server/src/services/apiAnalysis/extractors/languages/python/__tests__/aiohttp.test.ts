import { describe, it, expect, vi } from 'vitest'
import { AiohttpExtractor } from '../aiohttp'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): AiohttpExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Python', approach: 'aiohttp', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new AiohttpExtractor(ctx)
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

describe('AiohttpExtractor', () => {
  it('extracts routes from add_get/add_post/add_route', async () => {
    const extractor = makeExtractor({
      'app/main.py': `
from aiohttp import web

async def list_users(request):
    return web.json_response([])

async def get_user(request):
    return web.json_response({})

async def create_user(request):
    return web.json_response({}, status=201)

app = web.Application()
app.router.add_get("/users", list_users)
app.router.add_post("/users", create_user)
app.router.add_get("/users/{id}", get_user)
app.router.add_route("DELETE", "/users/{id}", get_user)
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)

    const surface = result.surfaces[0]
    expect(surface.framework).toBe('aiohttp')

    const getUsers = surface.endpoints.find((e) => e.httpMethod === 'GET' && e.path === '/users')
    expect(getUsers).toBeDefined()

    const postUsers = surface.endpoints.find((e) => e.httpMethod === 'POST')
    expect(postUsers?.path).toBe('/users')

    const getUserById = surface.endpoints.find((e) => e.path === '/users/{id}' && e.httpMethod === 'GET')
    expect(getUserById?.parameters[0].name).toBe('id')
    expect(getUserById?.parameters[0].in).toBe('path')

    const deleteUser = surface.endpoints.find((e) => e.httpMethod === 'DELETE')
    expect(deleteUser).toBeDefined()
  })

  it('extracts routes from RouteTableDef decorators', async () => {
    const extractor = makeExtractor({
      'app/routes.py': `
from aiohttp import web

routes = web.RouteTableDef()

@routes.get("/items")
async def list_items(request):
    return web.json_response([])

@routes.post("/items")
async def create_item(request):
    return web.json_response({})
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)
    expect(result.surfaces[0].endpoints).toHaveLength(2)
  })

  it('returns empty when no aiohttp import', async () => {
    const extractor = makeExtractor({
      'app/main.py': `
from flask import Flask
app = Flask(__name__)
`,
    })
    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(0)
  })
})
