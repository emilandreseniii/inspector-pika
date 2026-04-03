import { BaseExtractor, ExtractorResult, RawEntity, RawField, RawRelationship } from '../../base'

// EF Core CLR type → normalised type
const EF_TYPE_MAP: Record<string, string> = {
  string: 'string', String: 'string',
  int: 'integer', Int32: 'integer', long: 'bigint', Int64: 'bigint',
  short: 'integer', Int16: 'integer', byte: 'integer', Byte: 'integer',
  double: 'float', Double: 'float', float: 'float', Single: 'float',
  decimal: 'decimal', Decimal: 'decimal',
  bool: 'boolean', Boolean: 'boolean',
  DateTime: 'datetime', DateTimeOffset: 'datetime', DateOnly: 'date', TimeOnly: 'time',
  Guid: 'uuid', byte_array: 'binary',
}

// EF Core navigation / collection property patterns
const NAV_COLLECTION_RE = /(?:ICollection|IList|IEnumerable|List|HashSet)<(\w+)>/
const NAV_SINGLE_RE = /^\s*public\s+(?:virtual\s+)?(\w+)\s+(\w+)\s*\{/

export class EfCoreExtractor extends BaseExtractor {
  readonly extractorId = 'csharp.ef_core'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []

    // Find DbContext files and entity files
    const hits = await this.grep('**/*.cs', /DbSet<|DbContext|\[Table\]|\[Table\s*\(/)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    let filesScanned = 0
    // Collect all entity class names from DbSet<T> properties first
    const dbSetTypes = new Set<string>()
    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        if (!content.includes('DbContext') && !content.includes('DbSet<')) continue
        for (const m of content.matchAll(/DbSet<(\w+)>/g)) {
          dbSetTypes.add(m[1])
        }
      } catch { /* skip */ }
    }

    // Parse all CS files for entity classes
    const allCsFiles = await this.glob('**/*.cs')
    for (const file of allCsFiles) {
      try {
        const content = await this.readFile(file)
        if (!isEntityFile(content, dbSetTypes)) continue
        filesScanned++
        const parsed = parseEntityFile(content, file, this.extractorId)
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

// ---- Helpers ----

function isEntityFile(content: string, dbSetTypes: Set<string>): boolean {
  if (/\[Table\b/.test(content)) return true
  if (/\[Entity\b/.test(content)) return true
  // Check if class name appears in a DbSet
  const classMatch = content.match(/\bclass\s+(\w+)/)
  if (classMatch && dbSetTypes.has(classMatch[1])) return true
  return false
}

function parseEntityFile(content: string, file: string, extractorId: string): RawEntity | null {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  // Find class name
  const classMatch = normalized.match(/\bclass\s+(\w+)/)
  if (!classMatch) return null
  const className = classMatch[1]

  // [Table("name")] override
  const tableAttr = normalized.match(/\[Table\s*\(\s*["'](\w+)["']/)
  const tableName = tableAttr ? tableAttr[1] : toSnakeCase(className)

  const fields: RawField[] = []
  const relationships: RawRelationship[] = []
  const lines = normalized.split('\n')

  let pos = 0
  let pendingKey = false
  let pendingColumn: string | null = null
  let pendingRequired = false

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    // [Key]
    if (trimmed === '[Key]') { pendingKey = true; continue }
    // [Required]
    if (trimmed === '[Required]') { pendingRequired = true; continue }
    // [Column("name")]
    const colAttr = trimmed.match(/^\[Column\s*\(\s*["'](\w+)["']/)
    if (colAttr) { pendingColumn = colAttr[1]; continue }
    // [MaxLength] / [StringLength] — ignore for now

    // Property: public Type Name { get; set; }
    const propMatch = trimmed.match(/^public\s+(?:virtual\s+)?([?\w<>, ]+?)\s+(\w+)\s*\{\s*get/)
    if (!propMatch) {
      if (!/^\[/.test(trimmed)) {
        pendingKey = false; pendingColumn = null; pendingRequired = false
      }
      continue
    }

    const [, rawType, propName] = propMatch

    // Navigation collection → one_to_many
    const collMatch = rawType.match(NAV_COLLECTION_RE)
    if (collMatch) {
      relationships.push({ type: 'one_to_many', targetEntity: collMatch[1], sourceField: null, targetField: null, metadata: {} })
      pendingKey = false; pendingColumn = null; pendingRequired = false
      continue
    }

    // Nullable type check
    const isNullable = rawType.endsWith('?') || rawType.startsWith('Nullable<')
    const baseType = rawType.replace(/\?$/, '').replace(/^Nullable<(.+)>$/, '$1').trim()
    const normalType = EF_TYPE_MAP[baseType] ?? baseType.toLowerCase()

    // Check if it's a navigation (single) property to another entity
    // Heuristic: type is PascalCase and not a known primitive
    if (!EF_TYPE_MAP[baseType] && /^[A-Z]/.test(baseType) && !baseType.startsWith('I')) {
      relationships.push({ type: 'many_to_one', targetEntity: baseType, sourceField: propName + 'Id', targetField: 'Id', metadata: {} })
      pendingKey = false; pendingColumn = null; pendingRequired = false
      continue
    }

    const colName = pendingColumn ?? toSnakeCase(propName)
    const isPk = pendingKey || propName === 'Id' || propName === className + 'Id'

    fields.push({
      name: colName,
      type: normalType,
      nullable: isPk ? false : !pendingRequired && isNullable,
      isPrimaryKey: isPk,
      isForeignKey: propName.endsWith('Id') && !isPk,
      isUnique: false,
      defaultValue: null,
      ordinalPosition: pos++,
      metadata: {},
    })

    pendingKey = false; pendingColumn = null; pendingRequired = false
  }

  if (fields.length === 0 && relationships.length === 0) return null

  return {
    name: tableName,
    entityType: 'table',
    fields,
    relationships,
    source: { file, startLine: 1, endLine: null, format: 'csharp', extractorId },
    extractorId,
    confidence: 'high',
    metadata: { className, namespace: normalized.match(/namespace\s+([\w.]+)/)?.[1] },
  }
}

function toSnakeCase(name: string): string {
  return name.replace(/([A-Z])/g, (m, c, i) => (i > 0 ? '_' : '') + c.toLowerCase())
}
