# Entity Detection Plan — Phase 1

This document describes how Inspector Pika determines which data entity storage frameworks are present in a cloned repository. This is Phase 1 of the entity analysis pipeline. Phase 2 (extraction) is described in [entity-extractor-architecture.md](./entity-extractor-architecture.md).

---

## Overview

Phase 1 detection is a **lightweight, fast scan** that runs before any expensive parsing. It answers the question: "Which extractors should we run?"

Detection avoids spawning language runtimes or build tools. It works entirely by:
- Reading known dependency manifest files
- Globbing for file extensions and directory names
- Running grep patterns over source files

The output is an array of `DetectedApproach` objects, each with a language, approach identifier, confidence level, and the list of signals that triggered the detection.

---

## Step 1: Language Identification

Language detection is **already complete** by the time `analyze_entities` runs. The `repoLanguages` table is populated by the `analyze_languages` job (which runs `enry`). The entity detection step reads from this table at the start of execution.

```ts
// In runAnalyzeEntities():
const languages = await db
  .select()
  .from(repoLanguages)
  .where(eq(repoLanguages.repoId, input.repoId))
  .orderBy(desc(repoLanguages.bytes))
```

This drives which per-language detection modules are invoked. A language that contributes less than 0.5% of the codebase bytes is still checked if it appears in the list, but low-byte-share languages are noted in the detection output.

Cross-language approaches (raw SQL files, Protobuf, OpenAPI, GraphQL) are always checked regardless of detected languages.

---

## Step 2: Per-Language Signal Checks

For each language present in `repoLanguages`, the detector runs a set of signal checks. Signals are grouped into three tiers:

- **Tier A — Dependency file match**: The framework appears as a named dependency in a package manifest. This is the strongest single signal because it is explicit and intentional.
- **Tier B — File/directory pattern match**: Known framework-specific files or directory structures exist in the repo (e.g., `prisma/schema.prisma`, `db/migrate/`).
- **Tier C — Code pattern match**: A grep over source files finds an import, annotation, or usage pattern specific to the framework (e.g., `from django.db import models`).

Signals are checked in parallel using `Promise.all` over a set of async file checks.

---

## Step 3: Confidence Scoring

Each detected approach receives a confidence score based on how many signal tiers confirmed it:

| Signals Present | Confidence |
|-----------------|-----------|
| Tier A only | `medium` |
| Tier B only | `low` |
| Tier C only | `low` |
| Tier A + Tier B | `high` |
| Tier A + Tier C | `high` |
| Tier B + Tier C | `medium` |
| All three tiers | `high` |

A `low` confidence detection is still written to `repoEntityApproaches` but extractors are not run for it unless `forceReanalysis: true` is passed with the low-confidence override option.

---

## Step 4: Output Format

The detector outputs an array of `DetectedApproach` objects:

```ts
interface DetectedApproach {
  language: string           // e.g. "Python", "TypeScript", "Java", or "cross-language"
  approach: string           // e.g. "django_orm", "prisma", "jpa_hibernate", "sql_ddl"
  confidence: 'high' | 'medium' | 'low'
  signals: string[]          // human-readable description of each matched signal
}
```

Example output for a Django + PostgreSQL project:

```json
[
  {
    "language": "Python",
    "approach": "django_orm",
    "confidence": "high",
    "signals": [
      "Tier A: 'Django' found in requirements.txt",
      "Tier B: app/models.py files found (3 files)",
      "Tier C: 'from django.db import models' found in src/users/models.py"
    ]
  },
  {
    "language": "cross-language",
    "approach": "sql_ddl",
    "confidence": "medium",
    "signals": [
      "Tier B: 4 .sql files found in migrations/ directory"
    ]
  }
]
```

---

## Step 5: Implementation Approach

The detector is implemented as `server/src/services/entityAnalysis/detector.ts`.

