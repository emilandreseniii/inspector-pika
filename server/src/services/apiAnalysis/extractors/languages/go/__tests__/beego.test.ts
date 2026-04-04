import { describe, it, expect, vi } from 'vitest'
import { BeegoExtractor } from '../beego'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): BeegoExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Go', approach: 'beego', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new BeegoExtractor(ctx)
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

describe('BeegoExtractor', () => {
  it('extracts routes from beego.Router calls', async () => {
    const extractor = makeExtractor({
      'routers/router.go': `
package routers

import (
    "github.com/beego/beego/v2/server/web"
    beego "github.com/beego/beego/v2/server/web"
    _ "myapp/routers"
)

func init() {
    beego.Router("/users", &controllers.UserController{})
    beego.Router("/users/:id", &controllers.UserController{}, "get:Get;post:Post;delete:Delete")
    web.Router("/posts", &controllers.PostController{})
}
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)

    const surface = result.surfaces[0]

    // /users should have all default methods
    const getUsersAll = surface.endpoints.filter((e) => e.path === '/users')
    expect(getUsersAll.length).toBeGreaterThan(0)

    // /users/:id should have only GET, POST, DELETE
    const getUserById = surface.endpoints.filter((e) => e.path === '/users/:id')
    expect(getUserById.map((e) => e.httpMethod).sort()).toEqual(['DELETE', 'GET', 'POST'])

    const getParam = getUserById.find((e) => e.httpMethod === 'GET')
    expect(getParam?.parameters[0].name).toBe('id')

    // /posts default methods
    const getPosts = surface.endpoints.find((e) => e.path === '/posts' && e.httpMethod === 'GET')
    expect(getPosts).toBeDefined()
  })

  it('returns empty when no beego/web router calls', async () => {
    const extractor = makeExtractor({
      'main.go': `
package main

import "fmt"

func main() {
    fmt.Println("hello")
}
`,
    })
    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(0)
  })
})
