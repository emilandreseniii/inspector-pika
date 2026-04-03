import { describe, it, expect, vi } from 'vitest'
import { SeaOrmExtractor } from '../seaOrm'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): SeaOrmExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Rust', approach: 'sea_orm', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new SeaOrmExtractor(ctx)
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

describe('SeaOrmExtractor', () => {
  it('extracts entity from DeriveEntityModel struct', async () => {
    const extractor = makeExtractor({
      'src/entity/user.rs': `
use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, DeriveEntityModel)]
#[sea_orm(table_name = "users")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub email: String,
    pub name: Option<String>,
    pub is_active: bool,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
`,
    })

    const result = await extractor.extract()
    expect(result.entities).toHaveLength(1)
    const entity = result.entities[0]
    expect(entity.name).toBe('users')

    const id = entity.fields.find((f) => f.name === 'id')
    expect(id!.isPrimaryKey).toBe(true)
    expect(id!.type).toBe('integer')

    const email = entity.fields.find((f) => f.name === 'email')
    expect(email!.type).toBe('string')
    expect(email!.nullable).toBe(false)

    const name = entity.fields.find((f) => f.name === 'name')
    expect(name!.nullable).toBe(true)
  })

  it('falls back to file name for table name', async () => {
    const extractor = makeExtractor({
      'src/entity/product.rs': `
#[derive(DeriveEntityModel)]
pub struct Model {
    pub id: i32,
    pub name: String,
}
`,
    })

    const result = await extractor.extract()
    expect(result.entities[0].name).toBe('product')
  })
})
