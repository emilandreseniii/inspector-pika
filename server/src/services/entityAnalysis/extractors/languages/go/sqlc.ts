import { BaseExtractor, ExtractorResult, RawEntity, RawField } from '../../base'

export class SqlcExtractor extends BaseExtractor {
  readonly extractorId = 'go.sqlc'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []

    // Find sqlc-generated Go files (queries.sql.go or *.sql.go)
    const generatedFiles = await this.glob('**/*.sql.go')
    // Also look for raw .sql query files with -- name: ... annotations
    const sqlFiles = await this.glob('**/*.sql')

    const allFiles = [...new Set([...generatedFiles, ...sqlFiles])]
    let filesScanned = 0

    for (const file of allFiles) {
      try {
        const content = await this.readFile(file)
        filesScanned++
        let fileEntities: RawEntity[]
        if (file.endsWith('.sql.go')) {
          fileEntities = parseSqlcGeneratedGo(content, file, this.extractorId)
        } else {
          fileEntities = parseSqlQueryFile(content, file, this.extractorId)
        }
        entities.push(...fileEntities)
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

// ---- Parse sqlc-generated Go file (queries.sql.go) ----

function parseSqlcGeneratedGo(content: string, file: string, extractorId: string): RawEntity[] {
  const entities: RawEntity[] = []
  const stripped = stripComments(content)
  const lines = stripped.split('\n')

  // Look for named result structs: type GetUserRow struct { ... }
  let i = 0
  while (i < lines.length) {
    const line = lines[i].trim()

    const structMatch = line.match(/^type\s+(\w+(?:Row|Result|Params))\s+struct\s*\{/)
    if (!structMatch) { i++; continue }

    const structName = structMatch[1]
    const fields: RawField[] = []

    i++
    while (i < lines.length) {
      const fieldLine = lines[i].trim()
      if (fieldLine === '}') { i++; break }
      if (!fieldLine || fieldLine.startsWith('//')) { i++; continue }

      // FieldName Type `json:"..." db:"..."`
      const fieldMatch = fieldLine.match(/^(\w+)\s+([\w*.[\]]+)\s*(?:`([^`]*)`)?/)
      if (fieldMatch) {
        const fieldName = fieldMatch[1]
        const goType = fieldMatch[2]
        const tags = fieldMatch[3] ?? ''

        // Column name from db: or json: tag
        const dbTag = tags.match(/db:"([^"]+)"/)
        const jsonTag = tags.match(/json:"([^",]+)/)
        const columnName = dbTag?.[1] ?? jsonTag?.[1] ?? toSnakeCase(fieldName)
        const type = goTypeToNormalized(goType)

        if (fieldName && type) {
          fields.push({ name: fieldName, columnName, type, nullable: null })
        }
      }
      i++
    }

    if (fields.length > 0) {
      entities.push({
        name: structName,
        entityType: 'query_result',
        fields,
        relationships: [],
        source: { file, line: i, extractorId },
        confidence: 'high',
      })
    }
  }

  return entities
}

// ---- Parse raw SQL query file with sqlc annotations ----

function parseSqlQueryFile(content: string, file: string, extractorId: string): RawEntity[] {
  const entities: RawEntity[] = []

  // -- name: GetUser :one or -- name: ListUsers :many
  const queryPattern = /--\s*name:\s*(\w+)\s*:(\w+)/g
  let match: RegExpExecArray | null

  while ((match = queryPattern.exec(content)) !== null) {
    const queryName = match[1]
    const queryType = match[2]  // one, many, exec, execresult, execrows, batchexec, batchmany, batchone

    const sourceLine = content.slice(0, match.index).split('\n').length

    // Extract the SQL statement after this annotation (until next -- name: or end of file)
    const stmtStart = match.index + match[0].length
    const nextAnnot = content.indexOf('-- name:', stmtStart)
    const stmtEnd = nextAnnot !== -1 ? nextAnnot : content.length
    const stmt = content.slice(stmtStart, stmtEnd).trim()

    // Extract columns from SELECT clause (simple heuristic)
    const fields = extractSelectColumns(stmt)

    entities.push({
      name: queryName,
      entityType: 'named_query',
      fields,
      relationships: [],
      source: { file, line: sourceLine, extractorId },
      confidence: 'medium',
      metadata: { queryType },
    })
  }

  return entities
}

// ---- Extract column names from SELECT statement ----

function extractSelectColumns(sql: string): RawField[] {
  const fields: RawField[] = []

  // Find SELECT ... FROM
  const selectMatch = sql.match(/SELECT\s+([\s\S]+?)\s+FROM\s/i)
  if (!selectMatch) return fields

  const colsPart = selectMatch[1]
  if (colsPart.trim() === '*') return fields  // Can't infer columns from *

  // Split by comma (simplified — doesn't handle subqueries)
  const cols = colsPart.split(',')
  for (const col of cols) {
    const trimmed = col.trim()
    // colname or alias AS colname or table.colname
    const aliasMatch = trimmed.match(/\bas\s+(\w+)\s*$/i)
    if (aliasMatch) {
      fields.push({ name: aliasMatch[1], type: 'unknown', nullable: null })
    } else {
      const nameMatch = trimmed.match(/(?:\w+\.)?(\w+)\s*$/)
      if (nameMatch) fields.push({ name: nameMatch[1], type: 'unknown', nullable: null })
    }
  }

  return fields
}

// ---- Helpers ----

function goTypeToNormalized(goType: string): string | undefined {
  const t = goType.replace(/^\*/, '').replace(/^\[\]/, '').replace(/^sql\.Null/, '')
  const map: Record<string, string> = {
    string: 'string', String: 'string',
    int: 'integer', int32: 'integer', int64: 'integer',
    float32: 'float', float64: 'float',
    bool: 'boolean',
    'time.Time': 'datetime',
    'pgtype.Text': 'string',
    'pgtype.Int4': 'integer',
    'pgtype.Int8': 'integer',
    'pgtype.Bool': 'boolean',
    'pgtype.Float4': 'float',
    'pgtype.Float8': 'float',
    'pgtype.Timestamptz': 'datetime',
    'pgtype.UUID': 'uuid',
    'pgtype.JSONB': 'json',
  }
  return map[t] ?? t.toLowerCase()
}

function toSnakeCase(name: string): string {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .toLowerCase()
}

function stripComments(code: string): string {
  let result = code.replace(/\/\/.*$/gm, '')
  result = result.replace(/\/\*[\s\S]*?\*\//g, '')
  return result
}
