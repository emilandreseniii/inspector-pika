import { BaseExtractor, ExtractorResult, RawEntity, RawField, RawRelationship } from '../../base'
import { toSnakeCase } from '../../../normalizer'

// TypeORM relation decorators → cardinality
const RELATION_DECORATORS: Record<string, RawRelationship['cardinality']> = {
  ManyToOne: 'many_to_one',
  OneToMany: 'one_to_many',
  OneToOne: 'one_to_one',
  ManyToMany: 'many_to_many',
}

export class TypeOrmExtractor extends BaseExtractor {
  readonly extractorId = 'typescript.typeorm'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []

    const hits = await this.grep(
      '**/*.{ts,mts}',
      /@Entity\s*\(/,
      2000,
    )
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]
    let filesScanned = 0

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        filesScanned++
        const fileEntities = parseTypeOrmFile(content, file, this.extractorId)
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

function parseTypeOrmFile(content: string, file: string, extractorId: string): RawEntity[] {
  if (!/@Entity\s*\(/.test(content)) return []

  const stripped = stripComments(content)
  const lines = stripped.split('\n')
  const entities: RawEntity[] = []

  let i = 0
  while (i < lines.length) {
    const trimmed = lines[i].trim()

    // @Entity() or @Entity('table_name') or @Entity({ name: 'table_name' })
    const entityDecoMatch = trimmed.match(/^@Entity\s*\(/)
    if (!entityDecoMatch) { i++; continue }

    // Extract table name from decorator arg
    let tableName: string | undefined
    // @Entity('explicit_name') or @Entity("explicit_name")
    const nameMatch = trimmed.match(/@Entity\s*\(\s*['"`]([^'"`]+)['"`]/)
    if (nameMatch) {
      tableName = nameMatch[1]
    } else {
      // @Entity({ name: 'explicit_name' })
      const objNameMatch = trimmed.match(/name\s*:\s*['"`]([^'"`]+)['"`]/)
      if (objNameMatch) tableName = objNameMatch[1]
    }

    // Find the class declaration (may be a few lines after the decorator)
    let className: string | undefined
    let classLineIdx = i + 1
    while (classLineIdx < lines.length && classLineIdx < i + 5) {
      const m = lines[classLineIdx].match(/(?:export\s+)?class\s+(\w+)/)
      if (m) { className = m[1]; break }
      classLineIdx++
    }

    if (!className) { i++; continue }

    // Derive table name from class name if not explicit
    if (!tableName) tableName = toSnakeCase(className)

    // Find opening brace of class body
    let braceStart = classLineIdx
    while (braceStart < lines.length) {
      if (lines[braceStart].includes('{')) break
      braceStart++
    }

    // Parse class body
    const { fields, relationships, endIndex } = parseClassBody(lines, braceStart, file)

    if (fields.length > 0 || relationships.length > 0) {
      entities.push({
        name: className,
        tableName,
        entityType: 'table',
        fields,
        relationships,
        source: { file, line: i + 1, extractorId },
        confidence: 'high',
      })
    }

    i = endIndex + 1
  }

  return entities
}

function parseClassBody(
  lines: string[],
  startIndex: number,
  file: string,
): { fields: RawField[]; relationships: RawRelationship[]; endIndex: number } {
  const fields: RawField[] = []
  const relationships: RawRelationship[] = []
  let braceDepth = 0
  let endIndex = startIndex

  // Pending decorators for the next property
  let pendingAnnotations: string[] = []

  for (let i = startIndex; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    // Track brace depth
    for (const ch of trimmed) {
      if (ch === '{') braceDepth++
      else if (ch === '}') braceDepth--
    }

    if (braceDepth === 0 && i > startIndex) {
      endIndex = i
      break
    }

    if (!trimmed || trimmed.startsWith('//')) {
      pendingAnnotations = []
      continue
    }

    // Collect decorators
    if (trimmed.startsWith('@')) {
      pendingAnnotations.push(trimmed)
      continue
    }

    // Property declaration: propertyName[?]: Type [= default]
    const propMatch = trimmed.match(/^(?:(?:public|protected|private|readonly)\s+)*(\w+)\??:\s*([\w<>[\],\s|]+?)(?:\s*[=;{]|$)/)
    if (propMatch && braceDepth === 1) {
      const propName = propMatch[1]
      if (['constructor', 'if', 'for', 'while', 'switch'].includes(propName)) {
        pendingAnnotations = []
        continue
      }

      const propType = propMatch[2].trim()
      const annotStr = pendingAnnotations.join(' ')

      // Check for relation decorators
      const relKind = Object.keys(RELATION_DECORATORS).find((k) => annotStr.includes(`@${k}`))
      if (relKind) {
        // Extract target entity type from decorator: @ManyToOne(() => User, ...)
        const targetMatch = annotStr.match(/@(?:ManyToOne|OneToMany|OneToOne|ManyToMany)\s*\(\s*\(\s*\)\s*=>\s*(\w+)/)
        const targetEntity = targetMatch?.[1] ?? extractTypeFromDeclaration(propType)
        relationships.push({
          fieldName: propName,
          targetEntity,
          cardinality: RELATION_DECORATORS[relKind]!,
          sourceFile: file,
        })
        pendingAnnotations = []
        continue
      }

      // Only emit fields with TypeORM column decorators
      if (!/@(?:Column|PrimaryColumn|PrimaryGeneratedColumn|CreateDateColumn|UpdateDateColumn|DeleteDateColumn|VersionColumn)\b/.test(annotStr)) {
        pendingAnnotations = []
        continue
      }

      const isPK = /@(?:PrimaryColumn|PrimaryGeneratedColumn)\b/.test(annotStr)
      const isOptional = trimmed.includes('?:')

      // @Column({ name: 'col' }) or @Column('col') → column name
      const colNameMatch = annotStr.match(/@Column\s*\(\s*['"`]([^'"`]+)['"`]/) ??
        annotStr.match(/name\s*:\s*['"`]([^'"`]+)['"`]/)
      const columnName = colNameMatch?.[1]

      // @Column({ unique: true })
      const isUnique = /unique\s*:\s*true/.test(annotStr)

      // @Column({ nullable: true/false })
      const nullableMatch = annotStr.match(/nullable\s*:\s*(true|false)/)
      const nullable = nullableMatch ? nullableMatch[1] === 'true' : (isPK ? false : isOptional ? true : null)

      // @Column({ type: '...' }) or infer from TS type
      const typeMatch = annotStr.match(/type\s*:\s*['"`]([^'"`]+)['"`]/) ??
        annotStr.match(/type\s*:\s*(\w+)/)
      const type = typeMatch?.[1] ?? normalizeType(propType)

      fields.push({
        name: propName,
        columnName: columnName ?? toSnakeCase(propName),
        type,
        isPK: isPK || undefined,
        nullable,
        isUnique: isUnique || undefined,
      })
    }

    pendingAnnotations = []
  }

  return { fields, relationships, endIndex }
}

// ---- Helpers ----

function extractTypeFromDeclaration(typeStr: string): string {
  // Extract inner type from Promise<Type>, Type[], Type
  const inner = typeStr.match(/Promise\s*<\s*([\w]+)/) ??
    typeStr.match(/([\w]+)\s*\[\s*\]/) ??
    typeStr.match(/([\w]+)/)
  return inner?.[1] ?? typeStr
}

function normalizeType(tsType: string): string {
  const t = tsType.toLowerCase().trim()
  if (t === 'string') return 'string'
  if (t === 'number') return 'number'
  if (t === 'boolean') return 'boolean'
  if (t === 'date') return 'datetime'
  if (t === 'buffer') return 'bytes'
  return t
}

function stripComments(code: string): string {
  let result = code.replace(/\/\/.*$/gm, '')
  result = result.replace(/\/\*[\s\S]*?\*\//g, '')
  return result
}
