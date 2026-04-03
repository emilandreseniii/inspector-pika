import { describe, it, expect, vi } from 'vitest'
import { FiberExtractor } from '../fiber'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): FiberExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Go', approach: 'fiber', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new FiberExtractor(ctx)
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

describe('FiberExtractor', () => {
  it('extracts routes from fiber.New()', async () => {
    const extractor = makeExtractor({
      'main.go': `
package main

import "github.com/gofiber/fiber/v2"

func main() {
    app := fiber.New()

    app.Get("/users", getUsers)
    app.Post("/users", createUser)
    app.Get("/users/:id", getUser)
    app.Put("/users/:id", updateUser)
    app.Delete("/users/:id", deleteUser)

    app.Listen(":3000")
}
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)

    const endpoints = result.surfaces[0].endpoints
    expect(endpoints).toHaveLength(5)
    expect(endpoints.find((e) => e.httpMethod === 'GET' && e.path === '/users')).toBeDefined()

    const getOne = endpoints.find((e) => e.path === '/users/:id' && e.httpMethod === 'GET')
    expect(getOne?.parameters[0]).toMatchObject({ name: 'id', location: 'path' })
  })

  it('handles route groups', async () => {
    const extractor = makeExtractor({
      'main.go': `
import "github.com/gofiber/fiber/v2"
func setup() {
    app := fiber.New()
    api := app.Group("/api")
    api.Get("/items", getItems)
    api.Post("/items", createItem)
}
`,
    })

    const result = await extractor.extract()
    const endpoints = result.surfaces[0].endpoints
    expect(endpoints.find((e) => e.path === '/items' && e.httpMethod === 'GET')).toBeDefined()
  })

  it('handles all HTTP methods', async () => {
    const extractor = makeExtractor({
      'main.go': `
import "github.com/gofiber/fiber/v2"
func setup() {
    app := fiber.New()
    app.Get("/a", h)
    app.Post("/b", h)
    app.Put("/c", h)
    app.Delete("/d", h)
    app.Patch("/e", h)
}
`,
    })

    const result = await extractor.extract()
    const methods = result.surfaces[0].endpoints.map((e) => e.httpMethod)
    expect(methods).toContain('GET')
    expect(methods).toContain('POST')
    expect(methods).toContain('PUT')
    expect(methods).toContain('DELETE')
    expect(methods).toContain('PATCH')
  })
})
