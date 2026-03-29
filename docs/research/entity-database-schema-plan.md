# Entity Analysis — Database Schema Plan

This document describes the PostgreSQL schema additions needed to store entity analysis results. All definitions are written as Drizzle ORM TypeScript schema additions, matching the style of the existing `server/src/db/schema.ts`.

---

## New Tables

### `repoEntityApproaches` — Detected Entity Storage Approaches

Stores the output of Phase 1 detection. One row per detected approach per repo. Re-running the `analyze_entities` job replaces these rows for the given repo.

```ts
import { pgTable, serial, text, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core'

export const repoEntityApproaches = pgTable('repo_entity_approaches', {
  id: serial('id').primaryKey(),
  repoId: integer('repo_id')
    .references(() => repositories.id, { onDelete: 'cascade' })
    .notNull(),

  // The primary language associated with this approach (e.g. "Python", "TypeScript").
  // Value "cross-language" for approaches not tied to a specific language
  // (SQL DDL files, Protobuf, OpenAPI, GraphQL schemas).
  language: text('language').notNull(),

  // Stable identifier for the framework/approach. Examples:
  //   "django_orm", "prisma", "jpa_hibernate", "sqlalchemy",
  //   "ef_core", "gorm", "ecto", "sql_ddl", "protobuf", "openapi"
  approach: text('approach').notNull(),

  // Detection confidence based on how many signal tiers matched.
  // "high"   = Tier A + at least one other tier
  // "medium" = Tier A only, or Tier B + Tier C
  // "low"    = Tier B only, or Tier C only
  confidence: text('confidence').notNull(), // "high" | "medium" | "low"

  // Array of human-readable signal descriptions that triggered this detection.
  // Example: ["Tier A: 'Django' found in requirements.txt", "Tier B: models.py files found (3 files)"]
  signals: jsonb('signals').notNull().$type<string[]>().default([]),

  // When the detection ran.
  detectedAt: timestamp('detected_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  // Look up all approaches for a given repo (primary use case)
  repoIdIdx: index('repo_entity_approaches_repo_id_idx').on(table.repoId),
  // Check if a specific approach exists for a repo (dedup / skip logic on re-run)
  repoApproachIdx: index('repo_entity_approaches_repo_approach_idx').on(table.repoId, table.language, table.approach),
}))
```

---

### `repoEntities` — The Main Entity Catalog

One row per distinct logical entity (table, collection, document, view, etc.) per repo. This is the deduplicated output of Phase 2 extraction.

```ts
export const repoEntities = pgTable('repo_entities', {
  id: serial('id').primaryKey(),
  repoId: integer('repo_id')
    .references(() => repositories.id, { onDelete: 'cascade' })
    .notNull(),

  // The canonical entity name as determined by the deduplicator.
  // Typically the name as written in the highest-confidence source.
  // Example: "UserAccount", "user_accounts", "Order"
  name: text('name').notNull(),

  // snake_case normalized version of name, used for deduplication and display.
  // Example: "user_account", "order"
  normalizedName: text('normalized_name').notNull(),

  // FK to the approach that was the primary (highest-confidence) source for this entity.
  // Nullable because an entity may survive even if its source approach row is deleted
  // (e.g., on a partial re-analysis), and because set null is used on cascade.
  sourceApproachId: integer('source_approach_id')
    .references(() => repoEntityApproaches.id, { onDelete: 'set null' }),

  // What kind of storage object this entity represents.
  // "table"     — relational database table
  // "collection"— document store collection (MongoDB, etc.)
  // "document"  — schema-defined document type (Protobuf message, GraphQL type)
  // "view"      — SQL VIEW or ORM-defined read model
  // "procedure" — stored procedure or function
  // "index"     — database index (rarely extracted directly)
  // "schema"    — database schema namespace
  entityType: text('entity_type').notNull(),

  // Entity-level confidence (maximum confidence across all contributing sources).
  confidence: text('confidence').notNull(), // "high" | "medium" | "low"

  // All source locations that contributed to this entity record (after deduplication).
  // Each element is a SourceLocation object:
  //   {
  //     file: string,           — path relative to repo root
  //     startLine: number|null, — 1-indexed, null for whole-file references
  //     endLine: number|null,
  //     format: string,         — "python_class", "prisma_model", "sql_ddl", etc.
  //     extractorId: string     — e.g. "python.django_orm"
  //   }
  // Multiple entries appear when the same entity was found by more than one extractor.
  primarySources: jsonb('primary_sources').notNull().$type<SourceLocation[]>().default([]),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  // List all entities for a repo (primary use case)
  repoIdIdx: index('repo_entities_repo_id_idx').on(table.repoId),
  // Look up a specific entity by normalized name within a repo (deduplication key)
  repoNormalizedNameIdx: index('repo_entities_repo_normalized_name_idx').on(table.repoId, table.normalizedName),
  // Filter entities by type within a repo
  repoEntityTypeIdx: index('repo_entities_repo_entity_type_idx').on(table.repoId, table.entityType),
  // Join from repoEntityApproaches to its entities
  sourceApproachIdx: index('repo_entities_source_approach_idx').on(table.sourceApproachId),
}))
```

