# Haskell: Data Entity Storage Methods

A catalog of frameworks, libraries, and approaches for data entity storage in Haskell, oriented toward automated static analysis of repositories to extract database tables, document collections, and similar data entities.

---

## Frameworks and Approaches

---

### 1. Persistent

- **Name**: persistent (with persistent-template, persistent-postgresql, persistent-mysql, persistent-sqlite, persistent-mongodb)
- **Type**: Relational ORM / Migration Framework
- **Supported Databases**: PostgreSQL, MySQL, SQLite, MongoDB, CouchDB (via backend packages)
- **Detection Signals**:
  - `.cabal` file: `persistent`, `persistent-template`, `persistent-postgresql`, `persistent-mysql`, `persistent-sqlite` in `build-depends`
  - `stack.yaml`: `extra-deps` or resolver-compatible package set
  - `package.yaml` (hpack format): same package names in `dependencies`
  - Imports: `import Database.Persist`, `import Database.Persist.TH`, `import Database.Persist.Sql`
  - Template Haskell quasi-quotes: `[persistLowerCase| ... |]` or `[persistUpperCase| ... |]` blocks
  - Invocation: `share [mkPersist sqlSettings, mkMigrate "migrateAll"] [persistLowerCase| ... |]`
  - File-based definitions: `$(persistFileWith lowerCaseSettings "config/models")`
  - Migration: `runMigration migrateAll`, `runMigrationSilent migrateAll`, `printMigration migrateAll`
- **Entity Definition Style**: Entities are defined in a quasi-quoted DSL inside `[persistLowerCase| ... |]` or `[persistUpperCase| ... |]` blocks. The DSL syntax is:
  ```
  EntityName sql=optional_table_name
      fieldName  FieldType
      otherField OtherType Maybe
      derivedField DerivedType default=value
      UniqueConstraintName fieldName otherField
  ```
  Template Haskell (`share`, `mkPersist`, `mkMigrate`) processes the quasi-quote at compile time to generate Haskell record types, `Key` newtypes, `EntityField` constructors, and migration functions. The entity name maps to a SQL table name via the `persistLowerCase`/`persistUpperCase` naming convention, or via the explicit `sql=` override.
- **Extraction Approach**:
  1. Detect `persistent-template` (or `persistent`) in `.cabal`/`package.yaml`/`stack.yaml`.
  2. Search all `.hs` files for `[persistLowerCase|` or `[persistUpperCase|` quasi-quote opening delimiters.
  3. Extract the content between the quasi-quote delimiters (from the `|` after the opening `[persistLowerCase` to the closing `|]`).
  4. Parse the extracted DSL:
     - Lines beginning with a non-whitespace uppercase letter are entity declarations: `EntityName` or `EntityName sql=table_name`.
     - If `sql=table_name` is present, use `table_name` as the SQL table name; otherwise apply the naming convention (lowercased for `persistLowerCase`, unchanged for `persistUpperCase`).
     - Indented lines under an entity declaration are field definitions: `fieldName FieldType [Maybe] [default=...] [sql=col_name]`.
     - Lines starting with an uppercase letter that appear indented and do not match field syntax are unique constraint declarations.
  5. Search for `$(persistFileWith ...)` patterns — trace the file path argument to load the external entity definition file (commonly `config/models` in Yesod projects).
  6. Search for `config/models` or `config/models.persistentmodels` files — these are plain-text entity definition files using the same DSL without quasi-quote delimiters.
- **Key Challenges**:
  - `mkPersist sqlSettings` with custom `MkPersistSettings` or `customizeName` can alter the naming convention used for table and column names.
  - `persistFileWith` loads definitions from external files; the file path is a string expression that must be statically traced.
  - Multiple `share` blocks across different source files must all be collected.
  - The Yesod scaffolded project puts entity definitions in `config/models` — a separate non-Haskell file that is very easy to parse.
  - MongoDB backend uses the EntityName directly as the collection name.
  - Entities can declare `deriving (Eq, Show, Read, Ord)` on the same DSL line — these must not be confused with field definitions.
- **Analysis Tools**: Regex for quasi-quote delimiters (high reliability — the DSL is distinctive); custom parser for the Persistent DSL grammar; tree-sitter-haskell for surrounding context.
- **Complexity**: Low-Medium (the quasi-quote DSL is machine-readable; file-based definitions are even simpler to parse)

---

### 2. Esqueleto

- **Name**: esqueleto
- **Type**: Type-Safe SQL DSL (built on Persistent)
- **Supported Databases**: PostgreSQL, MySQL, SQLite (inherits from Persistent backends)
- **Detection Signals**:
  - `.cabal`/`package.yaml`: `esqueleto` in `build-depends`
  - Imports: `import Database.Esqueleto`, `import Database.Esqueleto.Experimental`, `import Database.Esqueleto.Legacy`
  - Query patterns: `select $ from $ \entity -> ...`, `where_ (entity ^. EntityField ==. val x)`, `innerJoin`, `leftJoin`, `on`
