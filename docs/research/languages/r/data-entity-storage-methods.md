# R: Data Entity Storage Methods

A catalog of frameworks, libraries, and approaches for data entity storage in R, oriented toward automated static analysis of repositories to extract database tables, document collections, and similar data entities.

**Important note on realism**: R is a statistical computing language, not a systems or application programming language. It does not have ORMs, migration frameworks, or schema-enforcing data access layers in the traditional sense. R code accesses databases primarily through raw SQL strings passed to DBI-compatible drivers. Static analysis of R repositories for database entity extraction is fundamentally lower-signal than analysis of application languages. The approaches below reflect what is realistically achievable, and the limitations section is as important as the detection approaches.

---

## Frameworks and Approaches

---

### 1. DBI + Backend Drivers

- **Name**: DBI (with RPostgres, RMySQL, RMariaDB, RSQLite, odbc, bigrquery, ROracle)
- **Type**: Raw SQL / Database Interface Standard
- **Supported Databases**: PostgreSQL (RPostgres), MySQL/MariaDB (RMySQL, RMariaDB), SQLite (RSQLite), ODBC data sources (odbc), BigQuery (bigrquery), Oracle (ROracle)
- **Detection Signals**:
  - `DESCRIPTION` file: `DBI`, `RPostgres`, `RMySQL`, `RMariaDB`, `RSQLite`, `odbc`, `bigrquery`, `ROracle` in `Imports`, `Depends`, or `Suggests` fields
  - `renv.lock`: package entries for `DBI`, `RPostgres`, `RSQLite`, etc. with `Source` and `Version` fields
  - `NAMESPACE`: `importFrom(DBI, dbGetQuery)` or similar entries
  - R source patterns: `library(DBI)`, `require(DBI)`, `library(RPostgres)`, etc. in `.R` files
  - Connection patterns: `dbConnect(RPostgres::Postgres(), ...)`, `dbConnect(RSQLite::SQLite(), ...)`, `dbConnect(odbc::odbc(), ...)`, `dbConnect(RMariaDB::MariaDB(), ...)`
  - Query patterns: `dbGetQuery(conn, "SELECT ...")`, `dbExecute(conn, "...")`, `dbSendQuery(conn, "...")`, `dbReadTable(conn, "table_name")`, `dbWriteTable(conn, "table_name", df)`, `dbCreateTable(conn, "table_name", df)`
- **Entity Definition Style**: No schema definition in R code. Tables are referenced by string literals in raw SQL passed to DBI functions, or by string arguments to `dbReadTable`/`dbWriteTable`/`dbCreateTable`.
- **Extraction Approach**:
  1. Detect DBI usage via `DESCRIPTION`, `renv.lock`, or `library(DBI)` / `require(DBI)` calls in `.R` / `.r` files.
  2. Identify the database type from the driver in `dbConnect(...)`: `RPostgres::Postgres()` → PostgreSQL, `RSQLite::SQLite()` → SQLite, `RMySQL::MySQL()` → MySQL, `odbc::odbc()` → ODBC.
  3. Search for `dbGetQuery\s*\(`, `dbExecute\s*\(`, `dbSendQuery\s*\(`, `dbSendStatement\s*\(` calls; extract the second argument (SQL string literal, if non-assembled).
  4. Parse extracted SQL strings for table references:
     - `FROM\s+(\w+|\w+\.\w+)` (table name, possibly schema-qualified)
     - `INSERT\s+INTO\s+(\w+|\w+\.\w+)`
     - `CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(\w+|\w+\.\w+)`
     - `UPDATE\s+(\w+|\w+\.\w+)`
     - `JOIN\s+(\w+|\w+\.\w+)`
  5. Search for `dbReadTable\s*\(\s*\w+\s*,\s*["']([^"']+)["']` — extract the table name (second string argument). This is the highest-confidence R-level entity signal via DBI.
  6. Search for `dbWriteTable\s*\(\s*\w+\s*,\s*["']([^"']+)["']` — extract the table name.
  7. Search for `dbCreateTable\s*\(\s*\w+\s*,\s*["']([^"']+)["']` — extract the table name.
  8. Search for `dbListTables(conn)` as a signal that the connection references multiple tables (no specific names extractable, but confirms DB usage).
