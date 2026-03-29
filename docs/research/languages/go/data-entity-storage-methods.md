# Go: Data Entity Storage Methods

A comprehensive catalog of Go frameworks, libraries, and approaches for data entity storage, aimed at supporting automated static analysis to extract database tables, document collections, and other named data entities from Go repositories.

---

## Table of Contents

1. [GORM](#1-gorm)
2. [Ent](#2-ent)
3. [sqlx](#3-sqlx)
4. [database/sql (stdlib)](#4-databasesql-stdlib)
5. [pgx](#5-pgx)
6. [go-pg / bun (go-pg v10+)](#6-go-pg--bun-go-pg-v10)
7. [sqlc](#7-sqlc)
8. [Bun ORM](#8-bun-orm)
9. [xorm](#9-xorm)
10. [SQLBoiler](#10-sqlboiler)
11. [golang-migrate](#11-golang-migrate)
12. [Goose](#12-goose)
13. [Atlas](#13-atlas)
14. [go-redis](#14-go-redis)
15. [mongo-driver](#15-mongo-driver)
16. [Elasticsearch Go Client](#16-elasticsearch-go-client)
17. [DynamoDB (aws-sdk-go / aws-sdk-go-v2)](#17-dynamodb-aws-sdk-go--aws-sdk-go-v2)
18. [Firebase / Firestore Go SDK](#18-firebase--firestore-go-sdk)
19. [Protobuf (protoc-gen-go)](#19-protobuf-protoc-gen-go)
20. [Struct Definitions with json / db / bson Tags (Generic Signal)](#20-struct-definitions-with-json--db--bson-tags-generic-signal)
21. [OpenAPI-Generated Models](#21-openapi-generated-models)
22. [Repository Detection Plan](#repository-detection-plan)

---

## 1. GORM

- **Name**: GORM
- **Type**: Relational ORM
- **Supported Databases**: PostgreSQL, MySQL, SQLite, SQL Server, TiDB (via plugins)
- **Detection Signals**:
  - `go.mod` dependency: `gorm.io/gorm`, `gorm.io/driver/postgres`, `gorm.io/driver/mysql`, `gorm.io/driver/sqlite`, `gorm.io/driver/sqlserver`, or legacy `github.com/jinzhu/gorm`
  - Import paths: `"gorm.io/gorm"`, `"github.com/jinzhu/gorm"`
  - Struct tags: `` `gorm:"..."` `` containing `column:`, `table:`, `primaryKey`, `autoIncrement`, `index:`, `uniqueIndex:`, `not null`, `default:`
  - Call patterns: `db.AutoMigrate(&Model{})`, `db.Table("name")`, `db.Model(&Model{})`
  - Convention: model structs embed `gorm.Model` or have an `ID` field with `gorm:"primarykey"`
- **Entity Definition Style**:
  - Go structs with `gorm` struct tags. Table name is pluralized snake_case of struct name by default, or overridden by implementing `TableName() string` method.
  - Example:
    ```go
    type User struct {
        gorm.Model
        Name  string `gorm:"column:name;not null"`
        Email string `gorm:"uniqueIndex"`
    }
    func (User) TableName() string { return "users" }
    ```
- **Extraction Approach**:
  1. Detect `gorm.io/gorm` in `go.mod`.
  2. Parse all `.go` files using `go/ast` or tree-sitter Go grammar.
  3. Find all struct declarations containing fields with `` `gorm:"..."` `` tags, or embedding `gorm.Model`.
  4. For each such struct:
     a. Check for a `TableName() string` method — use its return value literal as the table name.
     b. If absent, apply GORM's default: plural snake_case of the struct name (e.g., `UserProfile` → `user_profiles`).
  5. Extract column names from `gorm:"column:X"` tags; fall back to snake_case field names.
  6. Scan for `db.AutoMigrate(...)` calls to confirm which models are actively migrated.
  7. Scan for `db.Table("literal_name")` calls to catch ad-hoc table references.
- **Key Challenges**:
  - Dynamic table names via `db.Table(variable)` cannot be resolved statically.
  - Polymorphic associations reference table names at runtime.
  - Model structs may live in generated or vendored directories — filter accordingly.
  - `TableName()` may return a value from a config or constant; resolve simple constant references.
  - Embedded structs can contribute additional columns — recurse into embedded types.
- **Analysis Tools**: `go/ast`, `go/parser`, `go/token` (stdlib); tree-sitter Go grammar; custom tag parser for struct field tags.
- **Complexity**: Medium

---

## 2. Ent

- **Name**: Ent
- **Type**: Relational ORM / Code Generation Framework
- **Supported Databases**: PostgreSQL, MySQL, MariaDB, SQLite, TiDB, CockroachDB, Amazon Neptune (graph)
- **Detection Signals**:
  - `go.mod` dependency: `entgo.io/ent`
  - Directory convention: `ent/schema/` directory containing schema files
  - Import paths: `"entgo.io/ent"`, `"entgo.io/ent/schema/field"`, `"entgo.io/ent/schema/edge"`
  - Struct pattern: types implementing `ent.Schema` interface with `Fields()` and `Edges()` methods
  - Generated code in `ent/` directory: `ent/user.go`, `ent/schema/user.go`, `ent/migrate/schema.go`
  - Config file: `entc.go` or `generate.go` with `//go:generate go run entgo.io/ent/cmd/ent generate`
- **Entity Definition Style**:
  - Schema structs in `ent/schema/` that implement `ent.Schema`. Entity name is the struct name; table name defaults to snake_case plural.
  - Example:
    ```go
    // ent/schema/user.go
    type User struct { ent.Schema }
    func (User) Fields() []ent.Field {
        return []ent.Field{
            field.String("name"),
            field.Time("created_at"),
        }
    }
    func (User) Edges() []ent.Edge {
        return []ent.Edge{
            edge.To("pets", Pet.Type),
        }
    }
    ```
- **Extraction Approach**:
  1. Detect `entgo.io/ent` in `go.mod`.
  2. Locate the `ent/schema/` directory.
  3. Parse each `.go` file in that directory.
  4. Find struct types embedding `ent.Schema` — each is an entity.
  5. Parse the `Fields()` method body to extract `field.String("name")`, `field.Int("age")`, etc. — the first string argument is the field/column name.
  6. Check for `func (T) Annotations() []schema.Annotation` with `entsql.Annotation{Table: "override_name"}` to find table name overrides.
  7. Apply default: snake_case plural of struct name if no annotation.
  8. Also scan `ent/migrate/schema.go` (generated) for `MigrateTable` structs as a secondary source of truth.
- **Key Challenges**:
  - Generated files in `ent/` can be voluminous; prefer schema files in `ent/schema/` as the source.
  - `entsql.Annotation` for table name override requires annotation parsing.
  - Edge tables (join tables for M2M) are generated automatically — names follow `<from>_<to>` convention.
- **Analysis Tools**: `go/ast`, `go/parser`; tree-sitter Go grammar; direct directory traversal for `ent/schema/`.
- **Complexity**: Low (schema files are highly structured)

---

## 3. sqlx

- **Name**: sqlx
- **Type**: SQL Extension / Struct Mapper
- **Supported Databases**: PostgreSQL, MySQL, SQLite, any `database/sql`-compatible driver
- **Detection Signals**:
  - `go.mod` dependency: `github.com/jmoiron/sqlx`
  - Import paths: `"github.com/jmoiron/sqlx"`
  - Struct tags: `` `db:"column_name"` ``
  - Call patterns: `sqlx.Get`, `sqlx.Select`, `sqlx.NamedExec`, `db.StructScan`, `db.QueryRowx`
  - Raw SQL strings as arguments to query functions
- **Entity Definition Style**:
  - Plain Go structs with `db` struct tags mapping fields to column names. No macro-level table definition; tables are referenced in raw SQL strings.
  - Example:
    ```go
    type User struct {
        ID    int    `db:"id"`
        Name  string `db:"name"`
        Email string `db:"email"`
    }
    // Table name appears in SQL:
    rows, _ := db.Queryx("SELECT * FROM users WHERE id=$1", id)
    ```
- **Extraction Approach**:
  1. Detect `github.com/jmoiron/sqlx` in `go.mod`.
  2. Find all structs with `db` tags — these are likely row-mapping entities.
  3. Extract SQL string literals passed to `db.Queryx(...)`, `db.NamedExec(...)`, `db.Get(...)`, `db.Select(...)`, etc.
  4. Apply SQL parsing (regex or a SQL parser library) to extract table names from `FROM`, `JOIN`, `INTO`, `UPDATE`, `CREATE TABLE` clauses.
  5. Correlate struct names with table names by matching `db` tag column names against parsed SQL columns.
- **Key Challenges**:
  - SQL strings can be multi-line raw literals, template strings, or built dynamically — static extraction is best-effort.
  - Table names in SQL may be schema-qualified (`public.users`).
  - Struct-to-table mapping is implicit; no direct annotation.
- **Analysis Tools**: `go/ast`; regex SQL parser; `vitess-go/vt/sqlparser` or `xwb1989/sqlparser` for SQL AST parsing.
- **Complexity**: High (relies on SQL string parsing)

---

## 4. database/sql (stdlib)

- **Name**: database/sql
- **Type**: Raw SQL / Standard Library
- **Supported Databases**: Any database with a `database/sql`-compatible driver (PostgreSQL via `lib/pq` or `pgx`, MySQL via `go-sql-driver/mysql`, SQLite via `mattn/go-sqlite3`, etc.)
- **Detection Signals**:
  - Import path: `"database/sql"` (standard library, always available)
  - Companion driver imports: `"github.com/lib/pq"`, `"github.com/go-sql-driver/mysql"`, `"github.com/mattn/go-sqlite3"`, `"modernc.org/sqlite"`
  - Call patterns: `sql.Open(...)`, `db.Query(...)`, `db.Exec(...)`, `db.QueryRow(...)`, `db.Prepare(...)`
  - Raw SQL string literals as arguments
- **Entity Definition Style**:
  - No ORM-level entity definition. Tables are referenced by name in raw SQL strings only. Structs used for scanning results are plain Go structs without mandatory tags.
- **Extraction Approach**:
  1. Detect `"database/sql"` import in source files.
  2. Extract all string literal arguments to `db.Query`, `db.Exec`, `db.QueryRow`, `db.Prepare`, `tx.Query`, `tx.Exec`, etc.
  3. Also look for `const` and `var` SQL string declarations.
  4. Parse SQL strings using a SQL parser to extract table names from DML/DDL clauses.
  5. Optionally scan for structs used in `rows.Scan(...)` calls to infer entity shapes.
- **Key Challenges**:
  - SQL strings are frequently constructed dynamically using `fmt.Sprintf` or string concatenation — only literal parts are extractable.
  - No struct-to-table binding exists at the language level.
  - Prepared statements may be built from variables.
- **Analysis Tools**: `go/ast`; SQL parser (`vitess`, `pganalyze/pg_query_go` for PostgreSQL-specific parsing); regex for simple cases.
- **Complexity**: High

---

## 5. pgx

- **Name**: pgx
- **Type**: PostgreSQL Driver / Query Interface
- **Supported Databases**: PostgreSQL only
- **Detection Signals**:
  - `go.mod` dependency: `github.com/jackc/pgx/v5` (or v4, v3)
  - Import paths: `"github.com/jackc/pgx/v5"`, `"github.com/jackc/pgx/v5/pgxpool"`
  - Call patterns: `pgxpool.New(...)`, `conn.Query(...)`, `conn.Exec(...)`, `conn.QueryRow(...)`, `pgx.Connect(...)`
  - pgx-specific types: `pgx.Rows`, `pgx.Row`, `pgtype.*` structs
- **Entity Definition Style**:
  - Raw SQL strings. No struct tags required; `pgx.RowToStructByName` (v5) uses field names or `db` tags from `pgx/v5/pgxscan`.
  - Struct scanning via `pgxscan` uses `db` tags.
- **Extraction Approach**:
  - Same as `database/sql` — extract SQL string literals from query call arguments.
  - Additionally, if `pgxscan` is used, find structs with `db` tags.
  - Scan for `pgx.CopyFrom(ctx, pgx.Identifier{"schema", "table"}, ...)` calls — `pgx.Identifier` slice literals contain schema and table names directly.
- **Key Challenges**:
  - PostgreSQL-specific features (schemas, partitioned tables, `COPY`) make table name extraction more nuanced.
  - `pgx.Identifier` arguments are valuable direct signals.
- **Analysis Tools**: `go/ast`; `pganalyze/pg_query_go` for PostgreSQL SQL parsing.
- **Complexity**: High

---

## 6. go-pg / bun (go-pg v10+)

- **Name**: go-pg (and its successor bun — see also §8)
- **Type**: PostgreSQL ORM
- **Supported Databases**: PostgreSQL only (go-pg); PostgreSQL, MySQL, SQLite, MSSQL (bun)
- **Detection Signals**:
  - `go.mod` dependency: `github.com/go-pg/pg/v10` (go-pg), `github.com/uptrace/bun` (bun)
  - Import paths: `"github.com/go-pg/pg/v10"`, `"github.com/go-pg/pg/v10/orm"`
  - Struct tags: `` `pg:"table_name,alias:t"` `` on struct declaration; field tags `` `pg:"column_name"` ``
  - Call patterns: `db.Model(&obj).Insert()`, `db.Model(&[]User{})`, `orm.CreateTable(...)`
- **Entity Definition Style**:
  - Go structs with `pg` struct tags. Table name can be set via a `pg` tag on the struct itself (go-pg specific) or via `TableName` interface method.
  - Example:
    ```go
    type User struct {
        tableName struct{} `pg:"users,alias:u"`
        ID        int64    `pg:"id,pk"`
        Name      string   `pg:"name"`
    }
    ```
- **Extraction Approach**:
  1. Detect `github.com/go-pg/pg` in `go.mod`.
  2. Parse structs; find fields named `tableName` of type `struct{}` with `pg` tag — the tag value before the first comma is the table name.
  3. If absent, apply go-pg's default: snake_case plural of struct name.
  4. Extract field names from `pg:"col_name"` tags.
  5. Scan for `db.Model(...)` call arguments to enumerate actively used models.
- **Key Challenges**:
  - The `tableName struct{}` field pattern is unusual; must specifically target field name + type + tag combination.
  - go-pg and bun share similar conventions but have different import paths.
- **Analysis Tools**: `go/ast`; tree-sitter Go grammar.
- **Complexity**: Medium

---

## 7. sqlc

- **Name**: sqlc
- **Type**: SQL-to-Go Code Generator
- **Supported Databases**: PostgreSQL, MySQL, SQLite
- **Detection Signals**:
  - `go.mod` dependency: `github.com/sqlc-dev/sqlc` (build/tool dependency) or presence of `sqlc.yaml` / `sqlc.yml`
  - Config files: `sqlc.yaml`, `sqlc.yml` in project root or subdirectory
  - Generated file patterns: `db.go`, `models.go`, `query.sql.go` in configured `out` directories
  - SQL schema files: `schema.sql`, `migrations/*.sql` referenced in `sqlc.yaml`
  - SQL query files: `queries/*.sql`, `query.sql`
  - Comment in generated files: `// Code generated by sqlc. DO NOT EDIT.`
- **Entity Definition Style**:
  - Tables are defined in SQL schema files (`schema.sql`, `CREATE TABLE` statements). sqlc generates Go structs from these. The `sqlc.yaml` links schema files to output packages.
  - Example `sqlc.yaml`:
    ```yaml
    version: "2"
    sql:
      - engine: "postgresql"
        schema: "schema.sql"
        queries: "queries/"
        gen:
          go:
            package: "db"
            out: "internal/db"
    ```
- **Extraction Approach**:
  1. Detect `sqlc.yaml` or `sqlc.yml`.
  2. Parse the YAML to find `schema` file paths.
  3. Parse each schema SQL file using a SQL parser to extract `CREATE TABLE` statements and table names.
  4. Optionally, read generated `models.go` for struct definitions — each struct corresponds to a table row.
  5. Generated struct names follow PascalCase of table names; column names become field names.
- **Key Challenges**:
  - Schema files may include `\i` (psql include) or `-- +migrate` directives — handle file includes.
  - Multiple schemas across multiple SQL files; YAML may define multiple `sql` blocks.
  - Generated files may be committed or gitignored — check both.
- **Analysis Tools**: YAML parser; `pganalyze/pg_query_go` or `xwb1989/sqlparser` for SQL files; `go/ast` for generated Go structs.
- **Complexity**: Low (schema SQL files are authoritative and structured)

---

## 8. Bun ORM

- **Name**: Bun
- **Type**: Relational ORM / SQL Query Builder
- **Supported Databases**: PostgreSQL, MySQL, MariaDB, SQLite, MSSQL
- **Detection Signals**:
  - `go.mod` dependency: `github.com/uptrace/bun`
  - Driver dependencies: `github.com/uptrace/bun/driver/pgdriver`, `github.com/uptrace/bun/driver/sqliteshim`, `github.com/uptrace/bun/dialect/mysqldialect`
  - Import paths: `"github.com/uptrace/bun"`
  - Struct tags: `` `bun:"table:name,alias:t"` `` on struct; field tags `` `bun:"column:col_name,pk"` ``
  - Embedding: `bun.BaseModel` embedded in model structs
  - Call patterns: `db.NewCreateTable().Model((*User)(nil)).Exec(ctx)`, `db.NewSelect().Model(&users)`
- **Entity Definition Style**:
  - Go structs embedding `bun.BaseModel` with `bun` struct tags.
  - Example:
    ```go
    type User struct {
        bun.BaseModel `bun:"table:users,alias:u"`
        ID            int64  `bun:"id,pk,autoincrement"`
        Name          string `bun:"name,notnull"`
    }
    ```
- **Extraction Approach**:
  1. Detect `github.com/uptrace/bun` in `go.mod`.
  2. Find structs embedding `bun.BaseModel`.
  3. Read the `bun` tag on the `BaseModel` field: `table:X` gives the table name.
  4. If absent, apply Bun's default: snake_case plural of struct name.
  5. Extract column names from `bun:"column:X"` or `bun:"X"` field tags.
  6. Scan for `db.NewCreateTable().Model((*Type)(nil))` patterns.
- **Key Challenges**:
  - `bun.BaseModel` is an embedded struct, not a named field — tag is on the embedded type declaration.
  - Bun and go-pg share conceptual heritage; distinguish by import path.
- **Analysis Tools**: `go/ast`; tree-sitter Go grammar.
- **Complexity**: Medium

---

## 9. xorm

- **Name**: xorm
- **Type**: Relational ORM
- **Supported Databases**: PostgreSQL, MySQL, SQLite, MSSQL, Oracle, TiDB
- **Detection Signals**:
  - `go.mod` dependency: `xorm.io/xorm` or legacy `github.com/go-xorm/xorm`
  - Import paths: `"xorm.io/xorm"`
  - Struct tags: `` `xorm:"'column_name' pk autoincrement"` `` or `` `xorm:"extends"` ``
  - Call patterns: `engine.Sync2(new(User))`, `engine.CreateTables(new(User))`, `engine.Table("name")`
  - Table name via `TableName() string` method
- **Entity Definition Style**:
  - Go structs with `xorm` struct tags. Default table name is snake_case of struct name.
  - Example:
    ```go
    type UserInfo struct {
        Id      int64  `xorm:"pk autoincrement 'id'"`
        Name    string `xorm:"varchar(200) notnull 'name'"`
        Created time.Time `xorm:"created"`
    }
    ```
- **Extraction Approach**:
  1. Detect `xorm.io/xorm` in `go.mod`.
  2. Find structs with `xorm` tags or `Sync2`/`CreateTables` call arguments.
  3. Check for `TableName() string` method override.
  4. Default: snake_case of struct name.
  5. Parse `xorm` tag values; quoted strings (e.g., `'col_name'`) are explicit column names.
- **Key Challenges**:
  - xorm tag syntax is non-standard (space-separated directives, quoted column names).
  - `xorm:"extends"` for embedded structs — recurse into embedded types.
- **Analysis Tools**: `go/ast`; custom xorm tag parser.
- **Complexity**: Medium

---

## 10. SQLBoiler

- **Name**: SQLBoiler
- **Type**: Database-First ORM / Code Generator
- **Supported Databases**: PostgreSQL, MySQL, MSSQL, CockroachDB, SQLite (community)
- **Detection Signals**:
  - `go.mod` dependency: `github.com/volatiletech/sqlboiler/v4`
  - Config file: `sqlboiler.toml` in project root
  - Generated code directory: typically `models/` containing `<table_name>.go` files
  - Generated file header: `// Code generated by SQLBoiler ... DO NOT EDIT.`
  - Import paths in generated files: `"github.com/volatiletech/sqlboiler/v4/boil"`
- **Entity Definition Style**:
  - SQLBoiler reads a live database schema and generates Go code. Entity definitions are in the database, not in Go source. Generated files represent the schema state at generation time.
  - Each table gets a file `models/users.go` with a `User` struct and methods.
- **Extraction Approach**:
  1. Detect `sqlboiler.toml` or `github.com/volatiletech/sqlboiler` in `go.mod`.
  2. Scan `models/` directory (or `sqlboiler.toml`-configured output dir) for generated `.go` files.
  3. In each generated file, extract the primary model struct name and look for `TableName = "..."` constant or `var TableName = "..."`.
  4. Parse struct field tags — SQLBoiler uses `boil:"col_name"` and standard `json` tags.
  5. `sqlboiler.toml` may contain schema/table inclusion/exclusion lists — parse for additional hints.
- **Key Challenges**:
  - Source of truth is the database, not Go source — generated files may be stale.
  - If generated files are gitignored, only `sqlboiler.toml` is available (minimal info).
- **Analysis Tools**: `go/ast`; TOML parser for config; file glob for generated model directory.
- **Complexity**: Low (generated files are highly structured when present)

---

## 11. golang-migrate

- **Name**: golang-migrate
- **Type**: Migration Tool
- **Supported Databases**: PostgreSQL, MySQL, SQLite, MongoDB, CockroachDB, Cassandra, ClickHouse, and many others
- **Detection Signals**:
  - `go.mod` dependency: `github.com/golang-migrate/migrate/v4`
  - Migration file directory: commonly `migrations/`, `db/migrations/`, `internal/migrations/`
  - File naming convention: `{version}_{description}.up.sql` and `{version}_{description}.down.sql` (e.g., `000001_create_users_table.up.sql`)
  - Also supports `.go` migration files: `000001_create_users_table.up.go`
  - Config-level: `migrate.New(...)` or `migrate.NewWithDatabaseInstance(...)` call with source URL
- **Entity Definition Style**:
  - Tables defined in SQL migration files via `CREATE TABLE` statements. No Go struct annotations; pure SQL DDL.
- **Extraction Approach**:
  1. Detect `github.com/golang-migrate/migrate` in `go.mod` or locate `*.up.sql` files in conventional directories.
  2. Glob for `**/*.up.sql` files.
  3. Parse each SQL file for `CREATE TABLE [IF NOT EXISTS] table_name` statements.
  4. Also capture `ALTER TABLE`, `CREATE INDEX`, `CREATE VIEW` for additional schema context.
  5. Order files by version number (prefix) to reconstruct current schema state.
- **Key Challenges**:
  - `DROP TABLE` and `ALTER TABLE RENAME TO` in later migrations modify the entity list — apply migrations in order.
  - `.go` migration files contain SQL in string literals — require Go parsing.
  - Some projects use custom migration runners and non-standard directory structures.
- **Analysis Tools**: File glob; SQL parser; version ordering of migration files.
- **Complexity**: Medium

---

## 12. Goose

- **Name**: Goose
- **Type**: Migration Tool
- **Supported Databases**: PostgreSQL, MySQL, SQLite, MSSQL, CockroachDB, TiDB, ClickHouse
- **Detection Signals**:
  - `go.mod` dependency: `github.com/pressly/goose/v3` or legacy `github.com/pressly/goose`, `bitbucket.org/liamstask/goose`
  - Migration files: SQL files with `-- +goose Up` / `-- +goose Down` directives; Go files with `func init()` registering migrations
  - Directory: commonly `migrations/`, `db/migrations/`
  - File naming: `{timestamp|sequential}_{description}.sql` (e.g., `20230101120000_create_users.sql`)
  - Config: `dbconf.yml` (legacy goose)
- **Entity Definition Style**:
  - SQL migrations with goose-specific directives. Tables defined in `-- +goose Up` sections.
  - Example:
    ```sql
    -- +goose Up
    CREATE TABLE users (
        id   BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL
    );
    -- +goose Down
    DROP TABLE users;
    ```
- **Extraction Approach**:
  1. Detect `github.com/pressly/goose` in `go.mod` or find `-- +goose Up` directives in SQL files.
  2. Glob for `.sql` files in migration directories.
  3. For each file, extract text between `-- +goose Up` and `-- +goose Down` (or end of file).
  4. Parse extracted SQL for `CREATE TABLE` statements.
  5. For Go-based migrations (`.go` files with `goose.AddMigration`), extract SQL strings from `Up` functions.
- **Key Challenges**:
  - `-- +goose StatementBegin` / `-- +goose StatementEnd` wrap multi-statement blocks — handle these delimiters.
  - Go-based migration files mix Go and SQL.
- **Analysis Tools**: File glob; regex for goose directives; SQL parser; `go/ast` for Go migration files.
- **Complexity**: Medium

---

## 13. Atlas

- **Name**: Atlas
- **Type**: Schema Management / Migration Tool
- **Supported Databases**: PostgreSQL, MySQL, MariaDB, SQLite, SQL Server, TiDB, ClickHouse, CockroachDB
- **Detection Signals**:
  - `go.mod` dependency: `ariga.io/atlas`
  - Config file: `atlas.hcl` in project root
  - Schema files: `schema.hcl`, `*.hcl` in `migrations/` or `schema/` directories
  - SQL migration files: `migrations/*.sql` with Atlas metadata comments (`-- atlas:sum`, `atlas:split`)
  - Directory: `atlas/`, `schema/`, `migrations/`
- **Entity Definition Style**:
  - Atlas HCL schema format (primary) or SQL DDL. HCL schema uses `table` blocks.
  - Example (HCL):
    ```hcl
    table "users" {
      schema = schema.public
      column "id" { type = bigint }
      column "name" { type = varchar(255) }
      primary_key { columns = [column.id] }
    }
    ```
- **Extraction Approach**:
  1. Detect `atlas.hcl` or `ariga.io/atlas` in `go.mod`.
  2. Parse `schema.hcl` / `atlas.hcl` using an HCL parser — extract `table "name"` blocks.
  3. For SQL migration files, parse `CREATE TABLE` statements.
  4. If using `atlas schema inspect` output (HCL or SQL), parse that directly.
- **Key Challenges**:
  - HCL is not a standard config format; requires an HCL parser (e.g., `hashicorp/hcl`).
  - Atlas can manage multiple schemas/databases in one config.
- **Analysis Tools**: HCL parser (`hashicorp/hcl`); SQL parser; `go/ast` for Go-embedded Atlas usage.
- **Complexity**: Medium

---

## 14. go-redis

- **Name**: go-redis
- **Type**: NoSQL (Key-Value Store)
- **Supported Databases**: Redis
- **Detection Signals**:
  - `go.mod` dependency: `github.com/redis/go-redis/v9` or `github.com/go-redis/redis/v8`
  - Import paths: `"github.com/redis/go-redis/v9"`
  - Call patterns: `rdb.Set(ctx, "key", ...)`, `rdb.Get(ctx, "key")`, `rdb.HSet(...)`, `rdb.HGetAll(...)`
  - Key patterns in string literals
- **Entity Definition Style**:
  - No formal schema. Entities are implied by key naming conventions and data structure types (`String`, `Hash`, `List`, `Set`, `ZSet`, `Stream`).
  - Key prefixes in string literals (e.g., `"user:%d"`, `"session:%s"`) are the primary entity signals.
- **Extraction Approach**:
  1. Detect `github.com/redis/go-redis` in `go.mod`.
  2. Extract string literal arguments to `Set`, `Get`, `HSet`, `HGetAll`, `LPush`, `SAdd`, `ZAdd`, `XAdd` etc.
  3. Identify key patterns using regex — extract prefix segments (e.g., `user:` from `"user:%d"`).
  4. Group by key prefix as logical entity names.
  5. Redis data type (Hash → struct-like, Stream → event entity) gives additional context.
- **Key Challenges**:
  - Key names are often dynamically constructed — only literal prefixes are extractable.
  - Redis has no schema; entity list is heuristic.
  - `const` key prefix declarations may exist; resolve constant references.
- **Analysis Tools**: `go/ast`; regex for key prefix extraction.
- **Complexity**: High (heuristic-based)

---

## 15. mongo-driver

- **Name**: mongo-driver (MongoDB Official Go Driver)
- **Type**: NoSQL (Document Store)
- **Supported Databases**: MongoDB
- **Detection Signals**:
  - `go.mod` dependency: `go.mongodb.org/mongo-driver`
  - Import paths: `"go.mongodb.org/mongo-driver/mongo"`, `"go.mongodb.org/mongo-driver/bson"`
  - Struct tags: `` `bson:"field_name,omitempty"` `` on model structs
  - Call patterns: `client.Database("dbname").Collection("colname")`, `coll.InsertOne(...)`, `coll.Find(...)`
  - String literals in `.Collection("name")` calls
- **Entity Definition Style**:
  - Go structs with `bson` tags for document field mapping. Collection names appear as string literals in `.Collection("name")` calls.
  - Example:
    ```go
    type User struct {
        ID    primitive.ObjectID `bson:"_id,omitempty"`
        Name  string             `bson:"name"`
        Email string             `bson:"email"`
    }
    coll := db.Collection("users")
    ```
- **Extraction Approach**:
  1. Detect `go.mongodb.org/mongo-driver` in `go.mod`.
  2. Scan for `.Collection("literal")` call expressions — the string argument is the collection name.
  3. Find all structs with `bson` tags — these are document entity models.
  4. Correlate structs to collection names by tracing variable assignments (e.g., `var result User; coll.FindOne(...).Decode(&result)`).
  5. Also scan for `mongo.IndexModel` definitions to identify indexed collections.
- **Key Challenges**:
  - Collection names passed as variables or constants — resolve simple constant references.
  - Database name selection (`client.Database(name)`) may be dynamic.
  - Multi-tenant patterns use dynamic collection names.
- **Analysis Tools**: `go/ast`; tree-sitter Go grammar.
- **Complexity**: Medium

---

## 16. Elasticsearch Go Client

- **Name**: Elasticsearch Go Client (official)
- **Type**: NoSQL (Search Index)
- **Supported Databases**: Elasticsearch, OpenSearch
- **Detection Signals**:
  - `go.mod` dependency: `github.com/elastic/go-elasticsearch/v8` (or v7, v6); OpenSearch: `github.com/opensearch-project/opensearch-go`
  - Import paths: `"github.com/elastic/go-elasticsearch/v8"`
  - Call patterns: `es.Indices.Create(...)`, `es.Index(...)`, `es.Search(...)` with `index` parameter
  - String literals for index names
  - Mapping JSON in string literals or struct definitions with `json` tags
- **Entity Definition Style**:
  - No formal Go struct schema. Indices are named in API calls. Document mappings defined as JSON strings or `esapi` request bodies.
  - `esutil.NewBulkIndexer(esutil.BulkIndexerConfig{Index: "users"})` — index name in config struct.
- **Extraction Approach**:
  1. Detect `github.com/elastic/go-elasticsearch` in `go.mod`.
  2. Scan for string literals used as index names in `es.Index(...)`, `es.Search(...)`, `es.Indices.Create(...)` calls.
  3. Look for `esutil.BulkIndexerConfig{Index: "name"}` struct literals.
  4. Find structs with `json` tags that are marshaled into Elasticsearch documents.
- **Key Challenges**:
  - Index names often constructed dynamically (e.g., date-based: `"logs-2024-01"`).
  - Mapping definitions are JSON-in-Go-strings — hard to parse statically.
- **Analysis Tools**: `go/ast`; JSON parser for mapping bodies.
- **Complexity**: High

---

## 17. DynamoDB (aws-sdk-go / aws-sdk-go-v2)

- **Name**: AWS DynamoDB SDK (aws-sdk-go and aws-sdk-go-v2)
- **Type**: NoSQL (Key-Value / Document)
- **Supported Databases**: AWS DynamoDB
- **Detection Signals**:
  - `go.mod` dependency: `github.com/aws/aws-sdk-go-v2/service/dynamodb` or `github.com/aws/aws-sdk-go/service/dynamodb`
  - Import paths: `"github.com/aws/aws-sdk-go-v2/service/dynamodb"`
  - Struct tags: `` `dynamodbav:"attr_name"` `` (for `attributevalue` marshaling)
  - Call patterns: `svc.PutItem(...)`, `svc.GetItem(...)`, `svc.Query(...)`, `svc.Scan(...)`; `dynamodb.CreateTableInput{TableName: aws.String("name")}`
  - `TableName: aws.String("literal")` in input struct literals
- **Entity Definition Style**:
  - Table names in `TableName` field of SDK input structs. Structs with `dynamodbav` tags define item attribute shapes.
  - Example:
    ```go
    type User struct {
        PK   string `dynamodbav:"PK"`
        SK   string `dynamodbav:"SK"`
        Name string `dynamodbav:"name"`
    }
    svc.PutItem(ctx, &dynamodb.PutItemInput{
        TableName: aws.String("Users"),
        ...
    })
    ```
- **Extraction Approach**:
  1. Detect `aws-sdk-go*/service/dynamodb` in `go.mod`.
  2. Scan for struct literals containing `TableName: aws.String("literal")` — extract the string argument.
  3. Also scan for `TableName: &tableName` where `tableName` is a `const` or `var` — resolve simple constant references.
  4. Find structs with `dynamodbav` tags as item entity models.
- **Key Challenges**:
  - Table names often stored in environment variables or config — limited static extractability.
  - Single-table design patterns use one table with many entity types — entity disambiguation requires attribute pattern analysis.
- **Analysis Tools**: `go/ast`; constant propagation for table name resolution.
- **Complexity**: High

---

## 18. Firebase / Firestore Go SDK

- **Name**: Firebase Admin Go SDK / Firestore Go Client
- **Type**: NoSQL (Document Store)
- **Supported Databases**: Google Cloud Firestore, Firebase Realtime Database
- **Detection Signals**:
  - `go.mod` dependency: `firebase.google.com/go/v4`, `cloud.google.com/go/firestore`
  - Import paths: `"cloud.google.com/go/firestore"`, `"firebase.google.com/go/v4/db"`
  - Call patterns (Firestore): `client.Collection("name")`, `client.Doc("name/id")`, `client.CollectionGroup("name")`
  - Call patterns (Realtime DB): `client.NewRef("path")`, `ref.Child("name")`
  - String literals in collection/ref path arguments
- **Entity Definition Style**:
  - Firestore: collection names as string literals in `.Collection("name")` calls. Documents may be represented by structs with `firestore` tags.
  - Realtime DB: hierarchical path strings in `NewRef`/`Child` calls.
- **Extraction Approach**:
  1. Detect `firebase.google.com/go` or `cloud.google.com/go/firestore` in `go.mod`.
  2. Scan for `.Collection("literal")` calls — first path segment is the top-level collection name.
  3. Scan for `.CollectionGroup("literal")` — collection group name.
  4. For Realtime DB, scan `NewRef("path")` string literals; extract top-level path segments.
  5. Find structs with `firestore:"field_name"` tags as document entity models.
- **Key Challenges**:
  - Nested subcollection paths (`users/{id}/posts`) — extract all path segments as potential entities.
  - Dynamic paths constructed at runtime.
- **Analysis Tools**: `go/ast`; regex for path segment extraction.
- **Complexity**: Medium

---

## 19. Protobuf (protoc-gen-go)

- **Name**: Protocol Buffers (protoc-gen-go)
- **Type**: Schema Definition / Serialization (not a DB, but defines data entities)
- **Supported Databases**: N/A (transport/storage format); used with any backend
- **Detection Signals**:
  - `go.mod` dependency: `google.golang.org/protobuf`, `github.com/golang/protobuf`
  - `.proto` source files in repository (anywhere, typically `proto/`, `api/`, `pb/`)
  - Generated Go files: `*.pb.go` (containing `// Code generated by protoc-gen-go`)
  - Import paths: `"google.golang.org/protobuf/proto"`, package names ending in `pb`
- **Entity Definition Style**:
  - Proto `message` definitions in `.proto` files. Generated Go structs in `*.pb.go` files.
  - Example:
    ```proto
    message User {
      int64 id = 1;
      string name = 2;
      string email = 3;
    }
    ```
- **Extraction Approach**:
  1. Detect `google.golang.org/protobuf` in `go.mod` or find `.proto` files in the repo.
  2. Prefer parsing `.proto` files directly — find all `message` declarations.
  3. Each `message` is a named data entity; nested messages are sub-entities.
  4. `enum` types are supporting entities.
  5. Alternatively, parse `*.pb.go` for generated struct types — look for `protoimpl.MessageState` fields or `ProtoReflect()` methods.
- **Key Challenges**:
  - `.proto` files may be in a separate repository or submodule.
  - Not all proto messages correspond to stored entities — some are RPC request/response envelopes.
  - `oneof` and `repeated` fields add complexity to field extraction.
- **Analysis Tools**: Proto file parser (e.g., `jhump/protoreflect`); `go/ast` for `*.pb.go` fallback; file glob for `.proto` files.
- **Complexity**: Low (`.proto` files are highly structured)

---

## 20. Struct Definitions with json / db / bson Tags (Generic Signal)

- **Name**: Tagged Struct (Generic Entity Signal)
- **Type**: Language-Level Heuristic
- **Supported Databases**: Any
- **Detection Signals**:
  - Any Go struct with `json`, `db`, `bson`, `xml`, `csv`, or `yaml` struct tags
  - File names suggesting data models: `model*.go`, `entity*.go`, `schema*.go`, `types*.go`, `*_model.go`, `*_entity.go`
  - Directory names: `models/`, `entities/`, `domain/`, `internal/models/`
  - Struct names following naming conventions: `*Model`, `*Entity`, `*Record`, `*Row`, `*Document`
- **Entity Definition Style**:
  - Plain Go structs with serialization tags. Not tied to any specific framework.
  - Example:
    ```go
    type UserProfile struct {
        ID        int64     `json:"id" db:"id"`
        Username  string    `json:"username" db:"username"`
        CreatedAt time.Time `json:"created_at" db:"created_at"`
    }
    ```
- **Extraction Approach**:
  1. No dependency detection needed — scan all `.go` files.
  2. Find structs with one or more of: `json`, `db`, `bson`, `dynamodbav`, `firestore`, `yaml` tags on their fields.
  3. Apply heuristic filters: structs in `models/`, `entities/`, `domain/` directories score higher.
  4. Struct name patterns (`*Model`, `*Entity`, `*Record`, `*Row`) add confidence.
  5. Cross-reference with detected ORM frameworks — tag-matching structs in ORM-heavy repos are high-confidence entities.
- **Key Challenges**:
  - Many structs have `json` tags for HTTP API payloads, not database entities — false positives are high without cross-referencing.
  - Confidence scoring needed to distinguish request/response DTOs from database models.
- **Analysis Tools**: `go/ast`; directory heuristics; scoring model combining multiple signals.
- **Complexity**: Medium (as a standalone signal, confidence is low; best used in combination)

---

## 21. OpenAPI-Generated Models

- **Name**: OpenAPI / Swagger Generated Go Code
- **Type**: Code-Generated Models
- **Supported Databases**: N/A (API spec → Go types; may overlap with DB entities)
- **Detection Signals**:
  - Config/spec files: `openapi.yaml`, `openapi.json`, `swagger.yaml`, `swagger.json`
  - `go.mod` dependencies: `github.com/deepmap/oapi-codegen`, `github.com/oapi-codegen/oapi-codegen`, `github.com/swaggo/swag`
  - Generated file header: `// Code generated by oapi-codegen` or similar
  - Generated struct files: often `api/types.gen.go`, `api/api.gen.go`, `models/openapi_types.go`
  - Config: `oapi-codegen.yaml`, `.oapi-codegen.yaml`
- **Entity Definition Style**:
  - Structs generated from OpenAPI schema `components/schemas` definitions. Tags include `json` and sometimes `validate` tags.
  - OpenAPI spec `schemas` directly map to named types.
- **Extraction Approach**:
  1. Find OpenAPI spec files (`openapi.yaml`, `swagger.yaml`).
  2. Parse spec YAML/JSON — extract `components/schemas` keys as entity names.
  3. Also parse generated Go files for struct definitions with `// Code generated` headers.
  4. Cross-reference schema names with detected DB framework models to identify which OpenAPI schemas correspond to stored entities.
- **Key Challenges**:
  - OpenAPI schemas may represent request/response bodies, not stored entities.
  - Generated files may diverge from the spec if regeneration is manual.
- **Analysis Tools**: YAML/JSON parser for spec files; `go/ast` for generated code; OpenAPI spec parser.
- **Complexity**: Low (spec files are structured) to Medium (correlation with DB entities is heuristic)

---

## Repository Detection Plan

The following outlines a recommended automated static analysis pipeline for a Go repository.

### Phase 1: Dependency Scanning

1. Parse `go.mod` (and `go.sum` for transitive dependencies if needed).
2. Build a **framework fingerprint**: map detected module paths to frameworks (see Detection Signals for each entry above).
3. Assign confidence weights: direct dependencies score higher than transitive.

### Phase 2: File Discovery

Based on detected frameworks, run targeted file discovery:

| Framework | Primary File Targets |
|---|---|
| GORM | All `*.go` files; filter to structs with `gorm` tags |
| Ent | `ent/schema/*.go` |
| sqlc | `sqlc.yaml`, schema SQL files, `models.go` |
| SQLBoiler | `sqlboiler.toml`, `models/*.go` |
| golang-migrate / Goose | `migrations/**/*.sql`, `db/migrations/**/*.sql` |
| Atlas | `*.hcl`, `atlas.hcl`, `schema.hcl` |
| mongo-driver | All `*.go` — scan for `.Collection(...)` calls |
| Protobuf | `**/*.proto`, `**/*.pb.go` |

### Phase 3: Entity Extraction

For each detected framework, apply the extraction approach described above. Output a normalized entity record:

```json
{
  "name": "users",
  "source_type": "table|collection|index|key_prefix|message",
  "framework": "GORM",
  "source_file": "internal/models/user.go",
  "source_line": 14,
  "fields": [
    {"name": "id", "type": "int64"},
    {"name": "name", "type": "string"}
  ],
  "confidence": 0.95
}
```

### Phase 4: Deduplication and Merging

1. Deduplicate entities with the same name across frameworks (e.g., a GORM model and a migration file both defining `users`).
2. Merge field lists when multiple sources provide complementary information.
3. Flag conflicts (e.g., different field sets for the same table name from different sources).

### Phase 5: Confidence Scoring

Apply confidence adjustments:

| Signal | Confidence Delta |
|---|---|
| SQL `CREATE TABLE` in migration file | +0.9 (high — authoritative DDL) |
| ORM struct with `TableName()` override | +0.85 |
| ORM struct with framework-specific tags | +0.80 |
| `.Collection("literal")` call | +0.75 |
| Generic struct with `db` tags in `models/` dir | +0.60 |
| Generic struct with `json` tags only | +0.30 |
| Dynamic table/collection name (variable) | -0.20 |

### Phase 6: Output

Produce a final entity manifest: table/collection name, source framework, file location, field list, confidence score. Flag low-confidence entities for human review.

### Recommended Tooling Stack

- **Go AST parsing**: `go/ast` + `go/parser` + `go/token` (Go stdlib)
- **Tree-sitter**: `tree-sitter-go` grammar for language-agnostic parsing
- **SQL parsing**: `pganalyze/pg_query_go` (PostgreSQL), `xwb1989/sqlparser` (MySQL-compatible), or regex for simple cases
- **HCL parsing**: `hashicorp/hcl/v2`
- **YAML parsing**: `gopkg.in/yaml.v3`
- **Proto parsing**: `jhump/protoreflect` or `bufbuild/protocompile`
- **File globbing**: `filepath.WalkDir` with pattern matching
