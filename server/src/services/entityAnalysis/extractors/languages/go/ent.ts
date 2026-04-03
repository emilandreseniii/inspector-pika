import { BaseExtractor, ExtractorResult, RawEntity, RawField, RawRelationship } from '../../base'
import { toSnakeCase } from '../../../normalizer'

// Ent field types → normalized
const ENT_TYPE_MAP: Record<string, string> = {
  Int: 'integer', Int8: 'integer', Int16: 'integer', Int32: 'integer', Int64: 'integer',
  Uint: 'integer', Uint8: 'integer', Uint16: 'integer', Uint32: 'integer', Uint64: 'integer',
  Float: 'float', Float32: 'float',
  String: 'string',
  Bool: 'boolean',
  Time: 'datetime',
  UUID: 'uuid',
  JSON: 'json',
  Bytes: 'bytes',
  Enum: 'enum',
  Text: 'string',
}

// Ent edge types → cardinality
const EDGE_CARDINALITY: Record<string, RawRelationship['cardinality']> = {
  To: 'one_to_many',
  From: 'many_to_one',
  O2O: 'one_to_one',
  O2M: 'one_to_many',
  M2O: 'many_to_one',
  M2M: 'many_to_many',
}

export class EntExtractor extends BaseExtractor {
  readonly extractorId = 'go.ent'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []

    // Ent schemas are in ent/schema/*.go
    const schemaFiles = await this.glob('**/ent/schema/*.go')

    let filesScanned = 0

    for (const file of schemaFiles) {
      try {
        const content = await this.readFile(file)
        filesScanned++
        const fileEntities = parseEntSchemaFile(content, file, this.extractorId)
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

// ---- Parse ent schema file ----

function parseEntSchemaFile(content: string, file: string, extractorId: string): RawEntity[] {
  const entities: RawEntity[] = []
  const stripped = stripComments(content)
  const lines = stripped.split('\n')

  let i = 0
  while (i < lines.length) {
    const line = lines[i].trim()

    // type User struct { ... } with ent.Schema embedding
    const structMatch = line.match(/^type\s+(\w+)\s+struct\s*\{/)
    if (!structMatch) { i++; continue }

    const structName = structMatch[1]

    // Quick check: does the struct embed ent.Schema?
    const bodyEnd = findStructEnd(lines, i + 1)
    const bodyLines = lines.slice(i + 1, bodyEnd)
    const isEntSchema = bodyLines.some((l) => /ent\.Schema/.test(l.trim()))

    if (!isEntSchema) { i = bodyEnd + 1; continue }

    // Find Fields() and Edges() methods for this struct
    const fields = extractFields(lines, structName, bodyEnd + 1)
    const relationships = extractEdges(lines, structName, bodyEnd + 1)

    entities.push({
      name: structName,
      tableName: toSnakeCase(structName) + 's',
      entityType: 'table',
      fields,
      relationships,
      source: { file, line: i + 1, extractorId },
      confidence: 'high',
    })

    i = bodyEnd + 1
  }

  return entities
}

// ---- Find end of struct ----

function findStructEnd(lines: string[], startIndex: number): number {
  for (let i = startIndex; i < lines.length; i++) {
    if (lines[i].trim() === '}') return i
  }
  return lines.length - 1
}

// ---- Extract Fields() method for struct ----

function extractFields(lines: string[], structName: string, startIndex: number): RawField[] {
  const fields: RawField[] = []

  // Find: func (User) Fields() []ent.Field {
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim()
    const methodMatch = line.match(new RegExp(`^func\\s*\\((?:\\w+\\s+)?${escapeRegex(structName)}\\)\\s+Fields\\s*\\(`))
    if (!methodMatch) continue

    // Scan until closing }
    let depth = 0
    for (let j = i; j < lines.length; j++) {
      const l = lines[j].trim()
      for (const ch of l) {
        if (ch === '{') depth++
        else if (ch === '}') depth--
      }

      // field.Int("age") or field.String("name").Optional() etc.
      const fieldMatch = l.match(/field\.(\w+)\s*\(\s*"([^"]+)"/)
      if (fieldMatch) {
        const fieldTypeName = fieldMatch[1]
        const fieldName = fieldMatch[2]

        if (fieldTypeName === 'Other' || fieldTypeName === 'UUID') {
          // Skip complex types we can't easily infer
        }

        const type = ENT_TYPE_MAP[fieldTypeName] ?? fieldTypeName.toLowerCase()
        const isOptional = /\.Optional\(\)/.test(l)
        const isUnique = /\.Unique\(\)/.test(l)
        const hasDefault = /\.Default\(/.test(l)
        const isImmutable = /\.Immutable\(\)/.test(l)

        fields.push({
          name: fieldName,
          columnName: toSnakeCase(fieldName),
          type,
          nullable: isOptional ? true : null,
          isUnique: isUnique || undefined,
          metadata: {
            ...(hasDefault ? { hasDefault: true } : {}),
            ...(isImmutable ? { isImmutable: true } : {}),
          },
        })
      }

      if (depth === 0 && j > i) break
    }

    break  // only one Fields() method
  }

  return fields
}

// ---- Extract Edges() method for struct ----

function extractEdges(lines: string[], structName: string, startIndex: number): RawRelationship[] {
  const relationships: RawRelationship[] = []

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim()
    const methodMatch = line.match(new RegExp(`^func\\s*\\((?:\\w+\\s+)?${escapeRegex(structName)}\\)\\s+Edges\\s*\\(`))
    if (!methodMatch) continue

    let depth = 0
    for (let j = i; j < lines.length; j++) {
      const l = lines[j].trim()
      for (const ch of l) {
        if (ch === '{') depth++
        else if (ch === '}') depth--
      }

      // edge.To("pets", Pet.Type) or edge.From("owner", User.Type)
      const edgeMatch = l.match(/edge\.(To|From)\s*\(\s*"([^"]+)"\s*,\s*(\w+)\.Type/)
      if (edgeMatch) {
        const edgeDir = edgeMatch[1]
        const edgeName = edgeMatch[2]
        const targetType = edgeMatch[3]
        relationships.push({
          fieldName: edgeName,
          targetEntity: targetType,
          cardinality: EDGE_CARDINALITY[edgeDir] ?? 'one_to_many',
        })
      }

      if (depth === 0 && j > i) break
    }

    break
  }

  return relationships
}

function stripComments(code: string): string {
  let result = code.replace(/\/\/.*$/gm, '')
  result = result.replace(/\/\*[\s\S]*?\*\//g, '')
  return result
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
