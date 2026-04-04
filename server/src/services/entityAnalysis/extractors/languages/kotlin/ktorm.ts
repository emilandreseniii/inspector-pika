import { BaseExtractor, ExtractorResult, RawEntity, RawField } from '../../base'
import { toSnakeCase } from '../../../normalizer'

/**
 * Extracts entity surfaces from Kotlin KTorm ORM.
 *
 * KTorm uses Kotlin object declarations extending Table<EntityType>:
 *
 *   object Employees : Table<Employee>("t_employee") {
 *     val id = int("id").primaryKey().bindTo { it.id }
 *     val name = varchar("name").bindTo { it.name }
 *     val departmentId = int("department_id").references(Departments) { it.department }
 *     val hireDate = date("hire_date").bindTo { it.hireDate }
 *   }
 *
 * Also handles Table<Nothing> for tables without entity binding:
 *   object Users : Table<Nothing>("users") { ... }
 */
export class KtormExtractor extends BaseExtractor {
  readonly extractorId = 'kotlin.ktorm'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []

    const hits = await this.grep('**/*.{kt,kts}', /:\s*Table\s*</, 2000)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]
    let filesScanned = 0

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        filesScanned++
        entities.push(...parseKtormFile(content, file, this.extractorId))
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

function parseKtormFile(content: string, file: string, extractorId: string): RawEntity[] {
  const stripped = stripComments(content)
  const lines = stripped.split('\n')
  const entities: RawEntity[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // object Employees : Table<Employee>("t_employee") {
    // object Users : Table<Nothing>("users") {
    const objectMatch = line.match(/\bobject\s+(\w+)\s*/)
    if (!objectMatch) continue

    const tableMatch = line.match(/:\s*Table\s*<[^>]*>\s*(?:\(\s*["']([^"']+)["']\s*\))?/)
    if (!tableMatch) continue

    const objectName = objectMatch[1]
    const tableName = tableMatch[1] ?? toSnakeCase(objectName)
    const fields: RawField[] = []

    // Parse object body
    let depth = 0
    let inObject = false
    for (let j = i; j < lines.length && j < i + 200; j++) {
      const t = lines[j]
      for (const ch of t) { if (ch === '{') depth++; else if (ch === '}') depth-- }
      if (depth > 0) inObject = true
      if (inObject && depth === 0) break

      const trimmed = t.trim()

      // val id = int("id").primaryKey().bindTo { it.id }
      // val name = varchar("name").bindTo { it.name }
      // val departmentId = int("department_id").references(Departments) { it.department }
      const colMatch = trimmed.match(/\bval\s+(\w+)\s*=\s*(\w+)\s*\(\s*["']([^"']+)["']/)
      if (!colMatch) continue

      const propName = colMatch[1]
      const ktormType = colMatch[2]
      const colName = colMatch[3]

      const isPk = t.includes('.primaryKey()')
      const isNullable = t.includes('.nullable()')
      const isFk = t.includes('.references(')

      fields.push({
        name: propName,
        normalizedName: colName,
        dataType: mapKtormType(ktormType),
        nativeType: ktormType,
        isNullable: isNullable ? true : null,
        isPrimaryKey: isPk,
        isForeignKey: isFk,
        isUnique: false,
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

function mapKtormType(t: string): string {
  const lower = t.toLowerCase()
  if (/varchar|text|char/.test(lower)) return 'string'
  if (/long/.test(lower)) return 'bigint'
  if (/int/.test(lower)) return 'integer'
  if (/float|double|decimal|numeric/.test(lower)) return 'float'
  if (/bool/.test(lower)) return 'boolean'
  if (/datetime|timestamp/.test(lower)) return 'datetime'
  if (/date/.test(lower)) return 'date'
  if (/uuid/.test(lower)) return 'uuid'
  if (/blob|binary|bytes/.test(lower)) return 'binary'
  if (/json/.test(lower)) return 'json'
  return 'string'
}

function stripComments(code: string): string {
  return code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}
