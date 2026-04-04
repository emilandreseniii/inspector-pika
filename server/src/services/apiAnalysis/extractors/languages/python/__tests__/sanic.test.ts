import { describe, it, expect, vi } from 'vitest'
import { SanicExtractor } from '../sanic'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): SanicExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Python', approach: 'sanic', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new SanicExtractor(ctx)
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

describe('SanicExtractor', () => {
  it('extracts routes from Sanic decorator syntax', async () => {
    const extractor = makeExtractor({
      'app/server.py': `
from sanic import Sanic
from sanic.response import json

app = Sanic("my-app")

@app.get("/users")
async def list_users(request):
    return json([])

@app.post("/users")
async def create_user(request):
    return json({}, status=201)

@app.get("/users/<id:int>")
async def get_user(request, id):
    return json({"id": id})

@app.route("/users/<id:int>", methods=["PUT", "DELETE"])
async def update_or_delete_user(request, id):
    return json({})
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)

    const surface = result.surfaces[0]

    const getUsers = surface.endpoints.find((e) => e.httpMethod === 'GET' && e.path === '/users')
    expect(getUsers).toBeDefined()

    const postUsers = surface.endpoints.find((e) => e.httpMethod === 'POST')
    expect(postUsers?.path).toBe('/users')

    const getById = surface.endpoints.find((e) => e.httpMethod === 'GET' && e.path === '/users/<id:int>')
    expect(getById?.parameters[0].name).toBe('id')
    expect(getById?.parameters[0].location).toBe('path')

    const put = surface.endpoints.find((e) => e.httpMethod === 'PUT')
    expect(put).toBeDefined()
    const del = surface.endpoints.find((e) => e.httpMethod === 'DELETE')
    expect(del).toBeDefined()
  })

  it('detects Blueprint routes', async () => {
    const extractor = makeExtractor({
      'app/users.py': `
from sanic import Blueprint, Sanic

app = Sanic("app")
bp = Blueprint("users", url_prefix="/api")

@bp.get("/users")
async def list_users(request):
    return json([])
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)
    expect(result.surfaces[0].endpoints).toHaveLength(1)
  })

  it('returns empty when no Sanic import', async () => {
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