- **Entity Definition Style**: Esqueleto uses the same entity definitions as Persistent (see entry 1). It provides a type-safe SQL DSL layered on top of Persistent's entity types. No additional entity definition mechanism exists in Esqueleto itself. Entity types referenced in Esqueleto queries appear as type-annotated lambda arguments to `from`.
- **Extraction Approach**:
  1. Detect `esqueleto` in `.cabal`/`package.yaml`.
  2. Entity definitions are found using the Persistent extraction approach (see entry 1).
  3. Additionally, scan Esqueleto `from` expressions: `from $ \(entity :: SqlExpr (Entity EntityType)) ->` — the `EntityType` confirms which Persistent entities are actively used.
  4. Treat entity names found only in Esqueleto queries (not in `[persistLowerCase|...]`) as cross-references to Persistent definitions.
- **Key Challenges**: Same as Persistent. Esqueleto adds no new entity definitions — all schema is in the underlying Persistent definition.
- **Analysis Tools**: Same as Persistent; tree-sitter-haskell for type-annotated lambda analysis.
- **Complexity**: Low (inherits from Persistent; no additional entity definitions)

---

### 3. Beam

- **Name**: beam (beam-core, beam-postgres, beam-sqlite, beam-mysql)
- **Type**: Type-Safe Relational Query DSL / ORM
- **Supported Databases**: PostgreSQL (beam-postgres), SQLite (beam-sqlite), MySQL (beam-mysql)
- **Detection Signals**:
  - `.cabal`/`package.yaml`: `beam-core`, `beam-postgres`, `beam-sqlite`, `beam-mysql`, `beam-migrate` in `build-depends`
  - Imports: `import Database.Beam`, `import Database.Beam.Postgres`, `import Database.Beam.Sqlite`, `import Database.Beam.Backend.SQL`
  - Type patterns: higher-kinded data (HKD) types parameterized by `f` with `Beamable` derivation: `deriving (Generic, Beamable)`
  - Database descriptor type: `data <DbName>Db f = <DbName>Db { db<TableName> :: f (TableEntity (<TableName>T)) } deriving (Generic, Database be)`
  - Settings: `defaultDbSettings`, `withDbModification`, `modifyTableFields`, `setEntityName`
- **Entity Definition Style**: Each table is a higher-kinded data type parameterized by `f`, conventionally named `<TableName>T`:
  ```haskell
  data UserT f = User
      { userId    :: C f Int64
      , userName  :: C f Text
      , userEmail :: C f Text
      } deriving (Generic, Beamable)
  type User = UserT Identity
  type UserId = PrimaryKey UserT Identity

  data ShopDb f = ShopDb
      { shopUsers  :: f (TableEntity UserT)
      , shopOrders :: f (TableEntity OrderT)
      } deriving (Generic, Database be)

  shopDb :: DatabaseSettings be ShopDb
  shopDb = defaultDbSettings
  ```
  `defaultDbSettings` derives table names from field names in the database descriptor using camelCase-to-snake_case stripping (e.g., `shopUsers` → `users` after stripping the `shop` prefix and converting case). This derivation is a compile-time computation.
- **Extraction Approach**:
  1. Detect `beam-core` in `.cabal`/`package.yaml`.
  2. Search for data types deriving `Beamable`: `deriving\s*\(.*\bBeamable\b.*\)` — these are table types. Extract the type name (strip trailing `T` convention to get entity name).
  3. Search for the database descriptor type: a record type deriving `Database be` where fields are of type `f (TableEntity <TypeT>)`. Extract all `TableEntity <TypeT>` references — each is a table in the schema.
  4. Find `defaultDbSettings` binding to locate where the database descriptor is instantiated and its name.
  5. Search for `withDbModification` / `modifyTableFields` / `setEntityName` calls that override the auto-derived table or column names — these are high-priority overrides for accurate table name extraction.
  6. For `beam-migrate`, search for `CheckedDatabaseSettings` and migration step functions for explicit DDL.
- **Key Challenges**:
  - `defaultDbSettings` derives table names via a complex compile-time naming convention; without running GHC, the derived table name must be computed by replicating the naming algorithm (strip type name prefix shared with the database type, then convert camelCase to snake_case).
  - `modifyEntityName` and `modifyTableFields` can override table and column names — always check for these.
  - The HKD pattern requires understanding type-level naming; general-purpose Haskell AST tools may not handle the type-level machinery.
  - Multiple database descriptor types may exist (e.g., separate schemas for different parts of the application).