```ts
export async function detectApproaches(
  sourceDir: string,
  languages: Array<{ language: string; bytes: number }>
): Promise<DetectedApproach[]>
```

Internally it delegates to per-language detector functions:

```ts
const detectorMap: Record<string, LanguageDetector> = {
  'Python':      detectPythonApproaches,
  'JavaScript':  detectJavaScriptApproaches,
  'TypeScript':  detectTypeScriptApproaches,
  'Java':        detectJavaApproaches,
  'Kotlin':      detectKotlinApproaches,
  'Go':          detectGoApproaches,
  'Ruby':        detectRubyApproaches,
  'PHP':         detectPhpApproaches,
  'C#':          detectCSharpApproaches,
  'Rust':        detectRustApproaches,
  'Swift':       detectSwiftApproaches,
  'Scala':       detectScalaApproaches,
  'C++':         detectCppApproaches,
  'Elixir':      detectElixirApproaches,
  'Haskell':     detectHaskellApproaches,
  'Perl':        detectPerlApproaches,
  'Clojure':     detectClojureApproaches,
  'Dart':        detectDartApproaches,
  'R':           detectRApproaches,
  'Lua':         detectLuaApproaches,
}
```

Cross-language detection always runs, regardless of detected languages:

```ts
const crossLanguageResults = await detectCrossLanguageApproaches(sourceDir)
```

Each per-language detector function returns `DetectedApproach[]` and is independently unit-testable.

Helper utilities used internally:

```ts
// Check if a file exists and optionally grep for a pattern within it
async function fileContains(filePath: string, pattern: RegExp): Promise<boolean>

// Glob for files matching a pattern and return count + paths
async function globCount(sourceDir: string, pattern: string): Promise<{ count: number; paths: string[] }>

// Grep recursively in a directory for a pattern, return first N matches
async function grepFirst(sourceDir: string, fileGlob: string, pattern: RegExp, limit?: number): Promise<string[]>
```

---

## Detection Signal Tables

### Python

| Approach | Tier A: Dependency File | Key Package Names | Tier B: File Patterns | Tier C: Code Patterns |
|----------|------------------------|-------------------|-----------------------|-----------------------|
| `django_orm` | `requirements*.txt`, `Pipfile`, `pyproject.toml` | `Django`, `django` | `*/models.py`, `*/models/*.py` | `from django.db import models`, `models.Model` |
| `sqlalchemy` | same | `SQLAlchemy`, `sqlalchemy`, `alembic` | `*/models.py`, `alembic/` | `from sqlalchemy`, `declarative_base()`, `Column(` |
| `tortoise_orm` | same | `tortoise-orm`, `tortoise` | `*/models.py` | `from tortoise import`, `tortoise.fields` |
| `peewee` | same | `peewee` | any `.py` | `from peewee import`, `peewee.Model` |
| `raw_sql_python` | same | `psycopg2`, `psycopg`, `pymysql`, `sqlite3` | — | `cursor.execute(`, `connection.execute(` |

### JavaScript

| Approach | Tier A: Dependency File | Key Package Names | Tier B: File Patterns | Tier C: Code Patterns |
|----------|------------------------|-------------------|-----------------------|-----------------------|
| `prisma` | `package.json` | `@prisma/client`, `prisma` | `prisma/schema.prisma`, `*.prisma` | `model ` in `.prisma` files |
| `typeorm` | `package.json` | `typeorm` | `**/entity/*.ts`, `**/entities/*.ts` | `@Entity()`, `@Column(`, `@PrimaryGeneratedColumn(` |
| `sequelize` | `package.json` | `sequelize` | `**/models/*.js` | `sequelize.define(`, `DataTypes.`, `Model.init(` |
| `mongoose` | `package.json` | `mongoose` | `**/models/*.js`, `**/schemas/*.js` | `mongoose.Schema(`, `new Schema({`, `mongoose.model(` |
| `knex` | `package.json` | `knex` | `knexfile.js`, `knexfile.ts`, `**/migrations/*.js` | `knex.schema.createTable(`, `table.increments(` |
| `drizzle_orm` | `package.json` | `drizzle-orm`, `drizzle-kit` | `**/schema.ts`, `**/db/schema.ts` | `pgTable(`, `mysqlTable(`, `sqliteTable(` |

