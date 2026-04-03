import { BaseExtractor, ExtractorResult, RawEntity, RawField, RawRelationship } from '../../base'

// Prisma scalar types → normalized type names
const PRISMA_TYPE_MAP: Record<string, string> = {
  String: 'string',
  Boolean: 'boolean',
  Int: 'integer',
  BigInt: 'bigint',
  Float: 'float',
  Decimal: 'decimal',
  DateTime: 'datetime',
  Json: 'json',
  Bytes: 'bytes',
}

export class PrismaExtractor extends BaseExtractor {
  readonly extractorId = 'typescript.prisma'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []

    const files = await this.glob('**/schema.prisma')
    // Also catch alternative locations / names
    const altFiles = await this.glob('**/*.prisma')
    const allFiles = [...new Set([...files, ...altFiles])]

    let filesScanned = 0

    for (const file of allFiles) {
      try {
        const content = await this.readFile(file)
        filesScanned++
        const fileEntities = parsePrismaSchema(content, file, this.extractorId)
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

// ---- Prisma schema parser ----

function parsePrismaSchema(content: string, file: string, extractorId: string): RawEntity[] {
  const entities: RawEntity[] = []
  const lines = content.split('\n')

  let i = 0
  while (i < lines.length) {
    const line = lines[i].trim()

    // Detect: model ModelName { ... }
    const modelMatch = line.match(/^model\s+(\w+)\s*\{/)
    if (modelMatch) {
      const modelName = modelMatch[1]
      const { entity, endIndex } = parseModelBlock(lines, i, modelName, file, extractorId)
      if (entity) entities.push(entity)
      i = endIndex + 1
      continue
    }

    i++
  }

  return entities
}

function parseModelBlock(
  lines: string[],
  startIndex: number,
  modelName: string,
  file: string,
  extractorId: string,
): { entity: RawEntity | null; endIndex: number } {
  const fields: RawField[] = []
  const relationships: RawRelationship[] = []
  let tableName: string | undefined
  let endIndex = startIndex

  // Scan through block until closing }
  for (let i = startIndex + 1; i < lines.length; i++) {
    const raw = lines[i]
    const trimmed = raw.trim()

    if (trimmed === '}') {
      endIndex = i
      break
    }

    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue

    // @@map("table_name") → table name override
    const mapMatch = trimmed.match(/^@@map\s*\(\s*["']([^"']+)["']\s*\)/)
    if (mapMatch) {
      tableName = mapMatch[1]
      continue
    }

    // Skip other model-level attributes (@@index, @@unique, @@id, etc.)
    if (trimmed.startsWith('@@')) continue

    // Field line: fieldName FieldType @modifier...
    const fieldMatch = trimmed.match(/^(\w+)\s+([\w[\]?]+)(.*)$/)
    if (!fieldMatch) continue

    const fieldName = fieldMatch[1]
    const typeStr = fieldMatch[2]
    const rest = fieldMatch[3] ?? ''

    // Skip if it's a block attribute line that slipped through
    if (['@@', '//'].includes(fieldName.slice(0, 2))) continue

    const isOptional = typeStr.endsWith('?')
    const isArray = typeStr.endsWith('[]')
    const baseType = typeStr.replace(/[?\[\]]/g, '')

    // @id or @@id → primary key
    const isPK = /@id\b/.test(rest) || fieldName === 'id'

    // @map("col_name") → column name override
    const colMapMatch = rest.match(/@map\s*\(\s*["']([^"']+)["']\s*\)/)
    const columnName = colMapMatch?.[1]

    // Check if this is a relation field (type is another model — starts with uppercase but not Prisma scalar)
    const isPrismaScalar = baseType in PRISMA_TYPE_MAP
    const isEnum = /^[A-Z]/.test(baseType) && !isPrismaScalar  // likely an enum or relation

    if (isArray && isEnum) {
      // Could be a one-to-many or many-to-many relation
      // @relation(...) confirms it's a relation
      if (/@relation/.test(rest)) {
        relationships.push({
          fieldName,
          targetEntity: baseType,
          cardinality: 'one_to_many',
          sourceFile: file,
        })
        continue
      }
    }

    if (!isArray && isEnum && /@relation/.test(rest)) {
      // many_to_one: single foreign model reference with @relation
      relationships.push({
        fieldName,
        targetEntity: baseType,
        cardinality: 'many_to_one',
        sourceFile: file,
      })
      continue
    }

    // @default, @updatedAt → metadata
    const hasDefault = /@default/.test(rest)
    const isUpdatedAt = /@updatedAt/.test(rest)
    const isUnique = /@unique\b/.test(rest)

    const mappedType = PRISMA_TYPE_MAP[baseType] ?? baseType.toLowerCase()

    const field: RawField = {
      name: fieldName,
      columnName,
      type: mappedType,
      isPK: isPK || undefined,
      nullable: isOptional ? true : (isPK ? false : null),
      isUnique: isUnique || undefined,
      metadata: {
        ...(hasDefault ? { hasDefault: true } : {}),
        ...(isUpdatedAt ? { isUpdatedAt: true } : {}),
        ...(isArray ? { isArray: true } : {}),
      },
    }
    fields.push(field)
  }

  if (fields.length === 0 && relationships.length === 0) return { entity: null, endIndex }

  const entity: RawEntity = {
    name: modelName,
    tableName: tableName ?? toSnakeCase(modelName),
    entityType: 'table',
    fields,
    relationships,
    source: {
      file,
      line: startIndex + 1,
      extractorId,
    },
    confidence: 'high',
  }

  return { entity, endIndex }
}

// ---- Convert PascalCase model name to snake_case table name ----

function toSnakeCase(name: string): string {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .toLowerCase()
}
