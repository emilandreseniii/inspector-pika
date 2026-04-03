import { describe, it, expect, vi } from 'vitest'
import { SequelExtractor } from '../sequel'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): SequelExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Ruby', approach: 'sequel', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new SequelExtractor(ctx)
  vi.spyOn(extractor as any, 'glob').mockImplementation(async () => Object.keys(files))
  vi.spyOn(extractor as any, 'readFile').mockImplementation(async (path: string) => {
    if (files[path] === undefined) throw new Error(`File not found: ${path}`)
    return files[path]
  })
  return extractor
}

describe('SequelExtractor', () => {
  it('extracts tables from DB.create_table blocks', async () => {
    const extractor = makeExtractor({
      'db/schema.rb': `
DB.create_table(:users) do
  primary_key :id
  String :email, null: false
  String :name
  Integer :age
  TrueClass :admin, default: false
end

DB.create_table(:posts) do
  primary_key :id
  String :title, null: false
  String :body
end
`,
    })

    const result = await extractor.extract()
    expect(result.entities).toHaveLength(2)

    const users = result.entities.find((e) => e.name === 'users')
    expect(users).toBeDefined()
    expect(users!.entityType).toBe('table')

    const id = users!.fields.find((f) => f.name === 'id')
    expect(id!.isPrimaryKey).toBe(true)

    const email = users!.fields.find((f) => f.name === 'email')
    expect(email!.type).toBe('string')
    expect(email!.nullable).toBe(false)

    const name = users!.fields.find((f) => f.name === 'name')
    expect(name!.nullable).toBe(true)
  })

  it('extracts associations from Sequel::Model subclasses', async () => {
    const extractor = makeExtractor({
      'models/post.rb': `
DB.create_table(:posts) do
  primary_key :id
  String :title
end

class Post < Sequel::Model
  many_to_one :user
  one_to_many :comments
end
`,
    })

    const result = await extractor.extract()
    const post = result.entities.find((e) => e.name === 'posts')
    expect(post).toBeDefined()

    const manyToOne = post!.relationships.find((r) => r.type === 'many_to_one')
    expect(manyToOne?.targetEntity).toBe('User')

    const oneToMany = post!.relationships.find((r) => r.type === 'one_to_many')
    expect(oneToMany?.targetEntity).toBe('Comment')
  })

  it('handles column syntax', async () => {
    const extractor = makeExtractor({
      'db/schema.rb': `
DB.create_table(:products) do
  primary_key :id
  column :name, String
  column :price, Numeric
  column :in_stock, TrueClass
end
`,
    })

    const result = await extractor.extract()
    const products = result.entities.find((e) => e.name === 'products')
    expect(products!.fields.find((f) => f.name === 'name' && f.type === 'string')).toBeDefined()
    expect(products!.fields.find((f) => f.name === 'price' && f.type === 'decimal')).toBeDefined()
  })
})
