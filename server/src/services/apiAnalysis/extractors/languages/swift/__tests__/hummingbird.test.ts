import { describe, it, expect, vi } from 'vitest'
import { HummingbirdExtractor } from '../hummingbird'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): HummingbirdExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Swift', approach: 'hummingbird', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new HummingbirdExtractor(ctx)
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

describe('HummingbirdExtractor', () => {
  it('extracts routes from Hummingbird router', async () => {
    const extractor = makeExtractor({
      'Sources/App/Application+build.swift': `
import Hummingbird

func buildApplication() -> some ApplicationProtocol {
    let app = HBApplication()

    app.router.get("/users") { _ in
        return [User]()
    }

    app.router.post("/users") { request in
        return HTTPResponse.Status.created
    }

    app.router.get("/users/:id") { request in
        let id = request.parameters.get("id")!
        return User(id: id)
    }

    return app
}
`,
    })

    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(1)

    const surface = result.surfaces[0]

    const getUsers = surface.endpoints.find((e) => e.httpMethod === 'GET' && e.path === '/users')
    expect(getUsers).toBeDefined()

    const postUsers = surface.endpoints.find((e) => e.httpMethod === 'POST' && e.path === '/users')
    expect(postUsers).toBeDefined()

    const getUserById = surface.endpoints.find((e) => e.path === '/users/{id}')
    expect(getUserById).toBeDefined()
    expect(getUserById?.parameters[0].name).toBe('id')
  })

  it('returns empty for non-Hummingbird files', async () => {
    const extractor = makeExtractor({
      'Sources/App/Foo.swift': `import Foundation\nstruct Foo {}\n`,
    })
    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(0)
  })
})
