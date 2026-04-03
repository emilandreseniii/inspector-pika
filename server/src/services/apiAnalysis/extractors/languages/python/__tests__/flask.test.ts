import { describe, it, expect, vi } from 'vitest'
import { FlaskExtractor } from '../flask'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): FlaskExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Python', approach: 'flask', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new FlaskExtractor(ctx)
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

describe('FlaskExtractor', () => {
  describe('basic route extraction', () => {
    it('extracts @app.route with methods', async () => {
      const extractor = makeExtractor({
        'app.py': `
from flask import Flask

app = Flask(__name__)

@app.route("/users", methods=["GET", "POST"])
def users():
    pass
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces).toHaveLength(1)
      const endpoints = result.surfaces[0].endpoints
      expect(endpoints).toHaveLength(2)
      expect(endpoints[0].httpMethod).toBe('GET')
      expect(endpoints[0].path).toBe('/users')
      expect(endpoints[1].httpMethod).toBe('POST')
    })

    it('extracts shorthand @app.get, @app.post methods', async () => {
      const extractor = makeExtractor({
        'app.py': `
from flask import Flask

app = Flask(__name__)

@app.get("/items")
def list_items():
    return []

@app.delete("/items/<int:item_id>")
def delete_item(item_id):
    pass
`,
      })

      const result = await extractor.extract()
      const endpoints = result.surfaces[0].endpoints
      expect(endpoints).toHaveLength(2)
      expect(endpoints[0].httpMethod).toBe('GET')
      expect(endpoints[0].path).toBe('/items')
      expect(endpoints[1].httpMethod).toBe('DELETE')
      expect(endpoints[1].path).toBe('/items/<int:item_id>')
    })

    it('defaults to GET when methods not specified in @app.route', async () => {
      const extractor = makeExtractor({
        'app.py': `
app = Flask(__name__)

@app.route("/ping")
def ping():
    return "pong"
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].endpoints[0].httpMethod).toBe('GET')
    })
  })

  describe('path parameter extraction', () => {
    it('extracts Flask-style <param> path params', async () => {
      const extractor = makeExtractor({
        'app.py': `
app = Flask(__name__)

@app.get("/users/<int:user_id>/posts/<post_id>")
def get_post(user_id, post_id):
    pass
`,
      })

      const result = await extractor.extract()
      const params = result.surfaces[0].endpoints[0].parameters
      const paramNames = params.map((p) => p.name)
      expect(paramNames).toContain('user_id')
      expect(paramNames).toContain('post_id')
      expect(params.find((p) => p.name === 'user_id')?.location).toBe('path')
    })
  })

  describe('Blueprint support', () => {
    it('detects Blueprint variable and extracts routes', async () => {
      const extractor = makeExtractor({
        'users/routes.py': `
from flask import Blueprint

users_bp = Blueprint("users", __name__, url_prefix="/users")

@users_bp.route("/")
def list_users():
    pass

@users_bp.post("/<int:user_id>")
def get_user(user_id):
    pass
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces[0].endpoints).toHaveLength(2)
    })
  })

  describe('add_url_rule support', () => {
    it('extracts add_url_rule registrations', async () => {
      const extractor = makeExtractor({
        'app.py': `
app = Flask(__name__)

def index():
    pass

app.add_url_rule("/", view_func=index, methods=["GET"])
`,
      })

      const result = await extractor.extract()
      // Should capture the add_url_rule endpoint
      const endpoint = result.surfaces[0].endpoints.find((e) => e.path === '/')
      expect(endpoint).toBeDefined()
      expect(endpoint?.httpMethod).toBe('GET')
    })
  })

  describe('stats', () => {
    it('reports correct stats', async () => {
      const extractor = makeExtractor({
        'a.py': `
app = Flask(__name__)

@app.get("/a")
def a(): pass
`,
        'b.py': `
bp = Blueprint("b", __name__)

@bp.get("/b")
def b(): pass

@bp.post("/b")
def b_post(): pass
`,
      })

      const result = await extractor.extract()
      expect(result.stats.filesScanned).toBe(2)
      expect(result.stats.surfacesFound).toBe(2)
      expect(result.stats.endpointsFound).toBe(3)
    })
  })
})
