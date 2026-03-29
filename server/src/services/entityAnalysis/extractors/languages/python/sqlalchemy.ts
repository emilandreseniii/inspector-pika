import { BaseExtractor, ExtractorResult, RawEntity, RawField, RawRelationship, RelationshipCardinality } from '../../base'
import { toSnakeCase } from '../../../normalizer'

export class SqlAlchemyExtractor extends BaseExtractor {
  readonly extractorId = 'python.sqlalchemy'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []

    const files = await this.glob('**/*.py')
    let filesScanned = 0

    for (const file of files) {
      try {
        const content = await this.readFile(file)
        // Quick pre-filter: must have __tablename__ to be a model file
        if (!/__tablename__/.test(content)) continue
        filesScanned++
        const fileEntities = parseSqlAlchemyFile(content, file, this.extractorId)
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

// ---- Logical line joining ----
// Joins continuation lines (open parens/brackets or trailing backslash)

function joinLogicalLines(content: string): string[] {
  const rawLines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const result: string[] = []
  let buffer: string | null = null
  let depth = 0
  let inSingleStr = false
  let inDoubleStr = false
  let inTripleSingle = false
  let inTripleDouble = false

  for (let li = 0; li < rawLines.length; li++) {
    const raw = rawLines[li]

    // Update depth, respecting string literals (simplified: track triple-quoted strings)
    for (let ci = 0; ci < raw.length; ci++) {
      const ch = raw[ci]
      const two = raw.slice(ci, ci + 3)

      if (!inSingleStr && !inDoubleStr && !inTripleSingle && !inTripleDouble) {
        if (two === "'''") { inTripleSingle = true; ci += 2; continue }
        if (two === '"""') { inTripleDouble = true; ci += 2; continue }
        if (ch === "'") { inSingleStr = true; continue }
        if (ch === '"') { inDoubleStr = true; continue }
        if (ch === '#') break  // rest of line is comment
        if (ch === '(' || ch === '[' || ch === '{') depth++
        else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1)
      } else if (inTripleSingle && two === "'''") { inTripleSingle = false; ci += 2 }
      else if (inTripleDouble && two === '"""') { inTripleDouble = false; ci += 2 }
      else if (inSingleStr && ch === "'" && raw[ci - 1] !== '\\') inSingleStr = false
      else if (inDoubleStr && ch === '"' && raw[ci - 1] !== '\\') inDoubleStr = false
    }

    if (buffer === null) {
      buffer = raw
    } else {
      buffer += ' ' + raw.trim()
    }

    const endsBackslash = raw.trimEnd().endsWith('\\')
    if (depth === 0 && !endsBackslash && !inTripleSingle && !inTripleDouble) {
      result.push(buffer.replace(/\\\s*$/, ''))
      buffer = null
    }
  }

  if (buffer !== null) result.push(buffer)
  return result
}

// ---- File parser ----

function parseSqlAlchemyFile(content: string, file: string, extractorId: string): RawEntity[] {
  const lines = joinLogicalLines(content)
  const entities: RawEntity[] = []

  // Collect top-level class blocks
  const classBlocks: Array<{ name: string; bases: string; lines: string[]; lineNo: number }> = []
  let current: (typeof classBlocks)[0] | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Match top-level class (no leading whitespace)
    const classMatch = line.match(/^class\s+(\w+)\s*\(([^)]*)\)\s*:/)
    if (classMatch) {
      if (current) classBlocks.push(current)
      current = { name: classMatch[1], bases: classMatch[2], lines: [], lineNo: i + 1 }
    } else if (current) {
      // Indented or blank line → still inside the class
      if (line === '' || line.startsWith(' ') || line.startsWith('\t')) {
        current.lines.push(line)
      } else {
        // Non-indented non-class line ends the class
        classBlocks.push(current)
        current = null
        // Re-check this line as a new class start
        i--
      }
    }
  }
  if (current) classBlocks.push(current)

  for (const block of classBlocks) {
    const bodyText = block.lines.join('\n')
    if (!/__tablename__/.test(bodyText)) continue

    const entity = extractClassEntity(block.name, block.lines, block.lineNo, file, extractorId)
    if (entity) entities.push(entity)
  }

  return entities
}

// ---- Class entity extractor ----

