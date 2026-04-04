import { BaseExtractor, ExtractorResult, RawEntity, RawField } from '../../base'
import { toSnakeCase } from '../../../normalizer'

/**
 * Extracts entity surfaces from Kotlin Exposed ORM.
 *
 * Exposed uses Kotlin object declarations that extend Table:
 *
 *   object Users : Table("users") {
 *     val id = integer("id").autoIncrement()
 *     val name = varchar("name", 255)
 *     val email = varchar("email", 255).uniqueIndex()
 *     val createdAt = datetime("created_at")
 *     override val primaryKey = PrimaryKey(id)
 *   }
 *
 * Also supports IntIdTable / LongIdTable / UUIDTable:
 *   object Posts : IntIdTable("posts") {
 *     val title = varchar("title", 200)
 *     val authorId = integer("author_id").references(Users.id)
 *   }
 */
export class ExposedExtractor extends BaseExtractor {
  readonly extractorId = 'kotlin.exposed'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []

    const hits = await this.grep('**/*.{kt,kts}', /:\s*(?:Int|Long|UUID)?(?:Id)?Table\s*\(/, 2000)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]
    let filesScanned = 0

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        filesScanned++
        entities.push(...parseExposedFile(content, file, this.extractorId))
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

// ---- File parser ----

const TABLE_BASE_RE = /:\s*(?:Int|Long|UUID|IntId|LongId|UUIDId)?(?:IdTable|Table)\s*(?:\(\s*["']([^"']+)["']\s*\))?/

function parseExposedFile(content: string, file: string, extractorId: string): RawEntity[] {
  const stripped = stripComments(content)
  const lines = stripped.split('\n')
  const entities: RawEntity[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // object Users : Table("users") {
    // object Posts : IntIdTable("posts") {
    // object Foos : Table {   (no explicit name)
    const objectMatch = line.match(/\bobject\s+(\w+)\s*/)
    if (!objectMatch) continue

    const tableBaseMatch = line.match(TABLE_BASE_RE)
    if (!tableBaseMatch) continue

    const objectName = objectMatch[1]
    const tableName = tableBaseMatch[1] ?? toSnakeCase(objectName)
    const fields: RawField[] = []

    // Check for implicit id from IntIdTable / LongIdTable / UUIDTable
    const hasImplicitId = /:\s*(?:Int|Long|UUID)IdTable/.test(line)
    if (hasImplicitId) {
      const idType = /IntIdTable/.test(line) ? 'integer' : /LongIdTable/.test(line) ? 'bigint' : 'uuid'
      fields.push({
        name: 'id',
        normalizedName: 'id',
        dataType: idType,
        nativeType: idType,
        isNullable: false,
        isPrimaryKey: true,
        isForeignKey: false,
        isUnique: true,
        ordinalPosition: 0,
        metadata: {},
      })
    }

    // Parse object body
    let depth = 0
    let inObject = false
    for (let j = i; j < lines.length && j < i + 200; j++) {
      const t = lines[j]
      for (const ch of t) { if (ch === '{') depth++; else if (ch === '}') depth-- }
      if (depth > 0) inObject = true
      if (inObject && depth === 0) break

      const trimmed = t.trim()

      // val name = varchar("col_name", length)  or  val id = integer("id").autoIncrement()
      // val authorId = integer("author_id").references(Users.id)
      // override val primaryKey = PrimaryKey(id)
      if (trimmed.startsWith('override') && /primaryKey/.test(trimmed)) {
        // Extract column names from PrimaryKey(col1, col2)
        const pkMatch = trimmed.match(/PrimaryKey\s*\(([^)]+)\)/)
        if (pkMatch) {
          const pkCols = pkMatch[1].split(',').map((s) => s.trim())
          for (const col of pkCols) {
            const existing = fields.find((f) => f.name === col)
            if (existing) existing.isPrimaryKey = true
          }
        }
        continue
      }

      const colMatch = trimmed.match(/\bval\s+(\w+)\s*=\s*(\w+)\s*\(\s*["']([^"']+)["']/)
      if (!colMatch) continue

      const propName = colMatch[1]
      const exposedType = colMatch[2]
      const colName = colMatch[3]

      if (propName === 'primaryKey') continue // handled above

      const isNullable = t.includes('.nullable()')
      const isUnique = t.includes('.uniqueIndex()') || t.includes('.unique()')
      const isFk = t.includes('.references(')
      const isPk = t.includes('.autoIncrement()') && !hasImplicitId

      fields.push({
        name: propName,
        normalizedName: colName,
        dataType: mapExposedType(exposedType),
        nativeType: exposedType,
        isNullable: isNullable ? true : null,
        isPrimaryKey: isPk,
        isForeignKey: isFk,
        isUnique,
        ordinalPosition: fields.length,
        metadata: {},
      })
    }

    entities.push({
      name: objectName,
      normalizedName: toSnakeCase(objectName),
      tableName,
      entityType: 'table',
      fields,
      relationships: [],
      confidence: 'high',
      source: { file, line: i + 1, extractorId },
    })
  }

  return entities
}

// ---- Helpers ----

function mapExposedType(t: string): string {
  const lower = t.toLowerCase()
  if (/varchar|text|char/.test(lower)) return 'string'
  if (/integer|int/.test(lower)) return 'integer'
  if (/long/.test(lower)) return 'bigint'
  if (/float|double|decimal/.test(lower)) return 'float'
  if (/bool/.test(lower)) return 'boolean'
  if (/datetime|timestamp/.test(lower)) return 'datetime'
  if (/date/.test(lower)) return 'date'
  if (/uuid/.test(lower)) return 'uuid'
  if (/blob|binary/.test(lower)) return 'binary'
  return 'string'
}

function stripComments(code: string): string {
  return code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}
