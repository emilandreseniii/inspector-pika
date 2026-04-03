import { describe, it, expect, vi } from 'vitest'
import { DieselExtractor } from '../diesel'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): DieselExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Rust', approach: 'diesel', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new DieselExtractor(ctx)
  vi.spyOn(extractor as any, 'glob').mockImplementation(async () => Object.keys(files))
  vi.spyOn(extractor as any, 'readFile').mockImplementation(async (path: string) => {
    if (files[path] === undefined) throw new Error(`File not found: ${path}`)
    return files[path]
  })
  return extractor
}

describe('DieselExtractor', () => {
  it('extracts tables from diesel schema.rs', async () => {
    const extractor = makeExtractor({
      'src/schema.rs': `
// @generated automatically by Diesel CLI.

diesel::table! {
    users (id) {
        id -> Integer,
        email -> Text,
        name -> Nullable<Text>,
        created_at -> Timestamp,
    }
}

diesel::table! {
    posts (id) {
        id -> Integer,
        title -> Text,
        user_id -> Integer,
        published -> Bool,
    }
}
`,
    })

    const result = await extractor.extract()
    expect(result.entities).toHaveLength(2)

    const users = result.entities.find((e) => e.name === 'users')
    expect(users).toBeDefined()

    const id = users!.fields.find((f) => f.name === 'id')
    expect(id!.isPrimaryKey).toBe(true)
    expect(id!.type).toBe('integer')

    const email = users!.fields.find((f) => f.name === 'email')
    expect(email!.type).toBe('string')
    expect(email!.nullable).toBe(false)

    const name = users!.fields.find((f) => f.name === 'name')
    expect(name!.nullable).toBe(true)
  })

  it('maps Diesel SQL types correctly', async () => {
    const extractor = makeExtractor({
      'src/schema.rs': `
diesel::table! {
    products (id) {
        id -> BigInt,
        price -> Numeric,
        in_stock -> Bool,
        uuid -> Uuid,
    }
}
`,
    })

    const result = await extractor.extract()
    const p = result.entities[0]
    expect(p.fields.find((f) => f.name === 'id')?.type).toBe('bigint')
    expect(p.fields.find((f) => f.name === 'price')?.type).toBe('decimal')
    expect(p.fields.find((f) => f.name === 'in_stock')?.type).toBe('boolean')
    expect(p.fields.find((f) => f.name === 'uuid')?.type).toBe('uuid')
  })
})
