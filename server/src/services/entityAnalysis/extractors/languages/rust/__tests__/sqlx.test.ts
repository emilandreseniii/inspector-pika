import { describe, it, expect, vi } from 'vitest'
import { SqlxExtractor } from '../sqlx'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): SqlxExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Rust', approach: 'sqlx', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new SqlxExtractor(ctx)
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

describe('SqlxExtractor', () => {
  it('extracts structs with #[derive(FromRow)]', async () => {
    const extractor = makeExtractor({
      'src/models.rs': `
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow)]
pub struct UserRow {
    pub id: i32,
    pub email: String,
    pub name: Option<String>,
    pub created_at: NaiveDateTime,
}

#[derive(Debug, FromRow)]
pub struct PostRow {
    pub id: i64,
    pub title: String,
    pub user_id: i32,
}
`,
    })

    const result = await extractor.extract()
    expect(result.entities).toHaveLength(2)

    const users = result.entities.find((e) => e.name === 'users')
    expect(users).toBeDefined()
    expect(users!.fields.find((f) => f.name === 'id')?.isPrimaryKey).toBe(true)
    expect(users!.fields.find((f) => f.name === 'email')?.type).toBe('string')
    expect(users!.fields.find((f) => f.name === 'name')?.nullable).toBe(true)

    const posts = result.entities.find((e) => e.name === 'posts')
    expect(posts).toBeDefined()
    expect(posts!.fields.find((f) => f.name === 'user_id')?.isForeignKey).toBe(true)
  })

  it('strips Row/Record suffix for table name', async () => {
    const extractor = makeExtractor({
      'src/db.rs': `
#[derive(FromRow)]
pub struct OrderRecord {
    pub id: i32,
    pub total: f64,
}
`,
    })

    const result = await extractor.extract()
    expect(result.entities[0].name).toBe('orders')
  })
})