### TypeScript

Shares all entries from JavaScript (package.json detection applies to both). Additional TypeScript-specific signals:

| Approach | Tier A: Dependency File | Key Package Names | Tier B: File Patterns | Tier C: Code Patterns |
|----------|------------------------|-------------------|-----------------------|-----------------------|
| `prisma` | `package.json` | `@prisma/client`, `prisma` | `prisma/schema.prisma` | `model ` in `.prisma`, `@id`, `@relation` |
| `typeorm` | `package.json` | `typeorm` | `**/entity/*.ts` | `@Entity()`, `@Column(`, `@ManyToOne(` |
| `drizzle_orm` | `package.json` | `drizzle-orm` | `**/schema.ts` | `pgTable(`, `integer(`, `text(`, `.references(` |
| `mikro_orm` | `package.json` | `@mikro-orm/core` | `**/entities/*.ts` | `@Entity()`, `@Property()`, `@ManyToOne(` |

### Java

| Approach | Tier A: Dependency File | Key Package Names | Tier B: File Patterns | Tier C: Code Patterns |
|----------|------------------------|-------------------|-----------------------|-----------------------|
| `jpa_hibernate` | `pom.xml`, `build.gradle`, `build.gradle.kts` | `hibernate-core`, `spring-data-jpa`, `jakarta.persistence-api`, `javax.persistence-api` | `**/entity/*.java`, `**/model/*.java` | `@Entity`, `@Table(`, `@Column(`, `@Id` |
| `mybatis` | same | `mybatis`, `mybatis-spring` | `**/mapper/*.java`, `**/mapper/*.xml`, `resources/**/*.xml` | `@Mapper`, `@Select(`, `@Insert(`, `<mapper namespace=` |
| `jooq` | same | `jooq`, `org.jooq` | `**/generated/jooq/`, `jooq.xml` | `DSL.using(`, `create.selectFrom(`, `Tables.` |
| `spring_data_jdbc` | same | `spring-data-jdbc` | `**/repository/*.java` | `@Table`, `@Column`, `CrudRepository` |

### Kotlin

| Approach | Tier A: Dependency File | Key Package Names | Tier B: File Patterns | Tier C: Code Patterns |
|----------|------------------------|-------------------|-----------------------|-----------------------|
| `jpa_hibernate` | `pom.xml`, `build.gradle.kts` | `hibernate-core`, `spring-data-jpa` | `**/entity/*.kt`, `**/model/*.kt` | `@Entity`, `@Table(`, `@Column(` |
| `exposed` | same | `org.jetbrains.exposed:exposed-core` | `**/tables/*.kt` | `object ... : Table(`, `IntTable`, `LongTable` |
| `room` | `build.gradle`, `build.gradle.kts` | `androidx.room:room-runtime` | `**/database/*.kt`, `**/dao/*.kt` | `@Entity`, `@Dao`, `@Database(`, `@PrimaryKey` |

### Go

| Approach | Tier A: Dependency File | Key Package Names | Tier B: File Patterns | Tier C: Code Patterns |
|----------|------------------------|-------------------|-----------------------|-----------------------|
| `gorm` | `go.mod` | `gorm.io/gorm` | `**/models/*.go`, `**/model/*.go` | `gorm.Model`, `` `gorm:"` ``, `db.AutoMigrate(` |
| `sqlx` | `go.mod` | `github.com/jmoiron/sqlx` | any `.go` | `sqlx.Connect(`, `sqlx.DB`, `db.NamedExec(` |
| `ent` | `go.mod` | `entgo.io/ent` | `ent/schema/*.go`, `ent/generate.go` | `entc.Generate(`, `ent.Schema` |
| `sqlc` | `go.mod` | `github.com/sqlc-dev/sqlc` | `sqlc.yaml`, `sqlc.yml`, `*.sql` in queries dir | `-- name:` in `.sql` files |