function extractClassEntity(
  className: string,
  lines: string[],
  startLine: number,
  file: string,
  extractorId: string,
): RawEntity | null {
  const bodyText = lines.join('\n')

  // Table name from __tablename__
  const tableNameMatch = bodyText.match(/__tablename__\s*=\s*["']([^"']+)["']/)
  if (!tableNameMatch) return null
  const tableName = tableNameMatch[1]

  const fields: RawField[] = []
  const relationships: RawRelationship[] = []

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith('__')) continue

    // Modern mapped_column with Mapped annotation:
    //   field_name: Mapped[Optional[SomeType]] = mapped_column(...)
    //   field_name: Mapped[SomeType] = mapped_column(...)
    const mappedParsed = parseMappedAnnotationLine(line)
    if (mappedParsed) {
      const field = parseMappedColumn(mappedParsed.fieldName, mappedParsed.mappedType, mappedParsed.args, fields.length + 1)
      if (field) fields.push(field)
      continue
    }

    // Classic Column assignment (also handles mapped_column without Mapped annotation):
    //   field_name = Column(...)
    //   field_name = mapped_column(...)
    const colMatch = line.match(/^(\w+)\s*=\s*(?:sa\.)?(?:mapped_)?[Cc]olumn\s*\(/)
    if (colMatch && !line.includes(': Mapped[')) {
      const fieldName = colMatch[1]
      if (SKIP_FIELDS.has(fieldName)) continue
      const parenIdx = line.indexOf('(', colMatch[0].length - 1)
      const args = parenIdx !== -1 ? (extractBalancedParenContent(line, parenIdx) ?? '') : ''
      const field = parseColumn(fieldName, args, fields.length + 1)
      if (field) fields.push(field)
      continue
    }

    // Relationship:
    //   field_name = relationship('Target', ...)
    //   field_name: Mapped[List['Target']] = relationship(...)
    const relMatch = line.match(/^(\w+)(?::\s*Mapped\[[^\]]+\])?\s*=\s*relationship\s*\((.+)\)/)
    if (relMatch) {
      const [, fieldName, args] = relMatch
      const rel = parseRelationship(fieldName, args)
      if (rel) relationships.push(rel)
    }
  }

  return {
    name: tableName,
    entityType: 'table',
    fields,
    relationships,
    source: { file, startLine, endLine: startLine + lines.length, format: 'python_sqlalchemy', extractorId },
    extractorId,
    confidence: 'high',
    metadata: { pythonClass: className },
  }
}

// ---- Mapped annotation line parser ----
// Handles nested brackets: Mapped[Optional[str]], Mapped[List['Post']], etc.

function parseMappedAnnotationLine(line: string): { fieldName: string; mappedType: string; args: string } | null {
  const headerMatch = line.match(/^(\w+)\s*:\s*Mapped\[/)
  if (!headerMatch) return null
  const fieldName = headerMatch[1]

  // Walk forward through Mapped[...] with bracket-depth tracking (handles Optional[str], dict[str, Any], etc.)
  const mappedStart = line.indexOf('Mapped[') + 'Mapped['.length
  let depth = 1
  let i = mappedStart
  for (; i < line.length && depth > 0; i++) {
    if (line[i] === '[') depth++
    else if (line[i] === ']') depth--
  }
  const mappedType = line.slice(mappedStart, i - 1).trim()

  // Rest should be: = mapped_column(...)
  const rest = line.slice(i)
  if (!/\s*=\s*mapped_column\s*\(/.test(rest)) return null

  // Extract full args using balanced paren matching (handles String(50), ForeignKey(...), etc.)
  const parenStart = rest.indexOf('(')
  if (parenStart === -1) return null
  const args = extractBalancedParenContent(rest, parenStart) ?? ''

  return { fieldName, mappedType, args }
}

/** Extract content between a matching pair of parens starting at `openIdx` */
function extractBalancedParenContent(s: string, openIdx: number): string | null {
  let depth = 0
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === '(') depth++
    else if (s[i] === ')') {
      depth--
      if (depth === 0) return s.slice(openIdx + 1, i)
    }
  }
  return null
}

// ---- Field parsers ----

const SKIP_FIELDS = new Set([
  'metadata', 'query', 'query_class', '__mapper__', '__table__',
  '__abstract__', '__allow_unmapped__',
])

