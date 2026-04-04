import { BaseExtractor, ExtractorResult, RawEntity, RawField } from '../../base'

/**
 * Extracts entity definitions from GRDB (Swift SQLite library).
 *
 * Key patterns:
 *   struct User: Codable, FetchableRecord, PersistableRecord {
 *     static let databaseTableName = "users"
 *     var id: Int64
 *     var name: String
 *     var email: String?
 *   }
 *
 * Also supports TableRecord with column enum:
 *   struct User: TableRecord {
 *     static let databaseTableName = "users"
 *     enum Columns: String, ColumnExpression {
 *       case id, name, email
 *     }
 *   }
 */

const SWIFT_TYPE_MAP: Record<string, string> = {
  Int: 'integer', Int32: 'integer', Int64: 'bigint',
  Double: 'float', Float: 'float', Bool: 'boolean',
  String: 'string', Data: 'binary', Date: 'datetime',
  UUID: 'uuid',
}

export class GrdbExtractor extends BaseExtractor {
  readonly extractorId = 'swift.grdb'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []
    let filesScanned = 0

    const hits = await this.grep('**/*.swift', /FetchableRecord|PersistableRecord|TableRecord|databaseTableName/)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        if (!isGrdbFile(content)) continue
        filesScanned++
        const parsed = parseGrdbFile(content, file, this.extractorId)
        entities.push(...parsed)
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

function isGrdbFile(content: string): boolean {
  return /import\s+GRDB/.test(content)
}

function parseGrdbFile(content: string, file: string, extractorId: string): RawEntity[] {
  const stripped = stripComments(content)
  const entities: RawEntity[] = []

  // Match struct Foo: FetchableRecord, PersistableRecord or TableRecord
  const STRUCT_RE = /(?:struct|class|final\s+class)\s+(\w+)\s*:\s*[^{]*(?:FetchableRecord|PersistableRecord|TableRecord)[^{]*\{/g

  for (const structMatch of stripped.matchAll(STRUCT_RE)) {
    const className = structMatch[1]
    const bodyStart = (structMatch.index ?? 0) + structMatch[0].length

    // Extract body
    const body = extractBody(stripped, bodyStart - 1) // -1 to include the {

    // Find static let databaseTableName = "table"
    const tableNameMatch = body.match(/static\s+let\s+databaseTableName\s*=\s*"([^"]+)"/)
    const tableName = tableNameMatch?.[1] ?? toSnake(className)

    const fields: RawField[] = []
    let pos = 0

    // Extract stored properties: var name: Type or var name: Type?
    for (const propMatch of body.matchAll(/var\s+(\w+)\s*:\s*([\w.]+)(\?)?/g)) {
      const name = propMatch[1]
      const swiftType = propMatch[2]
      const isOptional = !!propMatch[3]

      if (['databaseTableName', 'databaseSelection'].includes(name)) continue

      fields.push({
        name,
        type: SWIFT_TYPE_MAP[swiftType] ?? 'string',
        nullable: isOptional,
        isPrimaryKey: name === 'id' || name === 'rowid',
        isForeignKey: false,
        isUnique: false,
        defaultValue: null,
        ordinalPosition: pos++,
        metadata: {},
      })
    }

    if (fields.length === 0) continue

    entities.push({
      name: tableName,
      entityType: 'table',
      fields,
      relationships: [],
      source: { file, startLine: 1, endLine: null, format: 'swift', extractorId },
      extractorId,
      confidence: 'high',
      metadata: { className },
    })
  }

  return entities
}

// ---- Helpers ----

function extractBody(content: string, fromBrace: number): string {
  const openBrace = content.indexOf('{', fromBrace)
  if (openBrace === -1) return ''
  let depth = 1
  let i = openBrace + 1
  while (i < content.length && depth > 0) {
    if (content[i] === '{') depth++
    else if (content[i] === '}') depth--
    i++
  }
  return content.slice(openBrace + 1, i - 1)
}

function toSnake(name: string): string {
  return name.replace(/([A-Z])/g, (m, c, i) => (i > 0 ? '_' : '') + c.toLowerCase())
}

function stripComments(code: string): string {
  return code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}