- **Analysis Tools**: tree-sitter-haskell; regex for `Beamable` derivation patterns; GHC API for full type-level analysis (impractical for static analysis — use approximation).
- **Complexity**: Medium-High (HKD pattern requires understanding type-level naming conventions)

---

### 4. Opaleye

- **Name**: Opaleye
- **Type**: Type-Safe PostgreSQL Query DSL
- **Supported Databases**: PostgreSQL
- **Detection Signals**:
  - `.cabal`/`package.yaml`: `opaleye` in `build-depends`
  - Imports: `import Opaleye`, `import Opaleye.Table`, `import Opaleye.Manipulation`, `import Opaleye.SqlTypes`
  - Table definitions: `table "table_name" ...`, `tableWithSchema "schema_name" "table_name" ...`
  - Record types with profunctor-style polymorphism: `data PersonF a b c = Person { personId :: a, personName :: b, personAge :: c }`
- **Entity Definition Style**: Tables are defined using the `table` or `tableWithSchema` function:
  ```haskell
  personTable :: Table PersonWriteFields PersonReadFields
  personTable = table "persons"
      (pPerson Person
          { personId    = tableField "id"
          , personName  = tableField "name"
          , personScore = tableField "score"
          })
  ```
  The first string argument to `table` is the PostgreSQL table name. Column names are given by `tableField "col_name"` string arguments.
- **Extraction Approach**:
  1. Detect `opaleye` in `.cabal`/`package.yaml`.
  2. Search all `.hs` files for `\btable\s+"([^"]+)"` — extract the table name string literal.
  3. Also search for `tableWithSchema\s+"([^"]+)"\s+"([^"]+)"` — extract schema name and table name.
  4. Extract `tableField\s+"([^"]+)"` patterns near each table definition to get column names.
  5. Identify the Haskell record types used with each table definition for full schema reconstruction.
- **Key Challenges**:
  - Table names are explicit string literals — straightforward to extract.
  - The profunctor/polymorphic record pattern means record types have multiple type parameters; the full schema requires understanding type instantiation.
  - `tableWithSchema` includes both a schema qualifier and table name; capture both.
  - Some Opaleye projects use `requiredTableField` / `optionalTableField` instead of `tableField` — handle all variants.
- **Analysis Tools**: Regex for `table "..."` patterns; tree-sitter-haskell for record type analysis.
- **Complexity**: Medium

---

### 5. postgresql-simple / mysql-simple / sqlite-simple

- **Name**: postgresql-simple, mysql-simple, sqlite-simple
- **Type**: Raw SQL with Row Mapping
- **Supported Databases**: PostgreSQL (postgresql-simple), MySQL (mysql-simple), SQLite (sqlite-simple)
- **Detection Signals**:
  - `.cabal`/`package.yaml`: `postgresql-simple`, `mysql-simple`, `sqlite-simple` in `build-depends`
  - Imports: `import Database.PostgreSQL.Simple`, `import Database.MySQL.Simple`, `import Database.SQLite.Simple`
  - Query patterns: `query conn "SELECT ..." params`, `execute conn "INSERT INTO ..."`, `query_ conn "SELECT ..."`, `executeMany conn "..." rows`
  - SQL quasi-quoters (companion packages): `[sql| SELECT ... FROM table |]` (from `postgresql-simple` or `raw-strings-qq`)
  - Row type instances: `instance FromRow MyType where fromRow = MyType <$> field <*> field ...`, `instance ToRow MyType where toRow = ...`
- **Entity Definition Style**: No ORM entity model. Queries are raw SQL strings passed as the `Query` type (a newtype over `ByteString`). `FromRow`/`ToRow` type class instances define how Haskell types map to/from query result rows.
- **Extraction Approach**:
  1. Detect the relevant library in `.cabal`/`package.yaml`.
  2. Search for `instance\s+FromRow\s+(\w+)` declarations — these types represent query result row shapes (likely corresponding to tables or views).
  3. Search for `instance\s+ToRow\s+(\w+)` declarations — these types represent row types being written to the database.
  4. Search for raw SQL strings in `query`, `execute`, `query_`, `executeMany` call sites: extract the second argument.
  5. Parse SQL string literals for table references: `FROM\s+(\w+)`, `INSERT\s+INTO\s+(\w+)`, `CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(\w+)`, `UPDATE\s+(\w+)`, `JOIN\s+(\w+|\w+\.\w+)`.
  6. Handle `[sql| ... |]` quasi-quoter content as SQL strings.
  7. Cross-reference `FromRow` type names with extracted table names from SQL queries for entity naming.
- **Key Challenges**:
  - SQL strings in `postgresql-simple` are the `Query` type (a `ByteString` newtype); they may be assembled via `<>` (Monoid concatenation) or constructed from `ByteString` manipulation.
  - `fromOnly` and single-column result types are common and may not represent full entities.
  - `query_` (zero-parameter queries) vs `query` (parameterized) both need to be scanned.
  - Large codebases may have many `query` calls; DDL (`CREATE TABLE`) must be prioritized over DML (`SELECT`, `INSERT`) for entity discovery.
