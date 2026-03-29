# Entity Extractor Architecture — Phase 2

This document describes the code architecture for the entity analysis system. It covers the module structure, TypeScript interfaces, the extractor base class, the registry, and how the orchestrator calls everything together.

---

## Module Structure

```
server/src/services/entityAnalysis/
  index.ts                          — orchestrator: drives detection + extraction pipeline
  detector.ts                       — Phase 1 detection (see entity-detection-plan.md)
  normalizer.ts                     — converts RawEntity[] to EntityRecord[]
  deduplicator.ts                   — merges EntityRecord[] from multiple extractors
  registry.ts                       — maps (language, approach) → extractor class

  extractors/
    base.ts                         — BaseExtractor interface and abstract class

    languages/
      python/
        sqlalchemy.ts
        django.ts
        tortoise.ts
        peewee.ts
        rawSql.ts
      javascript/
        prisma.ts
        typeorm.ts
        sequelize.ts
        mongoose.ts
        knex.ts
        drizzle.ts
      java/
        jpa.ts
        mybatis.ts
        jooq.ts
        springDataJdbc.ts
      kotlin/
        jpa.ts                      — reuses Java JPA patterns, Kotlin syntax
        exposed.ts
        room.ts
      go/
        gorm.ts
        sqlx.ts
        ent.ts
        sqlc.ts
      ruby/
        activerecord.ts
        sequel.ts
      php/
        eloquent.ts
        doctrine.ts
        propel.ts
      csharp/
        efCore.ts
        dapper.ts
        nhibernate.ts
      rust/
        diesel.ts
        seaOrm.ts
        sqlx.ts
      swift/
        coreData.ts
        grdb.ts
        realm.ts
      scala/
        slick.ts
        doobie.ts
      cpp/
        odbOrm.ts
        qtSql.ts
        wtDbo.ts
        soci.ts
        sqliteCpp.ts
      elixir/
        ecto.ts
      haskell/
        persistent.ts
        beam.ts
      perl/
        dbixClass.ts
        roseDb.ts
        rawDbi.ts
      clojure/
        honeySql.ts
        nextJdbc.ts
      dart/
        drift.ts
        isar.ts
      r/
        dbiDbplyr.ts
      lua/
        luaSql.ts

    shared/
      sqlDdlExtractor.ts            — parses raw SQL DDL files (CREATE TABLE, ALTER TABLE)
      protobufExtractor.ts          — parses .proto message definitions
      graphqlExtractor.ts           — parses .graphql/.graphqls schema type definitions
      openApiExtractor.ts           — parses OpenAPI 3.x / Swagger 2.x spec files
      migrationFileExtractor.ts     — handles migration file ordering and replay
```

---

## Core Interfaces

### `DetectedApproach`

Produced by `detector.ts`, consumed by the orchestrator and written to `repoEntityApproaches`.

```ts
export interface DetectedApproach {
  language: string           // "Python", "TypeScript", "cross-language", etc.
  approach: string           // "django_orm", "prisma", "jpa_hibernate", "sql_ddl"
  confidence: 'high' | 'medium' | 'low'
  signals: string[]          // e.g. ["Tier A: 'Django' in requirements.txt", "Tier B: models.py found"]
}
```

### `SourceLocation`

Identifies where in the source tree an entity was found.

```ts
export interface SourceLocation {
  file: string               // path relative to repo root, e.g. "src/models/user.py"
  startLine: number | null   // 1-indexed, null for whole-file references (e.g. SQL DDL file)
  endLine: number | null
  format: string             // "python_class", "prisma_model", "sql_ddl", "proto_message", etc.
  extractorId: string        // e.g. "python.django_orm", "cross-language.sql_ddl"
}
```

### `RawField`

A field/column as returned by an extractor before normalization.

```ts
export interface RawField {
  name: string               // as written in source: "user_id", "userId", "UserId"
  type: string               // native type string: "VARCHAR(255)", "String", "int64", "TEXT"
  nullable: boolean | null   // null means unknown/not determinable
  isPrimaryKey: boolean
  isForeignKey: boolean
  isUnique: boolean
  defaultValue: string | null
  ordinalPosition: number | null   // column order if determinable
  metadata: Record<string, unknown>  // extractor-specific extras, e.g. { autoIncrement: true }
}
```

### `RawRelationship`

A directional relationship between two entities as returned by an extractor.

