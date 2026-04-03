import { describe, it, expect, vi } from 'vitest'
import { FastApiExtractor } from '../fastapi'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): FastApiExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Python', approach: 'fastapi', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new FastApiExtractor(ctx)
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

describe('FastApiExtractor', () => {
  describe('basic route extraction', () => {
    it('extracts GET and POST routes', async () => {
      const extractor = makeExtractor({
        'main.py': `
from fastapi import FastAPI

app = FastAPI()

@app.get("/items")
def list_items():
    return []

@app.post("/items")
def create_item(item: Item):
    return item
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces).toHaveLength(1)

      const surface = result.surfaces[0]
      expect(surface.name).toBe('main')
      expect(surface.apiStyle).toBe('http')
      expect(surface.endpoints).toHaveLength(2)

      const [get, post] = surface.endpoints
      expect(get.httpMethod).toBe('GET')
      expect(get.path).toBe('/items')
      expect(get.operationName).toBe('list_items')

      expect(post.httpMethod).toBe('POST')
      expect(post.path).toBe('/items')
      expect(post.operationName).toBe('create_item')
    })

    it('extracts all common HTTP methods', async () => {
      const extractor = makeExtractor({
        'router.py': `
from fastapi import APIRouter

router = APIRouter()

@router.get("/x")
def get_x(): pass

@router.put("/x/{id}")
def put_x(id: int): pass

@router.delete("/x/{id}")
def del_x(id: int): pass

@router.patch("/x/{id}")
def patch_x(id: int): pass
`,
      })

      const result = await extractor.extract()
      const methods = result.surfaces[0].endpoints.map((e) => e.httpMethod)
      expect(methods).toEqual(['GET', 'PUT', 'DELETE', 'PATCH'])
    })
  })

  describe('path parameter extraction', () => {
    it('extracts {param} from path as path-location parameters', async () => {
      const extractor = makeExtractor({
        'items.py': `
from fastapi import FastAPI

app = FastAPI()

@app.get("/items/{item_id}/reviews/{review_id}")
def get_review(item_id: int, review_id: int):
    pass
`,
      })

      const result = await extractor.extract()
      const params = result.surfaces[0].endpoints[0].parameters
      expect(params).toHaveLength(2)
      expect(params[0]).toMatchObject({ name: 'item_id', location: 'path', required: true })
      expect(params[1]).toMatchObject({ name: 'review_id', location: 'path', required: true })
    })
  })

  describe('query parameter extraction', () => {
    it('marks params with defaults as optional query params', async () => {
      const extractor = makeExtractor({
        'items.py': `
from fastapi import FastAPI

app = FastAPI()

@app.get("/items")
def list_items(skip: int = 0, limit: int = 100):
    pass
`,
      })

      const result = await extractor.extract()
      const params = result.surfaces[0].endpoints[0].parameters
      expect(params).toHaveLength(2)
      expect(params[0]).toMatchObject({ name: 'skip', location: 'query', required: false })
      expect(params[1]).toMatchObject({ name: 'limit', location: 'query', required: false })
    })
  })

  describe('body parameter extraction', () => {
    it('marks non-primitive typed params without defaults as body', async () => {
      const extractor = makeExtractor({
        'items.py': `
from fastapi import FastAPI

app = FastAPI()

@app.post("/items")
def create_item(item: ItemCreate):
    pass
`,
      })

      const result = await extractor.extract()
      const params = result.surfaces[0].endpoints[0].parameters
      expect(params).toHaveLength(1)
      expect(params[0]).toMatchObject({ name: 'item', location: 'body', type: 'ItemCreate', required: true })
    })
  })

  describe('decorator metadata', () => {
    it('extracts response_model as returnType', async () => {
      const extractor = makeExtractor({
        'main.py': `
app = FastAPI()

@app.get("/items", response_model=list[ItemResponse])
def list_items():
    return []
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].endpoints[0].returnType).toBe('list[ItemResponse]')
    })

    it('extracts tags from decorator', async () => {
      const extractor = makeExtractor({
        'main.py': `
app = FastAPI()

@app.get("/users", tags=["users", "admin"])
def list_users():
    pass
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].endpoints[0].tags).toContain('users')
      expect(result.surfaces[0].endpoints[0].tags).toContain('admin')
    })
  })

  describe('APIRouter support', () => {
    it('detects APIRouter variable and extracts routes', async () => {
      const extractor = makeExtractor({
        'routers/users.py': `
from fastapi import APIRouter

router = APIRouter(prefix="/users", tags=["users"])

@router.get("/")
def list_users():
    pass

@router.post("/")
def create_user(user: UserCreate):
    pass
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].endpoints).toHaveLength(2)
    })
  })

  describe('async routes', () => {
    it('extracts async def routes', async () => {
      const extractor = makeExtractor({
        'main.py': `
app = FastAPI()

@app.get("/async-items")
async def list_items():
    return []
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].endpoints[0].operationName).toBe('list_items')
    })
  })

  describe('stats', () => {
    it('reports correct stats', async () => {
      const extractor = makeExtractor({
        'a.py': `
app = FastAPI()

@app.get("/a")
def a(): pass

@app.post("/a")
def a_post(): pass
`,
        'b.py': `
router = APIRouter()

@router.get("/b")
def b(): pass
`,
      })

      const result = await extractor.extract()
      expect(result.stats.filesScanned).toBe(2)
      expect(result.stats.surfacesFound).toBe(2)
      expect(result.stats.endpointsFound).toBe(3)
    })
  })
})