---

### `repoEntityFields` — Fields and Columns

One row per field/column of each entity.

```ts
export const repoEntityFields = pgTable('repo_entity_fields', {
  id: serial('id').primaryKey(),
  entityId: integer('entity_id')
    .references(() => repoEntities.id, { onDelete: 'cascade' })
    .notNull(),

  // Field name as found in source (preserves original casing).
  name: text('name').notNull(),

  // snake_case normalized version for deduplication across extractors.
  normalizedName: text('normalized_name').notNull(),

  // Normalized type category:
  //   "string" | "integer" | "decimal" | "boolean" | "datetime" |
  //   "json" | "binary" | "uuid" | "array" | "enum" | "unknown"
  dataType: text('data_type').notNull(),

  // The raw type string as written in source.
  // Examples: "VARCHAR(255)", "int64", "Decimal(10,2)", "EmailField(max_length=254)"
  nativeType: text('native_type'),

  // Whether the field is nullable.
  // Stored as text to represent three states: "true", "false", or null (unknown).
  // null means the extractor could not determine nullability from source.
  isNullable: text('is_nullable'), // "true" | "false" | null

  isPrimaryKey: text('is_primary_key').notNull().default('false'), // "true" | "false"
  isForeignKey: text('is_foreign_key').notNull().default('false'), // "true" | "false"
  isUnique: text('is_unique').notNull().default('false'),           // "true" | "false"

  // Default value as a string representation.
  // Examples: "now()", "'active'", "0", "true", "gen_random_uuid()"
  defaultValue: text('default_value'),

  // Column order within the entity, if determinable from source (1-indexed).
  // May be null for ORMs that don't preserve declaration order.
  ordinalPosition: integer('ordinal_position'),

  // Extractor-specific extras that don't fit the normalized columns. Common keys:
  //   autoIncrement: boolean  — for SQL SERIAL / AUTO_INCREMENT
  //   enumValues: string[]    — for ENUM('a', 'b') or @Column({ enum: [...] })
  //   referencedTable: string — for FK fields, the referenced table name
  //   referencedField: string — for FK fields, the referenced column name
  //   length: number          — for VARCHAR(N) or similar length-constrained types
  //   precision: number       — for DECIMAL(p,s)
  //   scale: number           — for DECIMAL(p,s)
  //   arrayItemType: string   — for PostgreSQL array fields (text[], integer[])
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  // Fetch all fields for a given entity (most common query)
  entityIdIdx: index('repo_entity_fields_entity_id_idx').on(table.entityId),
  // Look up a field by normalized name within an entity (deduplication during merge)
  entityNormalizedNameIdx: index('repo_entity_fields_entity_normalized_name_idx').on(table.entityId, table.normalizedName),
}))
```

---

### `repoEntityRelationships` — Relationships Between Entities

Directional relationship records linking source entity to target entity.

