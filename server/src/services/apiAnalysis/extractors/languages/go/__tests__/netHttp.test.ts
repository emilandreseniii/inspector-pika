import { describe, it, expect, vi } from 'vitest'
import { NetHttpExtractor } from '../netHttp'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): NetHttpExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Go', approach: 'net_http', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new NetHttpExtractor(ctx)
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

describe('NetHttpExtractor', () => {
  it('extracts routes from http.HandleFunc', async () => {
    const extractor = makeExtractor({
      'main.go': `
package main

import "net/http"

func main() {
    http.HandleFunc("/users", usersHandler)
    http.HandleFunc("/users/{id}", userHandler)
    http.HandleFunc("/health", healthHandler)
    http.ListenAndServe(":8080", nil)
}
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)

    const endpoints = result.surfaces[0].endpoints
    expect(endpoints).toHaveLength(3)
    expect(endpoints.find((e) => e.path === '/users')).toBeDefined()
    expect(endpoints.find((e) => e.path === '/health')).toBeDefined()
  })

  it('extracts path params from {param} style', async () => {
    const extractor = makeExtractor({
      'main.go': `
import "net/http"
func setup() {
    mux := http.NewServeMux()
    mux.HandleFunc("/users/{id}/posts/{postId}", handler)
}
`,
    })

    const result = await extractor.extract()
    const ep = result.surfaces[0].endpoints[0]
    expect(ep.parameters).toHaveLength(2)
    expect(ep.parameters.find((p) => p.name === 'id')).toBeDefined()
    expect(ep.parameters.find((p) => p.name === 'postId')).toBeDefined()
  })

  it('handles mux.HandleFunc pattern', async () => {
    const extractor = makeExtractor({
      'main.go': `
import "net/http"
func setup() {
    mux := http.NewServeMux()
    mux.HandleFunc("/api/items", itemsHandler)
    mux.Handle("/static/", http.FileServer(http.Dir("static")))
}
`,
    })

    const result = await extractor.extract()
    const endpoints = result.surfaces[0].endpoints
    expect(endpoints.find((e) => e.path === '/api/items')).toBeDefined()
  })
})
