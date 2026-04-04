import { BaseExtractor, ExtractorResult, RawEntity, RawField, RawRelationship } from '../../base'

/**
 * Extracts entity definitions from Ecto (Elixir).
 *
 * Key patterns:
 *   defmodule MyApp.User do
 *     use Ecto.Schema
 *     schema "users" do
 *       field :name, :string
 *       field :age, :integer
 *       field :email, :string
 *       belongs_to :role, MyApp.Role
 *       has_many :posts, MyApp.Post
 *     end
 *   end
 */

const ECTO_TYPE_MAP: Record<string, string> = {
  string: 'string', binary: 'binary', binary_id: 'uuid',
  integer: 'integer', float: 'float', decimal: 'decimal',
  boolean: 'boolean',
  date: 'date', time: 'time', naive_datetime: 'datetime', datetime: 'datetime', utc_datetime: 'datetime',
  map: 'json', array: 'json',
  id: 'integer', Ecto_UUID: 'uuid',
}

export class EctoExtractor extends BaseExtractor {
  readonly extractorId = 'elixir.ecto'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []
    let filesScanned = 0

    const hits = await this.grep('**/*.ex', /use\s+Ecto\.Schema|schema\s+"[^"]+"/)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        filesScanned++
        const parsed = parseEctoFile(content, file, this.extractorId)
        if (parsed) entities.push(parsed)
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

function parseEctoFile(content: string, file: string, extractorId: string): RawEntity | null {
  if (!(/use\s+Ecto\.Schema/.test(content))) return null

  const stripped = stripComments(content)
  const lines = stripped.split('\n')

  // Find schema "table_name" do
  let tableName: string | null = null
  let inSchema = false
  let schemaDepth = 0
  const fields: RawField[] = []
  const relationships: RawRelationship[] = []
  let pos = 0

  // Also extract timestamps
  let hasTimestamps = false

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    if (!inSchema) {
      const schemaMatch = trimmed.match(/^schema\s+["']([^"']+)["']\s+do/)
      if (schemaMatch) {
        tableName = schemaMatch[1]
        inSchema = true
        schemaDepth = 1
        continue
      }
    } else {
      // Track do/end depth
      if (/\bdo\b/.test(trimmed) && !/^\s*#/.test(trimmed)) schemaDepth++
      if (/\bend\b/.test(trimmed)) {
        schemaDepth--
        if (schemaDepth <= 0) { inSchema = false; continue }
      }

      // field :name, :type  or  field :name, :type, default: value
      const fieldMatch = trimmed.match(/^field\s+:(\w+),\s*:(\w+)/)
      if (fieldMatch) {
        const name = fieldMatch[1]
        const rawType = fieldMatch[2].replace(/\./, '_')
        fields.push({
          name,
          type: ECTO_TYPE_MAP[rawType] ?? rawType,
          nullable: true, // Ecto fields are nullable by default
          isPrimaryKey: false,
          isForeignKey: false,
          isUnique: false,
          defaultValue: null,
          ordinalPosition: pos++,
          metadata: {},
        })
        continue
      }

      // belongs_to :role, MyApp.Role  (adds role_id foreign key)
      const belongsToMatch = trimmed.match(/^belongs_to\s+:(\w+),\s*([\w.]+)/)
      if (belongsToMatch) {
        const assocName = belongsToMatch[1]
        const targetModule = belongsToMatch[2]
        relationships.push({
          type: 'many_to_one',
          targetEntity: targetModule.split('.').pop() ?? targetModule,
          sourceField: `${assocName}_id`,
          targetField: 'id',
          metadata: {},
        })
        continue
      }

      // has_many :posts, MyApp.Post
      const hasManyMatch = trimmed.match(/^has_many\s+:(\w+),\s*([\w.]+)/)
      if (hasManyMatch) {
        const targetModule = hasManyMatch[2]
        relationships.push({
          type: 'one_to_many',
          targetEntity: targetModule.split('.').pop() ?? targetModule,
          sourceField: null,
          targetField: null,
          metadata: {},
        })
        continue
      }

      // has_one :profile, MyApp.Profile
      const hasOneMatch = trimmed.match(/^has_one\s+:(\w+),\s*([\w.]+)/)
      if (hasOneMatch) {
        const targetModule = hasOneMatch[2]
        relationships.push({
          type: 'one_to_one',
          targetEntity: targetModule.split('.').pop() ?? targetModule,
          sourceField: null,
          targetField: null,
          metadata: {},
        })
        continue
      }

      // many_to_many :tags, MyApp.Tag
      const manyToManyMatch = trimmed.match(/^many_to_many\s+:(\w+),\s*([\w.]+)/)
      if (manyToManyMatch) {
        const targetModule = manyToManyMatch[2]
        relationships.push({
          type: 'many_to_many',
          targetEntity: targetModule.split('.').pop() ?? targetModule,
          sourceField: null,
          targetField: null,
          metadata: {},
        })
        continue
      }

      // timestamps() — adds inserted_at and updated_at
      if (/^timestamps\s*\(\s*\)/.test(trimmed)) {
        hasTimestamps = true
      }
    }
  }

  if (!tableName) return null

  // Add implicit id primary key
  const pkField: RawField = {
    name: 'id',
    type: 'integer',
    nullable: false,
    isPrimaryKey: true,
    isForeignKey: false,
    isUnique: true,
    defaultValue: null,
    ordinalPosition: -1,
    metadata: {},
  }
  fields.unshift(pkField)
  fields.forEach((f, idx) => { if (f.ordinalPosition === -1) f.ordinalPosition = idx })

  if (hasTimestamps) {
    fields.push(
      { name: 'inserted_at', type: 'datetime', nullable: false, isPrimaryKey: false, isForeignKey: false, isUnique: false, defaultValue: null, ordinalPosition: pos++, metadata: {} },
      { name: 'updated_at', type: 'datetime', nullable: false, isPrimaryKey: false, isForeignKey: false, isUnique: false, defaultValue: null, ordinalPosition: pos++, metadata: {} },
    )
  }

  return {
    name: tableName,
    entityType: 'table',
    fields,
    relationships,
    source: { file, startLine: 1, endLine: null, format: 'elixir', extractorId },
    extractorId,
    confidence: 'high',
    metadata: {},
  }
}

function stripComments(code: string): string {
  return code.replace(/#.*$/gm, '')
}
