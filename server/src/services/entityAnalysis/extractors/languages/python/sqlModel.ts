import { BaseExtractor, ExtractorResult, RawEntity, RawField, RawRelationship } from '../../base'
import { toSnakeCase } from '../../../normalizer'

/**
 * Extracts entity surfaces from SQLModel.
 *
 * SQLModel combines Pydantic v1/v2 syntax with SQLAlchemy-backed tables.
 * Only classes with `table=True` in the parent args are actual DB tables.
 *
 *   class User(SQLModel, table=True):
 *       id: Optional[int] = Field(default=None, primary_key=True)
 *       name: str
 *       email: str = Field(unique=True, index=True)
 *
 * Relationships:
 *   hero_id: Optional[int] = Field(default=None, foreign_key="hero.id")
 *   hero: Optional["Hero"] = Relationship(back_populates="teams")
 *
 * Non-table models (table=False or omitted) are Pydantic schemas, not DB tables.
 */
export class SqlModelExtractor extends BaseExtractor {
  readonly extractorId = 'python.sql_model'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []

    const files = await this.glob('**/*.py')
    let filesScanned = 0

    for (const file of files) {
      try {
        const content = await this.readFile(file)
        if (!SQLModel_RE.test(content)) continue
        filesScanned++
        const fileEntities = parseSqlModelFile(content, file, this.extractorId)
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

const SQLModel_RE = /SQLModel\s*,\s*table\s*=\s*True|class\s+\w+\s*\(\s*SQLModel\s*,\s*table/

// ---- File parser ----

function parseSqlModelFile(content: string, file: string, extractorId: string): RawEntity[] {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const entities: RawEntity[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // class User(SQLModel, table=True):
    const classMatch = line.match(/^class\s+(\w+)\s*\(\s*SQLModel\s*,\s*table\s*=\s*True\s*\)\s*:/)
    if (!classMatch) continue

    const className = classMatch[1]
    const tableName = toSnakeCase(className)
    const fields: RawField[] = []
    const relationships: RawRelationship[] = []

    // Read class body until next class or end of dedent
    const classIndent = line.match(/^(\s*)/)?.[1].length ?? 0
    let j = i + 1
    while (j < lines.length) {
      const bodyLine = lines[j]
      const trimmed = bodyLine.trim()

      // End of class body
      if (trimmed === '' || trimmed.startsWith('#')) { j++; continue }
      const bodyIndent = bodyLine.match(/^(\s*)/)?.[1].length ?? 0
      if (bodyIndent <= classIndent && trimmed !== '') break

      // Relationship: hero: Optional["Hero"] = Relationship(...)
      const relMatch = trimmed.match(/^(\w+)\s*:\s*(?:Optional\s*\[\s*["'](\w+)["']\s*\]|["'](\w+)["']|(\w+))\s*=\s*Relationship\s*\(/)
      if (relMatch) {
        const propName = relMatch[1]
        const target = relMatch[2] ?? relMatch[3] ?? relMatch[4]
        if (target && target !== 'None') {
          relationships.push({ type: 'many_to_one', targetEntityName: target, sourceField: propName })
        }
        j++; continue
      }

      // Field: name: str = Field(...)  or  name: str  or  name: Optional[str] = None
      const fieldMatch = trimmed.match(/^(\w+)\s*:\s*(.+?)(?:\s*=\s*(.*))?$/)
      if (fieldMatch) {
        const propName = fieldMatch[1]
        if (['__tablename__', 'class', 'def'].includes(propName)) { j++; continue }

        const typeExpr = fieldMatch[2].trim()
        const defaultExpr = fieldMatch[3] ?? ''

        // Check if it's a foreign_key field (links to another table)
        const isFk = /foreign_key\s*=/.test(defaultExpr)
        const isPk = /primary_key\s*=\s*True/.test(defaultExpr)
        const isNullable = /Optional\s*\[/.test(typeExpr) || /= None/.test(defaultExpr)
        const isUnique = /unique\s*=\s*True/.test(defaultExpr)

        // Unwrap Optional[X]
        const baseType = typeExpr.replace(/Optional\s*\[\s*/, '').replace(/\s*\]$/, '').trim()

        fields.push({
          name: propName,
          normalizedName: toSnakeCase(propName),
          dataType: mapPythonType(baseType),
          nativeType: typeExpr,
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

    entities.push({
      name: className,
      normalizedName: toSnakeCase(className),
      tableName,
      entityType: 'table',
      fields,
      relationships,
      confidence: 'high',
      source: { file, line: i + 1, extractorId },
    })

    i = j - 1
  }

  return entities
}

// ---- Helpers ----

function mapPythonType(t: string): string {
  const lower = t.toLowerCase()
  if (/^str/.test(lower)) return 'string'
  if (/^int/.test(lower)) return 'integer'
  if (/^float|decimal/.test(lower)) return 'float'
  if (/^bool/.test(lower)) return 'boolean'
  if (/^datetime|date|time/.test(lower)) return 'datetime'
  if (/^bytes/.test(lower)) return 'binary'
  if (/^list|dict/.test(lower)) return 'json'
  return 'string'
}
