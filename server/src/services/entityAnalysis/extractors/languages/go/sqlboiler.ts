import { BaseExtractor, ExtractorResult, RawEntity, RawField } from '../../base'
import { toSnakeCase } from '../../../normalizer'

/**
 * Extracts entity surfaces from sqlboiler generated models.
 *
 * sqlboiler generates Go structs with `boil` struct tags:
 *
 *   type User struct {
 *     ID        int64       `boil:"id" json:"id" toml:"id" yaml:"id"`
 *     Name      null.String `boil:"name" json:"name,omitempty" toml:"name" yaml:"name,omitempty"`
 *     Email     string      `boil:"email" json:"email" toml:"email" yaml:"email"`
 *     CreatedAt time.Time   `boil:"created_at" json:"created_at" toml:"created_at" yaml:"created_at"`
 *
 *     R *userR `boil:"-" json:"-" toml:"-" yaml:"-"`
 *     L userL  `boil:"-" json:"-" toml:"-" yaml:"-"`
 *   }
 *
 * The generated files are typically in models/*.go
 */
export class SqlboilerExtractor extends BaseExtractor {
  readonly extractorId = 'go.sqlboiler'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []

    // sqlboiler generates models in a models/ directory
    const hits = await this.grep('models/**/*.go', /boil:"[^-]/, 2000)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]
    let filesScanned = 0

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        filesScanned++
        entities.push(...parseSqlboilerFile(content, file, this.extractorId))
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

function parseSqlboilerFile(content: string, file: string, extractorId: string): RawEntity[] {
  const stripped = stripComments(content)
  const lines = stripped.split('\n')
  const entities: RawEntity[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // type User struct {
    const structMatch = line.match(/^type\s+(\w+)\s+struct\s*\{/)
    if (!structMatch) continue

    const structName = structMatch[1]
    // Skip internal sqlboiler types (userR, userL)
    if (/^[a-z]/.test(structName)) continue

    const fields: RawField[] = []

    let j = i + 1
    while (j < lines.length) {
      const bodyLine = lines[j]
      const trimmed = bodyLine.trim()

      if (trimmed === '}') break
      if (trimmed === '') { j++; continue }

      // FieldName  Type  `boil:"col_name" ...`
      const fieldMatch = bodyLine.match(/^\s+(\w+)\s+[\w.*[\]]+\s+`([^`]+)`/)
      if (fieldMatch) {
        const goFieldName = fieldMatch[1]
        const tags = fieldMatch[2]

        // Skip internal sqlboiler relation fields (R and L)
        if (goFieldName === 'R' || goFieldName === 'L') { j++; continue }

        const boilTag = tags.match(/\bboil:"([^"]+)"/)
        if (!boilTag || boilTag[1] === '-') { j++; continue }

        const colName = boilTag[1]
        const goType = bodyLine.match(/^\s+\w+\s+([\w.*[\]]+)/)?.[1] ?? ''
        const isNullable = /null\.\w+/.test(goType) || /\*\w+/.test(goType)
        const isPk = colName === 'id' || goFieldName === 'ID'

        fields.push({
          name: goFieldName,
          normalizedName: colName,
          dataType: mapGoType(goType),
          nativeType: goType,
          isNullable: isNullable ? true : null,
          isPrimaryKey: isPk,
          isForeignKey: false,
          isUnique: false,
          ordinalPosition: fields.length,
          metadata: {},
        })
      }

      j++
    }

    if (fields.length === 0) { continue }

    // Table name is plural snake_case of struct name
    const tableName = toSnakeCase(structName) + 's'

    entities.push({
      name: structName,
      normalizedName: toSnakeCase(structName),
      tableName,
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

function mapGoType(t: string): string {
  const lower = t.toLowerCase()
  if (/string|null\.string/.test(lower)) return 'string'
  if (/int64|int32|int16|int8\b|null\.int/.test(lower)) return 'integer'
  if (/float64|float32|null\.float/.test(lower)) return 'float'
  if (/bool|null\.bool/.test(lower)) return 'boolean'
  if (/time\.time/.test(lower)) return 'datetime'
  if (/uuid/.test(lower)) return 'uuid'
  if (/\[\]byte/.test(lower)) return 'binary'
  if (/json|null\.json/.test(lower)) return 'json'
  return 'string'
}

function stripComments(code: string): string {
  return code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}
