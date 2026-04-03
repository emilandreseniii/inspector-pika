import { BaseExtractor, ExtractorResult, RawEntity, RawField } from '../../base'

// CLR types → normalised (same as EF Core)
const TYPE_MAP: Record<string, string> = {
  string: 'string', String: 'string',
  int: 'integer', Int32: 'integer', long: 'bigint', Int64: 'bigint',
  short: 'integer', Int16: 'integer', byte: 'integer',
  double: 'float', Double: 'float', float: 'float', Single: 'float',
  decimal: 'decimal', Decimal: 'decimal',
  bool: 'boolean', Boolean: 'boolean',
  DateTime: 'datetime', DateTimeOffset: 'datetime', DateOnly: 'date', TimeOnly: 'time',
  Guid: 'uuid',
}

export class DapperExtractor extends BaseExtractor {
  readonly extractorId = 'csharp.dapper'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []
    let filesScanned = 0

    // Find DTO/model types used in Query<T> and Execute calls
    const hits = await this.grep('**/*.cs', /\.Query<|\.QueryAsync<|\.QueryFirst<|\.QuerySingleOrDefault</)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    // Collect DTO type names from Query<T> usages
    const dtoTypeNames = new Set<string>()
    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        for (const m of content.matchAll(/\.(?:Query|QueryAsync|QueryFirst|QuerySingle|QuerySingleOrDefault)(?:Async)?<(\w+)>/g)) {
          dtoTypeNames.add(m[1])
        }
      } catch { /* skip */ }
    }

    // Find and parse DTO class definitions
    const allCsFiles = await this.glob('**/*.cs')
    for (const file of allCsFiles) {
      try {
        const content = await this.readFile(file)
        const classMatch = content.match(/\bclass\s+(\w+)/)
        if (!classMatch) continue
        if (!dtoTypeNames.has(classMatch[1])) continue
        filesScanned++
        const entity = parseDtoFile(content, file, this.extractorId)
        if (entity) entities.push(entity)
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

// ---- DTO parser ----

function parseDtoFile(content: string, file: string, extractorId: string): RawEntity | null {
  const normalized = content.replace(/\r\n/g, '\n')
  const classMatch = normalized.match(/\bclass\s+(\w+)/)
  if (!classMatch) return null
  const className = classMatch[1]
  const tableName = toSnakeCase(className.replace(/Dto$/, '').replace(/Row$/, '').replace(/Model$/, ''))

  const fields: RawField[] = []
  let pos = 0

  for (const m of normalized.matchAll(/public\s+(\w+\??)\s+(\w+)\s*\{\s*get/g)) {
    const rawType = m[1].replace(/\?$/, '')
    const propName = m[2]
    const isNullable = m[1].endsWith('?')
    const type = TYPE_MAP[rawType] ?? rawType.toLowerCase()
    const isPk = propName === 'Id' || propName === className + 'Id'
    fields.push({
      name: toSnakeCase(propName), type, nullable: isNullable, isPrimaryKey: isPk,
      isForeignKey: propName.endsWith('Id') && !isPk, isUnique: false,
      defaultValue: null, ordinalPosition: pos++, metadata: {},
    })
  }

  if (fields.length === 0) return null

  return {
    name: tableName,
    entityType: 'table',
    fields,
    relationships: [],
    source: { file, startLine: 1, endLine: null, format: 'csharp', extractorId },
    extractorId,
    confidence: 'medium',
    metadata: { className, note: 'Dapper DTO' },
  }
}

function toSnakeCase(name: string): string {
  return name.replace(/([A-Z])/g, (m, c, i) => (i > 0 ? '_' : '') + c.toLowerCase())
}
