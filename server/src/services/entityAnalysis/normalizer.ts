import { RawEntity, RawField, RawRelationship, EntityType, Confidence } from './extractors/base'

// ---- Normalized output types ----

export interface NormalizedField {
  name: string
  normalizedName: string
  dataType: string
  nativeType: string
  isNullable: boolean | null
  isPrimaryKey: boolean
  isForeignKey: boolean
  isUnique: boolean
  defaultValue: string | null
  ordinalPosition: number | null
  metadata: Record<string, unknown>
}

export interface NormalizedRelationship {
  type: RawRelationship['type']
  targetEntityName: string
  sourceField: string | null
  targetField: string | null
  metadata: Record<string, unknown>
}

export interface EntityRecord {
  name: string
  normalizedName: string
  entityType: EntityType
  confidence: Confidence
  primarySources: RawEntity['source'][]
  fields: NormalizedField[]
  relationships: NormalizedRelationship[]
}

// ---- snake_case conversion ----

export function toSnakeCase(name: string): string {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[-\s]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
}

// ---- Type normalization ----

const TYPE_MAP: Array<[RegExp, string]> = [
  [/^(varchar|nvarchar|char|nchar|character varying|text|ntext|clob|tinytext|mediumtext|longtext|string|str|emailfield|urlfield|slugfield|charfield|textfield|longcharfield|longtext|character)(\s*\(.*\))?$/i, 'string'],
  [/^(int|integer|bigint|smallint|tinyint|int2|int4|int8|int16|int32|int64|long|serial|bigserial|smallserial|number|short|byte|autofield|bigautofield|smallautofield|positiveintegerfield|bigintegerfield|smallintegerfield|positiveinteger)(\s*\(.*\))?$/i, 'integer'],
  [/^(float|double|decimal|numeric|real|money|float4|float8|float32|float64|double precision|decimalfield|floatfield)(\s*\(.*\))?$/i, 'decimal'],
  [/^(bool|boolean|bit\(1\)|tinyint\(1\)|booleanfield)$/i, 'boolean'],
  [/^(timestamp|datetime|date|time|timetz|timestamptz|timestamp with time zone|timestamp without time zone|datetimefield|datefield|timefield|zoneddatetime|localdate|localdatetime|instant|offsetdatetime)(\s*\(.*\))?$/i, 'datetime'],
  [/^(jsonb|json|hstore|jsondocumentfield|jsonfield)$/i, 'json'],
  [/^(bytea|blob|binary|varbinary|longblob|mediumblob|tinyblob|image|binaryfield|filefield)(\s*\(.*\))?$/i, 'binary'],
  [/^(uuid|uuidfield)$/i, 'uuid'],
  [/\[\]$/, 'array'],
  [/^(array|list|set|collection|vector|arraytfield)(<.*>)?$/i, 'array'],
  [/^(enum|enumerated|enumfield)(\s*\(.*\))?$/i, 'enum'],
]

export function normalizeType(nativeType: string): string {
  const t = nativeType.trim()
  for (const [pattern, normalized] of TYPE_MAP) {
    if (pattern.test(t)) return normalized
  }
  return 'unknown'
}

// ---- Main normalizer ----

export function normalizeEntities(rawEntities: RawEntity[]): EntityRecord[] {
  return rawEntities.map(normalizeEntity)
}

function normalizeEntity(raw: RawEntity): EntityRecord {
  const normalizedName = toSnakeCase(raw.name)

  const fields: NormalizedField[] = raw.fields.map((f) => normalizeField(f))

  const relationships: NormalizedRelationship[] = raw.relationships.map((r) => ({
    type: r.type,
    targetEntityName: toSnakeCase(r.targetEntity),
    sourceField: r.sourceField,
    targetField: r.targetField,
    metadata: r.metadata,
  }))

  return {
    name: raw.name,
    normalizedName,
    entityType: raw.entityType,
    confidence: raw.confidence,
    primarySources: [raw.source],
    fields,
    relationships,
  }
}

function normalizeField(raw: RawField): NormalizedField {
  return {
    name: raw.name,
    normalizedName: toSnakeCase(raw.name),
    dataType: normalizeType(raw.type),
    nativeType: raw.type,
    isNullable: raw.nullable,
    isPrimaryKey: raw.isPrimaryKey,
    isForeignKey: raw.isForeignKey,
    isUnique: raw.isUnique,
    defaultValue: raw.defaultValue,
    ordinalPosition: raw.ordinalPosition,
    metadata: raw.metadata,
  }
}
