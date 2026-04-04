import { BaseExtractor, ExtractorResult, RawEntity, RawField } from '../../base'

/**
 * Extracts entity definitions from Doobie (Scala).
 *
 * Doobie uses SQL string interpolation to query typed results:
 *   sql"SELECT id, name, email FROM users".query[User]
 *   sql"SELECT * FROM posts WHERE user_id = $userId".query[Post]
 *
 * We extract:
 *   1. Case classes used as query[T] result types (via companion object scanning)
 *   2. Basic field info from the case class definition
 *
 * Since Doobie doesn't carry schema metadata in code (it's in SQL queries),
 * we extract case class shapes used as result types.
 */

export class DoobieExtractor extends BaseExtractor {
  readonly extractorId = 'scala.doobie'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []
    let filesScanned = 0

    // Find files using doobie's sql interpolator
    const hits = await this.grep('**/*.scala', /sql"[^"]*"\s*\.query\[|\.update\.run|fr"[^"]*"/)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        if (!isDoobieFile(content)) continue
        filesScanned++
        const parsed = parseDoobieFile(content, file, this.extractorId)
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

function isDoobieFile(content: string): boolean {
  return /doobie\.|import\s+doobie/.test(content)
}

function parseDoobieFile(content: string, file: string, extractorId: string): RawEntity[] {
  const stripped = stripComments(content)

  // Collect all result types used in .query[T] calls
  const resultTypes = new Set<string>()
  for (const m of stripped.matchAll(/\.query\s*\[\s*([\w.]+)\s*\]/g)) {
    resultTypes.add(m[1])
  }

  if (resultTypes.size === 0) return []

  // Extract table name from sql"SELECT ... FROM tableName"
  // Map type → table name
  const typeTableMap = new Map<string, string>()
  for (const m of stripped.matchAll(/sql\s*"[^"]*FROM\s+(\w+)[^"]*"\s*\.query\s*\[\s*([\w.]+)\s*\]/gi)) {
    typeTableMap.set(m[2], m[1])
  }

  const entities: RawEntity[] = []

  // For each result type, find its case class definition
  for (const typeName of resultTypes) {
    const simpleType = typeName.split('.').pop() ?? typeName
    const tableName = typeTableMap.get(typeName) ?? typeTableMap.get(simpleType) ?? toSnake(simpleType)

    // Find case class definition: case class Foo(id: Long, name: String, ...)
    const caseClassRe = new RegExp(`case\\s+class\\s+${simpleType}\\s*\\(([^)]+)\\)`)
    const classMatch = stripped.match(caseClassRe)
    if (!classMatch) continue

    const fields: RawField[] = []
    let pos = 0

    for (const param of classMatch[1].split(',')) {
      const paramMatch = param.trim().match(/(\w+)\s*:\s*(?:Option\s*\[)?\s*([\w.]+)/)
      if (!paramMatch) continue
      const [, name, scalaType] = paramMatch
      const isOption = /Option\s*\[/.test(param)

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
      name: tableName,
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
