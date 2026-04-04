import { BaseExtractor, ExtractorResult, RawEntity, RawField, RawRelationship } from '../../base'

/**
 * Extracts entity definitions from Fluent (Vapor ORM, Swift).
 *
 * Key patterns:
 *   final class User: Model, Content {
 *     static let schema = "users"
 *     @ID(key: .id) var id: UUID?
 *     @Field(key: "name") var name: String
 *     @Field(key: "email") var email: String
 *     @OptionalField(key: "age") var age: Int?
 *     @Parent(key: "role_id") var role: Role
 *     @Children(for: \.$user) var posts: [Post]
 *   }
 */

const SWIFT_TYPE_MAP: Record<string, string> = {
  UUID: 'uuid', String: 'string', Int: 'integer', Int32: 'integer', Int64: 'bigint',
  Double: 'float', Float: 'float', Bool: 'boolean',
  Date: 'datetime', Data: 'binary',
}

export class FluentExtractor extends BaseExtractor {
  readonly extractorId = 'swift.fluent'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []
    let filesScanned = 0

    const hits = await this.grep('**/*.swift', /final\s+class\s+\w+\s*:\s*Model|@ID\s*\(|@Field\s*\(/)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        if (!isFluentFile(content)) continue
        filesScanned++
        const parsed = parseFluentFile(content, file, this.extractorId)
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

function isFluentFile(content: string): boolean {
  return /import\s+Fluent|import\s+Vapor/.test(content) && /:\s*Model\b/.test(content)
}

function parseFluentFile(content: string, file: string, extractorId: string): RawEntity | null {
  const stripped = stripComments(content)
  const lines = stripped.split('\n')

  // Find: final class Foo: Model or class Foo: Model, Content
  const classMatch = stripped.match(/(?:final\s+)?class\s+(\w+)\s*:\s*(?:[\w,\s]*\bModel\b)/)
  if (!classMatch) return null

  const className = classMatch[1]

  // Find static let schema = "table_name"
  const schemaMatch = stripped.match(/static\s+let\s+schema\s*=\s*"([^"]+)"/)
  const tableName = schemaMatch?.[1] ?? toSnake(className)

  const fields: RawField[] = []
  const relationships: RawRelationship[] = []
  let pos = 0

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    // @ID(key: .id) var id: UUID?
    if (/^@ID\b/.test(trimmed)) {
      const propMatch = lines[i + 1]?.trim().match(/var\s+(\w+)\s*:\s*([\w.]+)/)
      if (propMatch) {
        fields.push({
          name: propMatch[1],
          type: 'uuid',
          nullable: false,
          isPrimaryKey: true,
          isForeignKey: false,
          isUnique: true,
          defaultValue: null,
          ordinalPosition: pos++,
          metadata: {},
        })
      }
      continue
    }

    // @Field(key: "col_name") var fieldName: Type
    const fieldMatch = trimmed.match(/^@(?:Optional)?Field\s*\(\s*key\s*:\s*(?:\.init\s*\(\s*stringLiteral\s*:\s*)?["']([^"']+)["']/)
    if (fieldMatch) {
      const colName = fieldMatch[1]
      const isOptional = trimmed.startsWith('@Optional')
      const propLine = lines[i + 1]?.trim()
      const propMatch = propLine?.match(/var\s+(\w+)\s*:\s*([\w.]+)\??/)
      if (propMatch) {
        const swiftType = propMatch[2]
        fields.push({
          name: colName,
          type: SWIFT_TYPE_MAP[swiftType] ?? 'string',
          nullable: isOptional,
          isPrimaryKey: false,
          isForeignKey: false,
          isUnique: false,
          defaultValue: null,
          ordinalPosition: pos++,
          metadata: { swiftFieldName: propMatch[1] },
        })
      }
      continue
    }

    // @Parent(key: "role_id") var role: Role
    const parentMatch = trimmed.match(/^@Parent\s*\(\s*key\s*:\s*["']([^"']+)["']/)
    if (parentMatch) {
      const propLine = lines[i + 1]?.trim()
      const propMatch = propLine?.match(/var\s+(\w+)\s*:\s*([\w.]+)/)
      if (propMatch) {
        relationships.push({ type: 'many_to_one', targetEntity: propMatch[2], sourceField: parentMatch[1], targetField: 'id', metadata: {} })
      }
      continue
    }

    // @Children(for: \.$user) var posts: [Post]
    const childrenMatch = trimmed.match(/^@Children/)
    if (childrenMatch) {
      const propLine = lines[i + 1]?.trim()
      const propMatch = propLine?.match(/var\s+\w+\s*:\s*\[(\w+)\]/)
      if (propMatch) {
        relationships.push({ type: 'one_to_many', targetEntity: propMatch[1], sourceField: null, targetField: null, metadata: {} })
      }
      continue
    }

    // @Siblings(through: ...) — many to many
    if (/^@Siblings/.test(trimmed)) {
      const propLine = lines[i + 1]?.trim()
      const propMatch = propLine?.match(/var\s+\w+\s*:\s*\[(\w+)\]/)
      if (propMatch) {
        relationships.push({ type: 'many_to_many', targetEntity: propMatch[1], sourceField: null, targetField: null, metadata: {} })
      }
    }
  }

  if (fields.length === 0) return null

  return {
    name: tableName,
    entityType: 'table',
    fields,
    relationships,
    source: { file, startLine: 1, endLine: null, format: 'swift', extractorId },
    extractorId,
    confidence: 'high',
    metadata: { className },
  }
}

// ---- Helpers ----

function toSnake(name: string): string {
  return name.replace(/([A-Z])/g, (m, c, i) => (i > 0 ? '_' : '') + c.toLowerCase())
}

function stripComments(code: string): string {
  return code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}
