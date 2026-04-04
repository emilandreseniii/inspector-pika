import { BaseExtractor, ExtractorResult, RawEntity, RawField, RawRelationship } from '../../base'
import { toSnakeCase } from '../../../normalizer'

/**
 * Extracts entity surfaces from MikroORM.
 *
 * Key decorators from @mikro-orm/core:
 *   @Entity()               — marks the class as a DB entity
 *   @Entity({ tableName: 'table' })
 *   @Property()             — regular column
 *   @PrimaryKey()           — primary key (single) or composite
 *   @SerializedPrimaryKey() — string representation of ObjectId (MongoDB)
 *   @ManyToOne(() => Other) — many-to-one relation
 *   @OneToMany(() => Other, o => o.field) — one-to-many
 *   @OneToOne(() => Other)  — one-to-one
 *   @ManyToMany(() => Other) — many-to-many
 *   @Enum()                 — enum property
 */

const RELATION_DECORATORS: Record<string, RawRelationship['cardinality']> = {
  ManyToOne: 'many_to_one',
  OneToMany: 'one_to_many',
  OneToOne: 'one_to_one',
  ManyToMany: 'many_to_many',
}

export class MikroOrmExtractor extends BaseExtractor {
  readonly extractorId = 'typescript.mikro_orm'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []

