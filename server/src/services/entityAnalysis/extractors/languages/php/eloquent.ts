import { BaseExtractor, ExtractorResult, RawEntity, RawField, RawRelationship } from '../../base'

// Laravel migration column types → normalised
const LARAVEL_TYPE_MAP: Record<string, string> = {
  string: 'string', char: 'string', text: 'text', mediumText: 'text', longText: 'text',
  integer: 'integer', tinyInteger: 'integer', smallInteger: 'integer', mediumInteger: 'integer',
  bigInteger: 'bigint', unsignedBigInteger: 'bigint', unsignedInteger: 'integer',
  float: 'float', double: 'float', decimal: 'decimal',
  boolean: 'boolean',
  date: 'date', dateTime: 'datetime', dateTimeTz: 'datetime', time: 'time', timestamp: 'datetime', timestampTz: 'datetime',
  binary: 'binary',
  uuid: 'uuid', ulid: 'uuid',
  json: 'json', jsonb: 'json',
  enum: 'string',
}

// Eloquent association macros
const BELONGS_TO_RE = /\bbelongsTo\s*\(\s*(\w+)::class/
const HAS_MANY_RE = /\bhasMany\s*\(\s*(\w+)::class/
const HAS_ONE_RE = /\bhasOne\s*\(\s*(\w+)::class/
const BELONGS_TO_MANY_RE = /\bbelongsToMany\s*\(\s*(\w+)::class/

export class EloquentExtractor extends BaseExtractor {
  readonly extractorId = 'php.eloquent'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []
    let filesScanned = 0

    // Parse migration files
    const migrationFiles = await this.glob('**/database/migrations/*.php')
    const migrationEntities = new Map<string, RawEntity>()

    for (const file of migrationFiles.sort()) {
      try {
        const content = await this.readFile(file)
        if (!content.includes('Schema::create') && !content.includes('$table->')) continue
        filesScanned++
        const parsed = parseMigration(content, file, this.extractorId)
        for (const e of parsed) {
          if (!migrationEntities.has(e.name)) migrationEntities.set(e.name, e)
        }
      } catch (err) {
        warnings.push(`Failed to parse ${file}: ${(err as Error).message}`)
      }
    }

    // Parse model files for associations
    const modelFiles = await this.glob('app/Models/*.php')
    for (const file of modelFiles) {
      try {
        const content = await this.readFile(file)
        const classMatch = content.match(/class\s+(\w+)\s+extends\s+(?:Model|Eloquent)/)
        if (!classMatch) continue

        const className = classMatch[1]
        const tableName = (content.match(/protected\s+\$table\s*=\s*['"](\w+)['"]/))?.[1]
          ?? toSnakePlural(className)
        const rels = extractAssociations(content)

        const existing = migrationEntities.get(tableName)
        if (existing) {
          existing.relationships.push(...rels)
        }
      } catch (err) {
        warnings.push(`Failed to parse ${file}: ${(err as Error).message}`)
      }
    }

    entities.push(...migrationEntities.values())

    return {
      entities,
      warnings,
      stats: { filesScanned, entitiesFound: entities.length, extractionTimeMs: Date.now() - start },
    }
  }
}

// ---- Migration parser ----

function parseMigration(content: string, file: string, extractorId: string): RawEntity[] {
  const entities: RawEntity[] = []
  const stripped = stripComments(content)
  const lines = stripped.split('\n')

  let i = 0
  while (i < lines.length) {
    const trimmed = lines[i].trim()

    // Schema::create('users', function (Blueprint $table) {
    const createMatch = trimmed.match(/Schema::create\s*\(\s*['"](\w+)['"]/)
    if (createMatch) {
      const tableName = createMatch[1]
      const startLine = i + 1
      const fields: RawField[] = []
      let pos = 0

      i++
      while (i < lines.length) {
        const inner = lines[i].trim()
        if (inner === '});' || inner === '}') break

        // $table->id();  → integer primary key
        if (/\$table->id\(\)/.test(inner)) {
          fields.push(makeField('id', 'integer', false, true, false, false, null, pos++))
          i++; continue
        }

        // $table->uuid('id') as PK
        if (/\$table->uuid\s*\(\s*'id'\s*\)/.test(inner)) {
          fields.push(makeField('id', 'uuid', false, true, false, false, null, pos++))
          i++; continue
        }

        // $table->string('email')->unique()->nullable()
        const colMatch = inner.match(/\$table->(\w+)\s*\(\s*'(\w+)'/)
        if (colMatch) {
          const rawType = colMatch[1]
          const colName = colMatch[2]
          const type = LARAVEL_TYPE_MAP[rawType] ?? rawType
          const nullable = /->nullable\(\)/.test(inner)
          const isUnique = /->unique\(\)/.test(inner)
          const isPk = /->primary\(\)/.test(inner)
          if (rawType === 'timestamps' || rawType === 'softDeletes') { i++; continue }
          fields.push(makeField(colName, type, nullable, isPk, colName.endsWith('_id'), isUnique, null, pos++))
        }

        i++
      }

      entities.push({
        name: tableName,
        entityType: 'table',
        fields,
        relationships: [],
        source: { file, startLine, endLine: i + 1, format: 'php', extractorId },
        extractorId,
        confidence: 'high',
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
  for (const line of content.split('\n')) {
    let m = line.match(BELONGS_TO_RE)
    if (m) { rels.push({ type: 'many_to_one', targetEntity: m[1], sourceField: null, targetField: null, metadata: {} }); continue }
    m = line.match(HAS_MANY_RE)
    if (m) { rels.push({ type: 'one_to_many', targetEntity: m[1], sourceField: null, targetField: null, metadata: {} }); continue }
    m = line.match(HAS_ONE_RE)
    if (m) { rels.push({ type: 'one_to_one', targetEntity: m[1], sourceField: null, targetField: null, metadata: {} }); continue }
    m = line.match(BELONGS_TO_MANY_RE)
    if (m) { rels.push({ type: 'many_to_many', targetEntity: m[1], sourceField: null, targetField: null, metadata: {} }); continue }
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

function toSnakePlural(name: string): string {
  const snake = name.replace(/([A-Z])/g, (m, c, i) => (i > 0 ? '_' : '') + c.toLowerCase())
  if (snake.endsWith('y')) return snake.slice(0, -1) + 'ies'
  if (snake.endsWith('s')) return snake + 'es'
  return snake + 's'
}

function stripComments(code: string): string {
  return code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}
