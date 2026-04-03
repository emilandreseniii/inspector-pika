import { describe, it, expect, vi } from 'vitest'
import { ActiveRecordExtractor } from '../activeRecord'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): ActiveRecordExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Ruby', approach: 'active_record', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new ActiveRecordExtractor(ctx)
  vi.spyOn(extractor as any, 'glob').mockImplementation(async (pattern: string) => {
    return Object.keys(files).filter((f) => {
      if (pattern === '**/db/schema.rb') return f.includes('db/schema.rb')
      if (pattern === 'app/models/**/*.rb') return f.startsWith('app/models/')
      if (pattern === '**/db/migrate/*.rb') return f.includes('db/migrate/')
      return false
    })
  })
  vi.spyOn(extractor as any, 'readFile').mockImplementation(async (path: string) => {
    if (files[path] === undefined) throw new Error(`File not found: ${path}`)
    return files[path]
  })
  return extractor
}

describe('ActiveRecordExtractor', () => {
  describe('schema.rb parsing', () => {
    it('extracts tables and columns from schema.rb', async () => {
      const extractor = makeExtractor({
        'db/schema.rb': `
ActiveRecord::Schema[7.0].define(version: 2024_01_01_000000) do
  create_table "users", force: :cascade do |t|
    t.string "email", null: false
    t.string "name"
    t.boolean "admin", default: false
    t.timestamps
  end

  create_table "posts", force: :cascade do |t|
    t.string "title", null: false
    t.text "body"
    t.integer "user_id"
  end
end
`,
      })

      const result = await extractor.extract()
      expect(result.entities).toHaveLength(2)

      const users = result.entities.find((e) => e.name === 'users')
      expect(users).toBeDefined()
      expect(users!.entityType).toBe('table')

      const emailField = users!.fields.find((f) => f.name === 'email')
      expect(emailField).toBeDefined()
      expect(emailField!.type).toBe('string')
      expect(emailField!.nullable).toBe(false)

      const nameField = users!.fields.find((f) => f.name === 'name')
      expect(nameField!.nullable).toBe(true)

      const posts = result.entities.find((e) => e.name === 'posts')
      expect(posts!.fields.find((f) => f.name === 'title')).toBeDefined()
    })

    it('marks id column as primary key', async () => {
      const extractor = makeExtractor({
        'db/schema.rb': `
ActiveRecord::Schema[7.0].define do
  create_table "products", force: :cascade do |t|
    t.string "name"
  end
end
`,
      })

      const result = await extractor.extract()
      const product = result.entities[0]
      const idField = product.fields.find((f) => f.name === 'id')
      expect(idField).toBeDefined()
      expect(idField!.isPrimaryKey).toBe(true)
    })

    it('detects unique index', async () => {
      const extractor = makeExtractor({
        'db/schema.rb': `
ActiveRecord::Schema[7.0].define do
  create_table "users", force: :cascade do |t|
    t.string "email"
    t.index ["email"], name: "index_users_on_email", unique: true
  end
end
`,
      })

      const result = await extractor.extract()
      const users = result.entities[0]
      const emailField = users.fields.find((f) => f.name === 'email')
      expect(emailField!.isUnique).toBe(true)
    })
  })

  describe('model association parsing', () => {
    it('extracts belongs_to, has_many, has_one associations', async () => {
      const extractor = makeExtractor({
        'db/schema.rb': `
ActiveRecord::Schema[7.0].define do
  create_table "posts", force: :cascade do |t|
    t.string "title"
    t.integer "user_id"
  end
end
`,
        'app/models/post.rb': `
class Post < ApplicationRecord
  belongs_to :user
  has_many :comments
  has_one :featured_image
end
`,
      })

      const result = await extractor.extract()
      const post = result.entities.find((e) => e.name === 'posts')
      expect(post).toBeDefined()

      const belongs = post!.relationships.find((r) => r.type === 'many_to_one')
      expect(belongs?.targetEntity).toBe('User')

      const hasMany = post!.relationships.find((r) => r.type === 'one_to_many')
      expect(hasMany?.targetEntity).toBe('Comment')

      const hasOne = post!.relationships.find((r) => r.type === 'one_to_one')
      expect(hasOne?.targetEntity).toBe('FeaturedImage')
    })
  })

  describe('migration fallback', () => {
    it('falls back to migrations when no schema.rb', async () => {
      const extractor = makeExtractor({
        'db/migrate/20240101000000_create_users.rb': `
class CreateUsers < ActiveRecord::Migration[7.0]
  def change
    create_table :users do |t|
      t.string :email, null: false
      t.string :name
      t.timestamps
    end
  end
end
`,
      })

      const result = await extractor.extract()
      expect(result.entities).toHaveLength(1)
      expect(result.entities[0].name).toBe('users')
      expect(result.entities[0].fields.find((f) => f.name === 'email')).toBeDefined()
    })
  })
})
