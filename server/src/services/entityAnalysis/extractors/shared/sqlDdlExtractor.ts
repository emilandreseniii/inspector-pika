import { BaseExtractor, ExtractorResult, RawEntity, RawField } from '../base'

export class SqlDdlExtractor extends BaseExtractor {
  readonly extractorId = 'cross-language.sql_ddl'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []

    const sqlFiles = await this.glob('**/*.sql')
    const schemaFiles = sqlFiles.filter((f) => !isSeedOrFixture(f))

    for (const file of schemaFiles) {
      try {
        const content = await this.readFile(file)
        if (!hasSchemaContent(content)) continue
        const parsed = parseSqlDdl(content, file, this.extractorId)
        entities.push(...parsed)
      } catch (err) {
        warnings.push(`Failed to parse SQL in ${file}: ${(err as Error).message}`)
      }
    }

    return {
      entities,
      warnings,
      stats: { filesScanned: schemaFiles.length, entitiesFound: entities.length, extractionTimeMs: Date.now() - start },
    }
  }
}

function isSeedOrFixture(filePath: string): boolean {
  return /\/(seed|seeds|fixture|fixtures|testdata|test_data|data)\//i.test(filePath)
}

function hasSchemaContent(content: string): boolean {
  return /\bCREATE\s+TABLE\b/i.test(content)
}

export function parseSqlDdl(content: string, file: string, extractorId: string): RawEntity[] {
  const entities: RawEntity[] = []

  // Strip comments
  const stripped = content
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')

  // Match CREATE TABLE [IF NOT EXISTS] name (...)
  const createTablePattern = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"\[]?[\w.]+[`"\]]?)\s*\(([^;]*)\)/gi
  let m: RegExpExecArray | null

  while ((m = createTablePattern.exec(stripped)) !== null) {
    const rawName = unquote(m[1])
    // Strip schema prefix (schema.table → table)
    const tableName = rawName.includes('.') ? rawName.split('.').pop()! : rawName
    const body = m[2]

    const fields = parseColumnDefs(body)

    entities.push({
      name: tableName,
      entityType: 'table',
      fields,
      relationships: extractFkRelationships(body, extractorId),
      source: { file, startLine: null, endLine: null, format: 'sql_ddl', extractorId },
      extractorId,
      confidence: 'high',
      metadata: {},
    })
  }

  // Match CREATE VIEW name AS ...
  const createViewPattern = /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+([`"\[]?[\w.]+[`"\]]?)\s+AS\s/gi
  while ((m = createViewPattern.exec(stripped)) !== null) {
    const rawName = unquote(m[1])
    const viewName = rawName.includes('.') ? rawName.split('.').pop()! : rawName
    entities.push({
      name: viewName,
      entityType: 'view',
      fields: [],
      relationships: [],
      source: { file, startLine: null, endLine: null, format: 'sql_view', extractorId },
      extractorId,
      confidence: 'medium',
      metadata: {},
    })
  }

  return entities
}

function parseColumnDefs(body: string): RawField[] {
  const fields: RawField[] = []
  let pos = 1

  // Split on commas that are not inside parentheses
  const parts = splitTopLevel(body)

  for (const part of parts) {
    const trimmed = part.trim()

    // Skip constraint definitions
    if (/^(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|INDEX|KEY|CONSTRAINT)\b/i.test(trimmed)) continue

    // Column definition: name type [constraints]
    const colMatch = trimmed.match(/^([`"\[]?[\w]+[`"\]]?)\s+([\w]+(?:\s*\([^)]*\))?(?:\s+(?:WITHOUT\s+TIME\s+ZONE|WITH\s+TIME\s+ZONE|VARYING|PRECISION))?)(.*)$/i)
    if (!colMatch) continue

    const colName = unquote(colMatch[1])
    const rawType = colMatch[2].trim()
    const rest = colMatch[3] ?? ''

    const isNotNull = /\bNOT\s+NULL\b/i.test(rest)
    const isNull = /(?<!\bNOT\s)\bNULL\b/i.test(rest)
    const isPK = /\bPRIMARY\s+KEY\b/i.test(rest)
    const isUnique = /\bUNIQUE\b/i.test(rest)
    const isAutoIncrement = /\b(AUTO_INCREMENT|AUTOINCREMENT|SERIAL|BIGSERIAL|SMALLSERIAL|GENERATED\s+(?:ALWAYS|BY\s+DEFAULT)\s+AS\s+IDENTITY)\b/i.test(rawType + ' ' + rest)

    const defaultMatch = rest.match(/\bDEFAULT\s+(\S+)/i)
    const defaultValue = defaultMatch ? defaultMatch[1].replace(/^['"]|['"]$/g, '') : null

    const refsMatch = rest.match(/\bREFERENCES\s+([`"\[]?[\w]+[`"\]]?)\s*\(([^)]+)\)/i)
    const isForeignKey = !!refsMatch
    const metadata: Record<string, unknown> = {}
    if (isAutoIncrement) metadata.autoIncrement = true
    if (refsMatch) {
      metadata.referencedTable = unquote(refsMatch[1])
      metadata.referencedField = unquote(refsMatch[2].trim())
    }

    fields.push({
      name: colName,
      type: rawType,
      nullable: isNotNull ? false : isNull ? true : isPK ? false : null,
      isPrimaryKey: isPK,
      isForeignKey,
      isUnique: isUnique || isPK,
      defaultValue,
      ordinalPosition: pos++,
      metadata,
    })
  }

  return fields
}

type FkRel = { type: 'many_to_one'; targetEntity: string; sourceField: string; targetField: string; metadata: Record<string, never> }

function extractFkRelationships(body: string, _extractorId: string): FkRel[] {
  const rels: FkRel[] = []
  // FOREIGN KEY (col) REFERENCES table(col)
  const fkPattern = /FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+([`"\[]?[\w]+[`"\]]?)\s*\(([^)]+)\)/gi
  let m: RegExpExecArray | null
  while ((m = fkPattern.exec(body)) !== null) {
    rels.push({
      type: 'many_to_one' as const,
      targetEntity: unquote(m[2]),
      sourceField: unquote(m[1].trim()),
      targetField: unquote(m[3].trim()),
      metadata: {},
    })
  }
  return rels
}

function unquote(s: string): string {
  return s.replace(/^[`"\[]/, '').replace(/[`"\]]$/, '')
}

function splitTopLevel(s: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim()) parts.push(current)
  return parts
}
