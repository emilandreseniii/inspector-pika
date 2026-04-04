import { BaseExtractor, ExtractorResult, RawEntity, RawField, RawRelationship } from '../../base'
import { toSnakeCase } from '../../../normalizer'

/**
 * Extracts entity surfaces from Beanie ODM (MongoDB ODM for async Python).
 *
 * Beanie models look like:
 *
 *   class User(Document):
 *       name: str
 *       email: str
 *       age: Optional[int] = None
 *       created_at: datetime = Field(default_factory=datetime.utcnow)
 *
 *       class Settings:
 *           name = "users"  # collection name
 *
 * Also handles Link[T] for relations:
 *   class Post(Document):
 *       author: Link[User]
 */
export class BeanieExtractor extends BaseExtractor {
  readonly extractorId = 'python.beanie'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []

    const hits = await this.grep('**/*.py', /(?:from\s+beanie\s+import|import\s+beanie\b|class\s+\w+\s*\(\s*Document\s*\))/, 2000)
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]
    let filesScanned = 0

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        if (!/(from|import)\s+beanie/.test(content) && !/class\s+\w+\s*\(\s*Document\s*\)/.test(content)) continue
        filesScanned++
        entities.push(...parseBeanieFile(content, file, this.extractorId))
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

function parseBeanieFile(content: string, file: string, extractorId: string): RawEntity[] {
  const lines = content.split('\n')
  const entities: RawEntity[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const classMatch = line.match(/^class\s+(\w+)\s*\(\s*Document\s*\)\s*:/)
    if (!classMatch) continue

    const className = classMatch[1]
    const fields: RawField[] = []
    const relationships: RawRelationship[] = []
    let collectionName: string | undefined

    // Parse class body
    let j = i + 1
    let inSettings = false
    while (j < lines.length) {
      const bodyLine = lines[j]
      const trimmed = bodyLine.trim()

      // End of class body (next class or top-level def)
      if (trimmed && !bodyLine.startsWith(' ') && !bodyLine.startsWith('\t')) break

      if (trimmed === '') { j++; continue }

      // Settings inner class
      if (/^class\s+Settings\s*:/.test(trimmed)) {
        inSettings = true
        j++
        continue
      }
      if (inSettings) {
        const nameMatch = trimmed.match(/^name\s*=\s*["']([^"']+)["']/)
        if (nameMatch) collectionName = nameMatch[1]
        if (/^class\s+/.test(trimmed) && !/^class\s+Settings/.test(trimmed)) inSettings = false
        j++
        continue
      }

      // Skip methods and nested classes
      if (/^def\s+/.test(trimmed) || /^async\s+def\s+/.test(trimmed) || /^class\s+/.test(trimmed)) {
        j++
        continue
      }

      // Field: name: Type = ...
      // name: str
      // email: Optional[str] = None
      // author: Link[User]
      const fieldMatch = trimmed.match(/^(\w+)\s*:\s*(.+?)(?:\s*=.*)?$/)
      if (fieldMatch) {
        const propName = fieldMatch[1]
        const typeAnnotation = fieldMatch[2].trim()

        if (['self', 'cls', 'id'].includes(propName)) { j++; continue }
        if (/^["']/.test(propName)) { j++; continue } // skip docstrings

        // Check for Link[T] relationship
        const linkMatch = typeAnnotation.match(/Link\s*\[\s*(\w+)\s*\]/)
        if (linkMatch) {
          relationships.push({
            name: propName,
            targetEntity: linkMatch[1],
            cardinality: 'many_to_one',
          })
          j++
          continue
        }

        const isNullable = /Optional\[/.test(typeAnnotation) || /None/.test(bodyLine.split('=')[1] ?? '')
        const isPk = propName === 'id' || /PydanticObjectId/.test(typeAnnotation) || /Annotated.*ObjectId/.test(typeAnnotation)

        fields.push({
          name: propName,
          normalizedName: toSnakeCase(propName),
          dataType: mapPythonType(typeAnnotation),
          nativeType: typeAnnotation,
          isNullable: isNullable ? true : null,
          isPrimaryKey: isPk,
          isForeignKey: false,
          isUnique: false,
          ordinalPosition: fields.length,
          metadata: {},
        })
      }

      j++
    }

    const tableName = collectionName ?? toSnakeCase(className) + 's'

    entities.push({
      name: className,
      normalizedName: toSnakeCase(className),
      tableName,
      entityType: 'document',
      fields,
      relationships,
      confidence: 'high',
      source: { file, line: i + 1, extractorId },
    })
  }

  return entities
}

// ---- Helpers ----

function mapPythonType(t: string): string {
  const lower = t.toLowerCase()
  if (/str\b/.test(lower)) return 'string'
  if (/int\b/.test(lower)) return 'integer'
  if (/float\b/.test(lower)) return 'float'
  if (/bool\b/.test(lower)) return 'boolean'
  if (/datetime\b/.test(lower)) return 'datetime'
  if (/date\b/.test(lower)) return 'date'
  if (/uuid\b/.test(lower)) return 'uuid'
  if (/list\b|List\b/.test(lower)) return 'array'
  if (/dict\b|Dict\b/.test(lower)) return 'json'
  if (/objectid\b/.test(lower)) return 'objectid'
  return 'string'
}
