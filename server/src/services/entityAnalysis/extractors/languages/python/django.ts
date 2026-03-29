import { BaseExtractor, ExtractorResult, RawEntity, RawField, RawRelationship, RelationshipCardinality } from '../../base'
import { toSnakeCase } from '../../../normalizer'

export class DjangoExtractor extends BaseExtractor {
  readonly extractorId = 'python.django_orm'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []

    // Scan all models.py files plus any .py file with models.Model
    const allPy = await this.glob('**/*.py')
    const candidates = allPy.filter((f) => f.endsWith('/models.py') || f === 'models.py')

    // Also pick up any non-models.py file that uses models.Model (e.g. models/user.py)
    const otherFiles = allPy.filter((f) => !candidates.includes(f))
    for (const file of otherFiles) {
      try {
        const content = await this.readFile(file)
        if (/models\.Model\b|models\.AbstractModel\b|AbstractBaseUser\b/.test(content)) {
          candidates.push(file)
        }
      } catch { /* skip */ }
    }

    let filesScanned = 0

    for (const file of candidates) {
      try {
        const content = await this.readFile(file)
        if (!/class\s+\w+\s*\(/.test(content)) continue
        filesScanned++
        const fileEntities = parseDjangoFile(content, file, this.extractorId)
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

// ---- Logical line joiner (same approach as SQLAlchemy extractor) ----

function joinLogicalLines(content: string): string[] {
  const rawLines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const result: string[] = []
  let buffer: string | null = null
  let depth = 0
  let inTripleSingle = false
  let inTripleDouble = false
  let inSingleStr = false
  let inDoubleStr = false

  for (const raw of rawLines) {
    for (let ci = 0; ci < raw.length; ci++) {
      const ch = raw[ci]
      const three = raw.slice(ci, ci + 3)

      if (!inSingleStr && !inDoubleStr && !inTripleSingle && !inTripleDouble) {
        if (three === "'''") { inTripleSingle = true; ci += 2; continue }
        if (three === '"""') { inTripleDouble = true; ci += 2; continue }
        if (ch === "'") { inSingleStr = true; continue }
        if (ch === '"') { inDoubleStr = true; continue }
        if (ch === '#') break
        if (ch === '(' || ch === '[' || ch === '{') depth++
        else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1)
      } else if (inTripleSingle && three === "'''") { inTripleSingle = false; ci += 2 }
      else if (inTripleDouble && three === '"""') { inTripleDouble = false; ci += 2 }
      else if (inSingleStr && ch === "'" && raw[ci - 1] !== '\\') inSingleStr = false
      else if (inDoubleStr && ch === '"' && raw[ci - 1] !== '\\') inDoubleStr = false
    }

    if (buffer === null) {
      buffer = raw
    } else {
      buffer += ' ' + raw.trim()
    }

    const endsBackslash = raw.trimEnd().endsWith('\\')
    if (depth === 0 && !endsBackslash && !inTripleSingle && !inTripleDouble) {
      result.push(buffer.replace(/\\\s*$/, ''))
      buffer = null
    }
  }

  if (buffer !== null) result.push(buffer)
  return result
}

// ---- File parser ----

function parseDjangoFile(content: string, file: string, extractorId: string): RawEntity[] {
  const lines = joinLogicalLines(content)
  const entities: RawEntity[] = []

  const classBlocks: Array<{ name: string; bases: string; lines: string[]; lineNo: number }> = []
  let current: (typeof classBlocks)[0] | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const classMatch = line.match(/^class\s+(\w+)\s*\(([^)]*)\)\s*:/)
    if (classMatch) {
      if (current) classBlocks.push(current)
      current = { name: classMatch[1], bases: classMatch[2], lines: [], lineNo: i + 1 }
    } else if (current) {
      if (line === '' || line.startsWith(' ') || line.startsWith('\t')) {
        current.lines.push(line)
      } else {
        classBlocks.push(current)
        current = null
        i-- // reprocess this line
      }
    }
  }
  if (current) classBlocks.push(current)

  for (const block of classBlocks) {
    if (!isDjangoModel(block.bases, block.lines)) continue
    if (isAbstractModel(block.lines)) continue

    const entity = extractDjangoClass(block.name, block.lines, block.lineNo, file, extractorId)
    if (entity) entities.push(entity)
  }

  return entities
}

// ---- Detectors ----

function isDjangoModel(bases: string, lines: string[]): boolean {
  // Direct model inheritance
  if (/\bmodels\.Model\b|\bModel\b|\bAbstractUser\b|\bAbstractBaseUser\b|\bTimeStampedModel\b|\bMPTTModel\b/.test(bases)) {
    return true
  }
  // File has django field references even if we don't recognize the base
  const body = lines.join('\n')
  return /models\.\w+Field\s*\(|models\.ForeignKey\s*\(|models\.OneToOneField\s*\(|models\.ManyToManyField\s*\(/.test(body)
}

function isAbstractModel(lines: string[]): boolean {
  const body = lines.join('\n')
  return /class\s+Meta\b[\s\S]*?abstract\s*=\s*True/.test(body)
}

// ---- Class entity extractor ----

function extractDjangoClass(
  className: string,
  lines: string[],
  startLine: number,
  file: string,
  extractorId: string,
): RawEntity | null {
  const fields: RawField[] = []
  const relationships: RawRelationship[] = []

  // Determine table name: Meta.db_table or snake_case of class name
  let tableName = toSnakeCase(className)
  const bodyText = lines.join('\n')
  const dbTableMatch = bodyText.match(/db_table\s*=\s*["']([^"']+)["']/)
  if (dbTableMatch) tableName = dbTableMatch[1]

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    // Match: field_name = models.SomeField(...)
    const fieldMatch = line.match(/^(\w+)\s*=\s*(?:models|fields)\.(\w+)\s*\(([^)]*)\)/)
    if (!fieldMatch) continue

    const [, attrName, fieldType, args] = fieldMatch

    if (RELATIONSHIP_FIELDS.has(fieldType)) {
      const rel = parseDjangoRelationship(attrName, fieldType, args)
      if (rel) relationships.push(rel)
    } else if (FIELD_TYPE_MAP[fieldType] !== undefined) {
      const field = parseDjangoField(attrName, fieldType, args, fields.length + 1)
      if (field) fields.push(field)
    }
  }

  if (fields.length === 0 && relationships.length === 0) return null

  return {
    name: tableName,
    entityType: 'table',
    fields,
    relationships,
    source: { file, startLine, endLine: startLine + lines.length, format: 'python_django', extractorId },
    extractorId,
    confidence: 'high',
    metadata: { pythonClass: className },
  }
}

// ---- Field parser ----

function parseDjangoField(attrName: string, fieldType: string, args: string, position: number): RawField | null {
  const nativeType = fieldType
  const isPK = /primary_key\s*=\s*True/.test(args)
  // Django: null=True means DB-level nullable; blank=True is only form-level
  const nullable = /null\s*=\s*True/.test(args)
  const isUnique = /unique\s*=\s*True/.test(args) || isPK

  // Column name: db_column arg
  let colName = toSnakeCase(attrName)
  const dbColMatch = args.match(/db_column\s*=\s*["']([^"']+)["']/)
  if (dbColMatch) colName = dbColMatch[1]

  return {
    name: colName,
    type: nativeType,
    nullable,
    isPrimaryKey: isPK,
    isForeignKey: false,
    isUnique,
    defaultValue: null,
    ordinalPosition: position,
    metadata: {},
  }
}

// ---- Relationship parser ----

function parseDjangoRelationship(attrName: string, fieldType: string, args: string): RawRelationship | null {
  // First positional arg is the target model (or 'self')
  const firstArg = extractFirstArg(args)
  const targetRaw = firstArg.replace(/['"]/g, '').replace(/^.*\./, '') // strip quotes and app prefix
  if (!targetRaw || targetRaw === 'self') return null

  const targetEntity = toSnakeCase(targetRaw)

  let relType: RelationshipCardinality = 'many_to_one' // ForeignKey default
  if (fieldType === 'OneToOneField') relType = 'one_to_one'
  else if (fieldType === 'ManyToManyField') relType = 'many_to_many'

  const relatedNameMatch = args.match(/related_name\s*=\s*["']([^"']+)["']/)
  const metadata: Record<string, unknown> = {}
  if (relatedNameMatch) metadata.relatedName = relatedNameMatch[1]

  const colName = toSnakeCase(attrName) + '_id'

  return { type: relType, targetEntity, sourceField: colName, targetField: null, metadata }
}

// ---- Helpers ----

function extractFirstArg(args: string): string {
  let depth = 0
  for (let i = 0; i < args.length; i++) {
    const ch = args[i]
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth--
    else if (ch === ',' && depth === 0) return args.slice(0, i).trim()
  }
  return args.trim()
}

const RELATIONSHIP_FIELDS = new Set(['ForeignKey', 'OneToOneField', 'ManyToManyField'])

const FIELD_TYPE_MAP: Record<string, string> = {
  // String
  'CharField': 'CharField', 'TextField': 'TextField', 'EmailField': 'EmailField',
  'URLField': 'URLField', 'SlugField': 'SlugField', 'FileField': 'FileField',
  'ImageField': 'ImageField', 'FilePathField': 'FilePathField',
  'GenericIPAddressField': 'GenericIPAddressField', 'IPAddressField': 'IPAddressField',
  // Integer
  'IntegerField': 'IntegerField', 'BigIntegerField': 'BigIntegerField',
  'SmallIntegerField': 'SmallIntegerField', 'PositiveIntegerField': 'PositiveIntegerField',
  'PositiveBigIntegerField': 'PositiveBigIntegerField', 'PositiveSmallIntegerField': 'PositiveSmallIntegerField',
  'AutoField': 'AutoField', 'BigAutoField': 'BigAutoField', 'SmallAutoField': 'SmallAutoField',
  // Decimal / Float
  'FloatField': 'FloatField', 'DecimalField': 'DecimalField',
  // Boolean
  'BooleanField': 'BooleanField', 'NullBooleanField': 'NullBooleanField',
  // Date / Time
  'DateTimeField': 'DateTimeField', 'DateField': 'DateField', 'TimeField': 'TimeField',
  'DurationField': 'DurationField',
  // Binary / UUID / JSON
  'BinaryField': 'BinaryField', 'UUIDField': 'UUIDField', 'JSONField': 'JSONField',
}
