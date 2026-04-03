import { describe, it, expect, vi } from 'vitest'
import { PeeweeExtractor } from '../peewee'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): PeeweeExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Python', approach: 'peewee', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new PeeweeExtractor(ctx)

  vi.spyOn(extractor as any, 'glob').mockImplementation(async () => Object.keys(files))
  vi.spyOn(extractor as any, 'readFile').mockImplementation(async (path: string) => {
    if (files[path] === undefined) throw new Error(`File not found: ${path}`)
    return files[path]
  })
  return extractor
}

describe('PeeweeExtractor', () => {
  describe('basic model extraction', () => {
    it('extracts a simple Peewee model', async () => {
      const extractor = makeExtractor({
        'models.py': `
from peewee import *

class Person(Model):
    name = CharField(max_length=100)
    birthday = DateField()
    is_active = BooleanField(default=True)

    class Meta:
        table_name = "persons"
`,
      })

      const result = await extractor.extract()
      expect(result.entities).toHaveLength(1)

      const entity = result.entities[0]
      expect(entity.name).toBe('persons')
      expect(entity.entityType).toBe('table')
      expect(entity.extractorId).toBe('python.peewee')
      expect(entity.metadata.pythonClass).toBe('Person')

      const fieldNames = entity.fields.map((f) => f.name)
      expect(fieldNames).toContain('name')
      expect(fieldNames).toContain('birthday')
      expect(fieldNames).toContain('is_active')
    })

    it('derives table name from class name when Meta.table_name is absent', async () => {
      const extractor = makeExtractor({
        'models.py': `
from peewee import Model, CharField

class BlogPost(Model):
    title = CharField()
`,
      })

      const result = await extractor.extract()
      expect(result.entities[0].name).toBe('blog_post')
    })

    it('skips files that do not import peewee', async () => {
      const extractor = makeExtractor({
        'other.py': `
class Foo(Model):
    name = CharField()
`,
      })

      const result = await extractor.extract()
      expect(result.entities).toHaveLength(0)
    })
  })

  describe('field extraction', () => {
    it('marks AutoField as primary key', async () => {
      const extractor = makeExtractor({
        'models.py': `
from peewee import Model, AutoField, CharField

class User(Model):
    id = AutoField()
    username = CharField(max_length=50, unique=True)
`,
      })

      const result = await extractor.extract()
      const idField = result.entities[0].fields.find((f) => f.name === 'id')
      expect(idField?.isPrimaryKey).toBe(true)

      const userField = result.entities[0].fields.find((f) => f.name === 'username')
      expect(userField?.isUnique).toBe(true)
    })

    it('marks primary_key=True field as PK', async () => {
      const extractor = makeExtractor({
        'models.py': `
from peewee import Model, IntegerField

class Item(Model):
    item_id = IntegerField(primary_key=True)
    name = IntegerField()
`,
      })

      const result = await extractor.extract()
      const pkField = result.entities[0].fields.find((f) => f.name === 'item_id')
      expect(pkField?.isPrimaryKey).toBe(true)
    })

    it('extracts null=True as nullable', async () => {
      const extractor = makeExtractor({
        'models.py': `
from peewee import Model, CharField, TextField

class Article(Model):
    title = CharField()
    summary = TextField(null=True)
`,
      })

      const result = await extractor.extract()
      const summaryField = result.entities[0].fields.find((f) => f.name === 'summary')
      expect(summaryField?.nullable).toBe(true)
    })

    it('uses column_name for column name override', async () => {
      const extractor = makeExtractor({
        'models.py': `
from peewee import Model, CharField

class Product(Model):
    product_name = CharField(column_name="name")
`,
      })

      const result = await extractor.extract()
      const field = result.entities[0].fields.find((f) => f.name === 'name')
      expect(field).toBeDefined()
    })
  })

  describe('relationship extraction', () => {
    it('extracts ForeignKeyField as many_to_one', async () => {
      const extractor = makeExtractor({
        'models.py': `
from peewee import Model, ForeignKeyField, CharField

class Tweet(Model):
    user = ForeignKeyField(User, backref="tweets")
    content = CharField()
`,
      })

      const result = await extractor.extract()
      const rel = result.entities[0].relationships[0]
      expect(rel.type).toBe('many_to_one')
      expect(rel.targetEntity).toBe('user')
      expect(rel.sourceField).toBe('user_id')
      expect(rel.metadata.backref).toBe('tweets')
    })

    it('extracts ManyToManyField', async () => {
      const extractor = makeExtractor({
        'models.py': `
from peewee import Model, ManyToManyField

class Post(Model):
    tags = ManyToManyField(Tag, backref="posts")
`,
      })

      const result = await extractor.extract()
      const rel = result.entities[0].relationships[0]
      expect(rel.type).toBe('many_to_many')
    })
  })

  describe('stats', () => {
    it('reports correct stats', async () => {
      const extractor = makeExtractor({
        'models.py': `
from peewee import Model, CharField

class A(Model):
    name = CharField()

class B(Model):
    title = CharField()
`,
        'other.py': 'print("hello")',
      })

      const result = await extractor.extract()
      expect(result.stats.filesScanned).toBe(1)
      expect(result.stats.entitiesFound).toBe(2)
    })
  })
})
