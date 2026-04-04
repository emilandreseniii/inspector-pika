import { BaseExtractor, ExtractorResult, RawEntity, RawField } from '../../base'
import { toSnakeCase } from '../../../normalizer'

/**
 * Extracts entity surfaces from ROM (Ruby Object Mapper).
 *
 *   module Relations
 *     class Users < ROM::Relation[:sql]
 *       schema(:users) do
 *         attribute :id, Types::Serial
 *         attribute :name, Types::String
 *         attribute :email, Types::String
 *         attribute :created_at, Types::Time
 *       end
 *     end
 *   end
 */
export class RomExtractor extends BaseExtractor {
  readonly extractorId = 'ruby.rom'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []

    const hits = await this.grep('**/*.rb', /ROM::Relation|< ROM::/, 2000)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]
    let filesScanned = 0

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        filesScanned++
        entities.push(...parseRomFile(content, file, this.extractorId))
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

function parseRomFile(content: string, file: string, extractorId: string): RawEntity[] {
  const lines = content.split('\n')
  const entities: RawEntity[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // class Users < ROM::Relation[:sql] or class Users < ROM::Relation
    const classMatch = line.match(/^\s*class\s+(\w+)\s*<\s*ROM::Relation/)
    if (!classMatch) continue

    const className = classMatch[1]
    const fields: RawField[] = []
    let tableName: string | undefined

    // Look for schema block
    let j = i + 1
    let inSchema = false
    while (j < lines.length) {
      const bodyLine = lines[j]
      const trimmed = bodyLine.trim()

      // End of class
      if (/^end$/.test(trimmed) && !bodyLine.startsWith(' ') && !bodyLine.startsWith('\t')) break

      // schema(:users) do or schema(:table_name, infer: true) do
      const schemaMatch = trimmed.match(/^schema\s*\(\s*:(\w+)/)
      if (schemaMatch) {
        tableName = schemaMatch[1]
        inSchema = true
        j++
        continue
      }

      if (inSchema) {
        // end of schema block
        if (/^end\b/.test(trimmed)) {
          inSchema = false
          j++
          continue
        }

        // attribute :field_name, Types::SomeType
        const attrMatch = trimmed.match(/^attribute\s+:(\w+)(?:\s*,\s*(\S+))?/)
        if (attrMatch) {
          const fieldName = attrMatch[1]
          const romType = attrMatch[2] ?? 'Types::Any'
          const isPk = /::Serial\b|::PK\b/.test(romType) || fieldName === 'id'
          const isNullable = /::Maybe|\.optional/.test(romType)

          fields.push({
            name: fieldName,
            normalizedName: fieldName,
            dataType: mapRomType(romType),
            nativeType: romType,
            isNullable: isNullable ? true : null,
            isPrimaryKey: isPk,
            isForeignKey: false,
            isUnique: false,
            ordinalPosition: fields.length,
            metadata: {},
          })
        }
      }

      j++
    }

    if (fields.length === 0) continue

    entities.push({
      name: className,
      normalizedName: toSnakeCase(className),
      tableName: tableName ?? toSnakeCase(className),
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

function mapRomType(t: string): string {
  const lower = t.toLowerCase()
  if (/::string\b/.test(lower)) return 'string'
  if (/::integer\b|::serial\b/.test(lower)) return 'integer'
  if (/::float\b|::decimal\b/.test(lower)) return 'float'
  if (/::bool\b|::boolean\b/.test(lower)) return 'boolean'
  if (/::datetime\b|::time\b/.test(lower)) return 'datetime'
  if (/::date\b/.test(lower)) return 'date'
  if (/::uuid\b/.test(lower)) return 'uuid'
  if (/::json\b/.test(lower)) return 'json'
  return 'string'
}