```ts
export type RelationshipCardinality = 'one_to_one' | 'one_to_many' | 'many_to_one' | 'many_to_many'

export interface RawRelationship {
  type: RelationshipCardinality
  targetEntity: string       // the name of the referenced entity, as written in source
  sourceField: string | null // field on this entity that carries the FK
  targetField: string | null // field on the target entity being referenced
  metadata: Record<string, unknown>
}
```

### `RawEntity`

The primary output type of an extractor.

```ts
export interface RawEntity {
  name: string               // as written in source: "User", "users", "UserRecord"
  entityType: 'table' | 'collection' | 'document' | 'view' | 'procedure' | 'index' | 'schema'
  fields: RawField[]
  relationships: RawRelationship[]
  source: SourceLocation
  extractorId: string        // e.g. "python.django_orm", "cross-language.sql_ddl"
  confidence: 'high' | 'medium' | 'low'
  metadata: Record<string, unknown>
}
```

### `EntityRecord`

The normalized, deduplicated form written to the database. Produced by `normalizer.ts` and `deduplicator.ts`.

```ts
export interface NormalizedField {
  name: string
  normalizedName: string     // snake_case version of name
  dataType: string           // normalized type category: "string", "integer", "boolean", etc.
  nativeType: string         // original type string from source
  isNullable: boolean | null
  isPrimaryKey: boolean
  isForeignKey: boolean
  isUnique: boolean
  defaultValue: string | null
  ordinalPosition: number | null
  metadata: Record<string, unknown>
}

export interface NormalizedRelationship {
  type: RelationshipCardinality
  targetEntityName: string   // normalized name of target entity
  sourceField: string | null
  targetField: string | null
  metadata: Record<string, unknown>
}

export interface EntityRecord {
  name: string               // chosen canonical name (see deduplicator)
  normalizedName: string     // snake_case
  entityType: 'table' | 'collection' | 'document' | 'view' | 'procedure' | 'index' | 'schema'
  confidence: 'high' | 'medium' | 'low'
  primarySources: SourceLocation[]   // all source locations that contributed
  fields: NormalizedField[]
  relationships: NormalizedRelationship[]
}
```

---

## BaseExtractor

All language/framework extractors implement this interface:

```ts
// extractors/base.ts

export interface ExtractorContext {
  sourceDir: string            // absolute path to cloned repo root
  approach: DetectedApproach   // the detected approach this extractor handles
  repoFullName: string         // e.g. "facebook/react" — for logging
}

export interface ExtractorResult {
  entities: RawEntity[]
  warnings: string[]           // non-fatal issues encountered during extraction
  stats: {
    filesScanned: number
    entitiesFound: number
    extractionTimeMs: number
  }
}

export abstract class BaseExtractor {
  readonly extractorId: string   // e.g. "python.django_orm"

  constructor(protected ctx: ExtractorContext) {}

  /**
   * Run the extraction. Must resolve (not reject) even on partial failure.
   * Warnings should be recorded in the result, not thrown as errors.
   */
  abstract extract(): Promise<ExtractorResult>

  /**
   * Utility: read a file relative to sourceDir.
   */
  protected async readFile(relativePath: string): Promise<string> { ... }

  /**
   * Utility: glob files relative to sourceDir, excluding generated/vendor dirs.
   */
  protected async glob(pattern: string): Promise<string[]> { ... }

  /**
   * Utility: grep for a regex pattern across files matching a glob.
   * Returns { file, line, match } for each hit, up to limit.
   */
  protected async grep(
    fileGlob: string,
    pattern: RegExp,
    limit?: number
  ): Promise<Array<{ file: string; line: number; text: string }>> { ... }
}
```

The abstract `extract()` method is the only required implementation. The protected utilities provide consistent behavior across all extractors (correct path handling, consistent exclusion of `node_modules/`, `vendor/`, `build/`, etc.).

---

## Example Extractor Implementations

### `extractors/languages/javascript/prisma.ts`

