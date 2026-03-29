import { describe, it, expect, vi } from 'vitest'
import { DjangoExtractor } from '../django'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): DjangoExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Python', approach: 'django_orm', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new DjangoExtractor(ctx)

  vi.spyOn(extractor as any, 'glob').mockImplementation(async () => Object.keys(files))
  vi.spyOn(extractor as any, 'readFile').mockImplementation(async (path: string) => {
    if (files[path] === undefined) throw new Error(`File not found: ${path}`)
    return files[path]
  })

  return extractor
}

describe('DjangoExtractor', () => {
  describe('basic model extraction', () => {
    it('extracts a simple Django model', async () => {
      const extractor = makeExtractor({
        'myapp/models.py': `
from django.db import models

class Article(models.Model):
    title = models.CharField(max_length=200)
    body = models.TextField()
    published = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'articles'
`,
      })

      const result = await extractor.extract()
      expect(result.entities).toHaveLength(1)

      const entity = result.entities[0]
      expect(entity.name).toBe('articles')
      expect(entity.extractorId).toBe('python.django_orm')
      expect(entity.entityType).toBe('table')
      expect(entity.metadata.pythonClass).toBe('Article')

      const fieldNames = entity.fields.map((f) => f.name)
      expect(fieldNames).toContain('title')
      expect(fieldNames).toContain('body')
      expect(fieldNames).toContain('published')
      expect(fieldNames).toContain('created_at')
    })

    it('derives table name from class name when Meta.db_table is absent', async () => {
      const extractor = makeExtractor({
        'models.py': `
class UserProfile(models.Model):
    bio = models.TextField()
`,
      })

      const result = await extractor.extract()
      expect(result.entities[0].name).toBe('user_profile')
    })

    it('uses Meta.db_table over derived name', async () => {
      const extractor = makeExtractor({
        'models.py': `
class AuthToken(models.Model):
    key = models.CharField(max_length=40)

    class Meta:
        db_table = 'auth_tokens'
`,
      })

      const result = await extractor.extract()
      expect(result.entities[0].name).toBe('auth_tokens')
    })
  })

  describe('field attributes', () => {
    it('detects nullable fields (null=True)', async () => {
      const extractor = makeExtractor({
        'models.py': `
class Event(models.Model):
    name = models.CharField(max_length=100)
    description = models.TextField(null=True, blank=True)
    starts_at = models.DateTimeField()
`,
      })

      const result = await extractor.extract()
      const entity = result.entities[0]

      const name = entity.fields.find((f) => f.name === 'name')!
      expect(name.nullable).toBe(false)

      const description = entity.fields.find((f) => f.name === 'description')!
      expect(description.nullable).toBe(true)
    })

    it('detects unique fields', async () => {
      const extractor = makeExtractor({
        'models.py': `
class User(models.Model):
    username = models.CharField(max_length=150, unique=True)
    email = models.EmailField()
`,
      })

      const result = await extractor.extract()
      const entity = result.entities[0]
      const username = entity.fields.find((f) => f.name === 'username')!
      expect(username.isUnique).toBe(true)

      const email = entity.fields.find((f) => f.name === 'email')!
      expect(email.isUnique).toBe(false)
    })

    it('uses db_column override for column name', async () => {
      const extractor = makeExtractor({
        'models.py': `
class Legacy(models.Model):
    user_name = models.CharField(max_length=50, db_column='uname')
`,
      })

      const result = await extractor.extract()
      const entity = result.entities[0]
      expect(entity.fields[0].name).toBe('uname')
    })
  })

  describe('relationships', () => {
    it('extracts ForeignKey as many_to_one', async () => {
      const extractor = makeExtractor({
        'models.py': `
class Comment(models.Model):
    post = models.ForeignKey('Post', on_delete=models.CASCADE)
    author = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
`,
      })

      const result = await extractor.extract()
      const entity = result.entities[0]
      expect(entity.relationships).toHaveLength(2)

      const post = entity.relationships.find((r) => r.targetEntity === 'post')!
      expect(post.type).toBe('many_to_one')

      const author = entity.relationships.find((r) => r.targetEntity === 'user')!
      expect(author.type).toBe('many_to_one')
    })

    it('extracts OneToOneField as one_to_one', async () => {
      const extractor = makeExtractor({
        'models.py': `
class UserProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    bio = models.TextField()
`,
      })

      const result = await extractor.extract()
      const entity = result.entities[0]
      const rel = entity.relationships[0]
      expect(rel.type).toBe('one_to_one')
      expect(rel.targetEntity).toBe('user')
    })

    it('extracts ManyToManyField as many_to_many', async () => {
      const extractor = makeExtractor({
        'models.py': `
class Post(models.Model):
    title = models.CharField(max_length=200)
    tags = models.ManyToManyField('Tag', blank=True)
`,
      })

      const result = await extractor.extract()
      const entity = result.entities[0]
      const tags = entity.relationships.find((r) => r.targetEntity === 'tag')!
      expect(tags.type).toBe('many_to_many')
    })
  })

  describe('filtering', () => {
    it('skips abstract models', async () => {
      const extractor = makeExtractor({
        'models.py': `
class TimestampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        abstract = True

class Article(models.Model):
    title = models.CharField(max_length=200)
`,
      })

      const result = await extractor.extract()
      // Abstract model should be skipped; only Article should be extracted
      expect(result.entities).toHaveLength(1)
      expect(result.entities[0].metadata.pythonClass).toBe('Article')
    })

    it('handles multiple models in one file', async () => {
      const extractor = makeExtractor({
        'models.py': `
class Category(models.Model):
    name = models.CharField(max_length=100)

class Product(models.Model):
    name = models.CharField(max_length=200)
    category = models.ForeignKey(Category, on_delete=models.CASCADE)
`,
      })

      const result = await extractor.extract()
      expect(result.entities).toHaveLength(2)
      const names = result.entities.map((e) => e.name)
      expect(names).toContain('category')
      expect(names).toContain('product')
    })

    it('returns empty for files without Django models', async () => {
      const extractor = makeExtractor({
        'views.py': `
from django.views import View
class MyView(View):
    def get(self, request):
        pass
`,
      })

      const result = await extractor.extract()
      expect(result.entities).toHaveLength(0)
    })
  })

  describe('field type coverage', () => {
    it('maps Django field types correctly', async () => {
      const extractor = makeExtractor({
        'models.py': `
class Sampler(models.Model):
    name = models.CharField(max_length=100)
    body = models.TextField()
    count = models.IntegerField()
    big = models.BigIntegerField()
    score = models.FloatField()
    price = models.DecimalField(max_digits=10, decimal_places=2)
    flag = models.BooleanField()
    born = models.DateField()
    created = models.DateTimeField()
    uid = models.UUIDField()
    data = models.JSONField()
`,
      })

      const result = await extractor.extract()
      const entity = result.entities[0]
      const byName = Object.fromEntries(entity.fields.map((f) => [f.name, f.type]))

      expect(byName['name']).toBe('CharField')
      expect(byName['body']).toBe('TextField')
      expect(byName['count']).toBe('IntegerField')
      expect(byName['big']).toBe('BigIntegerField')
      expect(byName['score']).toBe('FloatField')
      expect(byName['price']).toBe('DecimalField')
      expect(byName['flag']).toBe('BooleanField')
      expect(byName['born']).toBe('DateField')
      expect(byName['created']).toBe('DateTimeField')
      expect(byName['uid']).toBe('UUIDField')
      expect(byName['data']).toBe('JSONField')
    })
  })
})
