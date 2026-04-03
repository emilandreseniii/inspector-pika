import { describe, it, expect, vi } from 'vitest'
import { TortoiseOrmExtractor } from '../tortoiseOrm'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): TortoiseOrmExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Python', approach: 'tortoise_orm', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new TortoiseOrmExtractor(ctx)

  vi.spyOn(extractor as any, 'glob').mockImplementation(async () => Object.keys(files))
  vi.spyOn(extractor as any, 'readFile').mockImplementation(async (path: string) => {
    if (files[path] === undefined) throw new Error(`File not found: ${path}`)
    return files[path]
  })
  return extractor
}

describe('TortoiseOrmExtractor', () => {
  describe('basic model extraction', () => {
    it('extracts a simple Tortoise model', async () => {
      const extractor = makeExtractor({
        'models.py': `
from tortoise import fields, models

class Tournament(models.Model):
    id = fields.IntField(pk=True)
    name = fields.CharField(max_length=255)
    created_at = fields.DatetimeField(auto_now_add=True)

    class Meta:
        table = "tournaments"
`,
      })

      const result = await extractor.extract()
      expect(result.entities).toHaveLength(1)

      const entity = result.entities[0]
      expect(entity.name).toBe('tournaments')
      expect(entity.entityType).toBe('table')
      expect(entity.extractorId).toBe('python.tortoise_orm')
      expect(entity.metadata.pythonClass).toBe('Tournament')

      const fieldNames = entity.fields.map((f) => f.name)
      expect(fieldNames).toContain('id')
      expect(fieldNames).toContain('name')
      expect(fieldNames).toContain('created_at')
    })

    it('derives table name from class name when Meta.table is absent', async () => {
      const extractor = makeExtractor({
        'models.py': `
from tortoise import models, fields

class UserProfile(models.Model):
    id = fields.IntField(pk=True)
    bio = fields.TextField(null=True)
`,
      })

      const result = await extractor.extract()
      expect(result.entities[0].name).toBe('user_profile')
    })

    it('skips files that do not import tortoise', async () => {
      const extractor = makeExtractor({
        'other.py': `
class Foo(Model):
    name = fields.CharField()
`,
      })

      const result = await extractor.extract()
      expect(result.entities).toHaveLength(0)
    })
  })

  describe('field extraction', () => {
    it('marks pk=True field as primary key', async () => {
      const extractor = makeExtractor({
        'models.py': `
from tortoise import models, fields

class Item(models.Model):
    id = fields.IntField(pk=True)
    name = fields.CharField(max_length=100)
`,
      })

      const result = await extractor.extract()
      const idField = result.entities[0].fields.find((f) => f.name === 'id')
      expect(idField?.isPrimaryKey).toBe(true)
      expect(idField?.nullable).toBe(false)
    })

    it('extracts nullable from null=True/False', async () => {
      const extractor = makeExtractor({
        'models.py': `
from tortoise import models, fields

class Event(models.Model):
    id = fields.IntField(pk=True)
    description = fields.TextField(null=True)
    required_field = fields.CharField(max_length=50, null=False)
`,
      })

      const result = await extractor.extract()
      const fields = result.entities[0].fields
      expect(fields.find((f) => f.name === 'description')?.nullable).toBe(true)
      expect(fields.find((f) => f.name === 'required_field')?.nullable).toBe(false)
    })

    it('extracts max_length metadata', async () => {
      const extractor = makeExtractor({
        'models.py': `
from tortoise import models, fields

class Tag(models.Model):
    id = fields.IntField(pk=True)
    name = fields.CharField(max_length=50)
`,
      })

      const result = await extractor.extract()
      const nameField = result.entities[0].fields.find((f) => f.name === 'name')
      expect(nameField?.metadata.maxLength).toBe(50)
    })
  })

  describe('relationship extraction', () => {
    it('extracts ForeignKeyField as many_to_one', async () => {
      const extractor = makeExtractor({
        'models.py': `
from tortoise import models, fields

class Event(models.Model):
    id = fields.IntField(pk=True)
    tournament = fields.ForeignKeyField("models.Tournament", related_name="events")
`,
      })

      const result = await extractor.extract()
      const rel = result.entities[0].relationships[0]
      expect(rel.type).toBe('many_to_one')
      expect(rel.targetEntity).toBe('tournament')
      expect(rel.sourceField).toBe('tournament_id')
    })

    it('extracts ManyToManyField', async () => {
      const extractor = makeExtractor({
        'models.py': `
from tortoise import models, fields

class Post(models.Model):
    id = fields.IntField(pk=True)
    tags = fields.ManyToManyField("models.Tag", related_name="posts")
`,
      })

      const result = await extractor.extract()
      const rel = result.entities[0].relationships[0]
      expect(rel.type).toBe('many_to_many')
      expect(rel.targetEntity).toBe('tag')
    })
  })

  describe('abstract models', () => {
    it('skips abstract models', async () => {
      const extractor = makeExtractor({
        'models.py': `
from tortoise import models, fields

class BaseModel(models.Model):
    id = fields.IntField(pk=True)
    created_at = fields.DatetimeField(auto_now_add=True)

    class Meta:
        abstract = True

class Article(models.Model):
    id = fields.IntField(pk=True)
    title = fields.CharField(max_length=200)
`,
      })

      const result = await extractor.extract()
      // BaseModel should be skipped (abstract), Article should be included
      expect(result.entities).toHaveLength(1)
      expect(result.entities[0].metadata.pythonClass).toBe('Article')
    })
  })

  describe('stats', () => {
    it('reports correct stats', async () => {
      const extractor = makeExtractor({
        'a/models.py': `
from tortoise import models, fields

class A(models.Model):
    id = fields.IntField(pk=True)
`,
        'b/models.py': `
from tortoise import models, fields

class B(models.Model):
    id = fields.IntField(pk=True)
`,
        'other.py': 'print("hello")',
      })

      const result = await extractor.extract()
      expect(result.stats.filesScanned).toBe(2)
      expect(result.stats.entitiesFound).toBe(2)
    })
  })
})
