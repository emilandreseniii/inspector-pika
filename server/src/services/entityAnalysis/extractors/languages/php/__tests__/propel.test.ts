import { describe, it, expect, vi } from 'vitest'
import { PropelExtractor } from '../propel'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): PropelExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'PHP', approach: 'propel', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new PropelExtractor(ctx)
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

describe('PropelExtractor', () => {
  it('extracts tables and columns from schema.xml', async () => {
    const extractor = makeExtractor({
      'schema.xml': `<?xml version="1.0" encoding="UTF-8"?>
<database name="myapp" defaultIdMethod="native">
  <table name="users" phpName="User">
    <column name="id" type="INTEGER" primaryKey="true" autoIncrement="true" required="true"/>
    <column name="name" type="VARCHAR" size="255" required="true"/>
    <column name="email" type="VARCHAR" size="255" required="false"/>
    <column name="role_id" type="INTEGER" required="true"/>
    <foreign-key foreignTable="roles">
      <reference local="role_id" foreign="id"/>
    </foreign-key>
  </table>
  <table name="roles" phpName="Role">
    <column name="id" type="INTEGER" primaryKey="true" autoIncrement="true" required="true"/>
    <column name="name" type="VARCHAR" size="100" required="true"/>
  </table>
</database>`,
    })

    const result = await extractor.extract()
    expect(result.entities).toHaveLength(2)

    const users = result.entities.find((e) => e.name === 'users')
    expect(users).toBeDefined()
    expect(users!.fields).toHaveLength(4)

    const id = users!.fields.find((f) => f.name === 'id')
    expect(id?.isPrimaryKey).toBe(true)
    expect(id?.type).toBe('integer')

    const email = users!.fields.find((f) => f.name === 'email')
    expect(email?.nullable).toBe(true)

    expect(users!.relationships).toHaveLength(1)
    expect(users!.relationships[0].type).toBe('many_to_one')
    expect(users!.relationships[0].targetEntity).toBe('roles')

    const roles = result.entities.find((e) => e.name === 'roles')
    expect(roles).toBeDefined()
    expect(roles!.fields).toHaveLength(2)
  })

  it('returns empty for schema.xml with no tables', async () => {
    const extractor = makeExtractor({
      'schema.xml': `<?xml version="1.0"?><database name="empty"></database>`,
    })
    const result = await extractor.extract()
    expect(result.entities).toHaveLength(0)
  })
})
