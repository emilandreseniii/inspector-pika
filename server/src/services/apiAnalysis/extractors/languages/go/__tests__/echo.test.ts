import { describe, it, expect, vi } from 'vitest'
import { EchoExtractor } from '../echo'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): EchoExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Go', approach: 'echo', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new EchoExtractor(ctx)
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

describe('EchoExtractor', () => {
  it('extracts routes from echo.New()', async () => {
    const extractor = makeExtractor({
      'main.go': `
package main

import (
    "github.com/labstack/echo/v4"
)

func main() {
    e := echo.New()

    e.GET("/users", getUsers)
    e.POST("/users", createUser)
    e.GET("/users/:id", getUser)
    e.PUT("/users/:id", updateUser)
    e.DELETE("/users/:id", deleteUser)

    e.Start(":8080")
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

  it('handles groups', async () => {
    const extractor = makeExtractor({
      'main.go': `
import "github.com/labstack/echo/v4"
func setup() {
    e := echo.New()
    g := e.Group("/api")
    g.GET("/items", getItems)
    g.POST("/items", createItem)
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
import "github.com/labstack/echo/v4"
func setup() {
    e := echo.New()
    e.GET("/a", h)
    e.POST("/b", h)
    e.PUT("/c", h)
    e.DELETE("/d", h)
    e.PATCH("/e", h)
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
