import { BaseExtractor, ExtractorResult, RawEntity, RawField } from '../../base'
import { toSnakeCase } from '../../../normalizer'

export class JooqExtractor extends BaseExtractor {
  readonly extractorId = 'java.jooq'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []
    let filesScanned = 0

    // Strategy 1: parse generated TableImpl subclasses
    const javaFiles = await this.glob('**/*.java')
    const tableImplFiles = javaFiles.filter((f) => f.toLowerCase().includes('/tables/') || f.toLowerCase().includes('/jooq/'))

    for (const file of tableImplFiles) {
      filesScanned++
      try {
        const content = await this.readFile(file)
        if (!/(extends\s+TableImpl|extends\s+UpdatableRecordImpl)/.test(content)) continue
        const parsed = parseTableImplFile(content, file, this.extractorId)
        if (parsed) entities.push(parsed)
      } catch (err) {
        warnings.push(`Failed to parse ${file}: ${(err as Error).message}`)
      }
    }

    // Strategy 2: parse SQL schema files referenced by jooq config
    if (entities.length === 0) {
      warnings.push('No jOOQ generated TableImpl classes found — entities will be extracted by the SQL DDL extractor if schema files are present')
    }

    return {
      entities,
      warnings,
      stats: { filesScanned, entitiesFound: entities.length, extractionTimeMs: Date.now() - start },
    }
  }
}

function parseTableImplFile(content: string, file: string, extractorId: string): RawEntity | null {
  // Extract the table name from the constructor: super("table_name", ...)
  const superMatch = content.match(/super\s*\(\s*["']([^"']+)["']/)
  if (!superMatch) return null
  const tableName = superMatch[1]

  const fields: RawField[] = []
  let pos = 1

  // Extract TableField declarations:
  // public final TableField<XxxRecord, Long> ID = createField(DSL.name("id"), SQLDataType.BIGINT, this);
  const fieldPattern = /public\s+final\s+TableField<[^,]+,\s*([^>]+)>\s+\w+\s*=\s*createField\s*\(\s*DSL\.name\s*\(\s*["']([^"']+)["']\s*\)\s*,\s*SQLDataType\.(\w+)/g
  let m: RegExpExecArray | null
  while ((m = fieldPattern.exec(content)) !== null) {
    const javaType = m[1].trim()
    const colName = m[2]
    const sqlType = m[3]

    fields.push({
      name: colName,
      type: sqlType,
      nullable: javaType.startsWith('Optional') || javaType.includes('Nullable') ? true : null,
      isPrimaryKey: false,
      isForeignKey: false,
      isUnique: false,
      defaultValue: null,
      ordinalPosition: pos++,
      metadata: { javaType },
    })
  }

  if (fields.length === 0) return null

  return {
    name: tableName,
    entityType: 'table',
    fields,
    relationships: [],
    source: { file, startLine: null, endLine: null, format: 'jooq_generated', extractorId },
    extractorId,
    confidence: 'high',
    metadata: { generatedClass: toSnakeCase(tableName) },
  }
}
