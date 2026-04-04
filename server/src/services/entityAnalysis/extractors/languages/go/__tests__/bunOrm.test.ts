import { describe, it, expect, vi } from 'vitest'
import { BunOrmExtractor } from '../bunOrm'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): BunOrmExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Go', approach: 'bun_orm', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new BunOrmExtractor(ctx)
  vi.spyOn(extractor as any, 'grep').mockImplementation(async (_glob: string, pattern: RegExp) => {
    const hits: Array<{ file: string; line: number; text: string }> = []
    for (const [file, content] of Object.entries(files)) {
      const lines = content.split('\n')
      lines.forEach((text, i) => {
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

describe('BunOrmExtractor', () => {
  it('extracts columns from a Bun ORM struct', async () => {
    const extractor = makeExtractor({
      'models/user.go': `
package models

import (
    "time"
    "github.com/uptrace/bun"
)

type User struct {
    bun.BaseModel \`bun:"table:users,alias:u"\`

    ID        int64     \`bun:"id,pk,autoincrement"\`
    Name      string    \`bun:"name,notnull"\`
    Email     string    \`bun:"email,unique,notnull"\`
    CreatedAt time.Time \`bun:",nullzero,notnull,default:current_timestamp"\`
}
`,
    })

    const result = await extractor.extract()
    expect(result.entities).toHaveLength(1)

    const entity = result.entities[0]
    expect(entity.name).toBe('User')
    expect(entity.tableName).toBe('users')

    const id = entity.fields.find((f) => f.normalizedName === 'id')
    expect(id?.isPrimaryKey).toBe(true)
    expect(id?.dataType).toBe('integer')

    const email = entity.fields.find((f) => f.normalizedName === 'email')
    expect(email?.isUnique).toBe(true)
  })

  it('extracts relationships', async () => {
    const extractor = makeExtractor({
      'models/user.go': `
package models

import "github.com/uptrace/bun"

type User struct {
    bun.BaseModel \`bun:"table:users"\`

    ID       int64      \`bun:"id,pk"\`
    Projects []*Project \`bun:"rel:has-many,join:id=user_id"\`
}
`,
    })

    const result = await extractor.extract()
    expect(result.entities).toHaveLength(1)

    const rel = result.entities[0].relationships.find((r) => r.name === 'Projects')
    expect(rel?.targetEntity).toBe('Project')
    expect(rel?.cardinality).toBe('one_to_many')
  })
})
