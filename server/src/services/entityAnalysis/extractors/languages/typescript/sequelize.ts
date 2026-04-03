import { BaseExtractor, ExtractorResult, RawEntity, RawField } from '../../base'
import { toSnakeCase } from '../../../normalizer'

// Sequelize DataTypes → normalized types
const SEQUELIZE_TYPE_MAP: Record<string, string> = {
  STRING: 'string',
  CHAR: 'string',
  TEXT: 'string',
  CITEXT: 'string',
  TINYTEXT: 'string',
  MEDIUMTEXT: 'string',
  LONGTEXT: 'string',
  INTEGER: 'integer',
  TINYINT: 'integer',
  SMALLINT: 'integer',
  MEDIUMINT: 'integer',
  BIGINT: 'bigint',
  FLOAT: 'float',
  REAL: 'float',
  DOUBLE: 'float',
  DECIMAL: 'decimal',
  NUMERIC: 'decimal',
  BOOLEAN: 'boolean',
  DATE: 'datetime',
  DATEONLY: 'date',
  TIME: 'time',
  NOW: 'datetime',
  JSON: 'json',
  JSONB: 'json',
  UUID: 'uuid',
  UUIDV1: 'uuid',
  UUIDV4: 'uuid',
  BLOB: 'bytes',
  ENUM: 'enum',
  ARRAY: 'array',
  RANGE: 'range',
  VIRTUAL: 'virtual',
}

export class SequelizeExtractor extends BaseExtractor {
  readonly extractorId = 'typescript.sequelize'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []

