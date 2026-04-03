import { BaseExtractor, ExtractorResult, RawEntity, RawField } from '../../base'

// Drizzle table factory functions per dialect
const TABLE_FACTORIES = ['pgTable', 'mysqlTable', 'sqliteTable', 'pgSchema', 'mysqlSchema']

// Drizzle column type → normalized type
const DRIZZLE_TYPE_MAP: Record<string, string> = {
  serial: 'integer',
  bigserial: 'bigint',
  integer: 'integer',
  bigint: 'bigint',
  smallint: 'integer',
  int: 'integer',
  real: 'float',
  doublePrecision: 'float',
  numeric: 'decimal',
  decimal: 'decimal',
  varchar: 'string',
  char: 'string',
  text: 'string',
  boolean: 'boolean',
  json: 'json',
  jsonb: 'json',
  timestamp: 'datetime',
  timestamptz: 'datetime',
  date: 'date',
  time: 'time',
  uuid: 'uuid',
  blob: 'bytes',
  // mysql-specific
  tinyint: 'integer',
  mediumint: 'integer',
  float: 'float',
  double: 'float',
  year: 'integer',
  binary: 'bytes',
  varbinary: 'bytes',
  // sqlite
  blob_: 'bytes',
}

export class DrizzleExtractor extends BaseExtractor {
  readonly extractorId = 'typescript.drizzle'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []

    const hits = await this.grep(
      '**/*.{ts,mts}',
      /(?:pgTable|mysqlTable|sqliteTable)\s*\(/,
      2000,
    )
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]
    let filesScanned = 0

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        filesScanned++
        const fileEntities = parseDrizzleFile(content, file, this.extractorId)
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

// ---- File parser ----

function parseDrizzleFile(content: string, file: string, extractorId: string): RawEntity[] {
  const entities: RawEntity[] = []
  const stripped = stripComments(content)

  // Find all: export const users = pgTable('users', { ... })
  //       or: export const users = pgTable('users', { ... }, (t) => [...])
  const tablePattern = new RegExp(
    `(?:export\\s+(?:const|let|var)\\s+)(\\w+)\\s*=\\s*(?:${TABLE_FACTORIES.map(escapeRegex).join('|')})\\s*\\(\\s*(['"\`])([^'"` + '`' + `]*)\\2`,
    'g',
  )

  let match: RegExpExecArray | null
  while ((match = tablePattern.exec(stripped)) !== null) {
    const varName = match[1]
    const tableName = match[3]

    // Find the opening brace of the columns object
    const afterQuote = stripped.indexOf(',', match.index + match[0].length - 1)
    if (afterQuote === -1) continue

    const openBrace = stripped.indexOf('{', afterQuote)
    if (openBrace === -1) continue

    const body = extractToMatchingBrace(stripped, openBrace)
    if (!body) continue

    const fields = parseColumnsObject(body, file)
    if (fields.length === 0) continue

    const sourceLine = stripped.slice(0, match.index).split('\n').length

    entities.push({
      name: varName,
      tableName,
      entityType: 'table',
      fields,
      relationships: [],
      source: { file, line: sourceLine, extractorId },
      confidence: 'high',
    })
  }

  return entities
}

// ---- Parse columns object body ----

function parseColumnsObject(body: string, _file: string): RawField[] {
  const fields: RawField[] = []
  const lines = body.split('\n')

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    // fieldName: columnType('col_name')... or fieldName: columnType()...
    // e.g.: id: serial('id').primaryKey(),
    //       name: varchar('name', { length: 255 }).notNull(),
    //       email: text('email').notNull().unique(),
    const fieldMatch = line.match(/^(\w+)\s*:\s*(\w+)\s*\(\s*(?:['"`]([^'"`]*)['"`])?\s*/)
    if (!fieldMatch) continue

    const fieldName = fieldMatch[1]
    // skip if this looks like a computed expression
    if (['if', 'for', 'return', 'const', 'let', 'var'].includes(fieldName)) continue

    const columnFn = fieldMatch[2]
    const columnName = fieldMatch[3] ?? fieldName

    // Skip non-column entries
    if (!DRIZZLE_TYPE_MAP[columnFn] && !columnFn.endsWith('Column')) {
      // Allow any fn that looks like a column builder (e.g., serial, text, integer)
      if (!/^(?:serial|bigserial|integer|bigint|smallint|int|real|double|float|decimal|numeric|varchar|char|text|boolean|json|jsonb|timestamp|date|time|uuid|blob|binary|tinyint|mediumint|year)$/.test(columnFn)) {
        continue
      }
    }

    const rest = line.slice(fieldMatch[0].length)
    const isPK = /\.primaryKey\b/.test(line) || columnFn === 'serial' || columnFn === 'bigserial'
    const isNotNull = /\.notNull\b/.test(line)
    const isUnique = /\.unique\b/.test(line)
    const hasDefault = /\.default\b/.test(line) || /\$defaultFn\b/.test(line)
    const nullable = isPK ? false : (!isNotNull ? null : false)

    const type = DRIZZLE_TYPE_MAP[columnFn] ?? 'string'

    fields.push({
      name: fieldName,
      columnName,
      type,
      isPK: isPK || undefined,
      nullable,
      isUnique: isUnique || undefined,
      metadata: hasDefault ? { hasDefault: true } : undefined,
    })
  }

  return fields
}

// ---- Extract content between matching braces ----

function extractToMatchingBrace(s: string, start: number): string | null {
  let depth = 0
  for (let i = start; i < s.length; i++) {
    if (s[i] === '{') depth++
    else if (s[i] === '}') {
      depth--
      if (depth === 0) return s.slice(start + 1, i)
    }
  }
  return null
}

function stripComments(code: string): string {
  let result = code.replace(/\/\/.*$/gm, '')
  result = result.replace(/\/\*[\s\S]*?\*\//g, '')
  return result
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