    const hits = await this.grep('**/*.{ts,mts}', /@Entity\s*\(/, 2000)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]
    let filesScanned = 0

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        // Filter out TypeORM files — they also use @Entity()
        // MikroORM uses @Property() while TypeORM uses @Column()
        if (/@Column\s*\(/.test(content) && !/@Property\s*\(/.test(content)) continue

        filesScanned++
        const fileEntities = parseMikroOrmFile(content, file, this.extractorId)
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

// ---- File parser ----

function parseMikroOrmFile(content: string, file: string, extractorId: string): RawEntity[] {
  if (!/@Entity\s*\(/.test(content)) return []

  const stripped = stripComments(content)
  const lines = stripped.split('\n')
  const entities: RawEntity[] = []

  let i = 0
  while (i < lines.length) {
    const trimmed = lines[i].trim()

    if (!trimmed.startsWith('@Entity')) { i++; continue }

    // Extract tableName from @Entity({ tableName: 'users' }) or @Entity({ collection: 'users' })
    let tableName: string | undefined
    const tableNameMatch = trimmed.match(/(?:tableName|collection)\s*:\s*['"`]([^'"`]+)['"`]/)
    if (tableNameMatch) tableName = tableNameMatch[1]

    // Find class declaration
    let className: string | undefined
    let classLine = i + 1
    while (classLine < lines.length && classLine < i + 5) {
      const m = lines[classLine].match(/(?:export\s+)?class\s+(\w+)/)
      if (m) { className = m[1]; break }
      classLine++
    }
    if (!className) { i++; continue }

    const derivedTable = tableName ?? toSnakeCase(className)

    // Parse class body for properties and relations
    const fields: RawField[] = []
    const relationships: RawRelationship[] = []
    const bodyStart = classLine + 1

    // Find matching closing brace
    let depth = 0
    let bodyEnd = bodyStart
    for (let j = classLine; j < lines.length; j++) {
      for (const ch of lines[j]) { if (ch === '{') depth++; else if (ch === '}') depth-- }
      if (depth === 0 && j > classLine) { bodyEnd = j; break }
    }

    let j = bodyStart
    while (j < bodyEnd) {
      const propLine = lines[j].trim()

      // @PrimaryKey() or @SerializedPrimaryKey()
      if (/@PrimaryKey\s*\(|@SerializedPrimaryKey\s*\(/.test(propLine)) {
        const nextLine = findPropertyLine(lines, j + 1, bodyEnd)
        if (nextLine) {
          const field = parsePropertyDeclaration(nextLine.text, true, false)
          if (field) fields.push(field)
          j = nextLine.idx + 1
          continue
        }
      }

      // @Property([options])
      if (/@Property\s*\(|@Enum\s*\(/.test(propLine)) {
        // Extract nullable from @Property({ nullable: true })
        const isNullable = /nullable\s*:\s*true/.test(propLine)
        const isUnique = /unique\s*:\s*true/.test(propLine)
        // Extract columnType from @Property({ columnType: 'text' })
        const colTypeMatch = propLine.match(/columnType\s*:\s*['"`]([^'"`]+)['"`]/)

        const nextLine = findPropertyLine(lines, j + 1, bodyEnd)
        if (nextLine) {
          const field = parsePropertyDeclaration(nextLine.text, false, false)
          if (field) {
            if (isNullable) field.isNullable = true
            if (isUnique) field.isUnique = true
            if (colTypeMatch) field.nativeType = colTypeMatch[1]
            fields.push(field)
          }
          j = nextLine.idx + 1
          continue
        }
      }

      // Relation decorators: @ManyToOne, @OneToMany, @OneToOne, @ManyToMany
      let relCardinality: RawRelationship['cardinality'] | undefined
      for (const [deco, card] of Object.entries(RELATION_DECORATORS)) {
        if (new RegExp(`@${deco}\\s*\\(`).test(propLine)) { relCardinality = card; break }
      }

      if (relCardinality) {
        // Extract target entity from arrow fn: @ManyToOne(() => User, ...)
        const targetMatch = propLine.match(/@\w+\s*\(\s*\(\s*\)\s*=>\s*(\w+)/)
        const nextLine = findPropertyLine(lines, j + 1, bodyEnd)
        const propName = nextLine ? extractPropName(nextLine.text) : undefined

        if (targetMatch && propName) {
          relationships.push({
            type: relCardinality,
            targetEntityName: targetMatch[1],
            sourceField: propName,
          })
          j = nextLine ? nextLine.idx + 1 : j + 1
          continue
        }
      }

      j++
    }

    entities.push({
      name: className,
      normalizedName: toSnakeCase(className),
      tableName: derivedTable,
      entityType: 'table',
      fields,
      relationships,
      confidence: 'high',
      source: { file, line: classLine + 1, extractorId },
    })

    i = bodyEnd + 1
  }

  return entities
}

// ---- Helpers ----

interface LineResult { text: string; idx: number }

function findPropertyLine(lines: string[], startIdx: number, endIdx: number): LineResult | null {
  for (let i = startIdx; i < Math.min(startIdx + 3, endIdx); i++) {
    const t = lines[i].trim()
    if (t && !t.startsWith('@') && !t.startsWith('//') && !t.startsWith('*')) {
      return { text: t, idx: i }
    }
  }
  return null
}

function parsePropertyDeclaration(line: string, isPrimaryKey: boolean, isForeignKey: boolean): RawField | null {
  // Handles:  propName: Type  or  propName?: Type  or  propName!: Type
  const match = line.match(/^(?:(?:public|protected|private|readonly)\s+)*(\w+)[?!]?\s*:\s*([\w<>[\],\s|&]+?)(?:\s*=.*)?(?:\s*;)?$/)
  if (!match) return null

  const name = match[1]
  const tsType = match[2].trim()

  // Detect nullable from the TS type itself
  const isNullable = tsType.includes('null') || tsType.includes('undefined') || line.includes('?')
  const baseType = tsType.replace(/\s*\|\s*null/g, '').replace(/\s*\|\s*undefined/g, '').trim()

  return {
    name,
    normalizedName: toSnakeCase(name),
    dataType: mapTsType(baseType),
    nativeType: tsType,
    isNullable: isNullable ? true : null,
    isPrimaryKey,
    isForeignKey,
    isUnique: false,
    ordinalPosition: 0,
    metadata: {},
  }
}

function extractPropName(line: string): string | undefined {
  // Matches: propName: Type  OR  propName = new Collection(...)
  return line.match(/^(?:(?:public|protected|private|readonly)\s+)*(\w+)[?!]?\s*[=:]/)?.[1]
}

function mapTsType(tsType: string): string {
  const t = tsType.toLowerCase()
  if (/^string/.test(t)) return 'string'
  if (/^number/.test(t)) return 'number'
  if (/^boolean/.test(t)) return 'boolean'
  if (/^date/.test(t)) return 'datetime'
  if (/^bigint/.test(t)) return 'bigint'
  if (/^buffer/.test(t)) return 'binary'
  return 'string'
}

function stripComments(code: string): string {
  return code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}
