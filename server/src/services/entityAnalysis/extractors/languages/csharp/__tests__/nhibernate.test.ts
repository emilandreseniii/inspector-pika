import { describe, it, expect, vi } from 'vitest'
import { NHibernateExtractor } from '../nhibernate'
import type { ExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): NHibernateExtractor {
  const ctx: ExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'C#', approach: 'nhibernate', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new NHibernateExtractor(ctx)
  vi.spyOn(extractor as any, 'glob').mockImplementation(async (pattern: string) => {
    if (pattern.includes('.hbm.xml')) return Object.keys(files).filter((f) => f.endsWith('.hbm.xml'))
    return []
  })
  vi.spyOn(extractor as any, 'grep').mockImplementation(async (_glob: string, pattern: RegExp) => {
    const hits: Array<{ file: string; line: number; text: string }> = []
    for (const [file, content] of Object.entries(files)) {
      if (!file.endsWith('.cs')) continue
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

describe('NHibernateExtractor', () => {
  it('extracts entities from HBM XML mapping files', async () => {
    const extractor = makeExtractor({
      'Mappings/User.hbm.xml': `
<?xml version="1.0" encoding="utf-8" ?>
<hibernate-mapping xmlns="urn:nhibernate-mapping-2.2">
  <class name="MyApp.Domain.User" table="users">
    <id name="Id" column="id" type="Int32">
      <generator class="identity" />
    </id>
    <property name="Name" column="name" type="String" not-null="true"/>
    <property name="Email" column="email" type="String"/>
    <many-to-one name="Department" class="Department" column="dept_id" not-null="true"/>
    <bag name="Posts" cascade="all-delete-orphan">
      <key column="user_id"/>
      <one-to-many class="Post"/>
    </bag>
  </class>
</hibernate-mapping>
`,
    })

    const result = await extractor.extract()
    expect(result.entities).toHaveLength(1)

    const entity = result.entities[0]
    expect(entity.name).toBe('User')
    expect(entity.tableName).toBe('users')

    const id = entity.fields.find((f) => f.name === 'Id')
    expect(id?.isPrimaryKey).toBe(true)

    const name = entity.fields.find((f) => f.name === 'Name')
    expect(name).toBeDefined()

    expect(entity.relationships).toHaveLength(2)
    expect(entity.relationships.find((r) => r.type === 'many_to_one')?.targetEntityName).toBe('Department')
    expect(entity.relationships.find((r) => r.type === 'one_to_many')?.targetEntityName).toBe('Post')
  })

  it('extracts entities from Fluent NHibernate ClassMap', async () => {
    const extractor = makeExtractor({
      'Mappings/ProductMap.cs': `
using FluentNHibernate.Mapping;

public class ProductMap : ClassMap<Product>
{
    public ProductMap()
    {
        Table("products");
        Id(x => x.Id);
        Map(x => x.Name);
        Map(x => x.Price);
        Map(x => x.Description).Nullable();
        References(x => x.Category);
        HasMany(x => x.Reviews);
    }
}
`,
    })

    const result = await extractor.extract()
    expect(result.entities).toHaveLength(1)

    const entity = result.entities[0]
    expect(entity.name).toBe('Product')
    expect(entity.tableName).toBe('products')

    const id = entity.fields.find((f) => f.name === 'Id')
    expect(id?.isPrimaryKey).toBe(true)

    const desc = entity.fields.find((f) => f.name === 'Description')
    expect(desc?.isNullable).toBe(true)

    expect(entity.relationships).toHaveLength(2)
    expect(entity.relationships.find((r) => r.type === 'many_to_one')?.sourceField).toBe('Category')
    expect(entity.relationships.find((r) => r.type === 'one_to_many')?.sourceField).toBe('Reviews')
  })
})
