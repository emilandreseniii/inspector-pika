import { BaseExtractor, ExtractorResult, RawEntity, RawField, RawRelationship } from '../../base'

// Doctrine type → normalised
const DOCTRINE_TYPE_MAP: Record<string, string> = {
  string: 'string', text: 'text', ascii_string: 'string',
  integer: 'integer', smallint: 'integer', bigint: 'bigint',
  float: 'float', decimal: 'decimal',
  boolean: 'boolean',
  date: 'date', date_immutable: 'date', time: 'time', time_immutable: 'time',
  datetime: 'datetime', datetime_immutable: 'datetime', datetimetz: 'datetime',
  binary: 'binary', blob: 'binary',
  guid: 'uuid', uuid: 'uuid',
  json: 'json', simple_array: 'string', array: 'json',
}

export class DoctrineExtractor extends BaseExtractor {
  readonly extractorId = 'php.doctrine'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []
    let filesScanned = 0

    const hits = await this.grep('**/*.php', /#\[ORM\\Entity|#\[Entity\b|@ORM\\Entity|@Entity\b/)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        filesScanned++
        const parsed = parseDoctrineFile(content, file, this.extractorId)
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

function parseDoctrineFile(content: string, file: string, extractorId: string): RawEntity | null {
  const className = content.match(/class\s+(\w+)/)?.[1]
  if (!className) return null

  // [Table(name: "users")] or @ORM\Table(name="users")
  const tableAttr = content.match(/#\[(?:ORM\\)?Table\s*\(\s*name:\s*["'](\w+)["']/)
    ?? content.match(/@(?:ORM\\)?Table\s*\(\s*name\s*=\s*["'](\w+)["']/)
  const tableName = tableAttr?.[1] ?? toSnake(className)

  const fields: RawField[] = []
  const relationships: RawRelationship[] = []
  const lines = content.split('\n')

  let pos = 0
  let pendingColumn: { type: string; nullable: boolean; unique: boolean } | null = null
  let pendingId = false

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    // #[ORM\Id] or @ORM\Id
    if (/#\[(?:ORM\\)?Id\b/.test(trimmed) || /@(?:ORM\\)?Id\b/.test(trimmed)) {
      pendingId = true
      continue
    }

    // #[ORM\Column(type: 'string', nullable: true)]
    // @ORM\Column(type="string", nullable=true)
    const colAttr = trimmed.match(/#\[(?:ORM\\)?Column\s*\(([^)]+)\)/)
      ?? trimmed.match(/@(?:ORM\\)?Column\s*\(([^)]+)\)/)
    if (colAttr) {
      const attrs = colAttr[1]
      const typeMatch = attrs.match(/type\s*[=:]\s*['"]?(\w+)['"]?/)
      const nullableMatch = attrs.match(/nullable\s*[=:]\s*(true|false)/)
      const uniqueMatch = attrs.match(/unique\s*[=:]\s*(true|false)/)
      pendingColumn = {
        type: DOCTRINE_TYPE_MAP[typeMatch?.[1] ?? 'string'] ?? 'string',
        nullable: nullableMatch?.[1] === 'true',
        unique: uniqueMatch?.[1] === 'true',
      }
      continue
    }

    // #[ORM\ManyToOne(targetEntity: User::class)]
    const manyToOneMatch = trimmed.match(/#\[(?:ORM\\)?ManyToOne\s*\((?:[^)]*targetEntity\s*[=:]\s*(\w+)::class)?/)
      ?? trimmed.match(/@(?:ORM\\)?ManyToOne\s*\((?:[^)]*targetEntity\s*=\s*["']?(\w+)["']?)?/)
    if (manyToOneMatch) {
      relationships.push({ type: 'many_to_one', targetEntity: manyToOneMatch[1] ?? 'Unknown', sourceField: null, targetField: null, metadata: {} })
      pendingColumn = null; pendingId = false; continue
    }

    // #[ORM\OneToMany]
    const oneToManyMatch = trimmed.match(/#\[(?:ORM\\)?OneToMany\s*\((?:[^)]*targetEntity\s*[=:]\s*(\w+)::class)?/)
      ?? trimmed.match(/@(?:ORM\\)?OneToMany\s*\((?:[^)]*targetEntity\s*=\s*["']?(\w+)["']?)?/)
    if (oneToManyMatch) {
      relationships.push({ type: 'one_to_many', targetEntity: oneToManyMatch[1] ?? 'Unknown', sourceField: null, targetField: null, metadata: {} })
      pendingColumn = null; pendingId = false; continue
    }

    // #[ORM\ManyToMany]
    const manyToManyMatch = trimmed.match(/#\[(?:ORM\\)?ManyToMany\s*\((?:[^)]*targetEntity\s*[=:]\s*(\w+)::class)?/)
    if (manyToManyMatch) {
      relationships.push({ type: 'many_to_many', targetEntity: manyToManyMatch[1] ?? 'Unknown', sourceField: null, targetField: null, metadata: {} })
      pendingColumn = null; pendingId = false; continue
    }

    // Property: private/protected/public ?string $name = null;
    if (pendingColumn) {
      const propMatch = trimmed.match(/(?:private|protected|public)\s+\??[\w\\|]+\s+\$(\w+)/)
      if (propMatch) {
        const colName = propMatch[1]
        fields.push({
          name: colName,
          type: pendingColumn.type,
          nullable: pendingColumn.nullable,
          isPrimaryKey: pendingId,
          isForeignKey: false,
          isUnique: pendingColumn.unique,
          defaultValue: null,
          ordinalPosition: pos++,
          metadata: {},
        })
        pendingColumn = null
        pendingId = false
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
