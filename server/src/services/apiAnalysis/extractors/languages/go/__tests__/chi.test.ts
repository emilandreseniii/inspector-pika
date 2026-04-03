import { describe, it, expect, vi } from 'vitest'
import { ChiExtractor } from '../chi'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): ChiExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Go', approach: 'chi', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new ChiExtractor(ctx)
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

describe('ChiExtractor', () => {
  it('extracts routes from chi.NewRouter()', async () => {
    const extractor = makeExtractor({
      'main.go': `
package main

import (
    "github.com/go-chi/chi/v5"
)

func main() {
    r := chi.NewRouter()

    r.Get("/users", getUsers)
    r.Post("/users", createUser)
    r.Get("/users/{userID}", getUser)
    r.Put("/users/{userID}", updateUser)
    r.Delete("/users/{userID}", deleteUser)
}
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)

    const endpoints = result.surfaces[0].endpoints
    expect(endpoints).toHaveLength(5)
    expect(endpoints.find((e) => e.httpMethod === 'GET' && e.path === '/users')).toBeDefined()

    const getOne = endpoints.find((e) => e.path === '/users/{userID}' && e.httpMethod === 'GET')
    expect(getOne?.parameters[0]).toMatchObject({ name: 'userID', location: 'path' })
  })

  it('handles {param:regex} Chi path params', async () => {
    const extractor = makeExtractor({
      'main.go': `
import "github.com/go-chi/chi/v5"
func setup() {
    r := chi.NewRouter()
    r.Get("/articles/{articleID:[0-9]+}", getArticle)
}
`,
    })

    const result = await extractor.extract()
    const ep = result.surfaces[0].endpoints[0]
    expect(ep.parameters[0].name).toBe('articleID')
  })

  it('handles all HTTP methods', async () => {
    const extractor = makeExtractor({
      'main.go': `
import "github.com/go-chi/chi/v5"
func setup() {
    r := chi.NewRouter()
    r.Get("/a", h)
    r.Post("/b", h)
    r.Put("/c", h)
    r.Delete("/d", h)
    r.Patch("/e", h)
    r.Head("/f", h)
    r.Options("/g", h)
}
`,
    })

    const result = await extractor.extract()
    const methods = result.surfaces[0].endpoints.map((e) => e.httpMethod)
    expect(methods).toContain('GET')
    expect(methods).toContain('POST')
    expect(methods).toContain('DELETE')
    expect(methods).toContain('PATCH')
  })
})