```ts
export const repoEntityRelationships = pgTable('repo_entity_relationships', {
  id: serial('id').primaryKey(),
  repoId: integer('repo_id')
    .references(() => repositories.id, { onDelete: 'cascade' })
    .notNull(),

  sourceEntityId: integer('source_entity_id')
    .references(() => repoEntities.id, { onDelete: 'cascade' })
    .notNull(),

  // Target entity. Nullable FK because:
  //   - The target entity may not yet have been extracted (e.g., it's in another service)
  //   - The relationship was inferred from a string reference that doesn't match any extracted entity
  // targetEntityName preserves the unresolved name even when this FK is null.
  targetEntityId: integer('target_entity_id')
    .references(() => repoEntities.id, { onDelete: 'set null' }),

  // The target entity name as written in source, preserved even when targetEntityId is null.
  // Used for display and future resolution if the target entity is later extracted.
  targetEntityName: text('target_entity_name').notNull(),

  // Relationship type from the source entity's perspective.
  // "one_to_one"   — e.g. User has one UserProfile
  // "one_to_many"  — e.g. User has many Orders
  // "many_to_one"  — e.g. Order belongs to User
  // "many_to_many" — e.g. User has many Roles through UserRoles
  relationshipType: text('relationship_type').notNull(),

  // Field on the source entity that carries the FK (or join table reference).
  sourceField: text('source_field'),

  // Field on the target entity being referenced.
  targetField: text('target_field'),

  // Extractor-specific extras. Common keys:
  //   joinTable: string  — for many_to_many via explicit join table
  //   cascade: string    — e.g. "delete", "all", "merge"
  //   nullable: boolean  — whether the FK allows null
  //   fetchType: string  — e.g. "LAZY" or "EAGER" from JPA
  //   mappedBy: string   — owning side field name for bidirectional ORM relationships
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  // Fetch all relationships for a repo
  repoIdIdx: index('repo_entity_relationships_repo_id_idx').on(table.repoId),
  // Fetch outgoing relationships from a given source entity
  sourceEntityIdIdx: index('repo_entity_relationships_source_entity_id_idx').on(table.sourceEntityId),
  // Fetch incoming relationships to a given target entity
  targetEntityIdIdx: index('repo_entity_relationships_target_entity_id_idx').on(table.targetEntityId),
}))
```

---

## Relations (Drizzle ORM)

```ts
export const repoEntityApproachesRelations = relations(repoEntityApproaches, ({ one, many }) => ({
  repository: one(repositories, {
    fields: [repoEntityApproaches.repoId],
    references: [repositories.id],
  }),
  entities: many(repoEntities),
}))

export const repoEntitiesRelations = relations(repoEntities, ({ one, many }) => ({
  repository: one(repositories, {
    fields: [repoEntities.repoId],
    references: [repositories.id],
  }),
  sourceApproach: one(repoEntityApproaches, {
    fields: [repoEntities.sourceApproachId],
    references: [repoEntityApproaches.id],
  }),
  fields: many(repoEntityFields),
  outgoingRelationships: many(repoEntityRelationships, { relationName: 'source' }),
  incomingRelationships: many(repoEntityRelationships, { relationName: 'target' }),
}))

export const repoEntityFieldsRelations = relations(repoEntityFields, ({ one }) => ({
  entity: one(repoEntities, {
    fields: [repoEntityFields.entityId],
    references: [repoEntities.id],
  }),
}))

export const repoEntityRelationshipsRelations = relations(repoEntityRelationships, ({ one }) => ({
  repository: one(repositories, {
    fields: [repoEntityRelationships.repoId],
    references: [repositories.id],
  }),
  sourceEntity: one(repoEntities, {
    fields: [repoEntityRelationships.sourceEntityId],
    references: [repoEntities.id],
    relationName: 'source',
  }),
  targetEntity: one(repoEntities, {
    fields: [repoEntityRelationships.targetEntityId],
    references: [repoEntities.id],
    relationName: 'target',
  }),
}))
```

The `repositoriesRelations` export in `schema.ts` should be extended to include:

```ts
export const repositoriesRelations = relations(repositories, ({ many }) => ({
  languages: many(repoLanguages),
  dependencies: many(repoDependencies),
  components: many(repoComponents),
  apiEndpoints: many(repoApiEndpoints),
  docs: many(repoDocs),
  entityApproaches: many(repoEntityApproaches),   // new
  entities: many(repoEntities),                   // new
}))
```

---

## Notes on JSONB Fields

### `repoEntityApproaches.signals`

Array of strings. Each string is a plain-English description of a detected signal, including which tier it was in. Primarily for human display in the UI (as a tooltip on an approach badge) and for debugging false positives.

Example value:
```json
[
  "Tier A: 'typeorm' found in package.json devDependencies",
  "Tier B: 12 files matching **/entity/*.ts found",
  "Tier C: '@Entity()' decorator found in src/user/user.entity.ts"
]
```

### `repoEntities.primarySources`

