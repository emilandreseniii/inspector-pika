import { describe, it, expect, vi } from 'vitest'
import { SequelizeExtractor } from '../sequelize'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): SequelizeExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'TypeScript', approach: 'sequelize', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new SequelizeExtractor(ctx)
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

describe('SequelizeExtractor', () => {
  describe('Model.init() pattern', () => {
    it('extracts entity from class Model.init()', async () => {
      const extractor = makeExtractor({
        'user.model.ts': `
import { Model, DataTypes, Sequelize } from 'sequelize'

class User extends Model {
  declare id: number
  declare email: string
  declare name: string | null
}

User.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  name: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
}, { sequelize, tableName: 'users' })
`,
      })

      const result = await extractor.extract()
      expect(result.entities).toHaveLength(1)

      const user = result.entities[0]
      expect(user.name).toBe('User')
      expect(user.tableName).toBe('users')
      expect(user.entityType).toBe('table')

      const id = user.fields.find((f) => f.name === 'id')
      expect(id?.isPK).toBe(true)
      expect(id?.nullable).toBe(false)
      expect(id?.type).toBe('integer')

      const email = user.fields.find((f) => f.name === 'email')
      expect(email?.isUnique).toBe(true)
      expect(email?.nullable).toBe(false)
      expect(email?.type).toBe('string')

      const name = user.fields.find((f) => f.name === 'name')
      expect(name?.nullable).toBe(true)
    })
  })

  describe('sequelize.define() pattern', () => {
    it('extracts entity from sequelize.define()', async () => {
      const extractor = makeExtractor({
        'post.model.js': `
const { DataTypes } = require('sequelize')

const Post = sequelize.define('Post', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  content: DataTypes.TEXT,
}, {
  tableName: 'posts',
})
`,
      })

      const result = await extractor.extract()
      expect(result.entities).toHaveLength(1)

      const post = result.entities[0]
      expect(post.name).toBe('Post')
      expect(post.tableName).toBe('posts')

      const title = post.fields.find((f) => f.name === 'title')
      expect(title?.nullable).toBe(false)
      expect(title?.type).toBe('string')

      // Shorthand field
      const content = post.fields.find((f) => f.name === 'content')
      expect(content?.type).toBe('string')
    })
  })

  describe('column names', () => {
    it('uses field option as column name', async () => {
      const extractor = makeExtractor({
        'model.ts': `
class MyModel extends Model {}
MyModel.init({
  id: { type: DataTypes.INTEGER, primaryKey: true },
  firstName: {
    type: DataTypes.STRING,
    field: 'first_name',
    allowNull: false,
  },
}, { sequelize })
`,
      })

      const result = await extractor.extract()
      const field = result.entities[0].fields.find((f) => f.name === 'firstName')
      expect(field?.columnName).toBe('first_name')
    })

    it('converts camelCase to snake_case by default', async () => {
      const extractor = makeExtractor({
        'model.ts': `
class MyModel extends Model {}
MyModel.init({
  id: { type: DataTypes.INTEGER, primaryKey: true },
  createdAt: { type: DataTypes.DATE, allowNull: false },
}, { sequelize })
`,
      })

      const result = await extractor.extract()
      const field = result.entities[0].fields.find((f) => f.name === 'createdAt')
      expect(field?.columnName).toBe('created_at')
    })
  })

  describe('field types', () => {
    it('maps DataTypes to normalized types', async () => {
      const extractor = makeExtractor({
        'model.ts': `
class M extends Model {}
M.init({
  a: { type: DataTypes.STRING },
  b: { type: DataTypes.INTEGER },
  c: { type: DataTypes.BOOLEAN },
  d: { type: DataTypes.DATE },
  e: { type: DataTypes.FLOAT },
  f: { type: DataTypes.JSON },
  g: { type: DataTypes.UUID },
}, { sequelize })
`,
      })

      const result = await extractor.extract()
      const m = result.entities[0]
      const typeMap: Record<string, string> = {}
      for (const f of m.fields) typeMap[f.name] = f.type ?? ''

      expect(typeMap['a']).toBe('string')
      expect(typeMap['b']).toBe('integer')
      expect(typeMap['c']).toBe('boolean')
      expect(typeMap['d']).toBe('datetime')
      expect(typeMap['e']).toBe('float')
      expect(typeMap['f']).toBe('json')
      expect(typeMap['g']).toBe('uuid')
    })
  })

  describe('stats', () => {
    it('reports correct stats', async () => {
      const extractor = makeExtractor({
        'models.ts': `
const A = sequelize.define('A', { id: { type: DataTypes.INTEGER, primaryKey: true } })
const B = sequelize.define('B', { id: { type: DataTypes.INTEGER, primaryKey: true } })
`,
      })

      const result = await extractor.extract()
      expect(result.stats.filesScanned).toBe(1)
      expect(result.stats.entitiesFound).toBe(2)
    })
  })
})
