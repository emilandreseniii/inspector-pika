import { describe, it, expect, vi } from 'vitest'
import { RomExtractor } from '../rom'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): RomExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Ruby', approach: 'rom', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new RomExtractor(ctx)
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

describe('RomExtractor', () => {
  it('extracts attributes from a ROM relation', async () => {
    const extractor = makeExtractor({
      'lib/relations/users.rb': `
module Relations
  class Users < ROM::Relation[:sql]
    schema(:users) do
      attribute :id, Types::Serial
      attribute :name, Types::String
      attribute :email, Types::String
      attribute :age, Types::Integer.optional
      attribute :created_at, Types::DateTime
    end
  end
end
`,
    })

    const result = await extractor.extract()
    expect(result.entities).toHaveLength(1)

    const entity = result.entities[0]
    expect(entity.name).toBe('Users')
    expect(entity.tableName).toBe('users')

    const id = entity.fields.find((f) => f.name === 'id')
    expect(id?.isPrimaryKey).toBe(true)
    expect(id?.dataType).toBe('integer')

    const name = entity.fields.find((f) => f.name === 'name')
    expect(name?.dataType).toBe('string')

    const age = entity.fields.find((f) => f.name === 'age')
    expect(age?.isNullable).toBe(true)
  })

  it('returns empty when no ROM::Relation classes', async () => {
    const extractor = makeExtractor({
      'app/models/user.rb': `
class User < ApplicationRecord
end
`,
    })
    const result = await extractor.extract()
    expect(result.entities).toHaveLength(0)
  })
})
