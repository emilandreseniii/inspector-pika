import { BaseExtractor, ExtractorResult, RawEntity, RawField, RawRelationship, RelationshipCardinality } from '../../base'
import { toSnakeCase } from '../../../normalizer'

// Known Peewee field type names
const PEEWEE_FIELDS = new Set([
  'CharField', 'TextField', 'IntegerField', 'BigIntegerField', 'SmallIntegerField',
  'FloatField', 'DoubleField', 'DecimalField', 'BooleanField', 'DateField',
  'DateTimeField', 'TimeField', 'TimestampField', 'BlobField', 'BitField',
  'BigBitField', 'UUIDField', 'BinaryUUIDField', 'IPField', 'AutoField',
  'BigAutoField', 'IdentityField', 'PrimaryKeyField', 'CompositeKey',
  'ForeignKeyField', 'ManyToManyField', 'DeferredForeignKey', 'BackrefAccessor',
])

export class PeeweeExtractor extends BaseExtractor {
  readonly extractorId = 'python.peewee'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []

    const files = await this.glob('**/*.py')
    let filesScanned = 0

    for (const file of files) {
      try {
        const content = await this.readFile(file)
        // Quick pre-filter: must import peewee
        if (!/(from|import)\s+peewee/.test(content)) continue
        filesScanned++
        const fileEntities = parsePeeweeFile(content, file, this.extractorId)
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

function parsePeeweeFile(content: string, file: string, extractorId: string): RawEntity[] {
  const lines = joinLogicalLines(content)
  const entities: RawEntity[] = []

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    // Detect class extending Model
    const classMatch = trimmed.match(/^class\s+(\w+)\s*\(\s*([\w.,\s]+)\s*\)\s*:/)
    if (!classMatch) continue

    const className = classMatch[1]
    const bases = classMatch[2].split(',').map((b) => b.trim())

    // Only Peewee Model subclasses (Model, BaseModel, db.Model, etc.)
    const isPeeweeModel = bases.some((b) =>
      b === 'Model' || b.endsWith('.Model') || b === 'BaseModel' || b.endsWith('BaseModel'),
    )
    if (!isPeeweeModel) continue
    if (className === 'Meta' || className === 'BaseModel') continue

    const { fields, relationships, tableName } = extractPeeweeClassBody(lines, i, className)
    if (fields.length === 0 && relationships.length === 0) continue

    entities.push({
      name: tableName ?? toSnakeCase(className),
      entityType: 'table',
      fields,
      relationships,
      source: { file, startLine: i + 1, endLine: i + 1, format: 'python_peewee', extractorId },
      extractorId,
      confidence: 'high',
      metadata: { pythonClass: className },
    })
  }

  return entities
}

interface PeeweeClassBody {
  fields: RawField[]
  relationships: RawRelationship[]
  tableName: string | null
}

function extractPeeweeClassBody(lines: string[], classStartLine: number, _className: string): PeeweeClassBody {
  const fields: RawField[] = []
  const relationships: RawRelationship[] = []
  let tableName: string | null = null

  const classIndent = lines[classStartLine].match(/^(\s*)/)?.[1].length ?? 0
  let inMeta = false
  let metaIndent = -1

  for (let i = classStartLine + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue

    const indent = line.match(/^(\s*)/)?.[1].length ?? 0
    if (indent <= classIndent && line.trim()) break

    const trimmed = line.trim()

    // Inner Meta class
    if (/^class\s+Meta\s*:/.test(trimmed)) {
      inMeta = true
      metaIndent = indent
      continue
    }

    if (inMeta) {
      if (indent <= metaIndent && trimmed) { inMeta = false }
      else {
        const tableMatch = trimmed.match(/^table_name\s*=\s*["']([^"']+)["']/)
        if (tableMatch) tableName = tableMatch[1]
        // legacy: db_table
        const dbTableMatch = trimmed.match(/^db_table\s*=\s*["']([^"']+)["']/)
        if (dbTableMatch) tableName = dbTableMatch[1]
        continue
      }
    }

    // Field assignment: name = SomeField(...)
    const fieldMatch = trimmed.match(/^(\w+)\s*=\s*(\w+)\s*\(/)
    if (!fieldMatch) continue

    const fieldName = fieldMatch[1]
    const fieldTypeName = fieldMatch[2]

    if (!PEEWEE_FIELDS.has(fieldTypeName)) continue
    if (['class', 'if', 'for', 'while', 'def'].includes(fieldName)) continue

    // Relationships
    if (fieldTypeName === 'ForeignKeyField' || fieldTypeName === 'DeferredForeignKey') {
      const targetMatch = trimmed.match(/\(\s*(\w+)\s*[,)]/)
      const targetEntity = targetMatch ? toSnakeCase(targetMatch[1]) : 'unknown'

      const backrefMatch = trimmed.match(/\bbackref\s*=\s*["']([^"']+)["']/)

      relationships.push({
        type: 'many_to_one',
        targetEntity,
        sourceField: toSnakeCase(fieldName) + '_id',
        targetField: null,
        metadata: { fieldType: fieldTypeName, backref: backrefMatch?.[1] },
      })
      continue
    }

    if (fieldTypeName === 'ManyToManyField') {
      const targetMatch = trimmed.match(/\(\s*["']?(\w+)["']?\s*[,)]/)
      const targetEntity = targetMatch ? toSnakeCase(targetMatch[1]) : 'unknown'

      relationships.push({
        type: 'many_to_many',
        targetEntity,
        sourceField: null,
        targetField: null,
        metadata: { fieldType: fieldTypeName },
      })
      continue
    }

    // Primary key field
    const isPK =
      fieldTypeName === 'AutoField' ||
      fieldTypeName === 'BigAutoField' ||
      fieldTypeName === 'PrimaryKeyField' ||
      fieldTypeName === 'IdentityField' ||
      /\bprimary_key\s*=\s*True/.test(trimmed)

    const nullableMatch = trimmed.match(/\bnull\s*=\s*(True|False)/)
    const nullable: boolean | null = nullableMatch ? nullableMatch[1] === 'True' : (isPK ? false : null)

    const uniqueMatch = trimmed.match(/\bunique\s*=\s*(True|False)/)
    const isUnique = uniqueMatch ? uniqueMatch[1] === 'True' : isPK

    const colNameMatch = trimmed.match(/\bcolumn_name\s*=\s*["']([^"']+)["']/)
    const colName = colNameMatch ? colNameMatch[1] : toSnakeCase(fieldName)

    const maxLenMatch = trimmed.match(/\bmax_length\s*=\s*(\d+)/)
    const metadata: Record<string, unknown> = { fieldType: fieldTypeName }
    if (maxLenMatch) metadata.maxLength = parseInt(maxLenMatch[1])
    if (isPK) metadata.autoIncrement = true

    fields.push({
      name: colName,
      type: fieldTypeName,
      nullable,
      isPrimaryKey: isPK,
      isForeignKey: false,
      isUnique,
      defaultValue: null,
      ordinalPosition: fields.length + 1,
      metadata,
    })
  }

  return { fields, relationships, tableName }
}

// ---- Logical line joining ----

function joinLogicalLines(content: string): string[] {
  const rawLines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const result: string[] = []
  let buffer: string | null = null
  let depth = 0

  for (const raw of rawLines) {
    if (buffer === null) buffer = raw
    else buffer += ' ' + raw.trim()

    for (const ch of raw) {
      if (ch === '(' || ch === '[' || ch === '{') depth++
      else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1)
      else if (ch === '#') break
    }

    if (depth === 0 && !raw.trimEnd().endsWith('\\')) {
      result.push(buffer.replace(/\\\s*$/, ''))
      buffer = null
    }
  }
  if (buffer !== null) result.push(buffer)
  return result
}