// Parse a classic Column(...) args string
function parseColumn(fieldName: string, args: string, position: number): RawField | null {
  // First positional arg is the type (skip ForeignKey as first arg)
  const firstArg = extractFirstArg(args)
  const isFk = /ForeignKey\s*\(/.test(args)

  // Type: first arg if it's not a ForeignKey, otherwise look deeper
  let nativeType = 'unknown'
  if (firstArg && !/ForeignKey/.test(firstArg) && !/^(nullable|primary_key|unique|default|index|server_default|name|doc)=/.test(firstArg)) {
    nativeType = extractTypeName(firstArg)
  } else {
    // Type might be second arg (after ForeignKey as first), or omitted
    const argsNoCols = args.replace(/ForeignKey\s*\([^)]*\)\s*,?\s*/, '')
    const second = extractFirstArg(argsNoCols)
    if (second && !/^(nullable|primary_key|unique|default|index)=/.test(second)) {
      nativeType = extractTypeName(second)
    }
  }

  const isPK = /primary_key\s*=\s*True/.test(args)
  const nullable = /nullable\s*=\s*(True|False)/.test(args)
    ? /nullable\s*=\s*True/.test(args)
    : !isPK
  const isUnique = /unique\s*=\s*True/.test(args) || isPK

  // Explicit column name
  let colName = toSnakeCase(fieldName)
  const nameMatch = args.match(/(?:^|,)\s*name\s*=\s*["']([^"']+)["']/)
  if (nameMatch) colName = nameMatch[1]

  return {
    name: colName,
    type: nativeType,
    nullable,
    isPrimaryKey: isPK,
    isForeignKey: isFk,
    isUnique,
    defaultValue: null,
    ordinalPosition: position,
    metadata: {},
  }
}

