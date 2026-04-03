import { describe, it, expect, vi } from 'vitest'
import { DrizzleExtractor } from '../drizzle'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): DrizzleExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'TypeScript', approach: 'drizzle_orm', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new DrizzleExtractor(ctx)
  vi.spyOn(extractor as any, 'grep').mockImplementation(async (_glob: string, pattern: RegExp) => {
    const hits: Array<{ file: string; line: number; text: string }> = []
    for (const [file, content] of Object.entries(files)) {
      content.split('\n').forEach((text, i) => {
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

describe('DrizzleExtractor', () => {
  describe('pgTable extraction', () => {
    it('extracts tables from pgTable definitions', async () => {
      const extractor = makeExtractor({
        'schema.ts': `
import { pgTable, serial, text, varchar, boolean, timestamp } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: text('name'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})
`,
      })

      const result = await extractor.extract()
      expect(result.entities).toHaveLength(1)

      const users = result.entities[0]
      expect(users.name).toBe('users')
      expect(users.tableName).toBe('users')
      expect(users.entityType).toBe('table')

      const id = users.fields.find((f) => f.name === 'id')
      expect(id?.isPK).toBe(true)
      expect(id?.nullable).toBe(false)
      expect(id?.type).toBe('integer')

      const email = users.fields.find((f) => f.name === 'email')
      expect(email?.isUnique).toBe(true)
      expect(email?.type).toBe('string')
      expect(email?.columnName).toBe('email')

      const name = users.fields.find((f) => f.name === 'name')
      expect(name?.nullable).toBe(null)  // not .notNull()
    })
  })

  describe('mysqlTable extraction', () => {
    it('extracts tables from mysqlTable definitions', async () => {
      const extractor = makeExtractor({
        'schema.ts': `
import { mysqlTable, int, varchar, text } from 'drizzle-orm/mysql-core'

export const products = mysqlTable('products', {
  id: int('id').primaryKey().autoincrement(),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
})
`,
      })

      const result = await extractor.extract()
      expect(result.entities).toHaveLength(1)
      const products = result.entities[0]
      expect(products.name).toBe('products')
      expect(products.tableName).toBe('products')
    })
  })

  describe('sqliteTable extraction', () => {
    it('extracts tables from sqliteTable definitions', async () => {
      const extractor = makeExtractor({
        'schema.ts': `
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'

export const todos = sqliteTable('todos', {
  id: integer('id').primaryKey(),
  content: text('content').notNull(),
  completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
})
`,
      })

      const result = await extractor.extract()
      expect(result.entities).toHaveLength(1)
      expect(result.entities[0].name).toBe('todos')
      expect(result.entities[0].tableName).toBe('todos')
    })
  })

  describe('column names', () => {
    it('extracts column name from first argument of column function', async () => {
      const extractor = makeExtractor({
        'schema.ts': `
import { pgTable, serial, text } from 'drizzle-orm/pg-core'

export const posts = pgTable('posts', {
  id: serial('id').primaryKey(),
  createdAt: text('created_at').notNull(),
})
`,
      })

      const result = await extractor.extract()
      const posts = result.entities[0]
      expect(posts.fields.find((f) => f.name === 'createdAt')?.columnName).toBe('created_at')
    })
  })

  describe('column types', () => {
    it('maps Drizzle types to normalized types', async () => {
      const extractor = makeExtractor({
        'schema.ts': `
import { pgTable, serial, text, boolean, timestamp, uuid, json, real } from 'drizzle-orm/pg-core'

export const items = pgTable('items', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  active: boolean('active').notNull(),
  score: real('score'),
  meta: json('meta'),
  createdAt: timestamp('created_at').notNull(),
})
`,
      })

      const result = await extractor.extract()
      const item = result.entities[0]
      const typeMap: Record<string, string> = {}
      for (const f of item.fields) typeMap[f.name] = f.type ?? ''

      expect(typeMap['name']).toBe('string')
      expect(typeMap['active']).toBe('boolean')
      expect(typeMap['score']).toBe('float')
      expect(typeMap['meta']).toBe('json')
      expect(typeMap['createdAt']).toBe('datetime')
    })
  })

  describe('multiple tables', () => {
    it('extracts multiple tables from one file', async () => {
      const extractor = makeExtractor({
        'schema.ts': `
import { pgTable, serial, text, integer } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull(),
})

export const posts = pgTable('posts', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  authorId: integer('author_id').notNull(),
})
`,
      })

      const result = await extractor.extract()
      expect(result.entities).toHaveLength(2)
      expect(result.entities.map((e) => e.name)).toContain('users')
      expect(result.entities.map((e) => e.name)).toContain('posts')
    })
  })

  describe('stats', () => {
    it('reports correct stats', async () => {
      const extractor = makeExtractor({
        'a.ts': `
import { pgTable, serial } from 'drizzle-orm/pg-core'
export const a = pgTable('a', { id: serial('id').primaryKey() })
export const b = pgTable('b', { id: serial('id').primaryKey() })
`,
      })

      const result = await extractor.extract()
      expect(result.stats.filesScanned).toBe(1)
      expect(result.stats.entitiesFound).toBe(2)
    })
  })
})
