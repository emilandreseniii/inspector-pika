import { BaseExtractor, ExtractorResult, RawEntity, RawField, RawRelationship } from '../../base'

/**
 * Extracts entity definitions from Cycle ORM (PHP).
 *
 * Key patterns:
 *   #[Entity(table: 'users')]
 *   #[Column(type: 'primary')]
 *   #[Column(type: 'string')]
 *   #[BelongsTo(target: User::class)]
 *   #[HasMany(target: Post::class)]
 *
 * Also supports annotated style (@Entity, @Column).
 */

const CYCLE_TYPE_MAP: Record<string, string> = {
  primary: 'integer',
  bigPrimary: 'bigint',
  tinyInteger: 'integer',
  smallInteger: 'integer',
  integer: 'integer',
  bigInteger: 'bigint',
  float: 'float',
  double: 'float',
  decimal: 'decimal',
  boolean: 'boolean',
  string: 'string',
  text: 'text',
  longText: 'text',
  tinyText: 'text',
  binary: 'binary',
  date: 'date',
  time: 'time',
  datetime: 'datetime',
  timestamp: 'datetime',
  uuid: 'uuid',
  json: 'json',
}

export class CycleOrmExtractor extends BaseExtractor {
  readonly extractorId = 'php.cycle_orm'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []
    let filesScanned = 0

    const hits = await this.grep('**/*.php', /#\[Entity\b|@Entity\b/)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        filesScanned++
        const parsed = parseCycleOrmFile(content, file, this.extractorId)
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

function parseCycleOrmFile(content: string, file: string, extractorId: string): RawEntity | null {
  // Must have cycle ORM import
  if (!/use\s+Cycle\\(?:Annotated|ORM)/.test(content)) return null

  const className = content.match(/class\s+(\w+)/)?.[1]
  if (!className) return null

  // #[Entity(table: 'users')] or @Entity(table = "users")
  const tableAttr = content.match(/#\[Entity\s*\(\s*(?:table\s*:\s*['"](\w+)['"]|[^)]*table\s*:\s*['"](\w+)['"])/)
    ?? content.match(/@Entity\s*\(\s*(?:[^)]*table\s*=\s*['"](\w+)['"])/)
  const tableName = tableAttr?.[1] ?? tableAttr?.[2] ?? toSnake(className)

  const fields: RawField[] = []
  const relationships: RawRelationship[] = []
  const lines = content.split('\n')
  let pos = 0

  let pendingColumn: { type: string; nullable: boolean; isPrimary: boolean } | null = null

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    // #[Column(type: 'primary')] or #[Column(type: 'string', nullable: true)]
    const colAttr = trimmed.match(/#\[Column\s*\(([^)]+)\)/)
      ?? trimmed.match(/@Column\s*\(([^)]+)\)/)
    if (colAttr) {
      const attrs = colAttr[1]
      const typeMatch = attrs.match(/type\s*[=:]\s*['"]?(\w+)['"]?/)
      const nullableMatch = attrs.match(/nullable\s*[=:]\s*(true|false)/)
      const rawType = typeMatch?.[1] ?? 'string'
      pendingColumn = {
        type: CYCLE_TYPE_MAP[rawType] ?? rawType,
        nullable: nullableMatch?.[1] === 'true',
        isPrimary: rawType === 'primary' || rawType === 'bigPrimary',
      }
      continue
    }

    // Relationship annotations
    const relMatch = trimmed.match(/#\[(?:BelongsTo|HasOne)\s*\((?:[^)]*target\s*:\s*(\w+)::class)?/)
      ?? trimmed.match(/@(?:BelongsTo|HasOne)\s*\((?:[^)]*target\s*=\s*['"]?(\w+)['"]?)?/)
    if (relMatch) {
      relationships.push({ type: 'many_to_one', targetEntity: relMatch[1] ?? 'Unknown', sourceField: null, targetField: null, metadata: {} })
      pendingColumn = null; continue
    }

    const hasManyMatch = trimmed.match(/#\[HasMany\s*\((?:[^)]*target\s*:\s*(\w+)::class)?/)
      ?? trimmed.match(/@HasMany\s*\((?:[^)]*target\s*=\s*['"]?(\w+)['"]?)?/)
    if (hasManyMatch) {
      relationships.push({ type: 'one_to_many', targetEntity: hasManyMatch[1] ?? 'Unknown', sourceField: null, targetField: null, metadata: {} })
      pendingColumn = null; continue
    }

    const manyToManyMatch = trimmed.match(/#\[ManyToMany\s*\((?:[^)]*target\s*:\s*(\w+)::class)?/)
    if (manyToManyMatch) {
      relationships.push({ type: 'many_to_many', targetEntity: manyToManyMatch[1] ?? 'Unknown', sourceField: null, targetField: null, metadata: {} })
      pendingColumn = null; continue
    }

    // Property declaration: private/public/protected ?Type $name
    if (pendingColumn) {
      const propMatch = trimmed.match(/(?:private|protected|public)\s+\??[\w\\|]+\s+\$(\w+)/)
      if (propMatch) {
        fields.push({
          name: propMatch[1],
          type: pendingColumn.type,
          nullable: pendingColumn.nullable,
          isPrimaryKey: pendingColumn.isPrimary,
          isForeignKey: false,
          isUnique: false,
          defaultValue: null,
          ordinalPosition: pos++,
          metadata: {},
        })
        pendingColumn = null
      }
    }
  }

  if (fields.length === 0 && relationships.length === 0) return null

  return {
    name: tableName,
    entityType: 'table',
    fields,
    relationships,
    source: { file, startLine: 1, endLine: null, format: 'php', extractorId },
    extractorId,
    confidence: 'high',
    metadata: { className },
  }
}

function toSnake(name: string): string {
  return name.replace(/([A-Z])/g, (m, c, i) => (i > 0 ? '_' : '') + c.toLowerCase())
}
