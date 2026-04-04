import { BaseExtractor, ExtractorResult, RawEntity, RawField } from '../../base'

/**
 * Extracts entity definitions from Slick (Scala).
 *
 * Key patterns:
 *   class Users(tag: Tag) extends Table[User](tag, "users") {
 *     def id = column[Long]("id", O.PrimaryKey, O.AutoInc)
 *     def name = column[String]("name")
 *     def email = column[Option[String]]("email")
 *     def * = (id, name, email) <> (User.tupled, User.unapply)
 *   }
 */

const SLICK_TYPE_MAP: Record<string, string> = {
  Long: 'bigint', Int: 'integer', Short: 'integer', Byte: 'integer',
  Double: 'float', Float: 'float', BigDecimal: 'decimal',
  Boolean: 'boolean',
  String: 'string',
  java_sql_Date: 'date', java_sql_Time: 'time', java_sql_Timestamp: 'datetime',
  java_time_LocalDate: 'date', java_time_LocalDateTime: 'datetime',
  UUID: 'uuid', Array: 'binary',
}

export class SlickExtractor extends BaseExtractor {
  readonly extractorId = 'scala.slick'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []
    let filesScanned = 0

    const hits = await this.grep('**/*.scala', /extends\s+Table\s*\[/)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        filesScanned++
        const parsed = parseSlickFile(content, file, this.extractorId)
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

function parseSlickFile(content: string, file: string, extractorId: string): RawEntity[] {
  if (!/slick\.|import\s+slick/.test(content)) return []

  const entities: RawEntity[] = []
  const stripped = stripComments(content)

  // Match: class Foo(tag: Tag) extends Table[Bar](tag, "table_name")
  // or:    class Foo(tag: Tag) extends Table[Bar](tag, SchemaName, "table_name")
  const CLASS_RE = /class\s+(\w+)\s*\(\s*tag\s*:\s*Tag\s*\)\s+extends\s+Table\s*\[.*?\]\s*\(\s*tag\s*,(?:\s*["']\w+["']\s*,)?\s*["'](\w+)["']/g

  for (const classMatch of stripped.matchAll(CLASS_RE)) {
    const className = classMatch[1]
    const tableName = classMatch[2]

    // Find the body of this class — extract from current position
    const classStart = classMatch.index ?? 0
    const body = extractClassBody(stripped, classStart)

    const fields: RawField[] = []
    let pos = 0

    // def id = column[Long]("id", O.PrimaryKey, O.AutoInc)
    // def name = column[String]("name")
    // def email = column[Option[String]]("email")
    for (const colMatch of body.matchAll(/def\s+(\w+)\s*=\s*column\s*\[\s*(Option\s*\[)?\s*([\w.]+)\s*\][\s\]]*\(\s*"([^"]+)"([^)]*)\)/g)) {
      const fieldName = colMatch[1]
      if (fieldName === '*') continue
      const isOption = !!colMatch[2]
      const scalaType = colMatch[3].replace(/java\.sql\./, 'java_sql_').replace(/java\.time\./, 'java_time_').replace(/\./g, '_')
      const colName = colMatch[4]
      const options = colMatch[5] ?? ''
      const isPrimary = options.includes('O.PrimaryKey') || options.includes('PrimaryKey')

      const mappedType = SLICK_TYPE_MAP[scalaType] ?? 'string'

      fields.push({
        name: colName,
        type: mappedType,
        nullable: isOption,
        isPrimaryKey: isPrimary,
        isForeignKey: false,
        isUnique: false,
        defaultValue: null,
        ordinalPosition: pos++,
        metadata: { scalaFieldName: fieldName },
      })
    }

    if (fields.length === 0) continue

    entities.push({
      name: tableName,
      entityType: 'table',
      fields,
      relationships: [],
      source: { file, startLine: 1, endLine: null, format: 'scala', extractorId },
      extractorId,
      confidence: 'high',
      metadata: { className },
    })
  }

  return entities
}

// ---- Helpers ----

function extractClassBody(content: string, classStart: number): string {
  // Find the opening { of the class
  const openBrace = content.indexOf('{', classStart)
  if (openBrace === -1) return ''

  let depth = 1
  let i = openBrace + 1
  while (i < content.length && depth > 0) {
    if (content[i] === '{') depth++
    else if (content[i] === '}') depth--
    i++
  }
  return content.slice(openBrace + 1, i - 1)
}

function stripComments(code: string): string {
  return code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}
