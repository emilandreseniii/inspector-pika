import { describe, it, expect, vi } from 'vitest'
import { SqlboilerExtractor } from '../sqlboiler'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): SqlboilerExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'Go', approach: 'sqlboiler', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new SqlboilerExtractor(ctx)
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

describe('SqlboilerExtractor', () => {
  it('extracts columns from a sqlboiler generated struct', async () => {
    const extractor = makeExtractor({
      'models/users.go': `
package models

import (
    "time"
    "github.com/volatiletech/null/v8"
)

// User is an object representing the database table.
type User struct {
    ID        int64       \`boil:"id" json:"id" toml:"id" yaml:"id"\`
    Name      null.String \`boil:"name" json:"name,omitempty" toml:"name" yaml:"name,omitempty"\`
    Email     string      \`boil:"email" json:"email" toml:"email" yaml:"email"\`
    CreatedAt time.Time   \`boil:"created_at" json:"created_at" toml:"created_at" yaml:"created_at"\`

    R *userR \`boil:"-" json:"-" toml:"-" yaml:"-"\`
    L userL  \`boil:"-" json:"-" toml:"-" yaml:"-"\`
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

    const name = entity.fields.find((f) => f.normalizedName === 'name')
    expect(name?.isNullable).toBe(true)

    const email = entity.fields.find((f) => f.normalizedName === 'email')
    expect(email?.dataType).toBe('string')

    // R and L fields should be skipped
    expect(entity.fields.every((f) => f.name !== 'R' && f.name !== 'L')).toBe(true)
  })

  it('skips internal lowercase structs', async () => {
    const extractor = makeExtractor({
      'models/users.go': `
package models

type userR struct {
    Posts PostSlice \`boil:"Posts" json:"Posts" toml:"Posts" yaml:"Posts"\`
}
`,
    })

    const result = await extractor.extract()
    expect(result.entities).toHaveLength(0)
  })
})