    const hits = await this.grep(
      '**/*.{ts,js,mts,mjs}',
      /(?:Model\.init\s*\(|sequelize\.define\s*\(|DataTypes\.\w+)/,
      2000,
    )
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]
    let filesScanned = 0

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        // Quick pre-filter
        if (!/(sequelize|DataTypes|Model\.init|\.define\s*\()/.test(content)) continue
        filesScanned++
        const fileEntities = parseSequelizeFile(content, file, this.extractorId)
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

function parseSequelizeFile(content: string, file: string, extractorId: string): RawEntity[] {
  const entities: RawEntity[] = []
  const stripped = stripComments(content)

  // Pattern 1: Model.init({ fields }, { modelName/tableName, sequelize })
  entities.push(...extractModelInit(stripped, file, extractorId))

  // Pattern 2: sequelize.define('ModelName', { fields }, { options })
  entities.push(...extractSequelizeDefine(stripped, file, extractorId))

  return entities
}

function extractModelInit(content: string, file: string, extractorId: string): RawEntity[] {
  const entities: RawEntity[] = []

  // Find class extending Model
  const classPattern = /class\s+(\w+)\s+extends\s+(?:Model|Sequelize\.Model)\s*[<{]/g
  let classMatch: RegExpExecArray | null

  while ((classMatch = classPattern.exec(content)) !== null) {
    const className = classMatch[1]

    // Find ClassName.init() call (may appear before or after the class definition)
    const initToken = className + '.init('
    let initSearch = content.indexOf(initToken)
    if (initSearch === -1) {
      // Fallback: also check for Model.init( (less common)
      initSearch = content.indexOf('Model.init(', classMatch.index)
    }
    if (initSearch === -1) continue

    const openBrace = content.indexOf('{', initSearch)
    if (openBrace === -1) continue

    const fieldBody = extractToMatchingBrace(content, openBrace)
    if (!fieldBody) continue

    // Find options object (second arg to Model.init)
    const afterFields = openBrace + fieldBody.length + 2  // +2 for { }
    const optionsStart = content.indexOf('{', afterFields)
    let tableName: string | undefined
    let modelName: string | undefined

    if (optionsStart !== -1) {
      const optionsBody = extractToMatchingBrace(content, optionsStart)
      if (optionsBody) {
        const tableMatch = optionsBody.match(/tableName\s*:\s*['"`]([^'"`]+)['"`]/)
        if (tableMatch) tableName = tableMatch[1]
        const modelMatch = optionsBody.match(/modelName\s*:\s*['"`]([^'"`]+)['"`]/)
        if (modelMatch) modelName = modelMatch[1]
      }
    }

    const fields = parseFieldsObject(fieldBody)
    if (fields.length === 0) continue

    const sourceLine = content.slice(0, classMatch.index).split('\n').length

    entities.push({
      name: className,
      tableName: tableName ?? toSnakeCase(modelName ?? className) + 's',
      entityType: 'table',
      fields,
      relationships: [],
      source: { file, line: sourceLine, extractorId },
      confidence: 'high',
    })
  }

  return entities
}

function extractSequelizeDefine(content: string, file: string, extractorId: string): RawEntity[] {
  const entities: RawEntity[] = []

  // sequelize.define('ModelName', { fields }, { options })
  const definePattern = /\.define\s*\(\s*['"`](\w+)['"`]\s*,\s*\{/g
  let match: RegExpExecArray | null

  while ((match = definePattern.exec(content)) !== null) {
    const modelName = match[1]

    const openBrace = content.lastIndexOf('{', match.index + match[0].length)
    if (openBrace === -1) continue

    const fieldBody = extractToMatchingBrace(content, openBrace)
    if (!fieldBody) continue

    const fields = parseFieldsObject(fieldBody)
    if (fields.length === 0) continue

    // Look for options (3rd arg)
    const afterFields = openBrace + fieldBody.length + 2
    let tableName = toSnakeCase(modelName) + 's'
    const optionsStart = content.indexOf('{', afterFields)
    if (optionsStart !== -1) {
      const optBody = extractToMatchingBrace(content, optionsStart)
      if (optBody) {
        const tMatch = optBody.match(/tableName\s*:\s*['"`]([^'"`]+)['"`]/)
        if (tMatch) tableName = tMatch[1]
      }
    }

    const sourceLine = content.slice(0, match.index).split('\n').length

    entities.push({
      name: modelName,
      tableName,
      entityType: 'table',
      fields,
      relationships: [],
      source: { file, line: sourceLine, extractorId },
      confidence: 'high',
    })
  }

  return entities
}

// ---- Parse fields object ----

function parseFieldsObject(body: string): RawField[] {
  const fields: RawField[] = []
  // Split into top-level comma-separated field entries
  const entries = splitTopLevelCommas(body)

  for (const entry of entries) {
    const trimmed = entry.trim()
    if (!trimmed) continue

    // fieldName: { type: DataTypes.STRING, ... }
    // fieldName: DataTypes.STRING
    const nameMatch = trimmed.match(/^(\w+)\s*:\s*/)
    if (!nameMatch) continue
    const fieldName = nameMatch[1]
    if (['sequelize', 'options', 'modelName', 'tableName', 'timestamps'].includes(fieldName)) continue

    const rest = trimmed.slice(nameMatch[0].length).trim()

    let type: string | undefined
    let isPK = false
    let nullable: boolean | null = null
    let isUnique = false
    let hasDefault = false
    let columnName: string | undefined

    if (rest.startsWith('{')) {
      // Object form: { type: DataTypes.X, ... }
      const inner = extractToMatchingBrace(rest, 0)
      if (!inner) continue

      // type: DataTypes.STRING or type: DataTypes.STRING(255)
      const typeMatch = inner.match(/\btype\s*:\s*(?:DataTypes|Sequelize)\s*\.\s*(\w+)/)
      if (typeMatch) type = SEQUELIZE_TYPE_MAP[typeMatch[1]] ?? typeMatch[1].toLowerCase()

      isPK = /primaryKey\s*:\s*true/.test(inner) || /autoIncrement\s*:\s*true/.test(inner)
      nullable = /allowNull\s*:\s*false/.test(inner) ? false : /allowNull\s*:\s*true/.test(inner) ? true : (isPK ? false : null)
      isUnique = /unique\s*:\s*true/.test(inner) || /unique\s*:\s*['"`]/.test(inner)
      hasDefault = /defaultValue\s*:/.test(inner)
      const colMatch = inner.match(/field\s*:\s*['"`]([^'"`]+)['"`]/)
      if (colMatch) columnName = colMatch[1]
    } else {
      // Shorthand: DataTypes.STRING
      const typeMatch = rest.match(/(?:DataTypes|Sequelize)\s*\.\s*(\w+)/)
      if (typeMatch) type = SEQUELIZE_TYPE_MAP[typeMatch[1]] ?? typeMatch[1].toLowerCase()
    }

    fields.push({
      name: fieldName,
      columnName: columnName ?? toSnakeCase(fieldName),
      type,
      isPK: isPK || undefined,
      nullable,
      isUnique: isUnique || undefined,
      metadata: hasDefault ? { hasDefault: true } : undefined,
    })
  }

  return fields
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
