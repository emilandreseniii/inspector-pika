import { describe, it, expect, vi } from 'vitest'
import { MongooseExtractor } from '../mongoose'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): MongooseExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'TypeScript', approach: 'mongoose', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new MongooseExtractor(ctx)
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

describe('MongooseExtractor', () => {
  describe('basic schema extraction', () => {
    it('extracts fields from new Schema()', async () => {
      const extractor = makeExtractor({
        'user.model.ts': `
import mongoose, { Schema } from 'mongoose'

const userSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  age: { type: Number },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
})

export const User = mongoose.model('User', userSchema)
`,
      })

      const result = await extractor.extract()
      expect(result.entities).toHaveLength(1)

      const user = result.entities[0]
      expect(user.name).toBe('User')
      expect(user.entityType).toBe('collection')

      const name = user.fields.find((f) => f.name === 'name')
      expect(name?.type).toBe('string')
      expect(name?.nullable).toBe(false)

      const email = user.fields.find((f) => f.name === 'email')
      expect(email?.isUnique).toBe(true)
      expect(email?.nullable).toBe(false)

      const age = user.fields.find((f) => f.name === 'age')
      expect(age?.type).toBe('number')
      expect(age?.nullable).toBe(null)

      const active = user.fields.find((f) => f.name === 'active')
      expect(active?.type).toBe('boolean')
    })

    it('derives entity name from schema variable name', async () => {
      const extractor = makeExtractor({
        'post.model.ts': `
const postSchema = new Schema({
  title: { type: String, required: true },
  content: String,
})

export const Post = mongoose.model('Post', postSchema)
`,
      })

      const result = await extractor.extract()
      expect(result.entities[0].name).toBe('Post')
    })

    it('handles shorthand field type syntax', async () => {
      const extractor = makeExtractor({
        'item.model.ts': `
const itemSchema = new Schema({
  name: String,
  count: Number,
  active: Boolean,
})
mongoose.model('Item', itemSchema)
`,
      })

      const result = await extractor.extract()
      const item = result.entities[0]
      expect(item.fields.find((f) => f.name === 'name')?.type).toBe('string')
      expect(item.fields.find((f) => f.name === 'count')?.type).toBe('number')
      expect(item.fields.find((f) => f.name === 'active')?.type).toBe('boolean')
    })
  })

  describe('references / relationships', () => {
    it('extracts ObjectId ref as many_to_one relationship', async () => {
      const extractor = makeExtractor({
        'post.model.ts': `
const postSchema = new Schema({
  title: { type: String, required: true },
  author: { type: Schema.Types.ObjectId, ref: 'User' },
})
mongoose.model('Post', postSchema)
`,
      })

      const result = await extractor.extract()
      const post = result.entities[0]
      const rel = post.relationships.find((r) => r.fieldName === 'author')
      expect(rel?.targetEntity).toBe('User')
      expect(rel?.cardinality).toBe('many_to_one')
    })

    it('extracts array ref as one_to_many relationship', async () => {
      const extractor = makeExtractor({
        'post.model.ts': `
const postSchema = new Schema({
  title: String,
  tags: [{ type: Schema.Types.ObjectId, ref: 'Tag' }],
})
mongoose.model('Post', postSchema)
`,
      })

      const result = await extractor.extract()
      const post = result.entities[0]
      const rel = post.relationships.find((r) => r.fieldName === 'tags')
      expect(rel?.targetEntity).toBe('Tag')
      expect(rel?.cardinality).toBe('one_to_many')
    })
  })

  describe('field types', () => {
    it('maps Mongoose types to normalized types', async () => {
      const extractor = makeExtractor({
        'model.ts': `
const s = new Schema({
  str: String,
  num: Number,
  bool: Boolean,
  dt: Date,
  buf: Buffer,
  oid: Schema.Types.ObjectId,
  dec: Schema.Types.Decimal128,
})
mongoose.model('M', s)
`,
      })

      const result = await extractor.extract()
      const m = result.entities[0]
      const typeMap: Record<string, string> = {}
      for (const f of m.fields) typeMap[f.name] = f.type ?? ''

      expect(typeMap['str']).toBe('string')
      expect(typeMap['num']).toBe('number')
      expect(typeMap['bool']).toBe('boolean')
      expect(typeMap['dt']).toBe('datetime')
      expect(typeMap['buf']).toBe('bytes')
      expect(typeMap['oid']).toBe('objectid')
      expect(typeMap['dec']).toBe('decimal')
    })
  })

  describe('mongoose.Schema prefix', () => {
    it('handles mongoose.Schema without destructuring', async () => {
      const extractor = makeExtractor({
        'model.ts': `
const userSchema = new mongoose.Schema({
  email: { type: String, required: true },
  name: String,
})
const User = mongoose.model('User', userSchema)
`,
      })

      const result = await extractor.extract()
      expect(result.entities).toHaveLength(1)
      expect(result.entities[0].fields.find((f) => f.name === 'email')?.type).toBe('string')
    })
  })

  describe('stats', () => {
    it('reports correct stats', async () => {
      const extractor = makeExtractor({
        'a.ts': `
const aSchema = new Schema({ name: String })
mongoose.model('A', aSchema)
`,
        'b.ts': `
const bSchema = new Schema({ title: String })
mongoose.model('B', bSchema)
`,
      })

      const result = await extractor.extract()
      expect(result.stats.filesScanned).toBe(2)
      expect(result.stats.entitiesFound).toBe(2)
    })
  })
})