- **Analysis Tools**: Regex for SQL literal extraction; tree-sitter-haskell for `FromRow`/`ToRow` instance detection; SQL DDL parser for `CREATE TABLE` parsing.
- **Complexity**: Medium-High (raw SQL + instance detection required)

---

### 6. Hasql

- **Name**: Hasql (with hasql-th, hasql-transaction, hasql-pool)
- **Type**: High-Performance PostgreSQL Client
- **Supported Databases**: PostgreSQL
- **Detection Signals**:
  - `.cabal`/`package.yaml`: `hasql`, `hasql-th`, `hasql-transaction`, `hasql-pool` in `build-depends`
  - Imports: `import Hasql.Statement`, `import Hasql.Session`, `import Hasql.TH`, `import Hasql.Encoders`, `import Hasql.Decoders`
  - Statement patterns: `Statement "SELECT ..." encoder decoder`, `[hasqlStatement| SELECT ... |]` (Template Haskell quasi-quoter from `hasql-th`)
  - Encoder/decoder chains: `Encoders.param`, `Decoders.column`, `Decoders.rowList`, `Decoders.rowMaybe`
- **Entity Definition Style**: SQL statements are defined as `Statement` values wrapping a SQL `ByteString` with an encoder (for parameters) and a decoder (for results). The `hasql-th` package provides a `[hasqlStatement| SQL |]` quasi-quoter for compile-time SQL parsing and type derivation.
- **Extraction Approach**:
  1. Detect `hasql` in `.cabal`/`package.yaml`.
  2. Search for `Statement\s+"([^"]+)"` — the string literal is a SQL query; parse for table references.
  3. Search for `[hasqlStatement|` ... `|]` quasi-quoter content — extract SQL between the delimiters.
  4. Parse all extracted SQL for `FROM\s+(\w+)`, `INSERT\s+INTO\s+(\w+)`, `CREATE\s+TABLE\s+(\w+)`, `UPDATE\s+(\w+)`.
  5. The quasi-quote form is the most reliable since the SQL is clearly bounded by `|]`.
- **Key Challenges**:
  - `Statement` SQL is a `ByteString`; in more complex codebases it may be assembled dynamically.
  - Hasql is encoder/decoder-centric rather than record-type-centric; the type-level row shape is encoded in `Decoders.column` chains, not in a named Haskell record type.
  - No migration framework is built into Hasql — migrations are typically external SQL files or run via a separate tool.
  - `hasql-th` quasi-quoter content is syntactically distinct from Haskell string literals — parse separately.
- **Analysis Tools**: Regex for `Statement` patterns and `[hasqlStatement|` quasi-quoter; SQL DDL/DML parser.
- **Complexity**: Medium-High

---

### 7. Selda

- **Name**: selda (with selda-postgresql, selda-sqlite)
- **Type**: Type-Safe Relational DSL
- **Supported Databases**: PostgreSQL, SQLite
- **Detection Signals**:
  - `.cabal`/`package.yaml`: `selda`, `selda-postgresql`, `selda-sqlite` in `build-depends`
  - Imports: `import Database.Selda`, `import Database.Selda.PostgreSQL`, `import Database.Selda.SQLite`
  - Table patterns: `table "table_name" [...]`, `tableFieldMod "table_name" [...] modifier`
  - Row type derivation: `deriving (Generic, SqlRow)` on Haskell data types
  - Table type annotation: `persons :: Table Person`
- **Entity Definition Style**: A Selda table is defined by a Haskell record type deriving `SqlRow`, combined with a `table` function call:
  ```haskell
  data Person = Person
      { personId   :: ID Person
      , personName :: Text
      , personAge  :: Int
      } deriving (Generic, SqlRow)

  persons :: Table Person
  persons = table "persons" [personId :- autoPrimary]
  ```
  The `table` function takes a string (table name) and a list of column constraints.
- **Extraction Approach**:
  1. Detect `selda` in `.cabal`/`package.yaml`.
  2. Search for `\btable\s+"([^"]+)"` patterns — extract the table name string.
  3. Search for data types deriving `SqlRow`: `deriving\s*\(.*\bSqlRow\b.*\)` — these are the row types.
  4. Associate each `Table <T>` type signature with its corresponding `table "name"` definition and the `<T>` record type.
  5. Extract record field names from the row type to build a column list.
- **Key Challenges**: Table names are explicit string literals — straightforward extraction. Row types use standard Haskell record syntax, making field extraction reliable.
- **Analysis Tools**: Regex, tree-sitter-haskell.
- **Complexity**: Medium

---

### 8. Rel8

