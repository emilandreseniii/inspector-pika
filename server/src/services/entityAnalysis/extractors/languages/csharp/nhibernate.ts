import { BaseExtractor, ExtractorResult, RawEntity, RawField, RawRelationship } from '../../base'
import { toSnakeCase } from '../../../normalizer'

/**
 * Extracts entity surfaces from NHibernate mappings.
 *
 * Supports two mapping styles:
 *
 * 1. XML HBM mappings (*.hbm.xml):
 *    <class name="User" table="users">
 *      <id name="Id" column="id" type="Int32"/>
 *      <property name="Name" column="name" type="String"/>
 *      <many-to-one name="Team" column="team_id" class="Team"/>
 *      <bag name="Posts" ...><one-to-many class="Post"/></bag>
 *    </class>
 *
 * 2. Fluent NHibernate ClassMap<T>:
 *    public class UserMap : ClassMap<User> {
 *      public UserMap() {
 *        Table("users");
 *        Id(x => x.Id);
 *        Map(x => x.Name).Column("name");
 *        References(x => x.Team);
 *        HasMany(x => x.Posts);
 *      }
 *    }
 */
export class NHibernateExtractor extends BaseExtractor {
  readonly extractorId = 'csharp.nhibernate'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []

    // XML HBM mappings
    const hbmFiles = await this.glob('**/*.hbm.xml')
    for (const file of hbmFiles) {
      try {
        const content = await this.readFile(file)
        entities.push(...parseHbmXml(content, file, this.extractorId))
      } catch (err) {
        warnings.push(`Failed to parse ${file}: ${(err as Error).message}`)
      }
    }

    // Fluent NHibernate ClassMap<T>
    const hits = await this.grep('**/*.cs', /ClassMap\s*<\s*\w+\s*>/, 2000)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]
    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        entities.push(...parseFluentMap(content, file, this.extractorId))
      } catch (err) {
        warnings.push(`Failed to parse ${file}: ${(err as Error).message}`)
      }
    }

    return {
      entities,
      warnings,
      stats: { filesScanned: hbmFiles.length + uniqueFiles.length, entitiesFound: entities.length, extractionTimeMs: Date.now() - start },
    }
  }
}

// ---- HBM XML parser ----

function parseHbmXml(content: string, file: string, extractorId: string): RawEntity[] {
  const entities: RawEntity[] = []

  // Match <class name="Foo" table="bar"> ... </class>
  const classRe = /<class\s+([^>]+)>/gi
  let classMatch: RegExpExecArray | null

  while ((classMatch = classRe.exec(content)) !== null) {
    const attrStr = classMatch[1]
    const nameMatch = attrStr.match(/\bname\s*=\s*["']([^"']+)["']/)
    if (!nameMatch) continue
    const className = nameMatch[1].split('.').pop()! // strip namespace
    const tableAttrMatch = attrStr.match(/\btable\s*=\s*["']([^"']+)["']/)
    const tableName = tableAttrMatch?.[1] ?? toSnakeCase(className)

    // Find the extent of this class element
    const classStart = classMatch.index + classMatch[0].length
    const closeTag = content.indexOf('</class>', classStart)
    const classBody = closeTag >= 0 ? content.slice(classStart, closeTag) : content.slice(classStart)

    const fields: RawField[] = []
    const relationships: RawRelationship[] = []

    // <id name="Id" column="id" type="Int32"/>
    const idRe = /<id\s+[^>]*name\s*=\s*["']([^"']+)["'][^>]*(?:type\s*=\s*["']([^"']+)["'])?/gi
    for (const m of classBody.matchAll(idRe)) {
      fields.push(makeField(m[1], m[2] ?? 'int', true, false, false, null, fields.length))
    }

    // <property name="Name" column="name" type="String" not-null="true"/>
    const propRe = /<property\s+[^>]*name\s*=\s*["']([^"']+)["'][^>]*(?:type\s*=\s*["']([^"']+)["'])?[^>]*(?:not-null\s*=\s*["']([^"']+)["'])?/gi
    for (const m of classBody.matchAll(propRe)) {
      const isNullable = m[3] !== 'true'
      fields.push(makeField(m[1], m[2] ?? 'string', false, false, false, isNullable ? true : false, fields.length))
    }

    // <many-to-one name="Team" class="Team"/>
    const mtoRe = /<many-to-one\s+[^>]*name\s*=\s*["']([^"']+)["'][^>]*class\s*=\s*["']([^"'.]+)["']/gi
    for (const m of classBody.matchAll(mtoRe)) {
      relationships.push({ type: 'many_to_one', targetEntityName: m[2].split('.').pop()!, sourceField: m[1] })
    }

    // <bag/set/list name="Posts"><one-to-many class="Post"/></bag>
    const bagRe = /<(?:bag|set|list)\s+[^>]*name\s*=\s*["']([^"']+)["'][^>]*>[\s\S]*?<one-to-many\s+[^>]*class\s*=\s*["']([^"'.]+)["']/gi
    for (const m of classBody.matchAll(bagRe)) {
      relationships.push({ type: 'one_to_many', targetEntityName: m[2].split('.').pop()!, sourceField: m[1] })
    }

    entities.push({
      name: className,
      normalizedName: toSnakeCase(className),
      tableName,
      entityType: 'table',
      fields,
      relationships,
      confidence: 'high',
      source: { file, line: 1, extractorId },
    })
  }

  return entities
}

