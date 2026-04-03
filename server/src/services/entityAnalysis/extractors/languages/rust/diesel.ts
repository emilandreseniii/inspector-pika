import { BaseExtractor, ExtractorResult, RawEntity, RawField } from '../../base'

// Diesel SQL type → normalised type
const DIESEL_TYPE_MAP: Record<string, string> = {
  Text: 'string', VarChar: 'string', Varchar: 'string', Char: 'string',
  Integer: 'integer', Int4: 'integer', Int2: 'integer', SmallInt: 'integer',
  BigInt: 'bigint', Int8: 'bigint',
  Float: 'float', Float4: 'float', Float8: 'float', Double: 'float',
  Numeric: 'decimal', Decimal: 'decimal',
  Bool: 'boolean',
  Date: 'date', Time: 'time', Timestamp: 'datetime', Timestamptz: 'datetime',
  Bytea: 'binary',
  Uuid: 'uuid',
  Json: 'json', Jsonb: 'json',
  Nullable: 'nullable', // wrapper — handled separately
}

export class DieselExtractor extends BaseExtractor {
  readonly extractorId = 'rust.diesel'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []
    let filesScanned = 0

    // Diesel schema is generated in src/schema.rs
    const schemaFiles = await this.glob('**/schema.rs')

    for (const file of schemaFiles) {
      try {
        const content = await this.readFile(file)
        if (!content.includes('diesel::table!') && !content.includes('table! {')) continue
        filesScanned++
        const parsed = parseDieselSchema(content, file, this.extractorId)
        entities.push(...parsed)
      } catch (err) {
        warnings.push(`Failed to parse ${file}: ${(err as Error).message}`)
      }
    }

    return {
      entities,
      warnings,
      stats: { filesScanned, entitiesFound: entities.length, extractionTimeMs: Date.now() - start },
    }
  }
}

// ---- Parser ----

function parseDieselSchema(content: string, file: string, extractorId: string): RawEntity[] {
  const entities: RawEntity[] = []
  const lines = content.split('\n')

  let i = 0
  while (i < lines.length) {
    const trimmed = lines[i].trim()

    // diesel::table! { ... } or table! { ... }
    const tableBlockMatch = trimmed.match(/(?:diesel::)?table!\s*\{?$/) || trimmed.match(/(?:diesel::)?table!\s*\{/)
    if (tableBlockMatch) {
      const startLine = i + 1
      i++
      // Skip to table name line: users (id) {
      while (i < lines.length && !lines[i].trim().match(/^\w+\s*\(/)) i++
      if (i >= lines.length) break

      const headerMatch = lines[i].trim().match(/^(\w+)\s*\((\w+)\)/)
      if (!headerMatch) { i++; continue }
      const tableName = headerMatch[1]
      const pkName = headerMatch[2]

      const fields: RawField[] = []
      let pos = 0
      i++

      while (i < lines.length) {
        const inner = lines[i].trim()
        if (inner === '}' || inner === ');') break

        // id -> Integer,
        // name -> Nullable<Text>,
        const colMatch = inner.match(/^(\w+)\s*->\s*([\w<>, ]+?)\s*,?\s*$/)
        if (colMatch) {
          const colName = colMatch[1]
          const rawType = colMatch[2].trim()
          const isNullable = rawType.startsWith('Nullable<')
          const innerType = isNullable ? rawType.replace(/^Nullable<(.+)>$/, '$1').trim() : rawType
          const type = DIESEL_TYPE_MAP[innerType] ?? innerType.toLowerCase()
          const isPk = colName === pkName
          fields.push({
            name: colName, type, nullable: isNullable, isPrimaryKey: isPk,
            isForeignKey: false, isUnique: false, defaultValue: null, ordinalPosition: pos++, metadata: {},
          })
        }
        i++
      }

      entities.push({
        name: tableName,
        entityType: 'table',
        fields,
        relationships: [],
        source: { file, startLine, endLine: i + 1, format: 'rust', extractorId },
        extractorId,
        confidence: 'high',
        metadata: {},
      })
    }

    i++
  }

  return entities
}
