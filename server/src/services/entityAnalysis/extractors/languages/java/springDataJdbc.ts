import { BaseExtractor, ExtractorResult, RawEntity, RawField, RawRelationship } from '../../base'
import { toSnakeCase } from '../../../normalizer'

export class SpringDataJdbcExtractor extends BaseExtractor {
  readonly extractorId = 'java.spring_data_jdbc'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []

    // @Table is the primary marker; @Id + @MappedCollection are supporting signals.
    // We skip files that also have @Entity — those are JPA, handled by the JPA extractor.
    const hits = await this.grep('**/*.{java,kt}', /@Table\b/, 5000)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        // Skip JPA entities — they use @Entity alongside @Table
        if (/@Entity\b/.test(content)) continue
        const parsed = parseSpringDataJdbcFile(content, file, this.extractorId)
        if (parsed) entities.push(...parsed)
      } catch (err) {
        warnings.push(`Failed to parse ${file}: ${(err as Error).message}`)
      }
    }

    return {
      entities,
      warnings,
      stats: { filesScanned: uniqueFiles.length, entitiesFound: entities.length, extractionTimeMs: Date.now() - start },
    }
  }
}

// ---- File parser (may find multiple classes per file) ----

function parseSpringDataJdbcFile(content: string, file: string, extractorId: string): RawEntity[] {
  if (!/@Table\b/.test(content)) return []

  const collapsed = collapseAnnotationParens(content)
  const lines = collapsed.split('\n')

  const pkgMatch = content.match(/^package\s+([\w.]+)\s*;/m)
  const packageName = pkgMatch?.[1]

  const entities: RawEntity[] = []

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    // Look for lines with @Table annotation
    if (!/@Table\b/.test(trimmed)) continue

    // Determine table name: @Table("name") or @Table(name="name")
    let tableName: string | null = null
    const plainNameMatch = trimmed.match(/@Table\s*\(\s*["']([^"']+)["']\s*\)/)
    if (plainNameMatch) {
      tableName = plainNameMatch[1]
    } else {
      const namedAttrMatch = trimmed.match(/@Table\s*\([^)]*\bname\s*=\s*["']([^"']+)["']/)
      if (namedAttrMatch) tableName = namedAttrMatch[1]
    }

    // Find the class declaration following this annotation (may be same line or next few lines)
    let classLine = -1
    let className = ''
    for (let j = i; j < Math.min(i + 10, lines.length); j++) {
      const classMatch = lines[j].trim().match(
        /(?:public\s+|private\s+|protected\s+|static\s+|final\s+|abstract\s+)*(?:class|record|data\s+class)\s+(\w+)/,
      )
      if (classMatch) {
        classLine = j
        className = classMatch[1]
        break
      }
    }

    if (!className) continue
    if (!tableName) tableName = toSnakeCase(className)

    const { fields, relationships } = extractClassMembers(lines, classLine)
    if (fields.length === 0 && relationships.length === 0) continue

    entities.push({
      name: tableName,
      entityType: 'table',
      fields,
      relationships,
      source: { file, startLine: i + 1, endLine: classLine + 1, format: 'java_spring_data_jdbc', extractorId },
      extractorId,
      confidence: 'high',
      metadata: { javaClass: className, packageName },
    })

    // Skip past the class declaration to avoid re-processing
    i = classLine
  }

  return entities
}

// ---- Walk class body extracting fields and relationships ----