- **Key Challenges**:
  - SQL strings in R are standard character strings (single or double quoted); multi-line strings are assembled with `paste()`, `paste0()`, `glue::glue()`, or `sprintf()`. Assembled strings cannot be statically extracted.
  - `glue::glue("SELECT * FROM {table_var}")` makes table names completely dynamic.
  - `paste0("SELECT * FROM ", table_name)` — table name is a variable, not extractable statically.
  - R is heavily used for ad hoc data analysis; many DB queries are exploratory one-offs with no stable schema significance.
  - Connection objects are passed through function arguments (`function(con) { dbGetQuery(con, ...) }`), making connection-to-driver tracing difficult.
  - The `odbc` driver uses DSN names or driver strings that may not reveal the database type.
- **Analysis Tools**: Regex for DBI call patterns; SQL DDL parser for `CREATE TABLE` extraction; R AST tools (R's own `parse()`, `lintr`, `codetools` — require running R and are impractical for static offline analysis).
- **Complexity**: High (raw SQL in dynamic R strings)

---

### 2. dbplyr

- **Name**: dbplyr (database backend for dplyr)
- **Type**: Query Builder / SQL Generator
- **Supported Databases**: Any database with a DBI-compatible backend (PostgreSQL, MySQL, SQLite, BigQuery, Spark SQL, Snowflake, etc.)
- **Detection Signals**:
  - `DESCRIPTION` / `renv.lock`: `dbplyr` package
  - R source: `library(dbplyr)`, `require(dbplyr)`, or `tbl()` used with a DBI connection object
  - Primary table reference pattern: `tbl(conn, "table_name")`, `tbl(src, "table_name")`
  - Schema-qualified: `tbl(conn, dbplyr::in_schema("schema_name", "table_name"))`, `tbl(conn, Id(schema = "s", table = "t"))`
  - Raw SQL table: `tbl(conn, dbplyr::sql("SELECT ..."))`
  - dplyr verb chains: `conn %>% tbl("table_name") %>% filter(...) %>% select(...) %>% collect()`
  - Assignment: `users_tbl <- tbl(conn, "users")`
  - Materialization: `copy_to(conn, df, "table_name")`, `compute(name = "table_name")`
- **Entity Definition Style**: Tables are referenced by string literals in `tbl(conn, "table_name")` calls. No schema is defined in R — dbplyr generates SQL dynamically from dplyr verb chains. `tbl()` is the primary and most explicit entity reference mechanism in dbplyr workflows.
- **Extraction Approach**:
  1. Detect `dbplyr` in `DESCRIPTION`/`renv.lock`/`library()` calls.
  2. Search all `.R` / `.Rmd` / `.qmd` files for `\btbl\s*\(\s*\w+\s*,\s*["']([^"']+)["']` — extract the second argument as the table name.
  3. Handle `in_schema("schema_name", "table_name")` patterns — extract both schema and table name: `in_schema\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']`.
  4. Handle `Id(schema = "...", table = "...")` patterns — extract both fields.
  5. Handle `tbl(conn, sql("..."))` patterns — extract the SQL string and parse for table references.
  6. Search for `copy_to\s*\(\s*\w+\s*,\s*\w+\s*,\s*["']([^"']+)["']` — creates a (possibly temporary) table with the given name.
  7. Search for `compute\s*\(.*name\s*=\s*["']([^"']+)["']` — materializes a lazy query as a table.
- **Key Challenges**:
  - `tbl(conn, table_name_variable)` where the name is a variable — not statically resolvable.
  - `in_schema()` arguments may be computed from variables.
  - dbplyr is heavily used interactively in RMarkdown and Quarto notebooks where code is exploratory and schema significance is unclear.
  - The same table may be referenced in `tbl()` dozens of times across a codebase; deduplication is important.
- **Analysis Tools**: Regex for `tbl(` patterns; RMarkdown/Quarto code chunk extraction (see Step 4 in Detection Plan).
- **Complexity**: Medium (`tbl()` with literal table names is explicit and regex-extractable)

---

### 3. RODBC

- **Name**: RODBC
- **Type**: ODBC Interface / Raw SQL
- **Supported Databases**: Any ODBC data source (SQL Server, Oracle, PostgreSQL, MySQL, Microsoft Access, etc.)
- **Detection Signals**:
  - `DESCRIPTION` / `renv.lock`: `RODBC`
  - R source: `library(RODBC)`, `require(RODBC)`
  - Connection patterns: `channel <- odbcConnect("DSN_name")`, `odbcDriverConnect("Driver={SQL Server};Server=...;")`
  - Query patterns: `sqlQuery(channel, "SELECT ...")`, `sqlExecute(channel, "...")`, `sqlFetch(channel, "table_name")`, `sqlSave(channel, df, tablename = "table_name")`, `sqlColumns(channel, "table_name")`
- **Entity Definition Style**: Raw SQL strings passed to `sqlQuery()`; or explicit table names passed to `sqlFetch()` and `sqlSave()` without embedding in SQL.
- **Extraction Approach**:
  1. Detect RODBC via `DESCRIPTION`/`renv.lock`/`library(RODBC)`.
  2. Search for `sqlFetch\s*\(\s*\w+\s*,\s*["']([^"']+)["']` — extract the table name second argument (no SQL parsing needed — this is the most direct signal).
  3. Search for `sqlSave\s*\(.*\btablename\s*=\s*["']([^"']+)["']` — extract the `tablename` named argument.
  4. Search for `sqlQuery\s*\(\s*\w+\s*,\s*["']([^"']+)["']` — extract the SQL string; parse for `FROM\s+(\w+)`, `INSERT\s+INTO\s+(\w+)`, `CREATE\s+TABLE\s+(\w+)`.
  5. Search for `sqlColumns\s*\(\s*\w+\s*,\s*["']([^"']+)["']` — this call queries metadata for a specific table (high-confidence signal that the table exists).
- **Key Challenges**: Same raw SQL challenges as DBI for `sqlQuery`. `sqlFetch` and `sqlSave` with literal table name arguments are much more reliable. The DSN name in `odbcConnect` may reveal the database type if named descriptively (e.g., `"ProductionPostgres"`).
- **Analysis Tools**: Regex.
- **Complexity**: High (raw SQL) / Medium (for `sqlFetch`/`sqlSave` with literal names)

---

### 4. sqldf

- **Name**: sqldf
- **Type**: SQL on R Data Frames (in-memory SQL)
- **Supported Databases**: SQLite (default), MySQL (via RMySQL), PostgreSQL (via RPostgreSQL), H2
- **Detection Signals**:
  - `DESCRIPTION` / `renv.lock`: `sqldf`
  - R source: `library(sqldf)`, `require(sqldf)`
  - Patterns: `sqldf("SELECT ... FROM df_name ...")` — the `FROM` clause refers to R data frame variable names in scope, not database table names
- **Entity Definition Style**: The "tables" in sqldf queries are R data frame objects present in the calling environment. `sqldf("SELECT * FROM orders")` means the R data frame variable `orders` is the data source. These are in-memory R objects, not persistent database tables.
- **Extraction Approach**:
  1. Detect `sqldf` usage in source files.
  2. Search for `sqldf\s*\(\s*["']([^"']+)["']` — extract the SQL string.
  3. Parse the SQL for `FROM\s+(\w+)` — the name is an R data frame variable name, not a persistent DB table name.
  4. Flag all extracted names as **in-memory data frame references**, not persistent entities.
  5. Apply an exception: if `sqldf` is initialized with a persistent database option (`options(sqldf.driver = "SQLite")` with a file path), the "tables" may be persistent — check for this pattern.
- **Key Challenges**: sqldf table names are R variable names (data frames in scope at runtime), not database table names. They must not be treated as persistent entity names without additional context. sqldf is useful for detecting what data shapes are being analyzed but not for discovering database schema.
- **Analysis Tools**: Regex.
- **Complexity**: Medium (extraction is easy; interpretation requires disambiguation — mark as in-memory only)

---

### 5. RSQLite (Embedded SQLite)

- **Name**: RSQLite
- **Type**: Embedded SQLite Database
- **Supported Databases**: SQLite
- **Detection Signals**:
  - `DESCRIPTION` / `renv.lock`: `RSQLite`
  - R source: `library(RSQLite)`, `dbConnect(RSQLite::SQLite(), "path/to/db.sqlite")`, `dbConnect(SQLite(), ":memory:")`
  - Database files: `*.sqlite`, `*.db`, `*.sqlite3` files present in the project directory or a `data/` subdirectory
  - Table creation: `dbExecute(conn, "CREATE TABLE ...")`, `dbCreateTable(conn, "table_name", df)`, `dbWriteTable(conn, "table_name", df)`
- **Entity Definition Style**: Tables are created either via raw SQL DDL (`dbExecute(conn, "CREATE TABLE ...")`) or from a data frame's column structure (`dbCreateTable(conn, "table_name", data_frame)`, `dbWriteTable(conn, "table_name", df)`). The SQLite file itself persists the schema independently of R source code.
- **Extraction Approach**:
  1. Detect RSQLite usage via `DESCRIPTION`/`renv.lock` or `library(RSQLite)` / `dbConnect(RSQLite::SQLite(), ...)`.
  2. Extract the database file path from `dbConnect(RSQLite::SQLite(), "path.db")` — first non-driver string argument.
  3. If the SQLite file is committed to the repository, open it directly (using Python `sqlite3` module or SQLite CLI) and run `SELECT name FROM sqlite_master WHERE type='table'` — this gives the definitive schema independently of source code.
  4. Search for `dbExecute\s*\(\s*\w+\s*,\s*["']([^"']+)["']` where the SQL starts with `CREATE TABLE` — extract the table name.
  5. Search for `dbCreateTable\s*\(\s*\w+\s*,\s*["']([^"']+)["']` and `dbWriteTable\s*\(\s*\w+\s*,\s*["']([^"']+)["']` — extract the table name (second string argument).
- **Key Challenges**: The SQLite file is often a build artifact or generated during testing and may not be committed to the repository. `dbWriteTable` creates tables from data frames — column names are derived from the data frame's column names, which may not be statically known. `:memory:` database paths indicate ephemeral databases used for testing.
- **Analysis Tools**: Regex; SQLite CLI or Python `sqlite3` module for direct file schema inspection.
- **Complexity**: Medium (SQLite file inspection is most reliable; source-level is less so)

---

### 6. Pool Package

- **Name**: pool (connection pooling for Shiny and server applications)
- **Type**: Connection Pool (wrapper over DBI)
- **Supported Databases**: Any DBI-compatible backend
- **Detection Signals**:
  - `DESCRIPTION` / `renv.lock`: `pool`
  - R source: `library(pool)`, `pool::dbPool(...)`, `dbPool(drv = RPostgres::Postgres(), ...)`
  - Patterns: `pool_obj <- dbPool(RPostgres::Postgres(), ...)`, then `pool_obj %>% tbl("table_name")` or `dbGetQuery(pool_obj, "...")` (pool objects implement the DBI interface)
  - `poolClose(pool_obj)` calls at teardown
- **Entity Definition Style**: Pool objects are used as drop-in DBI connection substitutes. All entity detection falls back to DBI and dbplyr patterns applied to pool objects.
- **Extraction Approach**:
  1. Detect `pool` usage via `DESCRIPTION`/`renv.lock` or `library(pool)`.
  2. Identify the pool object variable name from `dbPool(...)` assignment.
  3. Apply all DBI and dbplyr extraction rules to usages of the pool object variable — treat pool objects identically to DBI connection objects.
  4. Extract the driver argument from `dbPool(drv = ...)` to determine database type.
- **Key Challenges**: Pool is a thin wrapper; all the underlying DBI challenges apply. Connection objects passed as function arguments make tracking pool variable usage difficult.
- **Analysis Tools**: Same as DBI.
- **Complexity**: Medium (reduces to DBI/dbplyr analysis)

---

### 7. Shiny + Database Patterns

- **Name**: Shiny applications with database connections
- **Type**: Application Framework with DB access
- **Supported Databases**: Any DBI-compatible backend
- **Detection Signals**:
  - `DESCRIPTION` / `renv.lock`: `shiny`
  - Project structure: `app.R`, `ui.R` + `server.R`, `global.R` files in project root
  - DB connection in `global.R` or inside the `server` function body
  - Patterns: `reactive(...)`, `eventReactive(...)`, `observe(...)` function bodies containing `dbGetQuery()` or `tbl()` calls
  - Config: `config.yml` using the `config` R package — database connection parameters under environment keys
  - Deployment config: `rsconnect/` directory or `manifest.json`
- **Entity Definition Style**: No Shiny-specific entity definition mechanism. DB access is via DBI/dbplyr patterns inside Shiny server functions. `global.R` is the conventional location for connection setup and shared data access objects.
- **Extraction Approach**:
  1. Detect Shiny project structure (`app.R` or `ui.R`+`server.R` in project root).
  2. Apply DBI + dbplyr extraction to `global.R`, `server.R`, and `app.R`.
  3. Search inside `reactive(...)`, `eventReactive(...)`, `observe(...)`, `observeEvent(...)` function bodies for `dbGetQuery`, `tbl()`, and similar DB calls.
  4. Check `config.yml` for database type and DSN information: parse the YAML for keys containing `host`, `dbname`, `driver`, `dsn` — reveals the database type even when no SQL is visible in source.
  5. Check `.Renviron` and `renv.lock` for `DATABASE_URL` or `DB_DSN` environment variable patterns.
- **Key Challenges**: Reactive programming means queries may be nested inside closures or anonymous functions. SQL strings may be assembled from `input$` UI values (`paste0("SELECT * FROM ", input$table_select)`) — completely dynamic and not statically extractable.
- **Analysis Tools**: Regex; YAML parser for `config.yml`.
- **Complexity**: High

---

### 8. Raw SQL Files Called via DBI or System Commands

- **Name**: SQL files loaded and executed by R code or system calls
- **Type**: Schema File / Raw SQL
- **Supported Databases**: Any
- **Detection Signals**:
  - R patterns: `readLines("path/to/query.sql")`, `readr::read_file("query.sql")`, `paste(readLines(...), collapse="\n")` followed by `dbExecute(conn, sql_string)` or `dbGetQuery(conn, sql_string)`
  - System call patterns: `system("psql -f schema.sql")`, `system2("sqlite3", args = c("db.sqlite", ".read init.sql"))`, `system("mysql < schema.sql")`
  - Files: `*.sql` files anywhere in the project directory tree
- **Entity Definition Style**: Standard SQL DDL (`CREATE TABLE`, `CREATE VIEW`) in `.sql` files, loaded and executed by R code or shell commands invoked from R.
- **Extraction Approach**:
  1. Sweep all `*.sql` files in the repository; parse each for `CREATE TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(["'\`]?(\w+)["'\`]?)` statements.
  2. Also parse `CREATE VIEW\s+(\w+)` and note as views.
  3. Search R source for `readLines`, `readr::read_file`, `read_file`, `readr::read_lines` patterns loading `.sql` files — cross-reference the file path to confirm the SQL file is actively used.
  4. Search for `system(`, `system2(`, `processx::run(` calls that invoke `psql`, `mysql`, `sqlite3`, or similar CLI tools with SQL file arguments.
- **Key Challenges**: SQL files may contain only `SELECT` queries (analytical usage, no schema). DDL files must be distinguished from DML files. The `.sql` file may be a one-off exploratory query rather than a schema definition.
- **Analysis Tools**: Regex for `CREATE TABLE`; SQL DDL parser.
- **Complexity**: Low-Medium (SQL files are the most reliable signal in R projects when present)

---

### 9. data.frame / tibble Column Definitions as Structural Signals

- **Name**: data.frame / tibble schemas (structural heuristic)
- **Type**: In-Memory Data Shape Signal
- **Supported Databases**: Not applicable (in-memory objects)
- **Detection Signals**:
  - R patterns: `data.frame(col1 = ..., col2 = ...)`, `tibble(col1 = ..., col2 = ...)`, `tribble(~col1, ~col2, ...)`
  - Column naming: `snake_case` names matching common DB column patterns (`id`, `user_id`, `created_at`, `updated_at`, `name`, `status`)
  - Variable names: `users_df`, `orders_tbl`, `products_data` — entity-like names with `_df`, `_tbl`, `_data`, `_table` suffixes
  - Usage: passed directly to `dbWriteTable(conn, "table_name", this_df)` — strongest signal
- **Entity Definition Style**: R data frames are in-memory objects with named columns. They do not inherently represent database tables, but they frequently mirror database schema in ETL pipelines, data transformation scripts, and when written to databases via `dbWriteTable`.
- **Extraction Approach**:
  1. Cross-reference: if a data frame variable is directly used in `dbWriteTable(conn, "table_name", df_var)`, extract the data frame's column names from its constructor call.
  2. Search for `data.frame(...)` and `tibble(...)` constructor calls where the variable name has entity-like suffixes.
  3. Extract column names from named constructor arguments.
  4. Treat only as a low-confidence entity signal when corroborated by DB write operations.
- **Key Challenges**: Extremely high false positive rate. Most data frames in R are analytical constructs — summaries, model outputs, transformed data — not database schema mirrors. Only treat as an entity signal when directly corroborated by `dbWriteTable` usage.
- **Analysis Tools**: Regex, R AST tools.
- **Complexity**: High (very low signal-to-noise ratio without corroboration)

---

### 10. readr / readxl / arrow Schemas as Flat File Entity Signals

- **Name**: readr, readxl, arrow (flat file I/O with schema specification)
- **Type**: Flat File Schema Signal
- **Supported Databases**: Not a relational database (CSV, Excel, Parquet, Arrow IPC)
- **Detection Signals**:
  - `DESCRIPTION` / `renv.lock`: `readr`, `readxl`, `arrow`
  - Patterns: `read_csv("file.csv", col_types = cols(...))`, `read_excel("file.xlsx", col_types = ...)`, `arrow::open_dataset("path/", schema = ...)`
  - Arrow schema: `arrow::schema(field("col_name", int32()), ...)`, `arrow::Schema$create(...)`, or inline `schema = schema(col1 = int32(), col2 = utf8())`
- **Entity Definition Style**: `col_types = cols(...)` in `read_csv()` and Arrow `schema(...)` objects define column names and types for flat file data. These are structural signals for data shapes (analogous to table schemas), but the storage medium is files rather than a relational database.
- **Extraction Approach**:
  1. Detect `readr`/`readxl`/`arrow` usage in `DESCRIPTION`/`renv.lock`.
  2. Search for `cols\(([^)]+)\)` specifications in `read_csv` calls — extract named column types from the `cols()` argument.
  3. Search for Arrow `schema(...)` or `Schema$create(field("name", ...)...)` patterns — extract field names.
  4. Extract the file path string from `read_csv("file.csv")` or `open_dataset("path/")` to identify the data source name.
  5. Report as flat-file entity definitions, not relational DB entities.
- **Key Challenges**: File paths may be dynamic variables; column type specifications may be partial (only some columns specified, others inferred). These are flat-file entities and should be reported as a separate category from relational DB entities.
- **Analysis Tools**: Regex.
- **Complexity**: Medium (extraction is straightforward; interpretation requires distinguishing from DB entities)

---

### 11. drake / targets Pipeline Data Shapes

- **Name**: drake (deprecated), targets (active)
- **Type**: Data Pipeline Framework / Computation Graph
- **Supported Databases**: Not a database directly; pipeline targets may include DB queries or file I/O
- **Detection Signals**:
  - `DESCRIPTION` / `renv.lock`: `targets`, `drake`
  - Files: `_targets.R` (targets framework entry point), `make.R` or `R/plan.R` (drake entry points)
  - Patterns: `tar_target("target_name", command_expr)`, `tar_target(target_name, command_expr)` (unquoted), `drake_plan(target_name = expr)`
  - DB access inside target expressions: `dbGetQuery(...)`, `tbl(...)`, `read_csv(...)` within target command expressions
- **Entity Definition Style**: Targets are named computation steps in a pipeline DAG. A target whose expression includes `dbGetQuery()`, `tbl()`, `dbReadTable()`, or file I/O is a data-backed target. The target name is a pipeline artifact identifier, not a database entity name.
- **Extraction Approach**:
  1. Detect `targets` or `drake` in `DESCRIPTION`/`renv.lock`.
  2. Parse `_targets.R` or `make.R` for target definitions.
  3. Within each target's command expression body, apply DBI/dbplyr extraction rules to find embedded DB queries.
  4. DB table names found within target expressions are entity references; associate them with the target name for pipeline documentation context.
  5. Do not use the target name itself as a database entity name.
- **Key Challenges**: Target command expressions may call R functions defined in other `R/` files — full tracing requires function definition resolution, which is beyond simple static analysis. Targets are often described at a high level of abstraction.
- **Analysis Tools**: Regex for `tar_target` patterns; YAML parser if `_targets.yaml` format is used.
- **Complexity**: High (requires cross-file function resolution for complete coverage)

---

## Repository Detection Plan

### Step 1: Identify Storage Technologies in Use

1. Parse `DESCRIPTION` file (if this is an R package): check `Imports`, `Depends`, `Suggests` for database-related packages.
2. Parse `renv.lock` (if renv is in use): enumerate all installed packages; match against known DB library names.
3. Search all `.R`, `.r`, `.Rmd`, `.qmd` files for `library(...)` and `require(...)` calls matching database package names.
4. Check `NAMESPACE` for `importFrom(DBI, ...)`, `importFrom(RPostgres, ...)`, etc.
5. Look for `config.yml` (using the R `config` package) for database connection parameters.
6. Look for `.Renviron` for `DATABASE_URL`, `DB_HOST`, `DB_NAME`, `PGHOST` environment variable patterns.
7. Search for `*.sqlite`, `*.db`, `*.sqlite3` files in the repository (confirms RSQLite usage and enables direct schema inspection).
8. Search for `*.sql` files anywhere in the repository.
9. Check for Shiny project structure: `app.R`, `ui.R`, `server.R`, `global.R`.
10. Check for `_targets.R` (targets) or `make.R` (drake) pipeline entry files.

### Step 2: Determine Database Type

From `dbConnect(...)` driver argument:
- `RPostgres::Postgres()` or `drv = Postgres()` → PostgreSQL
- `RSQLite::SQLite()` or `drv = SQLite()` → SQLite
- `RMySQL::MySQL()` or `drv = MySQL()` → MySQL
- `RMariaDB::MariaDB()` → MariaDB
- `odbc::odbc()` → ODBC (DSN or driver string may reveal DB type)
- `bigrquery::bigquery()` → Google BigQuery
- `ROracle::Oracle()` → Oracle

### Step 3: Apply Extraction in Priority Order

1. RSQLite database file schema: if a `*.sqlite` or `*.db` file is committed to the repository, inspect it directly for the definitive schema (highest confidence)
2. `dbReadTable(conn, "table_name")` and `dbWriteTable(conn, "table_name", ...)` — explicit table name arguments
3. `dbCreateTable(conn, "table_name", ...)` — explicit table name at creation
4. `tbl(conn, "table_name")` (dbplyr) — explicit table name arguments
5. `tbl(conn, in_schema("schema", "table"))` (dbplyr) — schema-qualified explicit names
6. `sqlFetch(channel, "table_name")` (RODBC) — explicit table name arguments
7. `dbExecute(conn, "CREATE TABLE ...")` with static SQL literal
8. `CREATE TABLE` in `.sql` files (always sweep regardless of other findings)
9. `FROM <table>` / `INSERT INTO <table>` in non-assembled R string literals
10. `dbGetQuery` / `dbExecute` with non-assembled SQL strings
11. Arrow schema fields and `read_csv` column type specifications (flat-file signals only)
12. data.frame/tibble column names corroborated by `dbWriteTable` usage (lowest confidence)

### Step 4: Extract from RMarkdown and Quarto Documents

R code may live in `.Rmd` (RMarkdown) and `.qmd` (Quarto) files inside code chunks:
- Extract R code chunks delimited by ` ```{r ...} ` ... ` ``` ` markers (RMarkdown) or ` ```{r} ` markers (Quarto).
- Apply all standard R extraction rules to the extracted chunk content.
- Label entities found in notebook files as "possibly exploratory" (lower confidence than `.R` script files).
- knitr `sql` engine chunks (` ```{sql connection=conn} `) contain raw SQL — parse these directly for `FROM`/`CREATE TABLE` references.