```ts
export class PrismaExtractor extends BaseExtractor {
  readonly extractorId = 'javascript.prisma'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []

    // Find all .prisma schema files
    const schemaFiles = await this.glob('**/*.prisma')
    if (schemaFiles.length === 0) {
      warnings.push('No .prisma files found despite Prisma being detected')
      return { entities, warnings, stats: { filesScanned: 0, entitiesFound: 0, extractionTimeMs: Date.now() - start } }
    }

    for (const file of schemaFiles) {
      const content = await this.readFile(file)
      const parsed = parsePrismaSchema(content, file)  // internal parser
      entities.push(...parsed)
    }

    return {
      entities,
      warnings,
      stats: { filesScanned: schemaFiles.length, entitiesFound: entities.length, extractionTimeMs: Date.now() - start },
    }
  }
}

// parsePrismaSchema uses regex to find:
//   model ModelName {
//     field  Type  @attribute
//   }
// Prisma schema syntax is simple enough to parse reliably with regex + line scanning.
// Also handles: view ViewName { ... }, enum EnumName { ... }
```

### `extractors/languages/java/jpa.ts`

```ts
export class JpaExtractor extends BaseExtractor {
  readonly extractorId = 'java.jpa_hibernate'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []

    // Find Java/Kotlin files with @Entity annotation
    const entityFiles = await this.grep('**/*.{java,kt}', /@Entity\b/, 5000)
    const uniqueFiles = [...new Set(entityFiles.map(h => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseJpaEntity(content, file)
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

// parseJpaEntity uses regex to extract:
//   @Table(name = "table_name") or falls back to class name → snake_case
//   @Column annotations and field declarations
//   @Id, @GeneratedValue, @ManyToOne, @OneToMany, @JoinColumn
```

### `extractors/shared/sqlDdlExtractor.ts`

```ts
export class SqlDdlExtractor extends BaseExtractor {
  readonly extractorId = 'cross-language.sql_ddl'

  async extract(): Promise<ExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const entities: RawEntity[] = []

    const sqlFiles = await this.glob('**/*.sql')
    // Exclude known non-schema SQL files (data dumps, test fixtures with INSERT only)
    const schemaFiles = sqlFiles.filter(f =>
      !f.match(/\/seed\//i) &&
      !f.match(/\/fixtures\//i) &&
      !f.match(/\/testdata\//i)
    )

    for (const file of schemaFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseSqlDdl(content, file)
        entities.push(...parsed)
      } catch (err) {
        warnings.push(`Failed to parse SQL in ${file}: ${(err as Error).message}`)
      }
    }

    return {
      entities,
      warnings,
      stats: { filesScanned: schemaFiles.length, entitiesFound: entities.length, extractionTimeMs: Date.now() - start },
    }
  }
}

// parseSqlDdl uses regex for simple cases. It handles:
//   CREATE TABLE name (...) — extracts table name and column definitions
//   CREATE TABLE IF NOT EXISTS name (...)
//   ALTER TABLE name ADD COLUMN ... — used by migrationFileExtractor
//   Quoted identifiers: "name", `name`, [name]
// Column parsing extracts: name, type, NOT NULL, PRIMARY KEY, UNIQUE, DEFAULT, REFERENCES
```

### `extractors/shared/migrationFileExtractor.ts`

```ts
// Wraps SqlDdlExtractor with migration-file-aware ordering.
// Detects Flyway (V1__name.sql), Liquibase, Rails (YYYYMMDDHHMMSS_name.rb),
// Django (NNNN_name.py), Alembic, and generic timestamp-prefixed files.
//
// Processes files in chronological order, accumulates CREATE TABLE and
// ALTER TABLE ADD COLUMN operations, and emits the final schema state
// as RawEntity objects. DROP TABLE and ALTER TABLE DROP COLUMN are also
// tracked to exclude removed entities from the output.

export class MigrationFileExtractor extends BaseExtractor {
  readonly extractorId = 'cross-language.migration_files'
  async extract(): Promise<ExtractorResult> { ... }
}
```

### `extractors/shared/protobufExtractor.ts`

```ts
// Parses .proto files for message definitions.
// Handles proto2 and proto3 syntax.
// Extracts: message name, field name+type+number, oneof blocks, nested messages.
// Maps proto scalar types to normalized dataType categories.
// Does not execute protoc; uses regex + line scanning.

export class ProtobufExtractor extends BaseExtractor {
  readonly extractorId = 'cross-language.protobuf'
  async extract(): Promise<ExtractorResult> { ... }
}
```

### `extractors/shared/openApiExtractor.ts`

```ts
// Parses OpenAPI 3.x and Swagger 2.x spec files (YAML and JSON).
// Extracts schema components under:
//   OpenAPI 3.x: components.schemas.*
//   Swagger 2.x: definitions.*
// Each named schema with type: object becomes a RawEntity with entityType "document".
// Properties become RawField entries. $ref resolution is attempted for inline schemas.

export class OpenApiExtractor extends BaseExtractor {
  readonly extractorId = 'cross-language.openapi'
  async extract(): Promise<ExtractorResult> { ... }
}
```

