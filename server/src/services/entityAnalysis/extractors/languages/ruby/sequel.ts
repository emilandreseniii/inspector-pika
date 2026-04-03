import { BaseExtractor, ExtractorResult, RawEntity, RawField, RawRelationship } from '../../base'

// Sequel column types → normalised type strings
const SEQUEL_TYPE_MAP: Record<string, string> = {
  String: 'string',
  Integer: 'integer',
  Bignum: 'bigint',
  Float: 'float',
  Numeric: 'decimal',
  BigDecimal: 'decimal',
  TrueClass: 'boolean',
  FalseClass: 'boolean',
  Date: 'date',
  DateTime: 'datetime',
  Time: 'datetime',
  File: 'binary',
  Blob: 'binary',
  String_text: 'text',
  // DB.create_table type symbols
  string: 'string',
  integer: 'integer',
  bigint: 'bigint',
  float: 'float',
  numeric: 'decimal',
  decimal: 'decimal',
  boolean: 'boolean',
  date: 'date',
  datetime: 'datetime',
  timestamp: 'datetime',
  text: 'text',
  blob: 'binary',
  json: 'json',
  jsonb: 'json',
  uuid: 'uuid',
}

// Sequel association macros
const ONE_TO_MANY_RE = /^\s*one_to_many\s+:(\w+)/
const MANY_TO_ONE_RE = /^\s*many_to_one\s+:(\w+)/
const ONE_TO_ONE_RE = /^\s*one_to_one\s+:(\w+)/
const MANY_TO_MANY_RE = /^\s*many_to_many\s+:(\w+)/

export class SequelExtractor extends BaseExtractor {
  readonly extractorId = 'ruby.sequel'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []
    let filesScanned = 0

    // Find model files (class Foo < Sequel::Model)
    const modelFiles = await this.glob('**/*.rb')
    const schemaEntities = new Map<string, RawEntity>()

    for (const file of modelFiles) {
      try {
        const content = await this.readFile(file)
        if (!/Sequel::Model|DB\.create_table/.test(content)) continue
        filesScanned++
        const parsed = parseSequelFile(content, file, this.extractorId)
        for (const e of parsed) schemaEntities.set(e.name, e)
      } catch (err) {
        warnings.push(`Failed to parse ${file}: ${(err as Error).message}`)
      }
    }

    entities.push(...schemaEntities.values())

    return {
      entities,
      warnings,
      stats: { filesScanned, entitiesFound: entities.length, extractionTimeMs: Date.now() - start },
    }
  }
}

// ---- File parser ----