- **Name**: rel8
- **Type**: Type-Safe PostgreSQL Query Library (based on Opaleye)
- **Supported Databases**: PostgreSQL
- **Detection Signals**:
  - `.cabal`/`package.yaml`: `rel8` in `build-depends`
  - Imports: `import Rel8`
  - HKD type patterns: data types with `Rel8able` derivation: `deriving (Generic, Rel8able)`
  - Schema declarations: `TableSchema { name = "table_name", schema = Nothing, columns = ... }` or `TableSchema { name = ..., columns = namesFromLabels @(GColumns ...)}`
- **Entity Definition Style**: Similar to Beam — tables are higher-kinded data types:
  ```haskell
  data UserT f = User
      { userId   :: Column f Int64
      , userName :: Column f Text
      } deriving (Generic, Rel8able)
  type User = UserT Result

  userSchema :: TableSchema (UserT Name)
  userSchema = TableSchema
      { name    = "users"
      , schema  = Nothing
      , columns = namesFromLabels @(GColumns (UserT Name))
      }
  ```
  The `name` field of `TableSchema` is the SQL table name as a string literal.
- **Extraction Approach**:
  1. Detect `rel8` in `.cabal`/`package.yaml`.
  2. Search for `TableSchema\s*\{` record expressions; within those, extract `name\s*=\s*"([^"]+)"`.
  3. Search for data types deriving `Rel8able` — these are table HKD types.
  4. Associate each `TableSchema` with the nearby `Rel8able` type to get the full entity definition.
- **Key Challenges**: `TableSchema` is always an explicit record with a `name` field — table names are straightforward to extract. The HKD pattern is similar to Beam.
- **Analysis Tools**: Regex, tree-sitter-haskell.
- **Complexity**: Medium

---

### 9. Squeal-postgresql

- **Name**: squeal-postgresql
- **Type**: Type-Safe PostgreSQL DSL (type-level schema encoding)
- **Supported Databases**: PostgreSQL
- **Detection Signals**:
  - `.cabal`/`package.yaml`: `squeal-postgresql` in `build-depends`
  - Imports: `import Squeal.PostgreSQL`, `import Squeal.PostgreSQL.Schema`
  - Type-level schema: `type Schema = '[ "table_name" ::: 'Table ('[...] :=> '[...]), ... ]` — schema is a type-level list (promoted types)
  - Type alias: `type DB = '[ "schema" ::: 'Schema Schema ]` or similar top-level DB type
- **Entity Definition Style**: The entire database schema is encoded at the Haskell type level using promoted type lists. Table names are type-level string literals (`Symbol`):
  ```haskell
  type Schema = '[
      "users"  ::: 'Table ('[] :=> '[
          "id"       ::: 'NoDef :=> 'NotNull 'PGint8
        , "username" ::: 'NoDef :=> 'NotNull 'PGtext
        , "email"    ::: 'NoDef :=> 'NotNull 'PGtext
        ])
    , "posts" ::: 'Table ('[] :=> '[
          "id"      ::: 'NoDef :=> 'NotNull 'PGint8
        , "user_id" ::: 'NoDef :=> 'NotNull 'PGint8
        , "body"    ::: 'NoDef :=> 'NotNull 'PGtext
        ])
    ]
  ```
- **Extraction Approach**:
  1. Detect `squeal-postgresql` in `.cabal`/`package.yaml`.
  2. Search for `type\s+\w+\s*=\s*'\[` type declarations — these are potential schema type definitions.
  3. Within the type-level list, extract all occurrences of `"([^"]+)"\s+:::\s+'Table` — the quoted string before `:::` is a table name.
  4. For column names, also extract `"([^"]+)"\s+:::\s+'(NoDef|Def|HasDefault)` patterns within the table's column list.
  5. Use multiline regex since these type definitions frequently span many lines.
- **Key Challenges**:
  - Type-level schema is expressed in Haskell type syntax, not value syntax — requires type-aware parsing.
  - Multi-line type declarations may span many lines with complex indentation.
  - Schema type aliases may be composed from multiple partial schema definitions via type-level list concatenation.
  - The promoted type notation (`'[`, `:::`, `'Table`) is syntactically unusual and requires careful regex.
- **Analysis Tools**: tree-sitter-haskell; regex with multiline support for type declarations.
- **Complexity**: High (type-level encoding is unusual; multiline parsing required)

---

### 10. Groundhog

- **Name**: groundhog (with groundhog-postgresql, groundhog-sqlite, groundhog-mysql, groundhog-th)
- **Type**: Relational ORM (similar to Persistent in approach)
- **Supported Databases**: PostgreSQL, MySQL, SQLite
- **Detection Signals**:
  - `.cabal`/`package.yaml`: `groundhog`, `groundhog-th`, `groundhog-postgresql`, `groundhog-sqlite`, `groundhog-mysql` in `build-depends`
  - Imports: `import Database.Groundhog`, `import Database.Groundhog.TH`, `import Database.Groundhog.Postgresql`
  - Template Haskell: `mkPersist defaultCodegenConfig [groundhog| ... |]`
  - YAML-like DSL content inside `[groundhog| ... |]` quasi-quote