// Parse Mapped[Optional[str]] = mapped_column(...) style
function parseMappedColumn(fieldName: string, mappedType: string, args: string, position: number): RawField | null {
  if (SKIP_FIELDS.has(fieldName)) return null

  // Determine nullability from Mapped type: Mapped[Optional[X]] or Mapped[X | None] → nullable
  const isOptional = /^Optional\[/.test(mappedType.trim()) || /\|\s*None/.test(mappedType) || /^None\s*\|/.test(mappedType)
  const isPK = /primary_key\s*=\s*True/.test(args)

  // Infer native type from Mapped annotation first, then from mapped_column args
  let nativeType = extractMappedType(mappedType)
  if (nativeType === 'unknown') {
    const firstArg = extractFirstArg(args)
    if (firstArg && !/^(primary_key|nullable|unique|default|index|name|server_default)=/.test(firstArg)) {
      nativeType = extractTypeName(firstArg)
    }
  }

  const nullable = /nullable\s*=\s*(True|False)/.test(args)
    ? /nullable\s*=\s*True/.test(args)
    : isOptional && !isPK

  const isUnique = /unique\s*=\s*True/.test(args) || isPK
  const isFk = /ForeignKey\s*\(/.test(args)

  let colName = toSnakeCase(fieldName)
  const nameMatch = args.match(/(?:^|,)\s*name\s*=\s*["']([^"']+)["']/)
  if (nameMatch) colName = nameMatch[1]

  return {
    name: colName,
    type: nativeType,
    nullable,
    isPrimaryKey: isPK,
    isForeignKey: isFk,
    isUnique,
    defaultValue: null,
    ordinalPosition: position,
    metadata: {},
  }
}

// ---- Relationship parser ----

function parseRelationship(fieldName: string, args: string): RawRelationship | null {
  // Target class: first quoted arg or argument= 'ClassName'
  const targetMatch = args.match(/["']([A-Z]\w*)["']/)
  if (!targetMatch) return null
  const targetEntity = toSnakeCase(targetMatch[1])

  // Determine cardinality: use_list=False or back_populates with singular name → many_to_one or one_to_one
  // Otherwise default to one_to_many
  const uselist = /uselist\s*=\s*False/.test(args)
  const secondary = /secondary\s*=/.test(args)
  let relType: RelationshipCardinality = 'one_to_many'
  if (secondary) relType = 'many_to_many'
  else if (uselist) relType = 'one_to_one'

  const backPopMatch = args.match(/back_populates\s*=\s*["']([^"']+)["']/)
  const backrefMatch = args.match(/backref\s*=\s*["']([^"']+)["']/)
  const metadata: Record<string, unknown> = {}
  if (backPopMatch) metadata.backPopulates = backPopMatch[1]
  if (backrefMatch) metadata.backref = backrefMatch[1]

  return { type: relType, targetEntity, sourceField: null, targetField: null, metadata }
}

// ---- Type helpers ----

// Extract first positional argument from a comma-separated args string, respecting paren nesting
function extractFirstArg(args: string): string {
  let depth = 0
  for (let i = 0; i < args.length; i++) {
    const ch = args[i]
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth--
    else if (ch === ',' && depth === 0) return args.slice(0, i).trim()
  }
  return args.trim()
}

// Extract the base type name from an expression like String(50), Integer, etc.
function extractTypeName(expr: string): string {
  const t = expr.trim()
  const match = t.match(/^(\w+)/)
  if (!match) return 'unknown'
  const raw = match[1]
  return SQLA_TYPE_MAP[raw] ?? raw
}

// Extract inner Python type from Mapped[Optional[str]] → str, Mapped[int] → int
function extractMappedType(mappedType: string): string {
  let inner = mappedType.trim()
  // Unwrap Optional[...]
  const optMatch = inner.match(/^Optional\[(.+)\]$/)
  if (optMatch) inner = optMatch[1].trim()
  // Strip | None (Python 3.10+ union syntax): str | None → str
  inner = inner.replace(/\s*\|\s*None$/, '').replace(/^None\s*\|\s*/, '').trim()
  // Unwrap List[...], list[...] etc.
  if (/^(?:List|list|Set|set|Sequence|Iterable)\[/.test(inner)) return 'array'
  // Unwrap dict[...] / Dict[...]
  if (/^(?:Dict|dict)\[/.test(inner)) return 'JSON'
  // Map Python type hints to SQLAlchemy-compatible type names
  return PYTHON_TYPE_HINT_MAP[inner] ?? extractTypeName(inner)
}

const PYTHON_TYPE_HINT_MAP: Record<string, string> = {
  'str': 'String', 'int': 'Integer', 'float': 'Float',
  'bool': 'Boolean', 'bytes': 'LargeBinary',
  'datetime': 'DateTime', 'date': 'Date', 'time': 'Time',
  'Decimal': 'Numeric', 'UUID': 'UUID', 'uuid.UUID': 'UUID',
  'dict': 'JSON', 'list': 'ARRAY', 'Any': 'unknown',
}

const SQLA_TYPE_MAP: Record<string, string> = {
  // Integers
  'Integer': 'Integer', 'INT': 'Integer', 'INTEGER': 'Integer',
  'BigInteger': 'BigInteger', 'BIGINT': 'BigInteger',
  'SmallInteger': 'SmallInteger', 'SMALLINT': 'SmallInteger',
  // Strings
  'String': 'String', 'VARCHAR': 'String', 'NVARCHAR': 'String', 'CHAR': 'String',
  'Text': 'Text', 'TEXT': 'Text', 'NTEXT': 'Text',
  'Unicode': 'String', 'UnicodeText': 'Text',
  'StringID': 'String', 'TaskInstanceState': 'String', // common custom types
  // Floats/Decimals
  'Float': 'Float', 'FLOAT': 'Float', 'REAL': 'Float',
  'Numeric': 'Numeric', 'NUMERIC': 'Numeric', 'DECIMAL': 'Numeric',
  'Double': 'Float',
  // Booleans
  'Boolean': 'Boolean', 'BOOLEAN': 'Boolean', 'BOOL': 'Boolean',
  // Dates
  'DateTime': 'DateTime', 'DATETIME': 'DateTime',
  'Date': 'Date', 'DATE': 'Date',
  'Time': 'Time', 'TIME': 'Time',
  'TIMESTAMP': 'DateTime', 'Interval': 'Interval',
  'UtcDateTime': 'DateTime', 'TimezoneAware': 'DateTime', // common custom types
  // JSON
  'JSON': 'JSON', 'JSONB': 'JSON', 'JSONType': 'JSON',
  // Binary
  'LargeBinary': 'LargeBinary', 'BLOB': 'LargeBinary', 'BINARY': 'LargeBinary',
  // UUID
  'UUID': 'UUID', 'Uuid': 'UUID',
  // Enum
  'Enum': 'Enum',
  // Array
  'ARRAY': 'ARRAY',
}
