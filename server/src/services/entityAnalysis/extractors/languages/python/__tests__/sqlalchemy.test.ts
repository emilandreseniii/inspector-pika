import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SqlAlchemyExtractor } from '../sqlalchemy'
import type { ExtractorContext } from '../../../base'

// ---- Test fixture: helper to create extractor with mock file system ----

function makeExtractor(files: Record<string, string>): SqlAlchemyExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Python', approach: 'sqlalchemy', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new SqlAlchemyExtractor(ctx)

  // Mock glob to return our file names
  vi.spyOn(extractor as any, 'glob').mockImplementation(async () => Object.keys(files))
  // Mock readFile to return file content
  vi.spyOn(extractor as any, 'readFile').mockImplementation(async (path: string) => {
    if (files[path] === undefined) throw new Error(`File not found: ${path}`)
    return files[path]
  })

  return extractor
}

// ---- Tests ----

describe('SqlAlchemyExtractor', () => {
  describe('classic Column() style', () => {
    it('extracts a simple model with Column fields', async () => {
      const extractor = makeExtractor({
        'models/user.py': `
from sqlalchemy import Column, Integer, String, Boolean
from myapp.db import Base

class User(Base):
    __tablename__ = 'users'

    id = Column(Integer, primary_key=True)
    username = Column(String(50), nullable=False, unique=True)
    email = Column(String(255), nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)
`,
      })

      const result = await extractor.extract()
      expect(result.entities).toHaveLength(1)

      const entity = result.entities[0]
      expect(entity.name).toBe('users')
      expect(entity.extractorId).toBe('python.sqlalchemy')
      expect(entity.entityType).toBe('table')
      expect(entity.metadata.pythonClass).toBe('User')

      const fieldNames = entity.fields.map((f) => f.name)
      expect(fieldNames).toContain('id')
      expect(fieldNames).toContain('username')
      expect(fieldNames).toContain('email')
      expect(fieldNames).toContain('is_active')
    })

    it('detects primary key, nullable, and unique correctly', async () => {
      const extractor = makeExtractor({
        'models.py': `
class Order(Base):
    __tablename__ = 'orders'
    id = Column(Integer, primary_key=True)
    code = Column(String(20), nullable=False, unique=True)
    notes = Column(String, nullable=True)
    qty = Column(Integer)
`,
      })

      const result = await extractor.extract()
      const entity = result.entities[0]

      const id = entity.fields.find((f) => f.name === 'id')!
      expect(id.isPrimaryKey).toBe(true)
      expect(id.nullable).toBe(false)
      expect(id.isUnique).toBe(true)

      const code = entity.fields.find((f) => f.name === 'code')!
      expect(code.nullable).toBe(false)
      expect(code.isUnique).toBe(true)
      expect(code.isPrimaryKey).toBe(false)

      const notes = entity.fields.find((f) => f.name === 'notes')!
      expect(notes.nullable).toBe(true)

      // Default: no explicit nullable → nullable=True for non-PK
      const qty = entity.fields.find((f) => f.name === 'qty')!
      expect(qty.nullable).toBe(true)
    })

    it('detects ForeignKey columns', async () => {
      const extractor = makeExtractor({
        'models.py': `
class Post(Base):
    __tablename__ = 'posts'
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    title = Column(String(200))
`,
      })

      const result = await extractor.extract()
      const entity = result.entities[0]

      const fk = entity.fields.find((f) => f.name === 'user_id')!
      expect(fk.isForeignKey).toBe(true)
      expect(fk.nullable).toBe(false)
    })

    it('extracts relationships', async () => {
      const extractor = makeExtractor({
        'models.py': `
class User(Base):
    __tablename__ = 'users'
    id = Column(Integer, primary_key=True)
    posts = relationship('Post', back_populates='author')
    profile = relationship('Profile', uselist=False)
`,
      })

      const result = await extractor.extract()
      const entity = result.entities[0]
      expect(entity.relationships).toHaveLength(2)

      const posts = entity.relationships.find((r) => r.targetEntity === 'post')!
      expect(posts.type).toBe('one_to_many')

      const profile = entity.relationships.find((r) => r.targetEntity === 'profile')!
      expect(profile.type).toBe('one_to_one')
    })

    it('handles multi-line Column definitions', async () => {
      const extractor = makeExtractor({
        'models.py': `
class Product(Base):
    __tablename__ = 'products'
    id = Column(
        Integer,
        primary_key=True,
        autoincrement=True,
    )
    name = Column(
        String(255),
        nullable=False,
    )
    price = Column(Numeric(10, 2))
`,
      })

      const result = await extractor.extract()
      expect(result.entities).toHaveLength(1)
      const entity = result.entities[0]
      expect(entity.fields.map((f) => f.name)).toEqual(expect.arrayContaining(['id', 'name', 'price']))

      const id = entity.fields.find((f) => f.name === 'id')!
      expect(id.isPrimaryKey).toBe(true)
    })

    it('ignores files without __tablename__', async () => {
      const extractor = makeExtractor({
        'utils.py': `
class Helper:
    def do_thing(self):
        pass
`,
      })

      const result = await extractor.extract()
      expect(result.entities).toHaveLength(0)
    })

    it('skips abstract/internal class attributes', async () => {
      const extractor = makeExtractor({
        'models.py': `
class Event(Base):
    __tablename__ = 'events'
    __table_args__ = {'schema': 'public'}
    id = Column(Integer, primary_key=True)
    name = Column(String(100))
`,
      })

      const result = await extractor.extract()
      const entity = result.entities[0]
      // __table_args__ should not appear as a field
      expect(entity.fields.map((f) => f.name)).not.toContain('__table_args__')
      expect(entity.fields).toHaveLength(2)
    })

    it('handles multiple models in one file', async () => {
      const extractor = makeExtractor({
        'models.py': `
class User(Base):
    __tablename__ = 'users'
    id = Column(Integer, primary_key=True)
    name = Column(String(50))

class Post(Base):
    __tablename__ = 'posts'
    id = Column(Integer, primary_key=True)
    content = Column(Text)
`,
      })

      const result = await extractor.extract()
      expect(result.entities).toHaveLength(2)
      const names = result.entities.map((e) => e.name)
      expect(names).toContain('users')
      expect(names).toContain('posts')
    })
  })

  describe('modern Mapped[] / mapped_column() style (SQLAlchemy 2.x)', () => {
    it('extracts Mapped fields', async () => {
      const extractor = makeExtractor({
        'models.py': `
from sqlalchemy.orm import Mapped, mapped_column
from typing import Optional

class Customer(Base):
    __tablename__ = 'customers'

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    email: Mapped[Optional[str]] = mapped_column(nullable=True)
    score: Mapped[float] = mapped_column(default=0.0)
`,
      })

      const result = await extractor.extract()
      expect(result.entities).toHaveLength(1)
      const entity = result.entities[0]

      const id = entity.fields.find((f) => f.name === 'id')!
      expect(id.isPrimaryKey).toBe(true)
      expect(id.nullable).toBe(false)

      const email = entity.fields.find((f) => f.name === 'email')!
      expect(email.nullable).toBe(true)

      const name = entity.fields.find((f) => f.name === 'name')!
      expect(name.nullable).toBe(false) // Mapped[str] without Optional → not nullable
    })

    it('infers nullable from Optional wrapper', async () => {
      const extractor = makeExtractor({
        'models.py': `
class Item(Base):
    __tablename__ = 'items'
    id: Mapped[int] = mapped_column(primary_key=True)
    description: Mapped[Optional[str]] = mapped_column()
    label: Mapped[str] = mapped_column()
`,
      })

      const result = await extractor.extract()
      const entity = result.entities[0]

      const description = entity.fields.find((f) => f.name === 'description')!
      expect(description.nullable).toBe(true)

      const label = entity.fields.find((f) => f.name === 'label')!
      expect(label.nullable).toBe(false)
    })
  })

  describe('type extraction', () => {
    it('maps common SQLAlchemy types', async () => {
      const extractor = makeExtractor({
        'models.py': `
class TypeSample(Base):
    __tablename__ = 'type_sample'
    id = Column(Integer, primary_key=True)
    name = Column(String(100))
    description = Column(Text)
    score = Column(Float)
    amount = Column(Numeric(10, 2))
    active = Column(Boolean)
    created_at = Column(DateTime)
    data = Column(JSON)
    uid = Column(UUID)
`,
      })

      const result = await extractor.extract()
      const entity = result.entities[0]
      const byName = Object.fromEntries(entity.fields.map((f) => [f.name, f.type]))

      expect(byName['id']).toBe('Integer')
      expect(byName['name']).toBe('String')
      expect(byName['description']).toBe('Text')
      expect(byName['score']).toBe('Float')
      expect(byName['amount']).toBe('Numeric')
      expect(byName['active']).toBe('Boolean')
      expect(byName['created_at']).toBe('DateTime')
      expect(byName['data']).toBe('JSON')
      expect(byName['uid']).toBe('UUID')
    })
  })

  describe('stats', () => {
    it('returns correct stats', async () => {
      const extractor = makeExtractor({
        'models/user.py': `
class User(Base):
    __tablename__ = 'users'
    id = Column(Integer, primary_key=True)
`,
        'utils.py': 'def helper(): pass',
      })

      const result = await extractor.extract()
      expect(result.stats.entitiesFound).toBe(1)
      expect(result.stats.filesScanned).toBe(1) // utils.py filtered out (no __tablename__)
    })
  })
})
