# Entity Analysis — Overview

Inspector Pika is a code analysis tool that catalogs metadata about software repositories. The entity analysis feature extends this with the ability to **detect and catalog data entities** — tables, collections, documents, and other structured data objects — directly from a repository's source code, without requiring a running database or application build.

---

## Goal

Given a cloned source code repository, determine:

1. **Which data storage frameworks or patterns are in use** (ORM, raw SQL, document store, etc.)
2. **What named entities those frameworks define** — table names, collection names, document types, GraphQL types, Protobuf messages
3. **What fields each entity has** — names, types, nullability, key constraints, relationships

Results are stored in the database and surfaced in the Inspector Pika UI on the Repository page.

---

## Two-Phase Approach

### Phase 1: Detection

Before extracting entities, the system determines *which* extraction strategies apply to the repository. Running every extractor on every repo would be expensive and noisy. Instead, a lightweight **detector** scans the repo for signals — dependency file contents, file extensions, directory names, and code patterns — and produces a list of detected approaches with confidence scores.

Detection is fast (grep-based, no parsing) and runs over the cloned source directory.

**Output:** An array of `DetectedApproach` records, each identifying a language + framework/approach combination and a confidence level (`high`, `medium`, `low`).

See [entity-detection-plan.md](./entity-detection-plan.md) for the full detection signal table and confidence scoring rules.

### Phase 2: Extraction

For each detected approach with confidence >= `medium`, the system runs the corresponding **extractor**. Extractors range from simple regex/grep-based scanners (e.g., SQL DDL files) to structured AST walkers (e.g., Prisma schema parser, SQLAlchemy model scanner).

Each extractor produces a list of `RawEntity` objects with their fields and relationships. The raw results from all extractors are then **normalized** into a common `EntityRecord` format and **deduplicated** — if two extractors find the same entity (e.g., a Prisma schema and a SQL migration file both define a `users` table), they are merged into one record with multiple source locations.

See [entity-extractor-architecture.md](./entity-extractor-architecture.md) for the full module structure, interfaces, and extractor registry.

---

## Supported Languages

The entity analysis system covers the following 20 languages, plus a cross-language category that applies to any repository regardless of primary language:

| # | Language | Primary Detection Target(s) |
|---|----------|-----------------------------|
| 1 | Python | SQLAlchemy, Django ORM, Tortoise ORM, Peewee, raw SQL |
| 2 | JavaScript | Prisma, TypeORM, Sequelize, Mongoose, Knex, Drizzle ORM |
| 3 | TypeScript | Prisma, TypeORM, Drizzle ORM, MikroORM, Sequelize |
| 4 | Java | JPA/Hibernate, MyBatis, jOOQ, Spring Data JDBC |
| 5 | Kotlin | Exposed, JPA/Hibernate, Room (Android), Spring Data |
| 6 | Go | GORM, sqlx, ent, sqlc |
| 7 | Ruby | ActiveRecord (Rails), Sequel |
| 8 | PHP | Eloquent (Laravel), Doctrine, Propel |
| 9 | C# | Entity Framework Core, Dapper, NHibernate |
| 10 | Rust | Diesel, SeaORM, sqlx |
| 11 | Swift | Core Data, GRDB, Realm |
| 12 | Scala | Slick, Doobie, Quill |
| 13 | C++ | ODB ORM, Qt SQL, Wt::Dbo, SOCI, SQLiteCpp |
| 14 | Elixir | Ecto |
| 15 | Haskell | Persistent, Beam |
| 16 | Perl | DBIx::Class, Rose::DB::Object, DBI |
| 17 | Dart | Drift (Moor), Isar |
| 18 | R | DBI, dplyr (dbplyr) |
| 19 | Lua | LuaSQL, LSQLITE3 |
| 20 | Clojure | HoneySQL, next.jdbc, Korma |
| — | (cross-language) | Raw SQL DDL files, Protobuf `.proto`, OpenAPI specs, GraphQL schemas |

The cross-language category applies to any repo regardless of primary language, since SQL migration files, `.proto` files, and API specs can appear in any project.

---

## How Results Are Stored

The results of entity analysis are stored in four new PostgreSQL tables added to the Inspector Pika schema:

| Table | Purpose |
|-------|---------|
| `repo_entity_approaches` | One row per detected approach per repo (output of Phase 1) |
| `repo_entities` | One row per distinct entity (table/collection/document) |
| `repo_entity_fields` | One row per field/column of each entity |
| `repo_entity_relationships` | One row per directional relationship between entities |

The deduplication strategy ensures that the same logical entity found by multiple extractors produces only **one** `repo_entities` row, with the `primarySources` JSONB field listing all source locations that contributed to the record.

See [entity-database-schema-plan.md](./entity-database-schema-plan.md) for the full Drizzle ORM schema definitions.

---

## How Results Are Displayed