### Ruby

| Approach | Tier A: Dependency File | Key Package Names | Tier B: File Patterns | Tier C: Code Patterns |
|----------|------------------------|-------------------|-----------------------|-----------------------|
| `activerecord` | `Gemfile` | `rails`, `activerecord` | `db/schema.rb`, `db/migrate/*.rb`, `app/models/*.rb` | `ActiveRecord::Base`, `< ApplicationRecord`, `create_table ` |
| `sequel` | `Gemfile` | `sequel` | any `.rb` | `Sequel::Model(`, `DB.create_table(`, `Sequel.connect(` |

### PHP

| Approach | Tier A: Dependency File | Key Package Names | Tier B: File Patterns | Tier C: Code Patterns |
|----------|------------------------|-------------------|-----------------------|-----------------------|
| `eloquent` | `composer.json` | `laravel/framework`, `illuminate/database` | `app/Models/*.php`, `database/migrations/*.php` | `extends Model`, `Schema::create(`, `$table->` |
| `doctrine` | `composer.json` | `doctrine/orm`, `doctrine/dbal` | `src/Entity/*.php`, `config/doctrine/` | `@Entity`, `@Table(`, `@Column(`, `@ORM\Entity` |
| `propel` | `composer.json` | `propel/propel` | `schema.xml`, `propel.xml` | `<table name=` in schema XML |

### C# (.NET)

| Approach | Tier A: Dependency File | Key Package Names | Tier B: File Patterns | Tier C: Code Patterns |
|----------|------------------------|-------------------|-----------------------|-----------------------|
| `ef_core` | `*.csproj`, `*.fsproj`, `packages.config` | `Microsoft.EntityFrameworkCore`, `Pomelo.EntityFrameworkCore.MySql` | `**/Migrations/*.cs`, `*Context.cs` | `DbContext`, `DbSet<`, `[Table(`, `modelBuilder.Entity<` |
| `dapper` | same | `Dapper` | any `.cs` | `connection.Query<`, `connection.Execute(`, `QueryAsync<` |
| `nhibernate` | same | `NHibernate` | `**/*.hbm.xml`, `**/Mappings/*.cs` | `<class name=`, `ISession`, `session.Save(` |

### Rust

| Approach | Tier A: Dependency File | Key Package Names | Tier B: File Patterns | Tier C: Code Patterns |
|----------|------------------------|-------------------|-----------------------|-----------------------|
| `diesel` | `Cargo.toml` | `diesel` | `diesel.toml`, `migrations/**/*.sql`, `src/schema.rs` | `#[derive(Queryable)]`, `table!`, `diesel::table!` |
| `sea_orm` | `Cargo.toml` | `sea-orm` | `entity/*.rs`, `migration/*.rs` | `#[derive(DeriveEntityModel)]`, `DeriveActiveModel` |
| `sqlx` | `Cargo.toml` | `sqlx` | any `.rs` | `sqlx::query!(`, `sqlx::query_as!(`, `FromRow` |

### Swift

| Approach | Tier A: Dependency File | Key Package Names | Tier B: File Patterns | Tier C: Code Patterns |
|----------|------------------------|-------------------|-----------------------|-----------------------|
| `core_data` | `*.xcodeproj`, `Package.swift` | `CoreData` (framework) | `*.xcdatamodeld`, `*.xcdatamodel` | `NSManagedObject`, `@NSManaged`, `NSEntityDescription` |
| `grdb` | `Package.swift`, `Podfile` | `GRDB.swift` | any `.swift` | `DatabaseQueue(`, `record.insert(`, `struct ... : Record` |
| `realm` | `Package.swift`, `Podfile` | `RealmSwift` | any `.swift` | `class ... : Object`, `@Persisted`, `Realm()` |