// ---- Fluent NHibernate parser ----

function parseFluentMap(content: string, file: string, extractorId: string): RawEntity[] {
  const entities: RawEntity[] = []
  const stripped = stripComments(content)
  const lines = stripped.split('\n')

  for (let i = 0; i < lines.length; i++) {
    // public class UserMap : ClassMap<User>
    const classMatch = lines[i].match(/class\s+(\w+Map)\s*:\s*ClassMap\s*<\s*(\w+)\s*>/)
    if (!classMatch) continue

    const entityName = classMatch[2]
    const fields: RawField[] = []
    const relationships: RawRelationship[] = []
    let tableName = toSnakeCase(entityName)

    // Read constructor body
    let depth = 0
    let inClass = false
    for (let j = i; j < lines.length && j < i + 100; j++) {
      const t = lines[j]
      for (const ch of t) { if (ch === '{') depth++; else if (ch === '}') depth-- }
      if (depth > 0) inClass = true
      if (inClass && depth === 0) break

      const trimmed = t.trim()

      // Table("users")
      const tableMatch = trimmed.match(/^\s*Table\s*\(\s*["']([^"']+)["']/)
      if (tableMatch) { tableName = tableMatch[1]; continue }

      // Id(x => x.Id)
      if (/\bId\s*\(/.test(trimmed)) {
        const propMatch = trimmed.match(/x\s*=>\s*x\.(\w+)/)
        if (propMatch) fields.push(makeField(propMatch[1], 'int', true, false, false, false, fields.length))
        continue
      }

      // Map(x => x.Name)
      if (/\bMap\s*\(/.test(trimmed)) {
        const propMatch = trimmed.match(/x\s*=>\s*x\.(\w+)/)
        if (propMatch) {
          const nullable = /\.Nullable\(\)/.test(trimmed)
          fields.push(makeField(propMatch[1], 'string', false, false, false, nullable ? true : null, fields.length))
        }
        continue
      }

      // References(x => x.Team)  → many-to-one
      if (/\bReferences\s*\(/.test(trimmed)) {
        const propMatch = trimmed.match(/x\s*=>\s*x\.(\w+)/)
        if (propMatch) relationships.push({ type: 'many_to_one', targetEntityName: propMatch[1], sourceField: propMatch[1] })
        continue
      }

      // HasMany(x => x.Posts) → one-to-many
      if (/\bHasMany\s*\(/.test(trimmed)) {
        const propMatch = trimmed.match(/x\s*=>\s*x\.(\w+)/)
        if (propMatch) relationships.push({ type: 'one_to_many', targetEntityName: propMatch[1], sourceField: propMatch[1] })
        continue
      }

      // HasManyToMany(x => x.Tags) → many-to-many
      if (/\bHasManyToMany\s*\(/.test(trimmed)) {
        const propMatch = trimmed.match(/x\s*=>\s*x\.(\w+)/)
        if (propMatch) relationships.push({ type: 'many_to_many', targetEntityName: propMatch[1], sourceField: propMatch[1] })
      }
    }

    entities.push({
      name: entityName,
      normalizedName: toSnakeCase(entityName),
      tableName,
      entityType: 'table',
      fields,
      relationships,
      confidence: 'high',
      source: { file, line: i + 1, extractorId },
    })
  }

  return entities
}

// ---- Helpers ----

function makeField(
  name: string, nativeType: string, isPrimaryKey: boolean,
  isForeignKey: boolean, isUnique: boolean, isNullable: boolean | null,
  ordinalPosition: number,
): RawField {
  return {
    name,
    normalizedName: toSnakeCase(name),
    dataType: mapHibernateType(nativeType),
    nativeType,
    isNullable,
    isPrimaryKey,
    isForeignKey,
    isUnique,
    ordinalPosition,
    metadata: {},
  }
}

function mapHibernateType(t: string): string {
  const lower = t.toLowerCase()
  if (/string|text|nvarchar|varchar/.test(lower)) return 'string'
  if (/int32|int64|int|long|short|byte/.test(lower)) return 'integer'
  if (/single|double|decimal|float/.test(lower)) return 'float'
  if (/bool|boolean/.test(lower)) return 'boolean'
  if (/datetime|date|time/.test(lower)) return 'datetime'
  if (/guid/.test(lower)) return 'uuid'
  if (/binary|blob/.test(lower)) return 'binary'
  return 'string'
}

function stripComments(code: string): string {
  return code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}
