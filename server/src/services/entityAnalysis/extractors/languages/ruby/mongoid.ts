import { BaseExtractor, ExtractorResult, RawEntity, RawField, RawRelationship } from '../../base'
import { toSnakeCase } from '../../../normalizer'

/**
 * Extracts entity surfaces from Mongoid (MongoDB ODM for Ruby).
 *
 *   class User
 *     include Mongoid::Document
 *     field :name, type: String
 *     field :email, type: String
 *     field :age, type: Integer
 *     field :created_at, type: DateTime
 *
 *     store_in collection: "users"
 *
 *     belongs_to :account
 *     has_many :posts
 *   end
 */
export class MongoidExtractor extends BaseExtractor {
  readonly extractorId = 'ruby.mongoid'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []

    const hits = await this.grep('**/*.rb', /include\s+Mongoid::Document/, 2000)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]
    let filesScanned = 0

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        filesScanned++
        entities.push(...parseMongoidFile(content, file, this.extractorId))
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

function parseMongoidFile(content: string, file: string, extractorId: string): RawEntity[] {
  const lines = content.split('\n')
  const entities: RawEntity[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // class User or class Admin::User
    const classMatch = line.match(/^class\s+([\w:]+)/)
    if (!classMatch) continue

    // Check if this class includes Mongoid::Document within a reasonable window
    const window = lines.slice(i + 1, i + 50).join('\n')
    if (!/include\s+Mongoid::Document/.test(window)) continue

    const className = classMatch[1].split('::').pop()!
    const fields: RawField[] = []
    const relationships: RawRelationship[] = []
    let collectionName: string | undefined

    let j = i + 1
    while (j < lines.length) {
      const bodyLine = lines[j]
      const trimmed = bodyLine.trim()

      // End of class
      if (/^end\s*$/.test(trimmed) && !bodyLine.startsWith(' ') && !bodyLine.startsWith('\t')) break
      if (/^class\s+\w/.test(trimmed) && !bodyLine.startsWith(' ') && !bodyLine.startsWith('\t')) break

      // store_in collection: "users"
      const storeInMatch = trimmed.match(/store_in\s+collection:\s+["']([^"']+)["']/)
      if (storeInMatch) {
        collectionName = storeInMatch[1]
        j++
        continue
      }

      // field :name, type: String
      const fieldMatch = trimmed.match(/^field\s+:(\w+)(?:\s*,\s*type:\s*(\w+))?/)
      if (fieldMatch) {
        const fieldName = fieldMatch[1]
        const mongoType = fieldMatch[2] ?? 'String'
        const isNullable = !trimmed.includes('required: true')

        fields.push({
          name: fieldName,
          normalizedName: fieldName,
          dataType: mapMongoidType(mongoType),
          nativeType: mongoType,
          isNullable: isNullable ? true : null,
          isPrimaryKey: false,
          isForeignKey: false,
          isUnique: trimmed.includes('unique: true'),
          ordinalPosition: fields.length,
          metadata: {},
        })
        j++
        continue
      }

      // belongs_to :account
      const belongsToMatch = trimmed.match(/^belongs_to\s+:(\w+)/)
      if (belongsToMatch) {
        relationships.push({ name: belongsToMatch[1], targetEntity: capitalize(belongsToMatch[1]), cardinality: 'many_to_one' })
        j++
        continue
      }

      // has_many :posts
      const hasManyMatch = trimmed.match(/^has_many\s+:(\w+)/)
      if (hasManyMatch) {
        relationships.push({ name: hasManyMatch[1], targetEntity: capitalize(hasManyMatch[1]), cardinality: 'one_to_many' })
        j++
        continue
      }

      // has_one :profile
      const hasOneMatch = trimmed.match(/^has_one\s+:(\w+)/)
      if (hasOneMatch) {
        relationships.push({ name: hasOneMatch[1], targetEntity: capitalize(hasOneMatch[1]), cardinality: 'one_to_one' })
      }

      j++
    }

    if (fields.length === 0 && relationships.length === 0) continue

    const tableName = collectionName ?? toSnakeCase(className) + 's'

    entities.push({
      name: className,
      normalizedName: toSnakeCase(className),
      tableName,
      entityType: 'document',
      fields,
      relationships,
      confidence: 'high',
      source: { file, line: i + 1, extractorId },
    })
  }

  return entities
}

// ---- Helpers ----

function mapMongoidType(t: string): string {
  const lower = t.toLowerCase()
  if (/string|symbol/.test(lower)) return 'string'
  if (/integer/.test(lower)) return 'integer'
  if (/float|bigdecimal/.test(lower)) return 'float'
  if (/boolean/.test(lower)) return 'boolean'
  if (/datetime/.test(lower)) return 'datetime'
  if (/date/.test(lower)) return 'date'
  if (/bson::objectid|objectid/.test(lower)) return 'objectid'
  if (/array/.test(lower)) return 'array'
  if (/hash/.test(lower)) return 'json'
  return 'string'
}

function capitalize(s: string): string {
  // Singularize naively and capitalize
  const singular = s.endsWith('s') ? s.slice(0, -1) : s
  return singular.charAt(0).toUpperCase() + singular.slice(1)
}
