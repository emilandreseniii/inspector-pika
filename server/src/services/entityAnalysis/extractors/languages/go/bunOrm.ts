import { BaseExtractor, ExtractorResult, RawEntity, RawField, RawRelationship } from '../../base'
import { toSnakeCase } from '../../../normalizer'

/**
 * Extracts entity surfaces from Bun ORM.
 *
 * Bun uses struct tags with bun:"..." annotations.
 * Struct fields embed bun.BaseModel with a table name tag.
 * Relations use rel:has-many, rel:belongs-to, rel:many-to-many tags.
 */
export class BunOrmExtractor extends BaseExtractor {
  readonly extractorId = 'go.bun_orm'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []

    const hits = await this.grep('**/*.go', /bun\.BaseModel|`bun:/, 2000)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]
    let filesScanned = 0

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        filesScanned++
        entities.push(...parseBunOrmFile(content, file, this.extractorId))
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

function parseBunOrmFile(content: string, file: string, extractorId: string): RawEntity[] {
  const stripped = stripComments(content)
  const lines = stripped.split('\n')
  const entities: RawEntity[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // type User struct {
    const structMatch = line.match(/^type\s+(\w+)\s+struct\s*\{/)
    if (!structMatch) continue

    const structName = structMatch[1]
    const fields: RawField[] = []
    const relationships: RawRelationship[] = []
    let tableName: string | undefined

    let j = i + 1
    while (j < lines.length) {
      const bodyLine = lines[j]
      const trimmed = bodyLine.trim()

      if (trimmed === '}') break
      if (trimmed === '' || trimmed.startsWith('//')) { j++; continue }

      // bun.BaseModel `bun:"table:users,alias:u"`
      const baseModelMatch = bodyLine.match(/bun\.BaseModel\s+\x60bun:"([^"]+)"/)
      if (baseModelMatch) {
        const tagParts = baseModelMatch[1].split(',')
        for (const part of tagParts) {
          if (part.startsWith('table:')) {
            tableName = part.slice('table:'.length)
          }
        }
        j++
        continue
      }

      // Field with bun tag: FieldName  Type  `bun:"col_name,pk,..."`
      const fieldMatch = bodyLine.match(/^\s+(\w+)\s+([\w.*[\]]+)\s+\x60([^\x60]+)\x60/)
      if (fieldMatch) {
        const goFieldName = fieldMatch[1]
        const goType = fieldMatch[2]
        const tags = fieldMatch[3]

        const bunTag = tags.match(/\bbun:"([^"]*)"/)
        if (!bunTag) { j++; continue }

        const bunTagValue = bunTag[1]

        // Skip relation fields
        if (/rel:/.test(bunTagValue)) {
          // Extract relationship info
          const relType = bunTagValue.match(/rel:([\w-]+)/)?.[1]
          const targetType = goType.replace(/[\[\]*]*/g, '').replace(/^.*\./, '')
          let cardinality: 'one_to_many' | 'many_to_one' | 'many_to_many' = 'many_to_one'
          if (relType === 'has-many' || relType === 'has-many-and-belongs-to-many') {
            cardinality = 'one_to_many'
          } else if (relType === 'many-to-many') {
            cardinality = 'many_to_many'
          }
          relationships.push({
            name: goFieldName,
            targetEntity: targetType,
            cardinality,
          })
          j++
          continue
        }

        if (bunTagValue === '-') { j++; continue }

        // Extract column name from tag (first part before comma)
        const colName = bunTagValue.split(',')[0] || toSnakeCase(goFieldName)
        const isPk = bunTagValue.includes(',pk') || bunTagValue.startsWith('pk')
        const isNullable = !bunTagValue.includes(',notnull') && !bunTagValue.includes('notnull')
        const isUnique = bunTagValue.includes(',unique') || bunTagValue.startsWith('unique')
        const isFk = bunTagValue.includes('fk:') || colName.endsWith('_id')

        fields.push({
          name: goFieldName,
          normalizedName: colName || toSnakeCase(goFieldName),
          dataType: mapGoType(goType),
          nativeType: goType,
          isNullable: isNullable ? true : null,
          isPrimaryKey: isPk,
          isForeignKey: isFk,
          isUnique,
          ordinalPosition: fields.length,
          metadata: {},
        })
      }

      j++
    }

    if (fields.length === 0 && relationships.length === 0) continue

    entities.push({
      name: structName,
      normalizedName: toSnakeCase(structName),
      tableName: tableName ?? toSnakeCase(structName) + 's',
      entityType: 'table',
      fields,
      relationships,
      confidence: 'high',
      source: { file, line: i + 1, extractorId },
    })
  }

  return entities
}

// ---- Helpers ----

function mapGoType(t: string): string {
  const lower = t.toLowerCase()
  if (/string/.test(lower)) return 'string'
  if (/int64|int32|int16|int8\b|int\b/.test(lower)) return 'integer'
  if (/float64|float32/.test(lower)) return 'float'
  if (/bool/.test(lower)) return 'boolean'
  if (/time\.time/.test(lower)) return 'datetime'
  if (/uuid/.test(lower)) return 'uuid'
  if (/\[\]byte/.test(lower)) return 'binary'
  return 'string'
}

function stripComments(code: string): string {
  return code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}