### `extractors/shared/graphqlExtractor.ts`

```ts
// Parses .graphql and .graphqls schema files.
// Extracts type definitions (type TypeName { ... }) as RawEntity with entityType "document".
// Fields become RawField entries with GraphQL type strings as nativeType.
// Skips: Query, Mutation, Subscription root types, scalar definitions, enum definitions.

export class GraphqlExtractor extends BaseExtractor {
  readonly extractorId = 'cross-language.graphql_schema'
  async extract(): Promise<ExtractorResult> { ... }
}
```

---

## Registry

`registry.ts` maps `(language, approach)` string pairs to extractor classes:

```ts
// registry.ts

import { PrismaExtractor } from './extractors/languages/javascript/prisma'
import { TypeOrmExtractor } from './extractors/languages/javascript/typeorm'
import { DrizzleExtractor } from './extractors/languages/javascript/drizzle'
import { DjangoExtractor } from './extractors/languages/python/django'
import { SqlAlchemyExtractor } from './extractors/languages/python/sqlalchemy'
import { JpaExtractor } from './extractors/languages/java/jpa'
import { DbixClassExtractor } from './extractors/languages/perl/dbixClass'
// ... etc

import { SqlDdlExtractor } from './extractors/shared/sqlDdlExtractor'
import { ProtobufExtractor } from './extractors/shared/protobufExtractor'
import { GraphqlExtractor } from './extractors/shared/graphqlExtractor'
import { OpenApiExtractor } from './extractors/shared/openApiExtractor'
import { MigrationFileExtractor } from './extractors/shared/migrationFileExtractor'

type ExtractorClass = new (ctx: ExtractorContext) => BaseExtractor

const registry = new Map<string, ExtractorClass>()

function register(language: string, approach: string, cls: ExtractorClass) {
  registry.set(`${language}:${approach}`, cls)
}

// JavaScript / TypeScript (shared package.json, same extractors)
register('JavaScript', 'prisma',        PrismaExtractor)
register('TypeScript', 'prisma',        PrismaExtractor)
register('JavaScript', 'typeorm',       TypeOrmExtractor)
register('TypeScript', 'typeorm',       TypeOrmExtractor)
register('JavaScript', 'drizzle_orm',   DrizzleExtractor)
register('TypeScript', 'drizzle_orm',   DrizzleExtractor)
register('JavaScript', 'sequelize',     SequelizeExtractor)
register('TypeScript', 'sequelize',     SequelizeExtractor)
register('JavaScript', 'mongoose',      MongooseExtractor)
register('TypeScript', 'mongoose',      MongooseExtractor)
register('JavaScript', 'mikro_orm',     MikroOrmExtractor)
register('TypeScript', 'mikro_orm',     MikroOrmExtractor)

// Python
register('Python', 'django_orm',        DjangoExtractor)
register('Python', 'sqlalchemy',        SqlAlchemyExtractor)
register('Python', 'tortoise_orm',      TortoiseExtractor)
register('Python', 'peewee',            PeeweeExtractor)

// Java / Kotlin
register('Java',   'jpa_hibernate',     JpaExtractor)
register('Kotlin', 'jpa_hibernate',     JpaExtractor)   // same extractor handles both
register('Java',   'mybatis',           MybatisExtractor)
register('Java',   'jooq',              JooqExtractor)
register('Java',   'spring_data_jdbc',  SpringDataJdbcExtractor)
register('Kotlin', 'exposed',           ExposedExtractor)
register('Kotlin', 'room',              RoomExtractor)

// Go
register('Go', 'gorm',                  GormExtractor)
register('Go', 'ent',                   EntExtractor)
register('Go', 'sqlc',                  SqlcExtractor)
register('Go', 'sqlx',                  SqlxGoExtractor)

// Ruby
register('Ruby', 'activerecord',        ActiveRecordExtractor)
register('Ruby', 'sequel',              SequelExtractor)

// PHP
register('PHP', 'eloquent',             EloquentExtractor)
register('PHP', 'doctrine',             DoctrineExtractor)
register('PHP', 'propel',               PropelExtractor)

// C#
register('C#', 'ef_core',              EfCoreExtractor)
register('C#', 'dapper',               DapperExtractor)
register('C#', 'nhibernate',           NHibernateExtractor)

// Rust
register('Rust', 'diesel',              DieselExtractor)
register('Rust', 'sea_orm',             SeaOrmExtractor)
register('Rust', 'sqlx',               SqlxRustExtractor)

// Swift
register('Swift', 'core_data',          CoreDataExtractor)
register('Swift', 'grdb',               GrdbExtractor)
register('Swift', 'realm',              RealmSwiftExtractor)

// Scala
register('Scala', 'slick',              SlickExtractor)
register('Scala', 'doobie',             DoodieExtractor)

// C++
register('C++', 'odb_orm',              OdbOrmExtractor)
register('C++', 'qt_sql',              QtSqlExtractor)
register('C++', 'wt_dbo',              WtDboExtractor)
register('C++', 'soci',                SociExtractor)
register('C++', 'sqlitecpp',           SqliteCppExtractor)

// Elixir
register('Elixir', 'ecto',              EctoExtractor)

// Haskell
register('Haskell', 'persistent',       PersistentExtractor)
register('Haskell', 'beam',             BeamExtractor)

// Perl
register('Perl', 'dbix_class',          DbixClassExtractor)
register('Perl', 'rose_db',             RoseDbExtractor)
register('Perl', 'raw_dbi',             RawDbiExtractor)

// Clojure
register('Clojure', 'honeysql',         HoneySqlExtractor)
register('Clojure', 'next_jdbc',        NextJdbcExtractor)

// Dart
register('Dart', 'drift',               DriftExtractor)
register('Dart', 'isar',                IsarExtractor)

// R
register('R', 'dbi_dbplyr',             DbiDbplyrExtractor)

// Lua
register('Lua', 'luasql',               LuaSqlExtractor)
register('Lua', 'lsqlite3',             Lsqlite3Extractor)

// Cross-language (language key is 'cross-language')
register('cross-language', 'sql_ddl',           SqlDdlExtractor)
register('cross-language', 'migration_files',   MigrationFileExtractor)
register('cross-language', 'protobuf',          ProtobufExtractor)
register('cross-language', 'graphql_schema',    GraphqlExtractor)
register('cross-language', 'openapi',           OpenApiExtractor)

export function getExtractor(
  language: string,
  approach: string,
  ctx: ExtractorContext
): BaseExtractor | null {
  const cls = registry.get(`${language}:${approach}`)
  if (!cls) return null
  return new cls(ctx)
}
```

