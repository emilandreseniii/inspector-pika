import { describe, it, expect, vi } from 'vitest'
import { GorillaMuxExtractor } from '../gorillaMux'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): GorillaMuxExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Go', approach: 'gorilla_mux', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new GorillaMuxExtractor(ctx)
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

describe('GorillaMuxExtractor', () => {
  it('extracts routes with .Methods() chains', async () => {
    const extractor = makeExtractor({
      'main.go': `
package main

import (
    "github.com/gorilla/mux"
    "net/http"
)

func main() {
    r := mux.NewRouter()
    r.HandleFunc("/users", listUsers).Methods("GET")
    r.HandleFunc("/users", createUser).Methods("POST")
    r.HandleFunc("/users/{id}", getUser).Methods("GET")
    r.HandleFunc("/users/{id}", deleteUser).Methods("DELETE")
    http.ListenAndServe(":8080", r)
}
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)

    const eps = result.surfaces[0].endpoints
    expect(eps).toHaveLength(4)

    expect(eps[0]).toMatchObject({ httpMethod: 'GET', path: '/users' })
    expect(eps[1]).toMatchObject({ httpMethod: 'POST', path: '/users' })
    expect(eps[2]).toMatchObject({ httpMethod: 'GET', path: '/users/{id}' })
    expect(eps[2].parameters).toEqual([{ name: 'id', location: 'path', required: true }])
    expect(eps[3]).toMatchObject({ httpMethod: 'DELETE', path: '/users/{id}' })
  })

  it('handles PathPrefix subrouters with prefixes', async () => {
    const extractor = makeExtractor({
      'router.go': `
package main

import "github.com/gorilla/mux"

func setupRoutes() *mux.Router {
    r := mux.NewRouter()
    api := r.PathPrefix("/api/v1").Subrouter()
    api.HandleFunc("/users", listUsers).Methods("GET")
    api.HandleFunc("/products", listProducts).Methods("GET")
    return r
}
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)

    const eps = result.surfaces[0].endpoints
    expect(eps).toHaveLength(2)
    expect(eps[0]).toMatchObject({ path: '/api/v1/users', httpMethod: 'GET' })
    expect(eps[1]).toMatchObject({ path: '/api/v1/products', httpMethod: 'GET' })
  })

  it('returns empty surfaces when no mux.NewRouter is found', async () => {
    const extractor = makeExtractor({
      'handler.go': `
package main

func doSomething() {}
`,
    })
    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(0)
  })
})