### Scala

| Approach | Tier A: Dependency File | Key Package Names | Tier B: File Patterns | Tier C: Code Patterns |
|----------|------------------------|-------------------|-----------------------|-----------------------|
| `slick` | `build.sbt` | `com.typesafe.slick` | `**/Tables.scala`, `**/schema/*.scala` | `TableQuery[`, `class ... extends Table[`, `def * =` |
| `doobie` | `build.sbt` | `org.tpolecat:doobie-core` | any `.scala` | `sql"`, `fr"SELECT`, `Query0[`, `Update0[` |

### C++

See [languages/cpp/data-entity-storage-methods.md](./languages/cpp/data-entity-storage-methods.md) for the full C++ signal table. Summary:

| Approach | Tier A | Tier B | Tier C |
|----------|--------|--------|--------|
| `odb_orm` | `vcpkg.json`: `odb` / `CMakeLists.txt`: `find_package(ODB` | `*-odb.hxx`, `*-odb.cxx` files | `#pragma db object` |
| `qt_sql` | `CMakeLists.txt`: `Qt5::Sql` / `.pro`: `QT += sql` | `.pro` files | `#include <QSqlTableModel>`, `.setTable(` |
| `wt_dbo` | `CMakeLists.txt`: `wtdbo` | — | `#include <Wt/Dbo/Dbo.h>`, `dbo::field(` |
| `soci` | `vcpkg.json`: `soci` / `CMakeLists.txt`: `find_package(SOCI` | — | `#include <soci/soci.h>` |
| `sqlitecpp` | `vcpkg.json`: `sqlitecpp` | — | `#include <SQLiteCpp/SQLiteCpp.h>` |

### Elixir

| Approach | Tier A | Tier B | Tier C |
|----------|--------|--------|--------|
| `ecto` | `mix.exs`: `{:ecto_sql,`, `{:ecto,` | `priv/repo/migrations/*.exs`, `lib/*/repo.ex` | `use Ecto.Schema`, `schema "`, `field :`, `Ecto.Repo` |

### Haskell

| Approach | Tier A | Tier B | Tier C |
|----------|--------|--------|--------|
| `persistent` | `*.cabal`, `package.yaml`: `persistent`, `persistent-postgresql` | `config/models`, `config/models.persistentmodels` | `share [mkPersist`, `[persistLowerCase|` |
| `beam` | same | — | `import Database.Beam`, `data ... = ... deriving (Generic, Beamable)` |

### Perl

See [languages/perl/data-entity-storage-methods.md](./languages/perl/data-entity-storage-methods.md) for the full Perl signal table. Summary:

| Approach | Tier A | Tier B | Tier C |
|----------|--------|--------|--------|
| `dbix_class` | `Makefile.PL`, `cpanfile`, `dist.ini`: `DBIx::Class` | `lib/*/Schema/*.pm`, `lib/*/Result/*.pm` | `use base 'DBIx::Class::Core'`, `__PACKAGE__->table(` |
| `rose_db` | same | — | `use Rose::DB::Object`, `__PACKAGE__->meta->table(` |
| `raw_dbi` | same | — | `use DBI`, `$dbh->prepare(`, `$dbh->do(` |

### Clojure

| Approach | Tier A | Tier B | Tier C |
|----------|--------|--------|--------|
| `honeysql` | `project.clj`, `deps.edn`: `com.github.seancorfield/honeysql` | — | `(sql/format {`, `(honey.sql/format` |
| `next_jdbc` | same | — | `(jdbc/execute!`, `(next.jdbc/execute!` |

### Dart

| Approach | Tier A | Tier B | Tier C |
|----------|--------|--------|--------|
| `drift` | `pubspec.yaml`: `drift`, `moor` | `*.drift`, `*.moor` files | `@DriftDatabase(`, `class ... extends Table`, `TextColumn get` |
| `isar` | `pubspec.yaml`: `isar`, `isar_core` | — | `@collection`, `@IsarId`, `@Name(` |