- **Entity Definition Style**: Similar to Persistent, but uses a YAML-like syntax in the quasi-quote:
  ```haskell
  mkPersist defaultCodegenConfig [groundhog|
    - entity: User
      dbName: users
      constructors:
        - name: User
          fields:
            - name: userName
              dbName: name
            - name: userEmail
              dbName: email
  |]
  ```
  The `entity:` key is the Haskell type name; `dbName:` (at the entity level) is the SQL table name. Field `dbName:` entries are the SQL column names.
- **Extraction Approach**:
  1. Detect `groundhog` or `groundhog-th` in `.cabal`/`package.yaml`.
  2. Search for `[groundhog|` ... `|]` quasi-quote delimiters.
  3. Extract the content between delimiters.
  4. Parse as YAML: `entity:` keys give the Haskell type name; `dbName:` at the entity level gives the SQL table name. If no entity-level `dbName:`, the table name defaults to the `entity:` value (via groundhog's naming convention).
  5. Within `constructors:` → `fields:`, extract `name:` (Haskell field) and `dbName:` (SQL column) pairs.
- **Key Challenges**: YAML quasi-quote content must be extracted (bounded by `[groundhog|` and `|]`) and then parsed as YAML. The indentation-sensitive YAML inside a Haskell quasi-quote is unusual and may require careful string extraction before YAML parsing.
- **Analysis Tools**: Regex for quasi-quote boundaries; YAML parser (PyYAML, etc.) for YAML content extraction.
- **Complexity**: Medium

---

### 11. HaskellDB (Legacy)

- **Name**: HaskellDB
- **Type**: Relational Query DSL (largely historical, pre-2010)
- **Supported Databases**: PostgreSQL, MySQL, SQLite, ODBC
- **Detection Signals**:
  - `.cabal`: `haskelldb` in `build-depends`
  - Imports: `import Database.HaskellDB`
  - Table definitions: `dbTable "table_name" $ do ...`
- **Entity Definition Style**: Tables are defined with `dbTable "table_name"` followed by field descriptors in a do-block.
- **Extraction Approach**:
  1. Detect `haskelldb` in `.cabal`.
  2. Search for `dbTable\s+"([^"]+)"` — extract the table name string literal.
- **Key Challenges**: HaskellDB is largely historical and rarely encountered in active projects post-2015. Detection is included for completeness.
- **Analysis Tools**: Regex.
- **Complexity**: Low

---

### 12. Raw SQL Migration Files (.sql)

- **Name**: Raw SQL Migration and Schema Files
- **Type**: Migration Tool / Schema File
- **Supported Databases**: Any
- **Detection Signals**:
  - Files: `migrations/*.sql`, `db/migrations/*.sql`, `schema.sql`, `*.sql` in project directories
  - Loaded via Haskell: `readFile "migrations/001_create_users.sql"`, `withBinaryFile` patterns
  - External tools: Flyway config (`flyway.conf`, `flyway.toml`), Liquibase config (`liquibase.properties`, `changelog.xml`), golang-migrate (`database/migrations/*.sql`)
  - Numbered or timestamped migration files: `V001__create_users.sql`, `20231001120000_add_orders.sql`
- **Entity Definition Style**: Standard SQL DDL. Tables are defined with `CREATE TABLE` statements, columns with their types and constraints. No Haskell-level representation.
- **Extraction Approach**:
  1. Recursively search for all `*.sql` files in the project directory.
  2. Parse each file for `CREATE TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(["'\`]?(\w+)["'\`]?)` — extract the table name.
  3. Parse `CREATE VIEW\s+(\w+)` — note as views rather than base tables.
  4. Parse `ALTER TABLE\s+(\w+)\s+RENAME\s+TO\s+(\w+)` in migration sequences for rename tracking.
  5. Process numbered migration files in lexicographic/numeric order to produce the current-state schema.
  6. Check for Flyway, Liquibase, or golang-migrate configuration files to understand the migration tool in use.
- **Key Challenges**: `ALTER TABLE RENAME TO` in later migration files may rename previously discovered entities — processing all migration files in order is necessary for accuracy. Rollback scripts (often named `down.sql` or `V001__undo.sql`) should be excluded or handled separately.
- **Analysis Tools**: SQL DDL parser, regex.
- **Complexity**: Low-Medium

---

### 13. Yesod + Persistent Patterns

- **Name**: Yesod (web framework, typically used with Persistent)
- **Type**: Web Framework with Integrated ORM
- **Supported Databases**: Same as Persistent backends
- **Detection Signals**:
  - `.cabal`/`package.yaml`: `yesod`, `yesod-core`, `yesod-persistent`, `yesod-auth` in `build-depends`
  - Project structure: `config/models` file (Persistent entity DSL plain text), `config/routes`, `Foundation.hs`, `Application.hs`, `Handler/` directory
  - `config/models` contains Persistent DSL entity definitions without surrounding quasi-quote delimiters
  - Scaffolded `Settings.hs` with `$(persistFileWith lowerCaseSettings "config/models")` call
- **Entity Definition Style**: Same as Persistent. The Yesod scaffolding convention places entity definitions in `config/models` as a plain text file using the Persistent DSL, loaded via `$(persistFileWith ...)` at compile time.
- **Extraction Approach**:
  1. Detect Yesod in `.cabal`/`package.yaml`.
  2. Check for `config/models` file directly — parse using the Persistent DSL grammar (same as entry 1, but without quasi-quote delimiters). Each line starting with a non-whitespace uppercase letter is an entity name.
  3. Also search for `[persistLowerCase|` in Haskell source files as a fallback for non-scaffolded Yesod projects.
  4. Look for `$(persistFileWith ...)` calls to identify custom model file paths.
- **Key Challenges**: The `config/models` plain text file is actually the most machine-readable entity definition format in the entire Haskell ecosystem — it is an unambiguous line-oriented DSL with no surrounding Haskell syntax. Parse it first if present.
- **Analysis Tools**: Custom Persistent DSL parser; regex for entity name lines (uppercase, non-indented).
- **Complexity**: Low (config/models file is the most machine-readable schema format in Haskell)

---

### 14. Event Sourcing Patterns (Event Types as Entity Signals)

- **Name**: Event Sourcing (informal pattern)
- **Type**: Event Store / CQRS Signal
- **Supported Databases**: EventStoreDB, custom PostgreSQL event tables, custom SQLite event stores
- **Detection Signals**:
  - Libraries: `eventstore`, `eventful`, `eventsource`, `conduit-extra` with event stream patterns
  - Type naming: sum types named `*Event`, `*Command`, `*EventType`
  - Patterns: `appendToStream "stream_name"`, `readFromStream "stream_name"`, `readAllEvents`
  - A single `events` table with `stream_id`, `event_type`, `payload` columns (common pattern in custom implementations)
- **Entity Definition Style**: Domain events are Haskell sum types. The actual storage "entity" is typically a single `events` table (or an `event_store` schema) with JSONB or binary payload column, or named event stream identifiers.
- **Extraction Approach**:
  1. Detect event sourcing libraries in `.cabal`.
  2. Extract sum type names ending in `Event` or `Command` via `data\s+(\w+Event)\s*=` and `data\s+(\w+Command)\s*=`.
  3. Search for `appendToStream` / `readFromStream` with string literal stream names.
  4. Look for an `events` or `event_store` table in SQL files.
- **Key Challenges**: Event types are domain types, not database tables per se. The mapping to storage is indirect and implementation-specific. Extract as domain event type inventory rather than direct schema entities.
- **Analysis Tools**: tree-sitter-haskell, regex.
- **Complexity**: High (indirect entity representation)

---

### 15. Aeson JSON Types as Entity Signals

- **Name**: Aeson (JSON serialization library)
- **Type**: Structural Shape Signal (heuristic)
- **Supported Databases**: Any (indirect — used with PostgreSQL JSONB, MongoDB, REST APIs, etc.)
- **Detection Signals**:
  - `.cabal`/`package.yaml`: `aeson` in `build-depends`
  - Imports: `import Data.Aeson`, `import Data.Aeson.TH`
  - Type patterns: `deriving (FromJSON, ToJSON)`, `$(deriveJSON ...)`, `instance FromJSON <Type>` with `parseJSON` implementation
  - Naming conventions: types named `*Schema`, `*Record`, `*Entity`, `*Row`, `*Document`, `*Model`
- **Entity Definition Style**: Not a storage layer. Haskell data types with `FromJSON`/`ToJSON` instances may represent document schemas stored in PostgreSQL JSONB columns, MongoDB documents, or REST API payloads that mirror database structure.
- **Extraction Approach**:
  1. Search for `deriving\s*\(.*\bFromJSON\b.*\)` and `deriving\s*\(.*\bToJSON\b.*\)` in type declarations.
  2. Apply naming heuristics: types whose names end in `Schema`, `Record`, `Entity`, `Row`, `Document`, or `Model` are higher-confidence entity candidates.
  3. Cross-reference with `postgresql-simple`/`hasql` queries that reference JSONB columns or with MongoDB driver usage.
  4. Treat only high-confidence naming matches corroborated by DB library usage as entity signals.
- **Key Challenges**: High false positive rate — most Aeson types in Haskell codebases are API types, not DB entities. This is a last-resort heuristic.
- **Analysis Tools**: tree-sitter-haskell, regex.
- **Complexity**: High (low confidence; significant disambiguation required)

---

## Repository Detection Plan

### Step 1: Identify Storage Technologies in Use

1. Parse all `*.cabal` files (in the repo root and any multi-package `cabal.project` sub-directories) — extract `build-depends` fields from all library, executable, and test-suite stanzas.
2. Parse `package.yaml` (hpack format) if present — extract `dependencies` fields.
3. Parse `stack.yaml` — note resolver and `extra-deps` for version context.
4. Match dependency names against the known library list in this document.
5. Search all `*.hs` files for `import Database.*` patterns to confirm which libraries are actually imported (covers transitive dependencies not in direct `build-depends`).
6. Check for `config/models` file (Yesod/Persistent signal — highest priority parse target).
7. Check for `*.sql` files anywhere in the repository.
8. Check for Flyway/Liquibase/golang-migrate config files.

### Step 2: Apply Framework-Specific Extraction

Priority order (highest structural signal to lowest):

1. Yesod `config/models` plain text file — most machine-readable Haskell entity definition format
2. Persistent `[persistLowerCase|...]` / `[persistUpperCase|...]` quasi-quotes in Haskell source
3. Groundhog `[groundhog|...]` quasi-quotes with YAML content
4. Opaleye `table "name" ...` string literal declarations
5. Selda `table "name" [...]` string literal declarations
6. Rel8 `TableSchema { name = "..." }` record declarations
7. Beam `Beamable` HKD types + database descriptor record fields
8. Squeal-postgresql type-level schema string symbols
9. Hasql `Statement "SQL"` and `[hasqlStatement|SQL|]` quasi-quoters
10. postgresql-simple / sqlite-simple `FromRow`/`ToRow` instances + SQL string extraction
11. Raw SQL `*.sql` files (always run regardless of other findings)
12. Aeson type heuristics (lowest confidence, highest false positive rate)

### Step 3: Handle Template Haskell

- Template Haskell (`share`, `mkPersist`, `[persistLowerCase|...]`) is expanded at compile time; the expansion is invisible at source level. Static analysis must parse the quasi-quote DSL directly.
- For `persistFileWith`, trace the file path string argument to load the external entity definition file.
- Do not attempt to run GHC or Template Haskell during static analysis — parse source-level quasi-quote content instead.
- For Beam's `defaultDbSettings`, replicate the naming algorithm in the analyzer: strip the shared prefix between the database type name and each field name, then convert camelCase to snake_case.

### Step 4: SQL File Sweep (Always Run)

Regardless of detected framework, sweep all `*.sql` files:
- Parse `CREATE TABLE (IF NOT EXISTS)? <name>` statements
- Parse `CREATE VIEW <name>` statements (flag as views, not tables)
- Parse `ALTER TABLE <name> RENAME TO <new_name>` for migration tracking
- Process numbered migration files in order

### Step 5: Output

Produce a structured list per entity:
```
entity_name | sql_table_name | framework | source_file | source_line | confidence | fields (if extractable)
```

### Key Files to Always Check

| File / Pattern | Significance |
|---|---|
| `*.cabal` | Primary Cabal build manifest |
| `package.yaml` | hpack manifest |
| `stack.yaml` | Stack build tool config |
| `cabal.project` | Multi-package project config |
| `config/models` | Yesod/Persistent entity DSL (plain text — highest priority) |
| `*.hs` (all) | Haskell source files |
| `*.sql` | Raw SQL migration/schema files |
| `migrations/` | Migration directory (by convention) |
| `flyway.conf`, `flyway.toml` | Flyway migration tool config |
| `liquibase.properties`, `changelog.xml` | Liquibase migration tool config |

### Confidence Levels

| Signal Type | Confidence |
|---|---|
| Persistent `config/models` entity line (non-indented uppercase) | High |
| Persistent `[persistLowerCase\|...\|]` entity line | High |
| Groundhog `entity:` in quasi-quote YAML | High |
| Opaleye `table "name"` string literal | High |
| Selda `table "name" [...]` string literal | High |
| Rel8 `TableSchema { name = "..." }` | High |
| Beam `Beamable` type in database descriptor | Medium-High |
| Squeal type-level `"name" ::: 'Table` | Medium-High |
| `FromRow` instance + corroborated SQL `FROM name` | Medium |
| `CREATE TABLE` in `.sql` files | High |
| Hasql `[hasqlStatement\| ... \|]` SQL content | Medium-High |
| `Statement "SELECT ... FROM name"` SQL content | Medium |
| Aeson type with DB-like naming convention | Low |