Entity analysis results appear on the **Repository page** in the Inspector Pika UI, in a new "Data Entities" section positioned after the Languages section and before the Detected Packages section.

Key UI elements:

- **Approach badges** — compact tags showing each detected framework (e.g., `Prisma`, `Django ORM`, `SQL DDL`) with a color-coded confidence dot
- **Entity table** — sortable/filterable list of entities with name, type, field count, source approach, and confidence
- **Expandable field panel** — clicking an entity row reveals its fields with types, nullability, and PK/FK indicators
- **Job trigger button** — integrated with the existing "Start A Job" menu as "Detect Data Entities"

The UI follows the same inline-styles React pattern used in the existing `RepositoryPage.tsx`, matching the visual design of the Languages and Packages sections.

See [entity-ui-plan.md](./entity-ui-plan.md) for the full component hierarchy and state management plan.

---

## How the Job Is Triggered

Entity analysis runs as a new job type: `analyze_entities`. It follows the same pattern as the existing `analyze_languages` and `analyze_dependencies` jobs:

1. A `POST /api/v1/jobs` call creates the job record with `status: 'pending'`
2. `jobRunner.ts` picks it up asynchronously and calls `runAnalyzeEntities()`
3. The job updates the DB with results and sets `status: 'completed'` or `'failed'`

The job requires the repository to already be cloned (it reuses `cloneOrUpdate` from `ortAnalyzer.ts`). It also requires `repoLanguages` to be populated for best results; the `analyze_languages` job should run first, though it is not a hard prerequisite — cross-language approaches (SQL DDL, Protobuf, OpenAPI, GraphQL) will fire regardless.

See [entity-job-plan.md](./entity-job-plan.md) for the full job execution flow, API additions, and error handling plan.

---

## Related Documents

| Document | Description |
|----------|-------------|
| [entity-detection-plan.md](./entity-detection-plan.md) | Phase 1: signal tables, confidence scoring, detection module design |
| [entity-extractor-architecture.md](./entity-extractor-architecture.md) | Phase 2: extractor module structure, interfaces, registry |
| [entity-database-schema-plan.md](./entity-database-schema-plan.md) | New Drizzle ORM schema tables and index definitions |
| [entity-job-plan.md](./entity-job-plan.md) | `analyze_entities` job type: flow, API endpoints, error handling |
| [entity-ui-plan.md](./entity-ui-plan.md) | React component hierarchy and UI state plan |
| [languages/python/data-entity-storage-methods.md](./languages/python/data-entity-storage-methods.md) | Detailed Python framework inventory |
| [languages/javascript/data-entity-storage-methods.md](./languages/javascript/data-entity-storage-methods.md) | Detailed JavaScript framework inventory |
| [languages/typescript/data-entity-storage-methods.md](./languages/typescript/data-entity-storage-methods.md) | Detailed TypeScript framework inventory |
| [languages/java/data-entity-storage-methods.md](./languages/java/data-entity-storage-methods.md) | Detailed Java framework inventory |
| [languages/kotlin/data-entity-storage-methods.md](./languages/kotlin/data-entity-storage-methods.md) | Detailed Kotlin framework inventory |
| [languages/go/data-entity-storage-methods.md](./languages/go/data-entity-storage-methods.md) | Detailed Go framework inventory |
| [languages/ruby/data-entity-storage-methods.md](./languages/ruby/data-entity-storage-methods.md) | Detailed Ruby framework inventory |
| [languages/php/data-entity-storage-methods.md](./languages/php/data-entity-storage-methods.md) | Detailed PHP framework inventory |
| [languages/csharp/data-entity-storage-methods.md](./languages/csharp/data-entity-storage-methods.md) | Detailed C# framework inventory |
| [languages/rust/data-entity-storage-methods.md](./languages/rust/data-entity-storage-methods.md) | Detailed Rust framework inventory |
| [languages/swift/data-entity-storage-methods.md](./languages/swift/data-entity-storage-methods.md) | Detailed Swift framework inventory |
| [languages/scala/data-entity-storage-methods.md](./languages/scala/data-entity-storage-methods.md) | Detailed Scala framework inventory |
| [languages/cpp/data-entity-storage-methods.md](./languages/cpp/data-entity-storage-methods.md) | Detailed C++ framework inventory |
| [languages/haskell/data-entity-storage-methods.md](./languages/haskell/data-entity-storage-methods.md) | Detailed Haskell framework inventory |
| [languages/perl/data-entity-storage-methods.md](./languages/perl/data-entity-storage-methods.md) | Detailed Perl framework inventory |
| [languages/dart/data-entity-storage-methods.md](./languages/dart/data-entity-storage-methods.md) | Detailed Dart framework inventory |
| [languages/r/data-entity-storage-methods.md](./languages/r/data-entity-storage-methods.md) | Detailed R framework inventory |
| [languages/lua/data-entity-storage-methods.md](./languages/lua/data-entity-storage-methods.md) | Detailed Lua framework inventory |
