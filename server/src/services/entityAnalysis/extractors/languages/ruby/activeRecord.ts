import { BaseExtractor, ExtractorResult, RawEntity, RawField, RawRelationship } from '../../base'

// ActiveRecord column types → normalised type strings
const AR_TYPE_MAP: Record<string, string> = {
  string: 'string',
  text: 'text',
  integer: 'integer',
  bigint: 'bigint',
  float: 'float',
  decimal: 'decimal',
  numeric: 'decimal',
  boolean: 'boolean',
  date: 'date',
  datetime: 'datetime',
  timestamp: 'datetime',
  time: 'time',
  binary: 'binary',
  blob: 'binary',
  json: 'json',
  jsonb: 'json',
  uuid: 'uuid',
  inet: 'string',
  citext: 'string',
}

// Rails association macros
const BELONGS_TO_RE = /^\s*belongs_to\s+:(\w+)/
const HAS_ONE_RE = /^\s*has_one\s+:(\w+)/
const HAS_MANY_RE = /^\s*has_many\s+:(\w+)/
const HAS_AND_BELONGS_RE = /^\s*has_and_belongs_to_many\s+:(\w+)/

export class ActiveRecordExtractor extends BaseExtractor {
  readonly extractorId = 'ruby.active_record'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []

    // Find all migration files to build schema info
    const migrationFiles = await this.glob('**/db/migrate/*.rb')
    const schemaFile = await this.glob('**/db/schema.rb')

    // Parse schema.rb first (preferred — complete picture)
    const schemaEntities = new Map<string, RawEntity>()
    for (const file of schemaFile) {
      try {
        const content = await this.readFile(file)
        const parsed = parseSchemaRb(content, file, this.extractorId)
        for (const e of parsed) schemaEntities.set(e.name, e)
      } catch (err) {
        warnings.push(`Failed to parse ${file}: ${(err as Error).message}`)
      }
    }

    // Parse model files to find associations
    const modelFiles = await this.glob('app/models/**/*.rb')
    const modelAssociations = new Map<string, RawRelationship[]>()
    for (const file of modelFiles) {
      try {
        const content = await this.readFile(file)
        const classMatch = content.match(/class\s+(\w+)\s*<\s*(?:ApplicationRecord|ActiveRecord::Base|ApplicationModel)/)
        if (!classMatch) continue
        const className = classMatch[1]
        const rels = extractAssociations(content)
        if (rels.length > 0) modelAssociations.set(className, rels)
      } catch (err) {
        warnings.push(`Failed to parse ${file}: ${(err as Error).message}`)
      }
    }

    // Merge associations into schema entities
    for (const entity of schemaEntities.values()) {
      const className = tableNameToClass(entity.name)
      const rels = modelAssociations.get(className)
      if (rels) entity.relationships.push(...rels)
      entities.push(entity)
    }

    // If no schema.rb, fall back to migration files
    if (entities.length === 0) {
      const migrationEntities = new Map<string, RawEntity>()
      for (const file of migrationFiles.sort()) {
        try {
          const content = await this.readFile(file)
          const parsed = parseMigrationFile(content, file, this.extractorId)
          for (const e of parsed) {
            if (migrationEntities.has(e.name)) {
              // Merge fields from later migrations
              const existing = migrationEntities.get(e.name)!
              existing.fields.push(...e.fields)
            } else {
              migrationEntities.set(e.name, e)
            }
          }
        } catch (err) {
          warnings.push(`Failed to parse ${file}: ${(err as Error).message}`)
        }
      }
      entities.push(...migrationEntities.values())
    }

    const filesScanned = schemaFile.length + modelFiles.length + (entities.length === 0 ? migrationFiles.length : 0)
    return {
      entities,
      warnings,
      stats: { filesScanned, entitiesFound: entities.length, extractionTimeMs: Date.now() - start },
    }
  }
}

// ---- schema.rb parser ----

