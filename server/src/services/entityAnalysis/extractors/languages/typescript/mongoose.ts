import { BaseExtractor, ExtractorResult, RawEntity, RawField, RawRelationship } from '../../base'

// Mongoose SchemaTypes → normalized types
const MONGOOSE_TYPE_MAP: Record<string, string> = {
  String: 'string',
  Number: 'number',
  Boolean: 'boolean',
  Date: 'datetime',
  Buffer: 'bytes',
  Mixed: 'mixed',
  ObjectId: 'objectid',
  Array: 'array',
  Map: 'map',
  Decimal128: 'decimal',
  UUID: 'uuid',
  BigInt: 'bigint',
}

export class MongooseExtractor extends BaseExtractor {
  readonly extractorId = 'typescript.mongoose'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []

    const hits = await this.grep(
      '**/*.{ts,js,mts,mjs}',
      /new\s+(?:mongoose\.)?Schema\s*\(/,
      2000,
    )
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]
    let filesScanned = 0

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        filesScanned++
        const fileEntities = parseMongooseFile(content, file, this.extractorId)
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

function parseMongooseFile(content: string, file: string, extractorId: string): RawEntity[] {
  const entities: RawEntity[] = []
  const stripped = stripComments(content)

  // Find all: new Schema({ ... }) or new mongoose.Schema({ ... })
  // Also: const xyzSchema = new Schema({...})
  const schemaPattern = /(?:(?:const|let|var)\s+(\w+)\s*=\s*)?new\s+(?:mongoose\.)?Schema\s*\(/g
  let match: RegExpExecArray | null

  while ((match = schemaPattern.exec(stripped)) !== null) {
    const schemaVarName = match[1]

    // Find the opening brace of the schema definition
    const openBrace = stripped.indexOf('{', match.index + match[0].length - 1)
    if (openBrace === -1) continue

    const schemaDef = extractToMatchingBrace(stripped, openBrace)
    if (!schemaDef) continue

    const fields = parseSchemaDefinition(schemaDef)
    const relationships: RawRelationship[] = extractRefRelationships(schemaDef)

    if (fields.length === 0 && relationships.length === 0) continue

    // Derive entity name from schema var name (e.g., userSchema → User)
    // or from mongoose.model('ModelName', ...) call
    let entityName = deriveEntityName(schemaVarName ?? '')
    if (!entityName) {
      // Look for: mongoose.model('ModelName', schemaVar) or model('ModelName', schemaVar)
      entityName = findModelRegistration(stripped, schemaVarName ?? '', match.index)
    }
    if (!entityName) entityName = schemaVarName ?? 'UnknownModel'

    const sourceLine = stripped.slice(0, match.index).split('\n').length

    entities.push({
      name: entityName,
      entityType: 'collection',
      fields,
      relationships,
      source: { file, line: sourceLine, extractorId },
      confidence: 'high',
    })
  }

  return entities
}

// ---- Derive entity name from schema variable name ----

function deriveEntityName(schemaVarName: string): string | undefined {
  // userSchema → User, UserSchema → User, user_schema → User
  const m = schemaVarName.match(/^(\w+?)[Ss]chema$/)
  if (m) {
    return m[1].charAt(0).toUpperCase() + m[1].slice(1)
  }
  return undefined
}

// ---- Find mongoose.model('ModelName', schemaVar) registration ----

function findModelRegistration(content: string, _schemaVar: string, _afterIdx: number): string | undefined {
  const m = content.match(/(?:mongoose\.)?model\s*\(\s*['"`](\w+)['"`]/)
  return m?.[1]
}

// ---- Parse schema definition object ----

function parseSchemaDefinition(body: string): RawField[] {
  const fields: RawField[] = []
  const entries = splitTopLevelCommas(body)

  for (const entry of entries) {
    const trimmed = entry.trim()
    if (!trimmed) continue

    // Skip schema-level options (_id, timestamps, etc.)
    const nameMatch = trimmed.match(/^(\w+)\s*:\s*/)
    if (!nameMatch) continue

    const fieldName = nameMatch[1]
    if (['_id', 'id', 'timestamps', 'versionKey', 'collection', 'strict'].includes(fieldName)) continue

    const rest = trimmed.slice(nameMatch[0].length).trim()

    let type: string | undefined
    let required = false
    let isUnique = false
    let hasDefault = false
    let isRef = false

    if (rest.startsWith('{')) {
      // Object: { type: String, required: true, ... }
      const inner = extractToMatchingBrace(rest, 0)
      if (!inner) continue

      // type: String or type: [String] or type: mongoose.Schema.Types.ObjectId
      const typeMatch = inner.match(/\btype\s*:\s*(?:\[?\s*)?(?:(?:mongoose\.Schema\.Types\.|Schema\.Types\.)?(\w+))/)
      if (typeMatch) type = MONGOOSE_TYPE_MAP[typeMatch[1]] ?? typeMatch[1].toLowerCase()

      required = /required\s*:\s*true/.test(inner) || /required\s*:\s*\[true/.test(inner)
      isUnique = /unique\s*:\s*true/.test(inner)
      hasDefault = /default\s*:/.test(inner)
      isRef = /ref\s*:\s*['"`]/.test(inner)
    } else if (rest.startsWith('[')) {
      // Array shorthand: [String] or [{ type: ObjectId, ref: '...' }]
      type = 'array'
      isRef = /ref\s*:\s*['"`]/.test(rest) || /ObjectId/.test(rest)
    } else {
      // Shorthand: String, Number, Boolean, etc.
      const typeMatch = rest.match(/^(?:mongoose\.Schema\.Types\.|Schema\.Types\.)?(\w+)/)
      if (typeMatch) type = MONGOOSE_TYPE_MAP[typeMatch[1]] ?? typeMatch[1].toLowerCase()
    }

    if (!isRef) {
      fields.push({
        name: fieldName,
        type,
        isPK: fieldName === '_id' || undefined,
        nullable: required ? false : null,
        isUnique: isUnique || undefined,
        metadata: hasDefault ? { hasDefault: true } : undefined,
      })
    }
  }

  return fields
}

// ---- Extract relationships from ref fields ----

function extractRefRelationships(body: string): RawRelationship[] {
  const relationships: RawRelationship[] = []
  const entries = splitTopLevelCommas(body)

  for (const entry of entries) {
    const trimmed = entry.trim()

    const nameMatch = trimmed.match(/^(\w+)\s*:\s*/)
    if (!nameMatch) continue
    const fieldName = nameMatch[1]

    const rest = trimmed.slice(nameMatch[0].length).trim()

    // { type: ObjectId, ref: 'ModelName' } → many_to_one
    // [{ type: ObjectId, ref: 'ModelName' }] or [SchemaRef] → one_to_many / many_to_many
    const isArray = rest.startsWith('[')
    const refMatch = rest.match(/ref\s*:\s*['"`](\w+)['"`]/)
    if (!refMatch) continue

    relationships.push({
      fieldName,
      targetEntity: refMatch[1],
      cardinality: isArray ? 'one_to_many' : 'many_to_one',
    })
  }

  return relationships
}

// ---- Helpers ----

function splitTopLevelCommas(s: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of s) {
    if (ch === '{' || ch === '(' || ch === '[') depth++
    else if (ch === '}' || ch === ')' || ch === ']') depth--
    else if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim()) parts.push(current)
  return parts
}

function extractToMatchingBrace(s: string, start: number): string | null {
  let depth = 0
  for (let i = start; i < s.length; i++) {
    if (s[i] === '{') depth++
    else if (s[i] === '}') {
      depth--
      if (depth === 0) return s.slice(start + 1, i)
    }
  }
  return null
}

function stripComments(code: string): string {
  let result = code.replace(/\/\/.*$/gm, '')
  result = result.replace(/\/\*[\s\S]*?\*\//g, '')
  return result
}
