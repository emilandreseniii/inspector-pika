import { describe, it, expect, vi } from 'vitest'
import { GormExtractor } from '../gorm'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): GormExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Go', approach: 'gorm', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new GormExtractor(ctx)
  vi.spyOn(extractor as any, 'glob').mockImplementation(async () => Object.keys(files))
  vi.spyOn(extractor as any, 'readFile').mockImplementation(async (path: string) => {
    if (files[path] === undefined) throw new Error(`File not found: ${path}`)
    return files[path]
  })
  return extractor
}

describe('GormExtractor', () => {
  describe('gorm.Model embedding', () => {
    it('extracts struct with embedded gorm.Model', async () => {
      const extractor = makeExtractor({
        'user.go': `
package models

import "gorm.io/gorm"

type User struct {
    gorm.Model
    Name  string \`gorm:"column:name;not null"\`
    Email string \`gorm:"column:email;unique;not null"\`
    Age   int    \`gorm:"column:age"\`
}
`,
      })

      const result = await extractor.extract()
      expect(result.entities).toHaveLength(1)

      const user = result.entities[0]
      expect(user.name).toBe('User')
      expect(user.tableName).toBe('users')
      expect(user.entityType).toBe('table')

      // gorm.Model provides ID, CreatedAt, UpdatedAt, DeletedAt
      const id = user.fields.find((f) => f.name === 'ID')
      expect(id?.isPK).toBe(true)
      expect(id?.nullable).toBe(false)

      const email = user.fields.find((f) => f.name === 'Email')
      expect(email?.isUnique).toBe(true)
      expect(email?.nullable).toBe(false)
      expect(email?.columnName).toBe('email')
    })
  })

  describe('explicit gorm tags', () => {
    it('extracts column name from gorm tag', async () => {
      const extractor = makeExtractor({
        'product.go': `
package models

type Product struct {
    ID          uint   \`gorm:"primaryKey"\`
    ProductName string \`gorm:"column:product_name;not null"\`
    Price       float64 \`gorm:"column:price"\`
    Description string \`gorm:"column:description"\`
}
`,
      })

      const result = await extractor.extract()
      expect(result.entities).toHaveLength(1)

      const product = result.entities[0]
      expect(product.fields.find((f) => f.name === 'ID')?.isPK).toBe(true)
      expect(product.fields.find((f) => f.name === 'ProductName')?.columnName).toBe('product_name')
      expect(product.fields.find((f) => f.name === 'Price')?.type).toBe('float')
    })

    it('skips fields tagged with gorm:"-"', async () => {
      const extractor = makeExtractor({
        'model.go': `
type Post struct {
    ID      uint   \`gorm:"primaryKey"\`
    Title   string \`gorm:"column:title"\`
    Ignored string \`gorm:"-"\`
}
`,
      })

      const result = await extractor.extract()
      expect(result.entities[0].fields.find((f) => f.name === 'Ignored')).toBeUndefined()
    })
  })

  describe('table name', () => {
    it('derives snake_case plural table name from struct name', async () => {
      const extractor = makeExtractor({
        'model.go': `
type BlogPost struct {
    ID    uint   \`gorm:"primaryKey"\`
    Title string \`gorm:"column:title"\`
}
`,
      })

      const result = await extractor.extract()
      expect(result.entities[0].tableName).toBe('blog_posts')
    })
  })

  describe('field types', () => {
    it('maps Go types to normalized types', async () => {
      const extractor = makeExtractor({
        'types.go': `
type TypeTest struct {
    A string      \`gorm:"column:a"\`
    B int64       \`gorm:"column:b"\`
    C float64     \`gorm:"column:c"\`
    D bool        \`gorm:"column:d"\`
    E time.Time   \`gorm:"column:e"\`
}
`,
      })

      const result = await extractor.extract()
      const m = result.entities[0]
      expect(m.fields.find((f) => f.name === 'A')?.type).toBe('string')
      expect(m.fields.find((f) => f.name === 'B')?.type).toBe('integer')
      expect(m.fields.find((f) => f.name === 'C')?.type).toBe('float')
      expect(m.fields.find((f) => f.name === 'D')?.type).toBe('boolean')
    })
  })

  describe('multiple structs', () => {
    it('extracts multiple GORM models from one file', async () => {
      const extractor = makeExtractor({
        'models.go': `
package models

type User struct {
    ID    uint   \`gorm:"primaryKey"\`
    Email string \`gorm:"column:email"\`
}

type Post struct {
    ID    uint   \`gorm:"primaryKey"\`
    Title string \`gorm:"column:title"\`
}
`,
      })

      const result = await extractor.extract()
      expect(result.entities).toHaveLength(2)
      expect(result.entities.map((e) => e.name)).toContain('User')
      expect(result.entities.map((e) => e.name)).toContain('Post')
    })
  })
})