function parseSchemaRb(content: string, file: string, extractorId: string): RawEntity[] {
  const entities: RawEntity[] = []
  const stripped = stripComments(content)
  const lines = stripped.split('\n')

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // create_table "users", force: :cascade do |t|
    const tableMatch = trimmed.match(/^create_table\s+["'](\w+)["']/)
    if (tableMatch) {
      const tableName = tableMatch[1]
      const startLine = i + 1
      const fields: RawField[] = []

      // Always add implicit id column
      fields.push(makeField('id', 'integer', false, true, false, false, null, 0))

      i++
      let pos = 1
      while (i < lines.length) {
        const inner = lines[i].trim()
        if (inner === 'end') break

        // t.string "name", null: false, default: ""
        const colMatch = inner.match(/^t\.(\w+)\s+["'](\w+)["'](.*)/)
        if (colMatch) {
          const [, rawType, colName, rest] = colMatch
          const type = AR_TYPE_MAP[rawType] ?? rawType
          const nullable = /null:\s*false/.test(rest) ? false : true
          const isUnique = /unique:\s*true/.test(rest)
          const defaultMatch = rest.match(/default:\s*["']?([^"',\s]+)["']?/)
          const defaultValue = defaultMatch ? defaultMatch[1] : null
          fields.push(makeField(colName, type, nullable, false, false, isUnique, defaultValue, pos++))
        }

        // t.index ["email"], name: "index_users_on_email", unique: true
        const indexMatch = inner.match(/^t\.index\s+\[([^\]]+)\].*unique:\s*true/)
        if (indexMatch) {
          const indexCols = indexMatch[1].match(/["'](\w+)["']/g)?.map((s) => s.replace(/["']/g, '')) ?? []
          for (const col of indexCols) {
            const field = fields.find((f) => f.name === col)
            if (field) field.isUnique = true
          }
        }

        i++
      }

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

    i++
  }

  return entities
}

// ---- Migration file parser ----

function parseMigrationFile(content: string, file: string, extractorId: string): RawEntity[] {
  const entities: RawEntity[] = []
  const stripped = stripComments(content)
  const lines = stripped.split('\n')

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // create_table :users do |t| or create_table "users" do |t|
    const tableMatch = trimmed.match(/^create_table\s+(?::(\w+)|["'](\w+)["'])/)
    if (tableMatch) {
      const tableName = tableMatch[1] ?? tableMatch[2]
      const startLine = i + 1
      const fields: RawField[] = [makeField('id', 'integer', false, true, false, false, null, 0)]

      i++
      let pos = 1
      while (i < lines.length) {
        const inner = lines[i].trim()
        if (inner === 'end') break
        const colMatch = inner.match(/^t\.(\w+)\s+:(\w+)(.*)/)
        if (colMatch) {
          const [, rawType, colName, rest] = colMatch
          const type = AR_TYPE_MAP[rawType] ?? rawType
          const nullable = /null:\s*false/.test(rest) ? false : true
          const isUnique = /unique:\s*true/.test(rest)
          fields.push(makeField(colName, type, nullable, false, false, isUnique, null, pos++))
        }
        i++
      }

      entities.push({
        name: tableName,
        entityType: 'table',
        fields,
        relationships: [],
        source: { file, startLine, endLine: i + 1, format: 'ruby', extractorId },
        extractorId,
        confidence: 'medium',
        metadata: {},
      })
    }

    i++
  }

  return entities
}

// ---- Association extractor ----

function extractAssociations(content: string): RawRelationship[] {
  const rels: RawRelationship[] = []
  const stripped = stripComments(content)
  for (const line of stripped.split('\n')) {
    let m: RegExpMatchArray | null

    m = line.match(BELONGS_TO_RE)
    if (m) {
      rels.push({ type: 'many_to_one', targetEntity: classify(m[1]), sourceField: m[1] + '_id', targetField: 'id', metadata: {} })
      continue
    }
    m = line.match(HAS_ONE_RE)
    if (m) {
      rels.push({ type: 'one_to_one', targetEntity: classify(m[1]), sourceField: null, targetField: null, metadata: {} })
      continue
    }
    m = line.match(HAS_MANY_RE)
    if (m) {
      rels.push({ type: 'one_to_many', targetEntity: classify(singularize(m[1])), sourceField: null, targetField: null, metadata: {} })
      continue
    }
    m = line.match(HAS_AND_BELONGS_RE)
    if (m) {
      rels.push({ type: 'many_to_many', targetEntity: classify(singularize(m[1])), sourceField: null, targetField: null, metadata: {} })
    }
  }
  return rels
}

// ---- Helpers ----

function makeField(
  name: string, type: string, nullable: boolean, isPrimaryKey: boolean,
  isForeignKey: boolean, isUnique: boolean, defaultValue: string | null, ordinalPosition: number,
): RawField {
  return { name, type, nullable, isPrimaryKey, isForeignKey, isUnique, defaultValue, ordinalPosition, metadata: {} }
}

/** "users" → "User" (simple Rails table-to-class heuristic) */
function tableNameToClass(table: string): string {
  return classify(singularize(table))
}

/** Simple singularize: remove trailing 's', handle 'ies'→'y' */
function singularize(word: string): string {
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y'
  if (word.endsWith('ses') || word.endsWith('xes') || word.endsWith('zes')) return word.slice(0, -2)
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

/** "user_profile" → "UserProfile" */
function classify(name: string): string {
  return name.split('_').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('')
}

function stripComments(code: string): string {
  return code.replace(/#.*$/gm, '')
}
