import { BaseExtractor, ExtractorResult, RawEntity, RawField, RawRelationship, RelationshipCardinality } from '../../base'
import { toSnakeCase } from '../../../normalizer'

export class TortoiseOrmExtractor extends BaseExtractor {
  readonly extractorId = 'python.tortoise_orm'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []

    const files = await this.glob('**/*.py')
    let filesScanned = 0

    for (const file of files) {
      try {
        const content = await this.readFile(file)
        // Quick pre-filter: must look like a Tortoise model file
        if (!content.includes('tortoise') && !content.includes('fields.') && !/class\s+\w+\s*\(\s*\w*Model\w*\s*\)/.test(content)) continue
        if (!/(from|import)\s+tortoise/.test(content)) continue
        filesScanned++
        const fileEntities = parseTortoiseFile(content, file, this.extractorId)
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

function parseTortoiseFile(content: string, file: string, extractorId: string): RawEntity[] {
  const lines = joinLogicalLines(content)
  const entities: RawEntity[] = []

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    // Detect class extending Model or AbstractModel
    const classMatch = trimmed.match(/^class\s+(\w+)\s*\(\s*([\w.,\s]+)\s*\)\s*:/)
    if (!classMatch) continue

    const className = classMatch[1]
    const bases = classMatch[2].split(',').map((b) => b.trim())

    // Only Tortoise model subclasses
    if (!bases.some((b) => b === 'Model' || b.endsWith('.Model') || b === 'AbstractModel')) continue
    if (className === 'Meta') continue

    // Find class body
    const { fields, relationships, tableName: metaTable, isAbstract } = extractTortoiseClassBody(lines, i, className)
    if (isAbstract) continue

    const tableName = metaTable ?? toSnakeCase(className)
    if (fields.length === 0 && relationships.length === 0) continue

    entities.push({
      name: tableName,
      entityType: 'table',
      fields,
      relationships,
      source: { file, startLine: i + 1, endLine: i + 1, format: 'python_tortoise_orm', extractorId },
      extractorId,
      confidence: 'high',
      metadata: { pythonClass: className },
    })
  }

  return entities
}

interface TortoiseClassBody {
  fields: RawField[]
  relationships: RawRelationship[]
  tableName: string | null
  isAbstract: boolean
}

function extractTortoiseClassBody(lines: string[], classStartLine: number, _className: string): TortoiseClassBody {
  const fields: RawField[] = []
  const relationships: RawRelationship[] = []
  let tableName: string | null = null
  let isAbstract = false

  const classIndent = lines[classStartLine].match(/^(\s*)/)?.[1].length ?? 0
  let inMeta = false
  let metaIndent = -1

  for (let i = classStartLine + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue

    const indent = line.match(/^(\s*)/)?.[1].length ?? 0
    if (indent <= classIndent && line.trim()) break  // End of class

    const trimmed = line.trim()

    // Detect inner Meta class
    if (/^class\s+Meta\s*:/.test(trimmed)) {
      inMeta = true
      metaIndent = indent
      continue
    }

    if (inMeta) {
      if (indent <= metaIndent && trimmed) { inMeta = false }
      else {
        const tableMatch = trimmed.match(/^table\s*=\s*["']([^"']+)["']/)
        if (tableMatch) tableName = tableMatch[1]
        const abstractMatch = trimmed.match(/^abstract\s*=\s*True/)
        if (abstractMatch) isAbstract = true
        continue
      }
    }

    // Field: name = fields.FieldType(...)  or  name = fields.relational.FieldType(...)
    const fieldMatch = trimmed.match(/^(\w+)\s*:\s*.*=\s*fields\.|^(\w+)\s*=\s*fields\./)
    if (!fieldMatch) continue

    const fieldName = (fieldMatch[1] ?? fieldMatch[2]).trim()
    if (fieldName === 'class' || !fieldName) continue

    // Extract field type: fields.CharField, fields.relational.ForeignKeyField, etc.
    // Use simple non-backtracking pattern: after "fields." skip optional "module." prefix
    const typeMatch = trimmed.match(/fields\.(?:\w+\.)?(\w+)\s*\(/)
    if (!typeMatch) continue

    const fieldType = typeMatch[1]
    // Only process known Tortoise field types
    if (!fieldType.endsWith('Field')) continue

    // Relationship fields
    if (/ForeignKeyField|OneToOneField|ManyToManyField/.test(fieldType)) {
      let relType: RelationshipCardinality = 'many_to_one'
      if (fieldType === 'OneToOneField') relType = 'one_to_one'
      else if (fieldType === 'ManyToManyField') relType = 'many_to_many'

      // Extract target model: fields.ForeignKeyField("app.ModelName", ...)
      const targetMatch = trimmed.match(/fields\.(?:\w+\.)?\w+\s*\(\s*["'](?:\w+\.)?(\w+)["']/)
      const targetEntity = targetMatch ? toSnakeCase(targetMatch[1]) : 'unknown'

      relationships.push({
        type: relType,
        targetEntity,
        sourceField: toSnakeCase(fieldName) + '_id',
        targetField: null,
        metadata: { fieldType },
      })
      continue
    }

    // Regular fields
    const isPK = /^id$/.test(fieldName) || /\bpk\s*=\s*True/.test(trimmed) || fieldType === 'IntField' && fieldName === 'id'
    const isGenerated = /generated\s*=\s*True|pk\s*=\s*True/.test(trimmed) || fieldName === 'id'

    const nullableMatch = trimmed.match(/\bnull\s*=\s*(True|False)/)
    const nullable: boolean | null = nullableMatch ? nullableMatch[1] === 'True' : (isPK ? false : null)

    const uniqueMatch = trimmed.match(/\bunique\s*=\s*(True|False)/)
    const isUnique = uniqueMatch ? uniqueMatch[1] === 'True' : isPK

    const dbColMatch = trimmed.match(/\bcolumn_name\s*=\s*["']([^"']+)["']/)
    const colName = dbColMatch ? dbColMatch[1] : toSnakeCase(fieldName)

    const metadata: Record<string, unknown> = { fieldType }
    if (isGenerated) metadata.autoIncrement = true

    const maxLenMatch = trimmed.match(/\bmax_length\s*=\s*(\d+)/)
    if (maxLenMatch) metadata.maxLength = parseInt(maxLenMatch[1])

    fields.push({
      name: colName,
      type: fieldType,
      nullable,
      isPrimaryKey: isPK,
      isForeignKey: false,
      isUnique,
      defaultValue: null,
      ordinalPosition: fields.length + 1,
      metadata,
    })
  }

  return { fields, relationships, tableName, isAbstract }
}

// ---- Logical line joining (handles open parens and backslash continuation) ----

function joinLogicalLines(content: string): string[] {
  const rawLines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const result: string[] = []
  let buffer: string | null = null
  let depth = 0

  for (const raw of rawLines) {
    if (buffer === null) buffer = raw
    else buffer += ' ' + raw.trim()

    // Count paren depth (simplified — no string awareness)
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
