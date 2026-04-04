import { describe, it, expect, vi } from 'vitest'
import { MongoidExtractor } from '../mongoid'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): MongoidExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Ruby', approach: 'mongoid', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new MongoidExtractor(ctx)
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

describe('MongoidExtractor', () => {
  it('extracts fields from a Mongoid document', async () => {
    const extractor = makeExtractor({
      'app/models/user.rb': `
class User
  include Mongoid::Document
  include Mongoid::Timestamps

  store_in collection: "users"

  field :name, type: String
  field :email, type: String
  field :age, type: Integer
  field :active, type: Boolean

  has_many :posts
  belongs_to :account
end
`,
    })

    const result = await extractor.extract()
    expect(result.entities).toHaveLength(1)

    const entity = result.entities[0]
    expect(entity.name).toBe('User')
    expect(entity.tableName).toBe('users')
    expect(entity.entityType).toBe('document')

    const name = entity.fields.find((f) => f.name === 'name')
    expect(name?.dataType).toBe('string')

    const age = entity.fields.find((f) => f.name === 'age')
    expect(age?.dataType).toBe('integer')

    const hasManyRel = entity.relationships.find((r) => r.name === 'posts')
    expect(hasManyRel?.cardinality).toBe('one_to_many')

    const belongsToRel = entity.relationships.find((r) => r.name === 'account')
    expect(belongsToRel?.cardinality).toBe('many_to_one')
  })

  it('returns empty when no Mongoid::Document classes', async () => {
    const extractor = makeExtractor({
      'app/models/user.rb': `
class User < ApplicationRecord
  has_many :posts
end
`,
    })
    const result = await extractor.extract()
    expect(result.entities).toHaveLength(0)
  })
})