---

## Normalizer

`normalizer.ts` converts `RawEntity[]` to `EntityRecord[]`. Key responsibilities:

1. **Name normalization**: convert `UserAccount`, `user_account`, `UserAccountRecord` → `user_account` (snake_case). The original name is preserved in the `name` field; `normalizedName` holds the snake_case version.

2. **Type normalization**: map native types to a standard category:
   - `VARCHAR`, `TEXT`, `NVARCHAR`, `String`, `str`, `string`, `character varying` → `"string"`
   - `INT`, `INTEGER`, `BIGINT`, `int`, `Long`, `int64`, `serial`, `bigserial` → `"integer"`
   - `FLOAT`, `DOUBLE`, `DECIMAL`, `NUMERIC`, `REAL`, `float64` → `"decimal"`
   - `BOOLEAN`, `BOOL`, `bool`, `BIT(1)`, `tinyint(1)` → `"boolean"`
   - `TIMESTAMP`, `DATETIME`, `DATE`, `TIME`, `Time`, `datetime` → `"datetime"`
   - `JSONB`, `JSON`, `jsonb`, `json` → `"json"`
   - `BYTEA`, `BLOB`, `BINARY`, `bytes` → `"binary"`
   - `UUID`, `uuid` → `"uuid"`
   - Array types (`text[]`, `integer[]`, `Array<T>`) → `"array"`
   - Enum types → `"enum"`
   - Unknown → `"unknown"` (nativeType preserved)

3. **Entity type inference**: if not explicitly set by extractor, infer from context:
   - Prisma `model` → `"table"`
   - Prisma `view` → `"view"`
   - Mongoose `Schema` → `"collection"`
   - Protobuf `message` → `"document"`
   - GraphQL `type` → `"document"`
   - SQL `CREATE TABLE` → `"table"`
   - SQL `CREATE VIEW` → `"view"`
   - SQL `CREATE INDEX` → `"index"`
   - SQL `CREATE PROCEDURE` / `CREATE FUNCTION` → `"procedure"`

