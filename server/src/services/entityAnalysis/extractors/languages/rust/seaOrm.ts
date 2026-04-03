import { BaseExtractor, ExtractorResult, RawEntity, RawField, RawRelationship } from '../../base'

const SEA_TYPE_MAP: Record<string, string> = {
  String: 'string', Text: 'string',
  Integer: 'integer', TinyInteger: 'integer', SmallInteger: 'integer', BigInteger: 'bigint',
  Float: 'float', Double: 'float',
  Decimal: 'decimal',
  Boolean: 'boolean',
  Date: 'date', Time: 'time', DateTime: 'datetime', TimestampWithTimeZone: 'datetime',
  Binary: 'binary',
  Uuid: 'uuid',
  Json: 'json', JsonBinary: 'json',
}

export class SeaOrmExtractor extends BaseExtractor {
  readonly extractorId = 'rust.sea_orm'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []
    let filesScanned = 0

    const hits = await this.grep('**/*.rs', /DeriveEntityModel|DeriveActiveModel|EntityTrait/)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        if (!content.includes('DeriveEntityModel') && !content.includes('EntityTrait')) continue
        filesScanned++
        const parsed = parseSeaOrmFile(content, file, this.extractorId)
        if (parsed) entities.push(parsed)
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

function parseSeaOrmFile(content: string, file: string, extractorId: string): RawEntity | null {
  // #[sea_orm(table_name = "users")]
  const tableAttr = content.match(/#\[sea_orm\s*\([^)]*table_name\s*=\s*["'](\w+)["']/)
  const tableName = tableAttr?.[1]

  // Find Model struct
  const modelMatch = content.match(/pub\s+struct\s+Model\s*\{([^}]+)\}/)
  if (!modelMatch) return null

  const structBody = modelMatch[1]
  const fields: RawField[] = []
  const relationships: RawRelationship[] = []
  let pos = 0

  // Parse fields:  pub id: i32,   pub name: String,   pub email: Option<String>,
  for (const m of structBody.matchAll(/pub\s+(\w+)\s*:\s*([\w<>]+)/g)) {
    const fieldName = m[1]
    const rawType = m[2]
    const isNullable = rawType.startsWith('Option<')
    const innerType = isNullable ? rawType.replace(/^Option<(.+)>$/, '$1') : rawType
    const type = SEA_TYPE_MAP[innerType] ?? mapRustPrimitive(innerType)
    const isPk = fieldName === 'id'

    fields.push({
      name: fieldName, type, nullable: isNullable, isPrimaryKey: isPk,
      isForeignKey: fieldName.endsWith('_id') && !isPk, isUnique: false,
      defaultValue: null, ordinalPosition: pos++, metadata: {},
    })
  }

  // Relation enum for relationships
  for (const m of content.matchAll(/belongs_to\s*::\s*super::(\w+)/g)) {
    relationships.push({ type: 'many_to_one', targetEntity: m[1], sourceField: null, targetField: null, metadata: {} })
  }
  for (const m of content.matchAll(/has_many\s*::\s*super::(\w+)/g)) {
    relationships.push({ type: 'one_to_many', targetEntity: m[1], sourceField: null, targetField: null, metadata: {} })
  }

  // Derive table name from file name if not explicit
  const derivedName = tableName ?? file.split('/').pop()?.replace(/\.rs$/, '') ?? 'entity'

  if (fields.length === 0) return null

  return {
    name: derivedName,
    entityType: 'table',
    fields,
    relationships,
    source: { file, startLine: 1, endLine: null, format: 'rust', extractorId },
    extractorId,
    confidence: 'high',
    metadata: {},
  }
}

function mapRustPrimitive(t: string): string {
  const map: Record<string, string> = {
    i8: 'integer', i16: 'integer', i32: 'integer', i64: 'bigint',
    u8: 'integer', u16: 'integer', u32: 'integer', u64: 'bigint',
    f32: 'float', f64: 'float',
    bool: 'boolean',
    String: 'string',
    Uuid: 'uuid',
  }
  return map[t] ?? t.toLowerCase()
}
