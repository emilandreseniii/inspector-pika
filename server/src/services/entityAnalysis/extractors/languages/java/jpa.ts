import { BaseExtractor, ExtractorResult, RawEntity, RawField, RawRelationship, RelationshipCardinality } from '../../base'
import { toSnakeCase } from '../../../normalizer'

export class JpaExtractor extends BaseExtractor {
  readonly extractorId = 'java.jpa_hibernate'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []

    // Find Java and Kotlin files containing @Entity
    const hits = await this.grep('**/*.{java,kt}', /@Entity\b/, 5000)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseJpaFile(content, file, this.extractorId)
        if (parsed) entities.push(parsed)
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

// ---- JPA file parser ----

function parseJpaFile(content: string, file: string, extractorId: string): RawEntity | null {
  if (!/@Entity\b/.test(content)) return null

  // Collapse whitespace inside annotation parens to simplify regex
  const normalized = collapseAnnotationParens(content)
  const lines = normalized.split('\n')

  // Extract class name
  const classMatch = normalized.match(/(?:public\s+|abstract\s+|final\s+)*(?:class|data\s+class)\s+(\w+)/)
  if (!classMatch) return null
  const className = classMatch[1]

  // Determine table name
  let tableName: string
  const tableMatch = normalized.match(/@Table\s*\([^)]*\bname\s*=\s*["']([^"']+)["']/)
  if (tableMatch) {
    tableName = tableMatch[1]
  } else {
    tableName = toSnakeCase(className)
  }

  const fields: RawField[] = []
  const relationships: RawRelationship[] = []

  // Accumulate annotations line-by-line, detect field declarations
  let pendingAnnotLines: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const trimmed = raw.trim()

    if (trimmed.startsWith('@')) {
      pendingAnnotLines.push(trimmed)
      continue
    }

    // Blank or comment lines pass through without clearing annotations
    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed === '{' || trimmed === '}') {
      continue
    }

    // Detect field declaration: visibility modifier + type + name + ; or =
    const fieldMatch = trimmed.match(
      /^(?:(?:private|protected|public|final|static|volatile|transient)\s+)+(?:final\s+)?([A-Za-z_$][\w$]*(?:<[^>]*>)?(?:\[\])?)\s+([A-Za-z_$][\w$]*)\s*[;=]/,
    )

    if (fieldMatch) {
      const rawType = fieldMatch[1]
      const fieldName = fieldMatch[2]
      const annots = pendingAnnotLines.join(' ')

      // Skip static fields and serialVersionUID
      if (trimmed.includes('static') || fieldName === 'serialVersionUID') {
        pendingAnnotLines = []
        continue
      }

      // Relationship field?
      if (/@(?:OneToMany|ManyToOne|OneToOne|ManyToMany)\b/.test(annots)) {
        const rel = extractRelationship(annots, rawType, fieldName)
        if (rel) relationships.push(rel)
      } else if (!/@Transient\b/.test(annots)) {
        // Skip @Transient fields — they are not persisted
        const field = extractField(annots, rawType, fieldName, fields.length + 1)
        if (field) fields.push(field)
      }

      pendingAnnotLines = []
    } else {
      // Line is not a field declaration — reset pending annotations
      pendingAnnotLines = []
    }
  }

  const lineCount = lines.length
  return {
    name: tableName,
    entityType: 'table',
    fields,
    relationships,
    source: { file, startLine: 1, endLine: lineCount, format: 'java_jpa', extractorId },
    extractorId,
    confidence: 'high',
    metadata: { javaClass: className },
  }
}

function extractField(annots: string, rawType: string, fieldName: string, position: number): RawField | null {
  const isPK = /@Id\b/.test(annots)

  // Column name: @Column(name="...") or @JoinColumn(name="...") or snake_case of field name
  let colName = toSnakeCase(fieldName)
  const colNameMatch = annots.match(/@(?:Column|JoinColumn)\s*\([^)]*\bname\s*=\s*["']([^"']+)["']/)
  if (colNameMatch) colName = colNameMatch[1]

  const nullableMatch = annots.match(/\bnullable\s*=\s*(true|false)/)
  const nullable: boolean | null = nullableMatch ? nullableMatch[1] === 'true' : (isPK ? false : null)

  const uniqueMatch = annots.match(/\bunique\s*=\s*(true|false)/)
  const isUnique = uniqueMatch ? uniqueMatch[1] === 'true' : isPK

  const isGenerated = /@GeneratedValue\b/.test(annots)
  const isForeignKey = /@JoinColumn\b/.test(annots)

  const lengthMatch = annots.match(/\blength\s*=\s*(\d+)/)
  const precisionMatch = annots.match(/\bprecision\s*=\s*(\d+)/)
  const scaleMatch = annots.match(/\bscale\s*=\s*(\d+)/)

  const metadata: Record<string, unknown> = {}
  if (isGenerated) metadata.autoIncrement = true
  if (lengthMatch) metadata.length = parseInt(lengthMatch[1])
  if (precisionMatch) metadata.precision = parseInt(precisionMatch[1])
  if (scaleMatch) metadata.scale = parseInt(scaleMatch[1])

  return {
    name: colName,
    type: rawType,
    nullable,
    isPrimaryKey: isPK,
    isForeignKey,
    isUnique,
    defaultValue: null,
    ordinalPosition: position,
    metadata,
  }
}

function extractRelationship(annots: string, rawType: string, _fieldName: string): RawRelationship | null {
  let relType: RelationshipCardinality = 'one_to_many'
  if (/@ManyToOne\b/.test(annots)) relType = 'many_to_one'
  else if (/@OneToOne\b/.test(annots)) relType = 'one_to_one'
  else if (/@ManyToMany\b/.test(annots)) relType = 'many_to_many'

  // Extract target entity from generic type: List<Order> → Order
  let targetEntity = rawType
    .replace(/^(?:List|Set|Collection|Optional|Iterable)<(.+)>$/, '$1')
    .replace(/\[\]$/, '')
  targetEntity = toSnakeCase(targetEntity)

  const joinColMatch = annots.match(/@JoinColumn\s*\([^)]*\bname\s*=\s*["']([^"']+)["']/)
  const sourceField = joinColMatch ? joinColMatch[1] : null

  const mappedByMatch = annots.match(/\bmappedBy\s*=\s*["']([^"']+)["']/)
  const metadata: Record<string, unknown> = {}
  if (mappedByMatch) metadata.mappedBy = mappedByMatch[1]

  const cascadeMatch = annots.match(/\bcascade\s*=\s*(?:CascadeType\.)?(\w+)/)
  if (cascadeMatch) metadata.cascade = cascadeMatch[1].toLowerCase()

  const fetchMatch = annots.match(/\bfetch\s*=\s*FetchType\.(\w+)/)
  if (fetchMatch) metadata.fetchType = fetchMatch[1]

  return { type: relType, targetEntity, sourceField, targetField: null, metadata }
}

/** Collapse whitespace inside annotation parentheses for simpler regex parsing */
function collapseAnnotationParens(content: string): string {
  let result = ''
  let depth = 0
  let inAnnot = false

  for (let i = 0; i < content.length; i++) {
    const ch = content[i]
    if (ch === '@') inAnnot = true
    if (inAnnot && ch === '(') depth++
    if (inAnnot && ch === ')') {
      depth--
      if (depth === 0) inAnnot = false
    }
    if (inAnnot && depth > 0 && (ch === '\n' || ch === '\r')) {
      result += ' '
    } else {
      result += ch
    }
  }
  return result
}
