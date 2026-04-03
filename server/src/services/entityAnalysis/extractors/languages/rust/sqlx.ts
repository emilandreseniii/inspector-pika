import { BaseExtractor, ExtractorResult, RawEntity, RawField } from '../../base'

const SQLX_TYPE_MAP: Record<string, string> = {
  i8: 'integer', i16: 'integer', i32: 'integer', i64: 'bigint',
  u8: 'integer', u16: 'integer', u32: 'integer', u64: 'bigint',
  f32: 'float', f64: 'float',
  bool: 'boolean',
  String: 'string',
  Vec: 'binary',
  Uuid: 'uuid',
  NaiveDate: 'date', NaiveTime: 'time', NaiveDateTime: 'datetime',
  DateTime: 'datetime', OffsetDateTime: 'datetime',
  Decimal: 'decimal', BigDecimal: 'decimal',
  Value: 'json',
}

export class SqlxExtractor extends BaseExtractor {
  readonly extractorId = 'rust.sqlx'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []
    let filesScanned = 0

    const hits = await this.grep('**/*.rs', /FromRow|sqlx::query_as!|query_as!\s*</)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        if (!content.includes('FromRow') && !content.includes('query_as')) continue
        filesScanned++
        const parsed = parseSqlxFile(content, file, this.extractorId)
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

function parseSqlxFile(content: string, file: string, extractorId: string): RawEntity[] {
  const entities: RawEntity[] = []

  // Find structs with #[derive(FromRow)]
  const fromRowRe = /#\[derive\([^\]]*FromRow[^\]]*\)\]\s*(?:#\[[^\]]*\]\s*)*pub\s+struct\s+(\w+)\s*\{([^}]+)\}/gs
  for (const m of content.matchAll(fromRowRe)) {
    const structName = m[1]
    const body = m[2]

    // Derive table name: UserRow → users, User → users
    const baseName = structName.replace(/Row$/, '').replace(/Record$/, '')
    const tableName = toSnakePlural(baseName)

    const fields: RawField[] = []
    let pos = 0

    for (const field of body.matchAll(/(?:#\[[^\]]*\]\s*)*pub\s+(\w+)\s*:\s*([\w<>, ]+?)\s*,?\s*$/gm)) {
      const fieldName = field[1]
      const rawType = field[2].trim()
      const isNullable = rawType.startsWith('Option<')
      const innerType = isNullable ? rawType.replace(/^Option<(.+)>$/, '$1').trim() : rawType
      const type = SQLX_TYPE_MAP[innerType] ?? innerType.toLowerCase()
      const isPk = fieldName === 'id'

      fields.push({
        name: fieldName, type, nullable: isNullable, isPrimaryKey: isPk,
        isForeignKey: fieldName.endsWith('_id') && !isPk,
        isUnique: false, defaultValue: null, ordinalPosition: pos++, metadata: {},
      })
    }

    if (fields.length === 0) continue

    entities.push({
      name: tableName,
      entityType: 'table',
      fields,
      relationships: [],
      source: { file, startLine: 1, endLine: null, format: 'rust', extractorId },
      extractorId,
      confidence: 'medium',
      metadata: { structName },
    })
  }

  return entities
}

function toSnakePlural(name: string): string {
  const snake = name.replace(/([A-Z])/g, (m, c, i) => (i > 0 ? '_' : '') + c.toLowerCase())
  if (snake.endsWith('y')) return snake.slice(0, -1) + 'ies'
  if (snake.endsWith('s')) return snake + 'es'
  return snake + 's'
}
