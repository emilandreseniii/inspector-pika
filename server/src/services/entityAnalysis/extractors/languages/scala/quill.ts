import { BaseExtractor, ExtractorResult, RawEntity, RawField } from '../../base'

/**
 * Extracts entity definitions from Quill (Scala).
 *
 * Quill uses case classes as entity types with `query[T]`:
 *   case class User(id: Long, name: String, email: Option[String])
 *   ctx.run(query[User])
 *   ctx.run(query[User].filter(_.id == id))
 *   quote { query[User].insert(lift(user)) }
 *
 * Entity name is derived from case class name (snake_case).
 */

export class QuillExtractor extends BaseExtractor {
  readonly extractorId = 'scala.quill'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []
    let filesScanned = 0

    const hits = await this.grep('**/*.scala', /ctx\.run\s*\(\s*query\[|quote\s*\{[^}]*query\[/)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        if (!isQuillFile(content)) continue
        filesScanned++
        const parsed = parseQuillFile(content, file, this.extractorId)
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

function isQuillFile(content: string): boolean {
  return /io\.getquill|import.*quill|MysqlJdbcContext|PostgresJdbcContext|H2JdbcContext/.test(content)
}

function parseQuillFile(content: string, file: string, extractorId: string): RawEntity[] {
  const stripped = stripComments(content)

  // Collect entity types used in query[T]
  const entityTypes = new Set<string>()
  for (const m of stripped.matchAll(/\bquery\s*\[\s*([\w.]+)\s*\]/g)) {
    entityTypes.add(m[1])
  }

  if (entityTypes.size === 0) return []

  const entities: RawEntity[] = []

  for (const typeName of entityTypes) {
    const simpleType = typeName.split('.').pop() ?? typeName

    // Find case class definition
    const caseClassRe = new RegExp(`case\\s+class\\s+${simpleType}\\s*\\(([^)]+)\\)`)
    const classMatch = stripped.match(caseClassRe)
    if (!classMatch) continue

    const fields: RawField[] = []
    let pos = 0

    for (const param of classMatch[1].split(',')) {
      const paramMatch = param.trim().match(/(\w+)\s*:\s*(Option\s*\[)?\s*([\w.]+)/)
      if (!paramMatch) continue
      const [, name, optionalMark, scalaType] = paramMatch
      const isOption = !!optionalMark

      fields.push({
        name: toSnake(name),
        type: scalaTypeToSql(scalaType),
        nullable: isOption,
        isPrimaryKey: name === 'id',
        isForeignKey: false,
        isUnique: false,
        defaultValue: null,
        ordinalPosition: pos++,
        metadata: { scalaFieldName: name },
      })
    }

    if (fields.length === 0) continue

    entities.push({
      name: toSnake(simpleType),
      entityType: 'table',
      fields,
      relationships: [],
      source: { file, startLine: 1, endLine: null, format: 'scala', extractorId },
      extractorId,
      confidence: 'medium',
      metadata: { caseClass: simpleType },
    })
  }

  return entities
}

// ---- Helpers ----

function scalaTypeToSql(t: string): string {
  const map: Record<string, string> = {
    Long: 'bigint', Int: 'integer', Short: 'integer',
    Double: 'float', Float: 'float', BigDecimal: 'decimal',
    Boolean: 'boolean', String: 'string',
    LocalDate: 'date', LocalDateTime: 'datetime', Instant: 'datetime',
    UUID: 'uuid',
  }
  return map[t] ?? 'string'
}

function toSnake(name: string): string {
  return name.replace(/([A-Z])/g, (m, c, i) => (i > 0 ? '_' : '') + c.toLowerCase())
}

function stripComments(code: string): string {
  return code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}