function parseSequelFile(content: string, file: string, extractorId: string): RawEntity[] {
  const entities: RawEntity[] = []
  const stripped = stripComments(content)
  const lines = stripped.split('\n')

  let i = 0
  while (i < lines.length) {
    const trimmed = lines[i].trim()

    // DB.create_table(:users) { ... } or DB.create_table(:users) do ... end
    const createTableMatch = trimmed.match(/^DB\.create_table[!?]?\s*\(?(?::(\w+)|["'](\w+)["'])\)?/)
    if (createTableMatch) {
      const tableName = createTableMatch[1] ?? createTableMatch[2]
      const startLine = i + 1
      const fields: RawField[] = []

      i++
      let pos = 0
      while (i < lines.length) {
        const inner = lines[i].trim()
        if (inner === 'end' || inner === '}') break

        // primary_key :id
        const pkMatch = inner.match(/^primary_key\s+:(\w+)/)
        if (pkMatch) {
          fields.push(makeField(pkMatch[1], 'integer', false, true, false, false, null, pos++))
          i++
          continue
        }

        // String :name, null: false
        // Integer :age
        // column :email, String
        let colMatch = inner.match(/^(\w+)\s+:(\w+)(.*)/)
        if (colMatch && SEQUEL_TYPE_MAP[colMatch[1]] !== undefined) {
          const type = SEQUEL_TYPE_MAP[colMatch[1]] ?? colMatch[1].toLowerCase()
          const colName = colMatch[2]
          const rest = colMatch[3]
          const nullable = /null:\s*false/.test(rest) ? false : true
          const isUnique = /unique:\s*true/.test(rest)
          fields.push(makeField(colName, type, nullable, false, false, isUnique, null, pos++))
          i++
          continue
        }

        // column :name, String
        colMatch = inner.match(/^column\s+:(\w+),\s*(\w+)(.*)/)
        if (colMatch) {
          const colName = colMatch[1]
          const rawType = colMatch[2]
          const type = SEQUEL_TYPE_MAP[rawType] ?? rawType.toLowerCase()
          const rest = colMatch[3]
          const nullable = /null:\s*false/.test(rest) ? false : true
          fields.push(makeField(colName, type, nullable, false, false, false, null, pos++))
          i++
          continue
        }

        i++
      }

      if (fields.length > 0) {
        entities.push({
          name: tableName,
          entityType: 'table',
          fields,
          relationships: [],
          source: { file, startLine, endLine: i + 1, format: 'ruby', extractorId },
          extractorId,
          confidence: 'high',
          metadata: {},
        })
      }
    }

    // class User < Sequel::Model or class User < Sequel::Model(:users)
    const classMatch = trimmed.match(/^class\s+(\w+)\s*<\s*Sequel::Model/)
    if (classMatch) {
      const className = classMatch[1]
      // Guess table name from class name (pluralised snake_case)
      const tableName = toSnakePlural(className)
      const startLine = i + 1
      const relationships: RawRelationship[] = []
      const fields: RawField[] = []

      i++
      while (i < lines.length) {
        const inner = lines[i].trim()
        if (inner === 'end') break

        let m: RegExpMatchArray | null
        m = inner.match(ONE_TO_MANY_RE)
        if (m) { relationships.push({ type: 'one_to_many', targetEntity: classify(singularize(m[1])), sourceField: null, targetField: null, metadata: {} }); i++; continue }
        m = inner.match(MANY_TO_ONE_RE)
        if (m) { relationships.push({ type: 'many_to_one', targetEntity: classify(m[1]), sourceField: m[1] + '_id', targetField: 'id', metadata: {} }); i++; continue }
        m = inner.match(ONE_TO_ONE_RE)
        if (m) { relationships.push({ type: 'one_to_one', targetEntity: classify(m[1]), sourceField: null, targetField: null, metadata: {} }); i++; continue }
        m = inner.match(MANY_TO_MANY_RE)
        if (m) { relationships.push({ type: 'many_to_many', targetEntity: classify(singularize(m[1])), sourceField: null, targetField: null, metadata: {} }); i++; continue }

        i++
      }

      // Check if we already have a create_table entity for this table
      const existing = entities.find((e) => e.name === tableName)
      if (existing) {
        existing.relationships.push(...relationships)
      } else if (relationships.length > 0) {
        entities.push({
          name: tableName,
          entityType: 'table',
          fields,
          relationships,
          source: { file, startLine, endLine: i + 1, format: 'ruby', extractorId },
          extractorId,
          confidence: 'medium',
          metadata: {},
        })
      }
    }

    i++
  }

  return entities
}

// ---- Helpers ----

function makeField(
  name: string, type: string, nullable: boolean, isPrimaryKey: boolean,
  isForeignKey: boolean, isUnique: boolean, defaultValue: string | null, ordinalPosition: number,
): RawField {
  return { name, type, nullable, isPrimaryKey, isForeignKey, isUnique, defaultValue, ordinalPosition, metadata: {} }
}

function singularize(word: string): string {
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y'
  if (word.endsWith('ses') || word.endsWith('xes')) return word.slice(0, -2)
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

function classify(name: string): string {
  return name.split('_').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('')
}

function toSnakePlural(className: string): string {
  // "UserProfile" → "user_profiles"
  const snake = className.replace(/([A-Z])/g, (m, c, i) => (i > 0 ? '_' : '') + c.toLowerCase())
  if (snake.endsWith('y')) return snake.slice(0, -1) + 'ies'
  if (snake.endsWith('s')) return snake + 'es'
  return snake + 's'
}

function stripComments(code: string): string {
  return code.replace(/#.*$/gm, '')
}
