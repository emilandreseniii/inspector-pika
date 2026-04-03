import { describe, it, expect, vi } from 'vitest'
import { GinExtractor } from '../gin'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): GinExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Go', approach: 'gin', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new GinExtractor(ctx)
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

describe('GinExtractor', () => {
  describe('basic route extraction', () => {
    it('extracts routes from gin.Default()', async () => {
      const extractor = makeExtractor({
        'main.go': `
package main

import "github.com/gin-gonic/gin"

func main() {
    r := gin.Default()

    r.GET("/users", getUsers)
    r.POST("/users", createUser)
    r.GET("/users/:id", getUser)
    r.PUT("/users/:id", updateUser)
    r.DELETE("/users/:id", deleteUser)

    r.Run(":8080")
}
`,
      })

      const result = await extractor.extract()
      expect(result.surfaces).toHaveLength(1)

      const endpoints = result.surfaces[0].endpoints
      expect(endpoints).toHaveLength(5)

      const get = endpoints.find((e) => e.path === '/users' && e.httpMethod === 'GET')
      expect(get).toBeDefined()

      const getOne = endpoints.find((e) => e.path === '/users/:id' && e.httpMethod === 'GET')
      expect(getOne?.parameters).toHaveLength(1)
      expect(getOne?.parameters[0]).toMatchObject({ name: 'id', location: 'path', required: true })
    })

    it('handles all HTTP methods', async () => {
      const extractor = makeExtractor({
        'routes.go': `
import "github.com/gin-gonic/gin"
func setup() {
    r := gin.New()
    r.GET("/a", h)
    r.POST("/b", h)
    r.PUT("/c", h)
    r.DELETE("/d", h)
    r.PATCH("/e", h)
    r.HEAD("/f", h)
    r.OPTIONS("/g", h)
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
      expect(methods).toContain('HEAD')
      expect(methods).toContain('OPTIONS')
    })
  })

  describe('router groups', () => {
    it('detects routes on router groups', async () => {
      const extractor = makeExtractor({
        'routes.go': `
import "github.com/gin-gonic/gin"
func setup() {
    r := gin.Default()
    v1 := r.Group("/api/v1")
    v1.GET("/users", getUsers)
    v1.POST("/users", createUser)
}
`,
      })

      const result = await extractor.extract()
      const endpoints = result.surfaces[0].endpoints
      // Should find routes on both r and v1
      expect(endpoints.find((e) => e.path === '/users' && e.httpMethod === 'GET')).toBeDefined()
    })
  })

  describe('path parameters', () => {
    it('extracts multiple :param from path', async () => {
      const extractor = makeExtractor({
        'routes.go': `
import "github.com/gin-gonic/gin"
func setup() {
    r := gin.Default()
    r.GET("/repos/:owner/:repo/issues/:number", getIssue)
}
`,
      })

      const result = await extractor.extract()
      const ep = result.surfaces[0].endpoints[0]
      expect(ep.parameters).toHaveLength(3)
      expect(ep.parameters.find((p) => p.name === 'owner')).toBeDefined()
      expect(ep.parameters.find((p) => p.name === 'repo')).toBeDefined()
      expect(ep.parameters.find((p) => p.name === 'number')).toBeDefined()
    })
  })

  describe('stats', () => {
    it('reports correct stats', async () => {
      const extractor = makeExtractor({
        'a.go': `
import "github.com/gin-gonic/gin"
func a() {
    r := gin.Default()
    r.GET("/a", h)
    r.POST("/b", h)
}
`,
        'b.go': `
import "github.com/gin-gonic/gin"
func b() {
    r := gin.New()
    r.GET("/c", h)
}
`,
      })

      const result = await extractor.extract()
      expect(result.stats.filesScanned).toBe(2)
      expect(result.stats.surfacesFound).toBe(2)
      expect(result.stats.endpointsFound).toBe(3)
    })
  })
})
