import { BaseExtractor, ExtractorResult, RawEntity, RawField, RawRelationship } from '../../base'
import { toSnakeCase } from '../../../normalizer'

// GORM relation keywords in struct tags
const RELATION_TAGS = ['hasOne', 'hasMany', 'belongsTo', 'many2many']

export class GormExtractor extends BaseExtractor {
  readonly extractorId = 'go.gorm'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []

    const files = await this.glob('**/*.go')
    let filesScanned = 0

    for (const file of files) {
      try {
        const content = await this.readFile(file)
        // Quick pre-filter: must use gorm tags or embed gorm.Model
        if (!(/gorm:/.test(content) || /gorm\.Model/.test(content) || /AutoMigrate/.test(content))) continue
        filesScanned++
        const fileEntities = parseGormFile(content, file, this.extractorId)
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

function parseGormFile(content: string, file: string, extractorId: string): RawEntity[] {
  const entities: RawEntity[] = []
  const stripped = stripComments(content)
  const lines = stripped.split('\n')

  let i = 0
  while (i < lines.length) {
    const line = lines[i].trim()

    // type ModelName struct {
    const structMatch = line.match(/^type\s+(\w+)\s+struct\s*\{/)
    if (!structMatch) { i++; continue }

    const structName = structMatch[1]

    // Scan struct body
    const { fields, relationships, isGorm, endIndex } = parseStructBody(lines, i + 1, file)

    if (isGorm && fields.length > 0) {
      const tableName = toSnakeCase(structName) + 's'
      entities.push({
        name: structName,
        tableName,
        entityType: 'table',
        fields,
        relationships,
        source: { file, line: i + 1, extractorId },
        confidence: 'high',
      })
    }

    i = endIndex + 1
  }

  return entities
}

function parseStructBody(
  lines: string[],
  startIndex: number,
  file: string,
): { fields: RawField[]; relationships: RawRelationship[]; isGorm: boolean; endIndex: number } {
  const fields: RawField[] = []
  const relationships: RawRelationship[] = []
  let isGorm = false
  let endIndex = startIndex

  for (let i = startIndex; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    if (trimmed === '}') {
      endIndex = i
      break
    }

    if (!trimmed || trimmed.startsWith('//')) continue

    // Embedded gorm.Model → definitely a GORM model
    if (trimmed === 'gorm.Model' || trimmed.startsWith('gorm.Model ')) {
      isGorm = true
      // gorm.Model provides ID, CreatedAt, UpdatedAt, DeletedAt
      fields.push(
        { name: 'ID', columnName: 'id', type: 'integer', isPK: true, nullable: false },
        { name: 'CreatedAt', columnName: 'created_at', type: 'datetime' },
        { name: 'UpdatedAt', columnName: 'updated_at', type: 'datetime' },
        { name: 'DeletedAt', columnName: 'deleted_at', type: 'datetime', nullable: true },
      )
      continue
    }

    // Field line: FieldName Type `gorm:"..."` or FieldName Type `...gorm:"..."...`
    const fieldMatch = trimmed.match(/^(\w+)\s+([\w*\[\].]+)\s*(?:`([^`]*)`)?/)
    if (!fieldMatch) continue

    const fieldName = fieldMatch[1]
    const goType = fieldMatch[2]
    const tags = fieldMatch[3] ?? ''

    // Check for gorm tag
    const gormTag = tags.match(/gorm:"([^"]*)"/)
    if (gormTag) {
      isGorm = true
      const tagContent = gormTag[1]

      // Skip if explicitly marked as a relation pointer (has a relation tag)
      const hasRelation = RELATION_TAGS.some((t) => tagContent.toLowerCase().includes(t))
      if (hasRelation) {
        // It's a relationship field
        const targetType = extractBaseType(goType)
        const many2many = tagContent.includes('many2many:')
        relationships.push({
          fieldName,
          targetEntity: targetType,
          cardinality: many2many ? 'many_to_many' : 'one_to_many',
          sourceFile: file,
        })
        continue
      }

      // gorm:"-" means skip
      if (tagContent === '-') continue

      // column name from gorm tag
      const colMatch = tagContent.match(/column:(\w+)/)
      const columnName = colMatch?.[1] ?? toSnakeCase(fieldName)

      const isPK = /primarykey|primaryKey|primary_key/.test(tagContent)
      const isUnique = /unique/.test(tagContent)
      const isNotNull = /not null/.test(tagContent)
      const type = goTypeToNormalized(goType)

      fields.push({
        name: fieldName,
        columnName,
        type,
        isPK: isPK || undefined,
        nullable: isPK ? false : (isNotNull ? false : null),
        isUnique: isUnique || undefined,
      })
    } else if (gormTag === null && tags === '' && /gorm\.Model/.test(lines.slice(startIndex, startIndex + 5).join(' '))) {
      // Field without tag in a GORM model (tagged struct without gorm:"..." is still a column)
      // Only include primitive/scalar fields
      const type = goTypeToNormalized(goType)
      if (type) {
        const columnName = toSnakeCase(fieldName)
        fields.push({ name: fieldName, columnName, type, nullable: null })
      }
    }
  }

  return { fields, relationships, isGorm, endIndex }
}

// ---- Extract base type from pointer/slice ----

function extractBaseType(goType: string): string {
  return goType.replace(/^\*/, '').replace(/^\[\]/, '').split('.').pop() ?? goType
}

// ---- Map Go types to normalized types ----

function goTypeToNormalized(goType: string): string | undefined {
  const t = goType.replace(/^\*/, '').replace(/^\[\]/, '')
  const map: Record<string, string> = {
    string: 'string',
    int: 'integer', int8: 'integer', int16: 'integer', int32: 'integer', int64: 'integer',
    uint: 'integer', uint8: 'integer', uint16: 'integer', uint32: 'integer', uint64: 'integer',
    float32: 'float', float64: 'float',
    bool: 'boolean',
    'time.Time': 'datetime',
    'datatypes.JSON': 'json',
    'json.RawMessage': 'json',
  }
  return map[t] ?? (t.startsWith('sql.Null') ? t.slice(8).toLowerCase() : undefined)
}

function stripComments(code: string): string {
  let result = code.replace(/\/\/.*$/gm, '')
  result = result.replace(/\/\*[\s\S]*?\*\//g, '')
  return result
}