Array of `SourceLocation` objects. Each object has:
```json
{
  "file": "src/models/user.py",
  "startLine": 12,
  "endLine": 34,
  "format": "python_class",
  "extractorId": "python.django_orm"
}
```
`file` is always relative to the repo root. Multiple entries appear after deduplication when the same entity was found by more than one extractor (e.g., a Prisma model AND a SQL migration both define the same table).

### `repoEntityFields.metadata`

Dictionary for extractor-specific extras that don't fit the normalized schema. Common keys:
- `autoIncrement: boolean` — for SQL `SERIAL`/`AUTO_INCREMENT` or `@GeneratedValue(strategy = AUTO)`
- `enumValues: string[]` — for `ENUM('a', 'b')` or `@Column({ enum: ['a', 'b'] })`
- `referencedTable: string` — for FK fields, the table name as a string (before entity resolution)
- `referencedField: string` — for FK fields, the column name in the referenced table
- `length: number` — for `VARCHAR(N)` or similar length-constrained types
- `precision: number`, `scale: number` — for `DECIMAL(p,s)` fields
- `arrayItemType: string` — for PostgreSQL array fields (`text[]`, `integer[]`)

### `repoEntityRelationships.metadata`

Common keys:
- `joinTable: string` — for many-to-many relationships, the name of the explicit join/pivot table
- `cascade: string` — e.g., `"delete"`, `"all"`, `"merge"` from ORM cascade annotations
- `nullable: boolean` — whether the FK allows null (equivalent to whether the relationship is optional)
- `fetchType: string` — e.g., `"LAZY"` or `"EAGER"` from JPA annotations
- `mappedBy: string` — for bidirectional ORM relationships, the field name on the owning side

---

## Deduplication Strategy

The `repoEntities` table maintains **one row per logical entity**. When the same entity is found by multiple extractors (e.g., a Prisma `model User` and a SQL DDL `CREATE TABLE users`), they are merged into a single row before upsert, with both source locations recorded in `primarySources`.

The deduplicator (see `deduplicator.ts` in [entity-extractor-architecture.md](./entity-extractor-architecture.md)) produces the final deduplicated `EntityRecord[]`. The job runner then upserts these into the database.

**Upsert keys:**

| Table | Conflict Key | Update Columns |
|-------|-------------|----------------|
| `repoEntityApproaches` | `(repoId, language, approach)` | `confidence`, `signals`, `detectedAt` |
| `repoEntities` | `(repoId, normalizedName)` | `name`, `sourceApproachId`, `entityType`, `confidence`, `primarySources`, `updatedAt` |
| `repoEntityFields` | `(entityId, normalizedName)` | all field columns |
| `repoEntityRelationships` | `(repoId, sourceEntityId, targetEntityName, relationshipType)` | `targetEntityId`, `sourceField`, `targetField`, `metadata` |

---

## Re-Analysis Handling

When `analyze_entities` runs again on the same repo, the job follows an **overwrite (replace) strategy**:

1. Delete all `repoEntityApproaches` rows for the repo (cascades to invalidate `sourceApproachId` FKs on `repoEntities` via `SET NULL`).
2. Delete all `repoEntities` rows for the repo (cascades to delete all `repoEntityFields` and `repoEntityRelationships`).
3. Run the full detection + extraction pipeline.
4. Insert all new results.

This is simpler and more correct than an incremental strategy. The delete-and-reinsert is done within the job runner, not as a DB transaction that spans the entire extraction (which would hold locks for minutes). The job status field ensures the UI shows a loading state during the gap.

If `forceReanalysis: false` (default) and the repo already has entity results (i.e., `repoEntityApproaches` rows exist), the job skips re-running and returns the existing data. To trigger a fresh run, call the job with `forceReanalysis: true`.

---

## Schema Migration Notes

These four tables should be added in a single Drizzle migration. The migration must run after the existing `repositories` table migration since all four tables reference `repositories.id`.

Suggested migration file name: `NNNN_add_entity_analysis_tables.ts` following the existing migration numbering convention.

The `isNullable`, `isPrimaryKey`, `isForeignKey`, `isUnique` fields on `repoEntityFields` use `text` rather than `boolean` because they need a three-state representation (`"true"` / `"false"` / `null` = unknown). This mirrors how some ORM extractors cannot determine nullability from source code alone. Future cleanup could normalize these to `boolean NOT NULL DEFAULT false` once extractors consistently populate them.
