import { describe, it, expect, vi } from 'vitest'
import { StarletteExtractor } from '../starlette'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): StarletteExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Python', approach: 'starlette', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new StarletteExtractor(ctx)
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

describe('StarletteExtractor', () => {
  it('extracts routes from Route() definitions', async () => {
    const extractor = makeExtractor({
      'app/main.py': `
from starlette.applications import Starlette
from starlette.routing import Route, Mount

async def list_users(request):
    return JSONResponse([])

async def get_user(request):
    return JSONResponse({})

async def create_user(request):
    return JSONResponse({})

routes = [
    Route("/users", endpoint=list_users, methods=["GET"]),
    Route("/users", endpoint=create_user, methods=["POST"]),
    Route("/users/{id}", endpoint=get_user, methods=["GET", "DELETE"]),
]

app = Starlette(routes=routes)
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)

    const surface = result.surfaces[0]
    expect(surface.framework).toBe('starlette')

    const getUsers = surface.endpoints.find((e) => e.httpMethod === 'GET' && e.path === '/users')
    expect(getUsers).toBeDefined()

    const postUsers = surface.endpoints.find((e) => e.httpMethod === 'POST' && e.path === '/users')
    expect(postUsers).toBeDefined()

    const getUserById = surface.endpoints.find((e) => e.path === '/users/{id}' && e.httpMethod === 'GET')
    expect(getUserById?.parameters[0].name).toBe('id')
    expect(getUserById?.parameters[0].in).toBe('path')

    const deleteUser = surface.endpoints.find((e) => e.path === '/users/{id}' && e.httpMethod === 'DELETE')
    expect(deleteUser).toBeDefined()
  })

  it('returns empty when no starlette import', async () => {
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
