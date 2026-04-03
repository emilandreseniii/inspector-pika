import { BaseExtractor, ExtractorResult, RawEntity, RawField } from '../base'

// Proto scalar types → normalised type
const PROTO_TYPE_MAP: Record<string, string> = {
  double: 'float', float: 'float',
  int32: 'integer', int64: 'bigint', uint32: 'integer', uint64: 'bigint',
  sint32: 'integer', sint64: 'bigint', fixed32: 'integer', fixed64: 'bigint',
  sfixed32: 'integer', sfixed64: 'bigint',
  bool: 'boolean',
  string: 'string',
  bytes: 'binary',
}

export class ProtoMessagesExtractor extends BaseExtractor {
  readonly extractorId = 'cross-language.proto_messages'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []

    const protoFiles = await this.glob('**/*.proto')

    for (const file of protoFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseProtoMessages(content, file, this.extractorId)
        entities.push(...parsed)
      } catch (err) {
        warnings.push(`Failed to parse ${file}: ${(err as Error).message}`)
      }
    }

    return {
      entities,
      warnings,
      stats: { filesScanned: protoFiles.length, entitiesFound: entities.length, extractionTimeMs: Date.now() - start },
    }
  }
}

// ---- Parser ----

function parseProtoMessages(content: string, file: string, extractorId: string): RawEntity[] {
  const entities: RawEntity[] = []
  const text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const stripped = stripComments(text)

  const packageMatch = stripped.match(/^\s*package\s+([\w.]+)\s*;/m)
  const packageName = packageMatch?.[1]

  // Match top-level message blocks (not nested — we flatten via recursion)
  const messageRe = /\bmessage\s+(\w+)\s*\{/g
  let m: RegExpExecArray | null

  while ((m = messageRe.exec(stripped)) !== null) {
    const msgName = m[1]
    const startIdx = m.index + m[0].length
    const body = extractBlock(stripped, startIdx - 1) // -1 to include the opening brace
    if (body === null) continue

    const startLine = countLines(text, m.index)
    const fields = parseMessageFields(body)

    if (fields.length === 0) continue

    entities.push({
      name: msgName,
      entityType: 'schema',
      fields,
      relationships: [],
      source: { file, startLine, endLine: startLine + body.split('\n').length, format: 'proto', extractorId },
      extractorId,
      confidence: 'high',
      metadata: { package: packageName },
    })
  }

  return entities
}

function parseMessageFields(body: string): RawField[] {
  const fields: RawField[] = []
  const lines = body.split('\n')

  let pos = 0
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue
    if (trimmed === '{' || trimmed === '}') continue
    if (/^\s*(?:reserved|option|extensions|oneof|enum|message)\b/.test(trimmed)) continue

    // optional/repeated/required string name = 1;
    // string name = 1;
    const fieldMatch = trimmed.match(/^(?:optional\s+|repeated\s+|required\s+)?(\w[\w.]*)\s+(\w+)\s*=\s*\d+/)
    if (fieldMatch) {
      const rawType = fieldMatch[1]
      const fieldName = fieldMatch[2]
      const isRepeated = /^repeated\s+/.test(trimmed)
      const type = PROTO_TYPE_MAP[rawType] ?? rawType
      const nullable = /^optional\s+/.test(trimmed)

      fields.push({
        name: fieldName,
        type: isRepeated ? `list<${type}>` : type,
        nullable,
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        defaultValue: null,
        ordinalPosition: pos++,
        metadata: { fieldNumber: trimmed.match(/=\s*(\d+)/)?.[1] },
      })
    }
  }

  return fields
}

/** Extract the content of a balanced { } block starting from an opening { */
function extractBlock(text: string, openIdx: number): string | null {
  let depth = 0
  let start = -1
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === '{') {
      depth++
      if (start === -1) start = i
    } else if (text[i] === '}') {
      depth--
      if (depth === 0) return text.slice(start + 1, i)
    }
  }
  return null
}

function countLines(text: string, offset: number): number {
  let count = 1
  for (let i = 0; i < offset; i++) {
    if (text[i] === '\n') count++
  }
  return count
}

function stripComments(code: string): string {
  return code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}