function extractClassMembers(lines: string[], classStartLine: number): { fields: RawField[]; relationships: RawRelationship[] } {
  const fields: RawField[] = []
  const relationships: RawRelationship[] = []

  let braceDepth = 0
  let parenDepth = 0
  let insideClass = false
  let insideKotlinCtor = false  // Kotlin primary constructor uses (...) not {...}
  let pendingAnnotLines: string[] = []

  for (let i = classStartLine; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    const depthBefore = braceDepth

    for (const ch of trimmed) {
      if (ch === '{') braceDepth++
      else if (ch === '}') braceDepth--
    }

    if (!insideClass) {
      if (braceDepth >= 1) {
        insideClass = true
        continue
      }
      // Kotlin data class primary constructor: class Foo( ... )
      if (!insideKotlinCtor) {
        for (const ch of trimmed) {
          if (ch === '(') parenDepth++
          else if (ch === ')') parenDepth--
        }
        if (parenDepth > 0) { insideKotlinCtor = true; insideClass = true }
      }
      continue
    }

    if (insideKotlinCtor) {
      // Track paren depth to detect end of constructor
      const parensBefore = parenDepth
      for (const ch of trimmed) {
        if (ch === '(') parenDepth++
        else if (ch === ')') parenDepth--
      }
      if (parenDepth <= 0 && parensBefore > 0) break
    } else {
      if (braceDepth <= 0) break
      if (depthBefore > 1) { pendingAnnotLines = []; continue }
    }

    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue

    // Separate any leading annotation(s) from the rest of the line.
    // This handles same-line patterns like "@Id private Long id;" or "@Id val id: Long,"
    let annotPart = ''
    let fieldPart = trimmed
    if (trimmed.startsWith('@')) {
      // Strip all stacked leading annotations
      const rest = trimmed.replace(/^(?:@\w+(?:\s*\([^)]*\))?\s*)+/, '').trim()
      annotPart = trimmed.slice(0, trimmed.length - rest.length).trim()
      if (annotPart) pendingAnnotLines.push(annotPart)
      if (!rest || rest.startsWith('@') || rest === '{' || rest === '}') continue
      fieldPart = rest
    }

    // Field declaration: modifiers type name [; or =]
    const fieldMatch = fieldPart.match(
      /^(?:(?:private|protected|public|final|static|volatile|transient)\s+)+(?:final\s+)?([A-Za-z_$][\w$]*(?:<[^>]*>)?(?:\[\])?)\s+([A-Za-z_$][\w$]*)\s*[;=]/,
    )

    // Kotlin val/var field or primary constructor parameter: val name: Type
    const kotlinMatch = !fieldMatch
      ? fieldPart.match(/^(?:val|var)\s+(\w+)\s*:\s*([\w<>.,\s?]+?)\s*[,)=;]/)
      : null

    if (fieldMatch || kotlinMatch) {
      const annots = pendingAnnotLines.join(' ')
      pendingAnnotLines = []

      const rawType = fieldMatch ? fieldMatch[1] : kotlinMatch![2].trim()
      const fieldName = fieldMatch ? fieldMatch[2] : kotlinMatch![1]

      if (fieldPart.includes('static') || fieldName === 'serialVersionUID') continue
      if (/@Transient\b/.test(annots)) continue

      if (/@MappedCollection\b/.test(annots)) {
        const rel = extractMappedCollectionRelationship(annots, rawType, fieldName)
        if (rel) relationships.push(rel)
        continue
      }

      fields.push(extractField(annots, rawType, fieldName, fields.length + 1))
    } else {
      pendingAnnotLines = []
    }
  }

  return { fields, relationships }
}

function extractField(annots: string, rawType: string, fieldName: string, position: number): RawField {
  const isPK = /@Id\b/.test(annots)

  // Column name: @Column("name") or @Column(value="name")
  let colName = toSnakeCase(fieldName)
  const plainColMatch = annots.match(/@Column\s*\(\s*["']([^"']+)["']\s*\)/)
  if (plainColMatch) {
    colName = plainColMatch[1]
  } else {
    const namedColMatch = annots.match(/@Column\s*\([^)]*\bvalue\s*=\s*["']([^"']+)["']/)
    if (namedColMatch) colName = namedColMatch[1]
  }

  // Spring Data JDBC does not have a nullable attribute on @Column — nullable is null (unknown)
  const nullable: boolean | null = isPK ? false : null

  const isVersion = /@Version\b/.test(annots)
  const isAudit = /@(?:CreatedDate|LastModifiedDate|CreatedBy|LastModifiedBy)\b/.test(annots)

  const metadata: Record<string, unknown> = {}
  if (isVersion) metadata.version = true
  if (isAudit) metadata.audit = true

  return {
    name: colName,
    type: rawType,
    nullable,
    isPrimaryKey: isPK,
    isForeignKey: false,
    isUnique: isPK,
    defaultValue: null,
    ordinalPosition: position,
    metadata,
  }
}

function extractMappedCollectionRelationship(annots: string, rawType: string, fieldName: string): RawRelationship | null {
  // Extract target type from generic: List<Order> → Order, Set<Tag> → Tag
  const genericMatch = rawType.match(/^(?:List|Set|Collection|Iterable)<(.+)>$/)
  const targetType = genericMatch ? genericMatch[1].trim() : rawType
  const targetEntity = toSnakeCase(targetType.replace(/\[\]$/, ''))

  const idColMatch = annots.match(/\bidColumn\s*=\s*["']([^"']+)["']/)
  const sourceField = idColMatch ? idColMatch[1] : toSnakeCase(fieldName) + '_id'

  return {
    type: 'one_to_many',
    targetEntity,
    sourceField,
    targetField: null,
    metadata: { annotatedWith: '@MappedCollection' },
  }
}

// ---- Helpers ----

function collapseAnnotationParens(content: string): string {
  let result = ''
  let depth = 0
  let inAnnot = false
  for (let i = 0; i < content.length; i++) {
    const ch = content[i]
    if (ch === '@') inAnnot = true
    if (inAnnot && ch === '(') depth++
    if (inAnnot && ch === ')') { depth--; if (depth === 0) inAnnot = false }
    if (inAnnot && depth > 0 && (ch === '\n' || ch === '\r')) result += ' '
    else result += ch
  }
  return result
}