### Step 5: Acknowledge Limitations

Static analysis of R repositories for entity extraction has fundamental limitations that must be communicated in output:

- **SQL string assembly**: `paste0()`, `glue()`, `sprintf()`, and `paste()` make table names dynamic and unextractable statically. These represent a large fraction of real-world R SQL usage.
- **Interactive/exploratory code**: R is heavily used for ad hoc analysis and data exploration. Many DB queries are one-off explorations with no stable schema significance — they should not be treated as canonical entity definitions.
- **No ORM conventions**: R has no ORM framework with explicit entity class declarations. All signals come from string literals in raw SQL or function arguments.
- **Realistic recall estimate**: Expect 40-70% recall of actual database tables referenced in well-structured R codebases. In heavily analytical or notebook-heavy repositories, recall may be 20-40%. False positive rates can be kept low by being conservative (literal strings only, no variable-name tracking).

### Key Files to Always Check

| File / Pattern | Significance |
|---|---|
| `DESCRIPTION` | R package dependency manifest |
| `renv.lock` | renv dependency snapshot |
| `NAMESPACE` | R package namespace (import declarations) |
| `.R`, `.r` (all) | R source files |
| `.Rmd` (all) | RMarkdown documents with embedded R code |
| `.qmd` (all) | Quarto documents with embedded R code |
| `global.R` | Shiny global setup (common DB connection location) |
| `app.R`, `server.R` | Shiny application files |
| `_targets.R` | targets pipeline entry point |
| `config.yml` | `config` package database settings |
| `.Renviron` | Environment variables (DB connection strings) |
| `*.sql` | Raw SQL files (always sweep) |
| `*.sqlite`, `*.db`, `*.sqlite3` | SQLite database files (inspect directly when present) |