### R

| Approach | Tier A | Tier B | Tier C |
|----------|--------|--------|--------|
| `dbi_dbplyr` | `DESCRIPTION`, `renv.lock`: `DBI`, `dbplyr` | — | `dbConnect(`, `tbl(con,`, `dbWriteTable(` |

### Lua

| Approach | Tier A | Tier B | Tier C |
|----------|--------|--------|--------|
| `luasql` | `*.rockspec`: `luasql-*` | — | `require "luasql.*"`, `env:connect(`, `conn:execute(` |
| `lsqlite3` | same | — | `require "lsqlite3"`, `sqlite3.open(` |

### Cross-Language (always checked)

| Approach | Tier B: File Patterns | Tier C: Code Patterns |
|----------|-----------------------|-----------------------|
| `sql_ddl` | `*.sql`, dirs: `migrations/`, `db/`, `schema/`, `sql/` | `CREATE TABLE`, `CREATE TABLE IF NOT EXISTS` |
| `protobuf` | `*.proto` | `message ` in `.proto` files |
| `graphql_schema` | `*.graphql`, `*.graphqls`, `schema.graphql` | `type ` with `{`, `schema {` |
| `openapi` | `openapi.yaml`, `openapi.json`, `swagger.yaml`, `swagger.json`, `api-spec.yaml` | `openapi:`, `swagger:`, `paths:` |

---

## Step 6: Edge Cases

### Polyglot Repositories

Many repos mix languages. The detector handles this naturally — it runs all applicable per-language detectors based on the `repoLanguages` results. Each language can produce independent detections. The job may end up running 3–5 extractors on a polyglot monorepo.

### Generated Code

Some frameworks generate code that looks like entity definitions but is not the source of truth. Examples:
- ODB generates `*-odb.hxx` files from annotated headers — scan the originals, not the generated output
- Prisma generates `@prisma/client` TypeScript — scan `schema.prisma`, not the client
- JPA may have generated classes from XML mappings
- jOOQ generates Java classes from the live database — scan `jooq.xml` config and SQL DDL instead

Mitigation: generated file directories (`generated/`, `gen/`, `build/`, `dist/`, `node_modules/`, `.gradle/`) are excluded from Tier C code pattern scans. Tier B file pattern matches in `generated/` directories reduce confidence to `low`.

### Vendored Dependencies

Some repos vendor their dependencies (Go modules, C++ header-only libs, git submodules). A package name match in a vendored directory (e.g., `vendor/gorm.io/gorm/`) should count as Tier B (the package is present) but not Tier A (it is not a declared dependency in the manifest), and should not contribute Tier C signals.

Directories to exclude from Tier C: `vendor/`, `node_modules/`, `third_party/`, `extern/`, `deps/`, `_vendor/`, `.git/`.

### Monorepos

In a monorepo, different subdirectories may be separate services with different frameworks. The detector does not currently split by subdirectory — it reports all detected approaches at the repo level. The `signals` array will include file paths, allowing a human to see which subdirectory each signal came from.

Future enhancement: group signals by subdirectory root and emit per-service `DetectedApproach` records.

### Confidence Floors

If a repo has a `package.json` listing `typeorm` but zero TypeScript or JavaScript source files matching `@Entity`, the approach is still emitted at `medium` confidence. The Tier A signal is enough to warrant running the extractor, which can then fail gracefully if it finds nothing.

### False Positives in Test Fixtures

SQL DDL patterns (`CREATE TABLE`) may appear in test fixture files that are not schema definitions. The cross-language `sql_ddl` extractor mitigates this by excluding paths matching `*/seed/*`, `*/fixtures/*`, `*/testdata/*` and files whose entire content is `INSERT INTO` statements with no `CREATE TABLE`.
