import { EntityRecord, NormalizedField, NormalizedRelationship, toSnakeCase } from './normalizer'
import { Confidence, EntityType } from './extractors/base'

const STRIP_SUFFIXES = /(_record|_model|_entity|_schema|_table|_dto|record|model|entity)$/i

function stripSuffix(name: string): string {
  return name.replace(STRIP_SUFFIXES, '')
}

function dedupKey(normalizedName: string): string {
  return stripSuffix(normalizedName.replace(/s$/, ''))
}

const ENTITY_TYPE_PRIORITY: Record<EntityType, number> = {
  table: 5,
  view: 4,
  collection: 3,
  procedure: 2,
  document: 1,
  index: 0,
  schema: 0,
}

const CONFIDENCE_PRIORITY: Record<Confidence, number> = { high: 2, medium: 1, low: 0 }

export function deduplicateEntities(entities: EntityRecord[]): EntityRecord[] {
  // Group entities by dedup key
  const groups = new Map<string, EntityRecord[]>()

  for (const entity of entities) {
    const key = dedupKey(entity.normalizedName)
    const group = groups.get(key) ?? []
    group.push(entity)
    groups.set(key, group)
  }

  return [...groups.values()].map(mergeGroup)
}

function mergeGroup(group: EntityRecord[]): EntityRecord {
  if (group.length === 1) return group[0]

  // Pick the best entity as the "winner" (highest confidence + most specific type)
  const winner = group.reduce((best, curr) => {
    const bestScore = CONFIDENCE_PRIORITY[best.confidence] * 10 + ENTITY_TYPE_PRIORITY[best.entityType]
    const currScore = CONFIDENCE_PRIORITY[curr.confidence] * 10 + ENTITY_TYPE_PRIORITY[curr.entityType]
    return currScore > bestScore ? curr : best
  })

  // Merge fields: dedup by normalizedName, prefer more complete definitions
  const fieldMap = new Map<string, NormalizedField>()
  for (const entity of group) {
    for (const field of entity.fields) {
      const existing = fieldMap.get(field.normalizedName)
      if (!existing) {
        fieldMap.set(field.normalizedName, field)
      } else {
        fieldMap.set(field.normalizedName, mergeField(existing, field))
      }
    }
  }

  // Merge relationships: dedup by (targetEntityName, type, sourceField)
  const relMap = new Map<string, NormalizedRelationship>()
  for (const entity of group) {
    for (const rel of entity.relationships) {
      const key = `${rel.targetEntityName}:${rel.type}:${rel.sourceField ?? ''}`
      if (!relMap.has(key)) relMap.set(key, rel)
    }
  }

  // Union all source locations
  const allSources = group.flatMap((e) => e.primarySources)

  return {
    name: winner.name,
    normalizedName: winner.normalizedName,
    entityType: winner.entityType,
    confidence: winner.confidence,
    primarySources: allSources,
    fields: [...fieldMap.values()].sort((a, b) => (a.ordinalPosition ?? 999) - (b.ordinalPosition ?? 999)),
    relationships: [...relMap.values()],
  }
}

function mergeField(a: NormalizedField, b: NormalizedField): NormalizedField {
  // Prefer the field with more information
  const aScore = fieldScore(a)
  const bScore = fieldScore(b)
  const winner = aScore >= bScore ? a : b
  const loser = winner === a ? b : a

  return {
    ...winner,
    // Fill in nulls from the loser
    nativeType: winner.nativeType || loser.nativeType,
    isNullable: winner.isNullable ?? loser.isNullable,
    defaultValue: winner.defaultValue ?? loser.defaultValue,
    ordinalPosition: winner.ordinalPosition ?? loser.ordinalPosition,
    metadata: { ...loser.metadata, ...winner.metadata },
  }
}

function fieldScore(f: NormalizedField): number {
  let score = 0
  if (f.dataType !== 'unknown') score += 2
  if (f.isNullable !== null) score++
  if (f.nativeType) score++
  if (f.ordinalPosition !== null) score++
  if (f.isPrimaryKey) score++
  return score
}