### Confidence Levels

| Signal Type | Confidence |
|---|---|
| SQLite file in repo: `sqlite_master` table names | High |
| `dbReadTable(conn, "name")` literal | High |
| `dbWriteTable(conn, "name", ...)` literal | High |
| `dbCreateTable(conn, "name", ...)` literal | High |
| `tbl(conn, "name")` literal (dbplyr) | High |
| `tbl(conn, in_schema("schema", "table"))` literals | High |
| `sqlFetch(channel, "name")` literal (RODBC) | High |
| `CREATE TABLE` in `.sql` files | High |
| `CREATE TABLE` in non-assembled R string literal | Medium |
| `FROM table` in non-assembled R string literal | Medium |
| `sqlColumns(channel, "name")` (RODBC metadata) | Medium |
| `FROM table` via `paste()`/`glue()` | Not extractable |
| `dbGetQuery` with assembled SQL string | Not extractable |
| data.frame columns corroborated by `dbWriteTable` | Low-Medium |
| Arrow schema field names | Low-Medium (flat file only) |
| `read_csv` `col_types` column names | Low (flat file only) |
| Arbitrary data.frame column name heuristic | Low |

### Realistic Expectations

R is a **low-signal language** for automated database entity extraction. Best results come from:

1. **RSQLite with a committed `.sqlite` file** — direct schema inspection bypasses all source-level limitations.
2. **dbplyr with `tbl(conn, "literal_table_name")`** — the most explicit R-level entity reference mechanism.
3. **Committed `.sql` schema files** — independently parseable with high reliability.
4. **`dbWriteTable` / `dbReadTable` / `dbCreateTable` with literal names** — simple, unambiguous table name signals.

Repositories that rely entirely on dynamically assembled SQL strings will yield very few extractable entity names. This is a realistic and common situation in R data science codebases.
