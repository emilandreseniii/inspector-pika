import { describe, it, expect, vi } from 'vitest'
import { VaporExtractor } from '../vapor'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): VaporExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Swift', approach: 'vapor', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new VaporExtractor(ctx)
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

describe('VaporExtractor', () => {
  it('extracts routes from Vapor app.get/post/... calls', async () => {
    const extractor = makeExtractor({
      'Sources/App/routes.swift': `
import Vapor

func routes(_ app: Application) throws {
    app.get("users") { req async throws -> [User] in
        return try await User.query(on: req.db).all()
    }

    app.post("users") { req async throws -> User in
        let user = try req.content.decode(User.self)
        try await user.save(on: req.db)
        return user
    }

    app.get("users", ":id") { req async throws -> User in
        guard let user = try await User.find(req.parameters.get("id"), on: req.db) else {
            throw Abort(.notFound)
        }
        return user
    }
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
    expect(getUserById?.httpMethod).toBe('GET')
    expect(getUserById?.parameters[0].name).toBe('id')
  })

  it('returns empty for non-Vapor files', async () => {
    const extractor = makeExtractor({
      'Sources/App/Foo.swift': `import Foundation\nstruct Foo {}\n`,
    })
    const result = await extractor.extract()
    expect(result.surfaces).toHaveLength(0)
  })
})
