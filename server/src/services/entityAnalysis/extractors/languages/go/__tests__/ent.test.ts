import { describe, it, expect, vi } from 'vitest'
import { EntExtractor } from '../ent'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): EntExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Go', approach: 'ent', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new EntExtractor(ctx)
  vi.spyOn(extractor as any, 'glob').mockImplementation(async (pattern: string) => {
    return Object.keys(files).filter((f) => f.includes('ent/schema/') && f.endsWith('.go'))
  })
  vi.spyOn(extractor as any, 'readFile').mockImplementation(async (path: string) => {
    if (files[path] === undefined) throw new Error(`File not found: ${path}`)
    return files[path]
  })
  return extractor
}

describe('EntExtractor', () => {
  describe('basic schema extraction', () => {
    it('extracts entity from ent schema file', async () => {
      const extractor = makeExtractor({
        'ent/schema/user.go': `
package schema

import (
    "entgo.io/ent"
    "entgo.io/ent/schema/field"
)

type User struct {
    ent.Schema
}

func (User) Fields() []ent.Field {
    return []ent.Field{
        field.Int("id"),
        field.String("name").NotEmpty(),
        field.String("email").Unique(),
        field.Int("age").Optional(),
        field.Bool("active").Default(true),
    }
}
`,
      })

      const result = await extractor.extract()
      expect(result.entities).toHaveLength(1)

      const user = result.entities[0]
      expect(user.name).toBe('User')
      expect(user.tableName).toBe('users')
      expect(user.entityType).toBe('table')

      const name = user.fields.find((f) => f.name === 'name')
      expect(name?.type).toBe('string')

      const email = user.fields.find((f) => f.name === 'email')
      expect(email?.isUnique).toBe(true)

      const age = user.fields.find((f) => f.name === 'age')
      expect(age?.nullable).toBe(true)
    })

    it('extracts edges as relationships', async () => {
      const extractor = makeExtractor({
        'ent/schema/user.go': `
package schema

import (
    "entgo.io/ent"
    "entgo.io/ent/schema/edge"
    "entgo.io/ent/schema/field"
)

type User struct {
    ent.Schema
}

func (User) Fields() []ent.Field {
    return []ent.Field{
        field.String("name"),
    }
}

func (User) Edges() []ent.Edge {
    return []ent.Edge{
        edge.To("pets", Pet.Type),
        edge.From("groups", Group.Type).Ref("users"),
    }
}
`,
      })

      const result = await extractor.extract()
      const user = result.entities[0]

      const petRel = user.relationships.find((r) => r.fieldName === 'pets')
      expect(petRel?.targetEntity).toBe('Pet')
      expect(petRel?.cardinality).toBe('one_to_many')

      const groupRel = user.relationships.find((r) => r.fieldName === 'groups')
      expect(groupRel?.targetEntity).toBe('Group')
      expect(groupRel?.cardinality).toBe('many_to_one')
    })
  })

  describe('field types', () => {
    it('maps ent field types to normalized types', async () => {
      const extractor = makeExtractor({
        'ent/schema/types.go': `
package schema

import (
    "entgo.io/ent"
    "entgo.io/ent/schema/field"
)

type TypeTest struct {
    ent.Schema
}

func (TypeTest) Fields() []ent.Field {
    return []ent.Field{
        field.String("name"),
        field.Int("count"),
        field.Float("score"),
        field.Bool("active"),
        field.Time("created_at"),
        field.UUID("uid", uuid.UUID{}),
        field.JSON("data", map[string]any{}),
    }
}
`,
      })

      const result = await extractor.extract()
      const m = result.entities[0]
      const typeMap: Record<string, string> = {}
      for (const f of m.fields) typeMap[f.name] = f.type ?? ''

      expect(typeMap['name']).toBe('string')
      expect(typeMap['count']).toBe('integer')
      expect(typeMap['score']).toBe('float')
      expect(typeMap['active']).toBe('boolean')
      expect(typeMap['created_at']).toBe('datetime')
      expect(typeMap['data']).toBe('json')
    })
  })

  describe('multiple schemas', () => {
    it('extracts multiple entities from multiple schema files', async () => {
      const extractor = makeExtractor({
        'ent/schema/user.go': `
package schema
type User struct {
    ent.Schema
}
func (User) Fields() []ent.Field {
    return []ent.Field{ field.String("email") }
}
`,
        'ent/schema/post.go': `
package schema
type Post struct {
    ent.Schema
}
func (Post) Fields() []ent.Field {
    return []ent.Field{ field.String("title") }
}
`,
      })

      const result = await extractor.extract()
      expect(result.entities).toHaveLength(2)
      expect(result.entities.map((e) => e.name)).toContain('User')
      expect(result.entities.map((e) => e.name)).toContain('Post')
    })
  })

  describe('stats', () => {
    it('reports correct stats', async () => {
      const extractor = makeExtractor({
        'ent/schema/user.go': `
package schema
type User struct {
    ent.Schema
}
func (User) Fields() []ent.Field {
    return []ent.Field{ field.String("name") }
}
`,
      })

      const result = await extractor.extract()
      expect(result.stats.filesScanned).toBe(1)
      expect(result.stats.entitiesFound).toBe(1)
    })
  })
})
