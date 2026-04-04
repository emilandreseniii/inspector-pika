import { describe, it, expect, vi } from 'vitest'
import { GrdbExtractor } from '../grdb'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): GrdbExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Swift', approach: 'grdb', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new GrdbExtractor(ctx)
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

describe('GrdbExtractor', () => {
  it('extracts fields from FetchableRecord/PersistableRecord structs', async () => {
    const extractor = makeExtractor({
      'Sources/App/Models/User.swift': `
import GRDB

struct User: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "users"
    var id: Int64
    var name: String
    var email: String?
    var createdAt: Date
}
`,
    })

    const result = await extractor.extract()
    expect(result.entities).toHaveLength(1)

    const entity = result.entities[0]
    expect(entity.name).toBe('users')
    expect(entity.fields).toHaveLength(4)

    const id = entity.fields.find((f) => f.name === 'id')
    expect(id?.isPrimaryKey).toBe(true)
    expect(id?.type).toBe('bigint')

    const email = entity.fields.find((f) => f.name === 'email')
    expect(email?.nullable).toBe(true)
  })

  it('returns empty for non-GRDB files', async () => {
    const extractor = makeExtractor({
      'Sources/App/Foo.swift': `import Foundation\nstruct Foo {}\n`,
    })
    const result = await extractor.extract()
    expect(result.entities).toHaveLength(0)
  })
})