4. **Confidence inheritance**: entity confidence comes from the `DetectedApproach.confidence` of the approach that produced it, unless the extractor overrides it for a specific entity (e.g., a `CREATE TABLE` in a SQL DDL file is always `high` regardless of approach confidence because the source is unambiguous).

---

## Deduplicator

`deduplicator.ts` merges `EntityRecord[]` from multiple extractors into a final deduplicated list.

### Matching Strategy

Two entity records are considered the same entity if their `normalizedName` values match after:
1. Stripping common suffixes: `_record`, `_model`, `_entity`, `_schema`, `_table`
2. Handling known plural/singular forms (e.g., `user` vs `users`)

Matching is case-insensitive on `normalizedName`.

### Merge Rules

When two records are merged:
- **`name`**: prefer the name from the higher-confidence source; if equal, prefer the shorter/simpler name (avoid `UserAccountRecord` in favor of `UserAccount`)
- **`entityType`**: prefer the more specific type; `table` > `document` > `collection` > `unknown`
- **`confidence`**: take the maximum confidence of all merged sources
- **`primarySources`**: union of all source locations from all merged records
- **`fields`**: merge field lists by `normalizedName`; prefer the field definition with more information (non-null type, known nullability, etc.)
- **`relationships`**: union, deduplicating by `(targetEntityName, type, sourceField)`

### Output

The deduplicator returns the final `EntityRecord[]`, ready to be upserted into the database.

---

## Orchestrator

`index.ts` ties everything together:

```ts
// server/src/services/entityAnalysis/index.ts

export interface EntityAnalysisInput {
  repoId: number
  sourceDir: string
  repoFullName: string
  detectedLanguages: Array<{ language: string; bytes: number }>
  forceReanalysis?: boolean
}

export interface EntityAnalysisResult {
  approaches: DetectedApproach[]
  entities: EntityRecord[]
  stats: {
    approachesDetected: number
    extractorsRun: number
    rawEntitiesFound: number
    entitiesAfterDedup: number
    warnings: string[]
    totalTimeMs: number
  }
}

export async function analyzeEntities(input: EntityAnalysisInput): Promise<EntityAnalysisResult> {
  const start = Date.now()
  const allWarnings: string[] = []

  // Phase 1: detect approaches
  const approaches = await detectApproaches(input.sourceDir, input.detectedLanguages)

  // Phase 2: run extractors for medium+ confidence approaches
  // (low confidence approaches are skipped unless forceReanalysis is set)
  const runnable = approaches.filter(a => a.confidence !== 'low' || input.forceReanalysis)
  const allRawEntities: RawEntity[] = []

  const extractorResults = await Promise.allSettled(
    runnable.map(async (approach) => {
      const ctx: ExtractorContext = {
        sourceDir: input.sourceDir,
        approach,
        repoFullName: input.repoFullName,
      }
      const extractor = getExtractor(approach.language, approach.approach, ctx)
      if (!extractor) {
        allWarnings.push(`No extractor registered for ${approach.language}:${approach.approach}`)
        return
      }
      const result = await extractor.extract()
      allRawEntities.push(...result.entities)
      allWarnings.push(...result.warnings)
    })
  )

  // Collect errors from failed extractors (partial failure is non-fatal)
  for (const r of extractorResults) {
    if (r.status === 'rejected') {
      allWarnings.push(`Extractor failed: ${(r.reason as Error).message}`)
    }
  }

  // Phase 3: normalize + deduplicate
  const normalizedEntities = normalizeEntities(allRawEntities)
  const finalEntities = deduplicateEntities(normalizedEntities)

  return {
    approaches,
    entities: finalEntities,
    stats: {
      approachesDetected: approaches.length,
      extractorsRun: runnable.length,
      rawEntitiesFound: allRawEntities.length,
      entitiesAfterDedup: finalEntities.length,
      warnings: allWarnings,
      totalTimeMs: Date.now() - start,
    },
  }
}
```

Key design decisions:
- `Promise.allSettled` is used so a failure in one extractor does not abort the rest
- The orchestrator does not interact with the database — the job runner (`jobRunner.ts`) does that after receiving the `EntityAnalysisResult`
- The orchestrator is pure TypeScript with no DB dependencies, making it fully unit-testable in isolation
- Cross-language approaches always run regardless of detected language list
