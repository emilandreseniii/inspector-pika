import { describe, it, expect, vi } from 'vitest'
import { FluentExtractor } from '../fluent'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): FluentExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Swift', approach: 'fluent', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new FluentExtractor(ctx)
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

describe('FluentExtractor', () => {
  it('extracts Fluent Model fields and relationships', async () => {
    const extractor = makeExtractor({
      'Sources/App/Models/User.swift': `
import Fluent
import Vapor

final class User: Model, Content {
    static let schema = "users"

    @ID(key: .id)
    var id: UUID?

    @Field(key: "name")
    var name: String

    @Field(key: "email")
    var email: String

    @OptionalField(key: "age")
    var age: Int?

    @Parent(key: "role_id")
    var role: Role

    @Children(for: \\.$user)
    var posts: [Post]

    init() {}
}
`,
    })

    const result = await extractor.extract()
    expect(result.entities).toHaveLength(1)

    const entity = result.entities[0]
    expect(entity.name).toBe('users')

    const id = entity.fields.find((f) => f.name === 'id')
    expect(id?.isPrimaryKey).toBe(true)
    expect(id?.type).toBe('uuid')

    const age = entity.fields.find((f) => f.name === 'age')
    expect(age?.nullable).toBe(true)

    expect(entity.relationships).toHaveLength(2)
    const parent = entity.relationships.find((r) => r.type === 'many_to_one')
    expect(parent?.targetEntity).toBe('Role')
  })

  it('returns empty for non-Fluent files', async () => {
    const extractor = makeExtractor({
      'Sources/App/Foo.swift': `import Foundation\nstruct Foo {}\n`,
    })
    const result = await extractor.extract()
    expect(result.entities).toHaveLength(0)
  })
})
