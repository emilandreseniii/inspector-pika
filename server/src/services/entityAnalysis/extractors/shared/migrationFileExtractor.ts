import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { BaseExtractor, ExtractorResult, RawEntity } from '../base'
import { parseSqlDdl } from './sqlDdlExtractor'

/**
 * Processes SQL migration files in chronological order, accumulating CREATE TABLE
 * and ALTER TABLE ADD COLUMN operations into a final schema state.
 *
 * Supports: Flyway (V1__name.sql), generic timestamp-prefixed files,
 * and plain numbered files (001_name.sql).
 */
export class MigrationFileExtractor extends BaseExtractor {
  readonly extractorId = 'cross-language.migration_files'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []

    // Collect all SQL files that look like migration files
    const sqlFiles = await this.glob('**/*.sql')
    const migrationFiles = sqlFiles
      .filter(isMigrationFile)
      .sort(compareMigrationFiles)

    if (migrationFiles.length === 0) {
      return { entities: [], warnings, stats: { filesScanned: 0, entitiesFound: 0, extractionTimeMs: Date.now() - start } }
    }

    // Also look for Liquibase changelog XML files
    const xmlFiles = await this.glob('**/*.xml')
    const liquibaseFiles = xmlFiles.filter((f) => /liquibase|changelog/i.test(f))

    const entityMap = new Map<string, RawEntity>()

    // Process SQL migration files in order
    for (const file of migrationFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseSqlDdl(content, file, this.extractorId)

        for (const entity of parsed) {
          if (entity.entityType === 'table') {
            entityMap.set(entity.name.toLowerCase(), entity)
          }
        }

        // Handle ALTER TABLE ADD COLUMN
        processAlterStatements(content, file, entityMap, this.extractorId)

        // Handle DROP TABLE
        processDropStatements(content, entityMap)
      } catch (err) {
        warnings.push(`Failed to parse migration ${file}: ${(err as Error).message}`)
      }
    }

    // Process Liquibase XML files
    for (const file of liquibaseFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseLiquibaseXml(content, file, this.extractorId)
        for (const entity of parsed) {
          if (!entityMap.has(entity.name.toLowerCase())) {
            entityMap.set(entity.name.toLowerCase(), entity)
          }
        }
      } catch (err) {
        warnings.push(`Failed to parse Liquibase file ${file}: ${(err as Error).message}`)
      }
    }

    const entities = [...entityMap.values()]

    return {
      entities,
      warnings,
      stats: {
        filesScanned: migrationFiles.length + liquibaseFiles.length,
        entitiesFound: entities.length,
        extractionTimeMs: Date.now() - start,
      },
    }
  }
}

function isMigrationFile(filePath: string): boolean {
  const basename = filePath.split('/').pop() ?? ''
  // Flyway: V1__name.sql, V1.2__name.sql
  if (/^V\d+[._]\d*__/i.test(basename)) return true
  // Numbered: 001_name.sql, 20240101_name.sql
  if (/^\d+[_-]/.test(basename)) return true
  // In a migrations/ directory
  if (/\/(migrations?|flyway|db\/migrate)\//i.test(filePath)) return true
  return false
}

function compareMigrationFiles(a: string, b: string): number {
  const numA = extractMigrationNum(a)
  const numB = extractMigrationNum(b)
  return numA - numB
}

function extractMigrationNum(filePath: string): number {
  const basename = filePath.split('/').pop() ?? ''
  const m = basename.match(/^[Vv]?(\d+)/)
  return m ? parseInt(m[1]) : 0
}

function processAlterStatements(content: string, file: string, entityMap: Map<string, RawEntity>, extractorId: string): void {
  const stripped = content.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  // ALTER TABLE name ADD [COLUMN] colname coltype [constraints]
  const alterPattern = /ALTER\s+TABLE\s+([`"\[]?[\w.]+[`"\]]?)\s+ADD\s+(?:COLUMN\s+)?([`"\[]?[\w]+[`"\]]?)\s+([\w]+(?:\s*\([^)]*\))?[^,;]*)/gi
  let m: RegExpExecArray | null
  while ((m = alterPattern.exec(stripped)) !== null) {
    const rawTableName = unquote(m[1]).split('.').pop()!
    const tableKey = rawTableName.toLowerCase()
    const entity = entityMap.get(tableKey)
    if (!entity) continue

    const colName = unquote(m[2])
    if (entity.fields.some((f) => f.name.toLowerCase() === colName.toLowerCase())) continue

    const colType = m[3].trim()
    entity.fields.push({
      name: colName,
      type: colType.split(/\s+/)[0],
      nullable: /\bNOT\s+NULL\b/i.test(colType) ? false : null,
      isPrimaryKey: false,
      isForeignKey: /\bREFERENCES\b/i.test(colType),
      isUnique: /\bUNIQUE\b/i.test(colType),
      defaultValue: null,
      ordinalPosition: entity.fields.length + 1,
      metadata: { addedViaAlter: true, sourceFile: file, extractorId },
    })
  }
}

function processDropStatements(content: string, entityMap: Map<string, RawEntity>): void {
  const stripped = content.replace(/--[^\n]*/g, '')
  const dropPattern = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([`"\[]?[\w.]+[`"\]]?)/gi
  let m: RegExpExecArray | null
  while ((m = dropPattern.exec(stripped)) !== null) {
    const rawName = unquote(m[1]).split('.').pop()!
    entityMap.delete(rawName.toLowerCase())
  }
}

function parseLiquibaseXml(content: string, file: string, extractorId: string): RawEntity[] {
  const entities: RawEntity[] = []

  // <createTable tableName="...">
  const createTablePattern = /<createTable\s+[^>]*tableName\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/createTable>/g
  let m: RegExpExecArray | null

  while ((m = createTablePattern.exec(content)) !== null) {
    const tableName = m[1]
    const body = m[2]
    const fields = parseLiquibaseColumns(body)

    entities.push({
      name: tableName,
      entityType: 'table',
      fields,
      relationships: [],
      source: { file, startLine: null, endLine: null, format: 'liquibase_xml', extractorId },
      extractorId,
      confidence: 'high',
      metadata: {},
    })
  }

  return entities
}

function parseLiquibaseColumns(body: string): RawEntity['fields'] {
  const fields: RawEntity['fields'] = []
  let pos = 1

  const colPattern = /<column\s+([^>]*?)\/?>/g
  let m: RegExpExecArray | null
  while ((m = colPattern.exec(body)) !== null) {
    const attrs = m[1]
    const name = extractAttr(attrs, 'name')
    if (!name) continue
    const rawType = extractAttr(attrs, 'type') ?? 'unknown'

    fields.push({
      name,
      type: rawType,
      nullable: null,
      isPrimaryKey: false,
      isForeignKey: false,
      isUnique: false,
      defaultValue: extractAttr(attrs, 'defaultValue'),
      ordinalPosition: pos++,
      metadata: {},
    })
  }

  return fields
}

function extractAttr(attrs: string, name: string): string | null {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`))
  return m ? m[1] : null
}

function unquote(s: string): string {
  return s.replace(/^[`"\[]/, '').replace(/[`"\]]$/, '')
}

// Needed to resolve migration dirs at runtime
export async function findMigrationDirs(sourceDir: string): Promise<string[]> {
  const candidates = ['db/migrate', 'migrations', 'migration', 'flyway', 'liquibase', 'db/migrations', 'database/migrations']
  const found: string[] = []
  for (const candidate of candidates) {
    const full = join(sourceDir, candidate)
    try {
      await readdir(full)
      found.push(candidate)
    } catch { /* not found */ }
  }
  return found
}
