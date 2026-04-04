import { BaseExtractor, ExtractorResult, RawEntity, RawField, RawRelationship } from '../../base'

/**
 * Extracts entity definitions from Propel ORM (PHP) schema.xml files.
 *
 * Key patterns in schema.xml:
 *   <table name="users" phpName="User">
 *     <column name="id" type="INTEGER" primaryKey="true" autoIncrement="true"/>
 *     <column name="email" type="VARCHAR" required="true"/>
 *     <column name="created_at" type="TIMESTAMP" required="false"/>
 *     <foreign-key foreignTable="roles">
 *       <reference local="role_id" foreign="id"/>
 *     </foreign-key>
 *   </table>
 */

const PROPEL_TYPE_MAP: Record<string, string> = {
  INTEGER: 'integer', TINYINT: 'integer', SMALLINT: 'integer', BIGINT: 'bigint',
  FLOAT: 'float', REAL: 'float', DOUBLE: 'float', DECIMAL: 'decimal', NUMERIC: 'decimal',
  BOOLEAN: 'boolean', BIT: 'boolean',
  CHAR: 'string', VARCHAR: 'string', LONGVARCHAR: 'text', CLOB: 'text', TEXT: 'text',
  BINARY: 'binary', VARBINARY: 'binary', LONGVARBINARY: 'binary', BLOB: 'binary',
  DATE: 'date', TIME: 'time', TIMESTAMP: 'datetime', DATETIME: 'datetime',
  OBJECT: 'json', ARRAY: 'json', JSON: 'json',
  UUID: 'uuid', UUID_BINARY: 'uuid',
}

export class PropelExtractor extends BaseExtractor {
  readonly extractorId = 'php.propel'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []
    let filesScanned = 0

    const hits = await this.grep('**/schema.xml', /<table\s/)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        filesScanned++
        const parsed = parsePropelSchema(content, file, this.extractorId)
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

function parsePropelSchema(content: string, file: string, extractorId: string): RawEntity[] {
  const entities: RawEntity[] = []

  // Extract all <table ...>...</table> blocks
  for (const tableMatch of content.matchAll(/<table\s([^>]*)>([\s\S]*?)<\/table>/g)) {
    const tableAttrs = tableMatch[1]
    const tableBody = tableMatch[2]

    const nameMatch = tableAttrs.match(/\bname\s*=\s*["']([^"']+)["']/)
    if (!nameMatch) continue
    const tableName = nameMatch[1]

    const fields: RawField[] = []
    const relationships: RawRelationship[] = []
    let pos = 0

    // <column name="id" type="INTEGER" primaryKey="true" required="true"/>
    for (const colMatch of tableBody.matchAll(/<column\s([^/]*)\/?>/g)) {
      const attrs = colMatch[1]
      const colName = attrs.match(/\bname\s*=\s*["']([^"']+)["']/)?.[1]
      if (!colName) continue

      const rawType = attrs.match(/\btype\s*=\s*["']([^"']+)["']/)?.[1]?.toUpperCase() ?? 'VARCHAR'
      const isPrimaryKey = /\bprimaryKey\s*=\s*["']true["']/.test(attrs)
      const nullable = !/\brequired\s*=\s*["']true["']/.test(attrs)
      const isUnique = /\bunique\s*=\s*["']true["']/.test(attrs)

      fields.push({
        name: colName,
        type: PROPEL_TYPE_MAP[rawType] ?? 'string',
        nullable,
        isPrimaryKey,
        isForeignKey: false,
        isUnique: isPrimaryKey || isUnique,
        defaultValue: null,
        ordinalPosition: pos++,
        metadata: {},
      })
    }

    // <foreign-key foreignTable="roles"> ... </foreign-key>
    for (const fkMatch of tableBody.matchAll(/<foreign-key\s([^>]*)>/g)) {
      const fkAttrs = fkMatch[1]
      const foreignTable = fkAttrs.match(/\bforeignTable\s*=\s*["']([^"']+)["']/)?.[1] ?? 'Unknown'
      relationships.push({
        type: 'many_to_one',
        targetEntity: foreignTable,
        sourceField: null,
        targetField: null,
        metadata: {},
      })
    }

    if (fields.length === 0 && relationships.length === 0) continue

    entities.push({
      name: tableName,
      entityType: 'table',
      fields,
      relationships,
      source: { file, startLine: 1, endLine: null, format: 'xml', extractorId },
      extractorId,
      confidence: 'high',
      metadata: {},
    })
  }

  return entities
}
