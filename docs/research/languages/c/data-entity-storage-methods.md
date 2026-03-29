# C Data Entity Storage Methods

Catalog of significant data entity storage frameworks, libraries, and approaches for C repositories. Intended to support automated static analysis for extracting data entities (database tables, document collections, etc.).

---

## 1. libpq (PostgreSQL C Client Library)

- **Name**: libpq
- **Type**: Raw SQL
- **Supported Databases**: PostgreSQL
- **Detection Signals**:
  - Dependencies: `libpq` or `postgresql` in `CMakeLists.txt` (`find_package(PostgreSQL REQUIRED)`, `target_link_libraries(... PostgreSQL::PostgreSQL ...)` or `-lpq`); Makefile link flags `-lpq`; `pkg-config libpq` references
  - Include patterns: `#include <libpq-fe.h>`, `#include <postgresql/libpq-fe.h>`, `#include "libpq-fe.h"`
  - Function usage: `PQconnectdb`, `PQconnectdbParams`, `PQexec`, `PQexecParams`, `PQprepare`, `PQexecPrepared`, `PQresultStatus`, `PQgetvalue`
- **Entity Definition Style**: SQL strings passed directly to `PQexec` or `PQexecParams`. No formal entity class — structs manually map to query result columns.
  ```c
  PGconn *conn = PQconnectdb("host=localhost dbname=mydb");
  PGresult *res = PQexec(conn, "SELECT user_id, username FROM users WHERE active = TRUE");
  // Manual field access by column index:
  char *username = PQgetvalue(res, 0, 1);
  ```
- **Extraction Approach**:
  1. Detect `#include <libpq-fe.h>` to confirm libpq usage.
  2. Scan all `.c` and `.h` files for `PQexec(`, `PQexecParams(`, `PQprepare(` calls.
  3. Extract the second string argument (the SQL query) from each call using AST or regex.
  4. Apply SQL parsing to extract table names from `FROM`, `INTO`, `UPDATE`, `JOIN`, `CREATE TABLE` clauses.
  5. Scan co-located `*.sql` DDL files for schema definitions.
  6. Struct definitions near query code (especially those with field names matching column names) can be cross-referenced as entity signals.
- **Key Challenges**:
  - SQL strings may be assembled via `sprintf`, `snprintf`, `strcat`, `strncat` — static extraction of dynamically built queries is incomplete.
  - Prepared statement names (passed as the first argument to `PQprepare`) do not carry table information; the SQL template does.
  - PostgreSQL-specific syntax (`RETURNING`, `$1` placeholders, `COPY`) requires dialect-aware SQL parsing.
  - Column indices used in `PQgetvalue(res, row, col)` do not carry semantic names; struct mapping is purely by developer convention.
- **Analysis Tools**:
  - tree-sitter-c: parse function call expressions and extract string literal arguments
  - Regex fallback: `PQexec\s*\([^,]+,\s*"([^"]+)"`
  - pg_query (PostgreSQL SQL parser) for parsing extracted SQL strings
- **Complexity**: Medium

---

## 2. MySQL C Connector (libmysqlclient)

- **Name**: MySQL C Connector (`mysql.h` / `libmysqlclient`)
- **Type**: Raw SQL
- **Supported Databases**: MySQL, MariaDB
- **Detection Signals**:
  - Dependencies: `-lmysqlclient` in Makefile or `CMakeLists.txt`; `find_package(MySQL ...)` or `find_package(MariaDB ...)`; `mysql_config --libs` in build scripts
  - Include patterns: `#include <mysql/mysql.h>`, `#include <mysql.h>`, `#include <mariadb/mysql.h>`
  - Function usage: `mysql_init`, `mysql_real_connect`, `mysql_query`, `mysql_real_query`, `mysql_stmt_init`, `mysql_stmt_prepare`, `mysql_fetch_row`, `mysql_fetch_field`
- **Entity Definition Style**: SQL strings passed to `mysql_query` or `mysql_stmt_prepare`. Struct field mapping is manual and implicit.
  ```c
  MYSQL *conn = mysql_init(NULL);
  mysql_real_connect(conn, "localhost", "user", "pass", "mydb", 0, NULL, 0);
  mysql_query(conn, "SELECT product_id, product_name, price FROM products");
  MYSQL_RES *result = mysql_store_result(conn);
  ```
- **Extraction Approach**:
  1. Detect `#include <mysql/mysql.h>` or `mysql_init` function usage.
  2. Extract string literals from `mysql_query(conn, "...")` and `mysql_stmt_prepare(stmt, "...", len)` calls.
  3. Parse extracted SQL for table names.
  4. `mysql_fetch_field` results can indicate column names at runtime; for static analysis focus on SQL strings.
  5. Check for `MYSQL_BIND` arrays — field count and structure can hint at entity shape.
- **Key Challenges**:
  - Prepared statements separate the SQL template from parameter binding; template still reveals table structure.
  - MariaDB Connector/C uses the same API surface, so detection signals are identical.
  - Dynamic SQL construction via string formatting is very common in C.
- **Analysis Tools**:
  - tree-sitter-c, regex: `mysql_query\s*\([^,]+,\s*"([^"]+)"`
  - SQL parser for MySQL dialect (handles backtick identifiers)
- **Complexity**: Medium

---

## 3. SQLite C API (sqlite3.h)

- **Name**: SQLite C API
- **Type**: Raw SQL
- **Supported Databases**: SQLite
- **Detection Signals**:
  - Dependencies: `sqlite3` in `vcpkg.json`, `CMakeLists.txt` (`find_package(SQLite3 ...)`, `target_link_libraries(... SQLite::SQLite3 ...)`); `-lsqlite3` in Makefile; `sqlite3.c` / `sqlite3.h` vendored directly in repo (amalgamation)
  - Include patterns: `#include <sqlite3.h>`, `#include "sqlite3.h"`
  - Function usage: `sqlite3_open`, `sqlite3_open_v2`, `sqlite3_exec`, `sqlite3_prepare_v2`, `sqlite3_prepare`, `sqlite3_step`, `sqlite3_column_text`, `sqlite3_bind_*`
- **Entity Definition Style**: SQL strings passed to `sqlite3_exec` or `sqlite3_prepare_v2`. Often includes `CREATE TABLE` statements inline.
  ```c
  sqlite3 *db;
  sqlite3_open("mydata.db", &db);
  sqlite3_exec(db,
    "CREATE TABLE IF NOT EXISTS sessions ("
    "  session_id TEXT PRIMARY KEY,"
    "  user_id INTEGER NOT NULL,"
    "  created_at INTEGER"
    ");", NULL, NULL, NULL);
  sqlite3_stmt *stmt;
  sqlite3_prepare_v2(db, "SELECT session_id, user_id FROM sessions WHERE user_id = ?", -1, &stmt, NULL);
  ```
- **Extraction Approach**:
  1. Detect `#include <sqlite3.h>` or vendored `sqlite3.c` in the repository.
  2. Extract string literals from:
     - `sqlite3_exec(db, "...", ...)` — second argument
     - `sqlite3_prepare_v2(db, "...", ...)` — second argument
     - `sqlite3_prepare(db, "...", ...)` — second argument
  3. Handle multi-line string literal concatenation in C (adjacent string literals).
  4. Parse extracted SQL: `CREATE TABLE` definitions give definitive entity names and schemas; `FROM`, `INTO`, `UPDATE` give usage-based entity signals.
  5. If `.db` or `.sqlite` files are present in the repo, open them and extract schema via `SELECT sql FROM sqlite_master WHERE type='table'`.
- **Key Challenges**:
  - Multi-line string literals in C (adjacent literals concatenated by preprocessor) require proper C parser handling rather than single-line regex.
  - `sqlite3_exec` callback function pointers receive row data but don't carry schema information.
  - WAL journal files (`.db-wal`, `.db-shm`) are runtime artifacts, not useful for static analysis.
  - Vendored `sqlite3.c` amalgamation must be excluded from source analysis (it is not application code).
- **Analysis Tools**:
  - tree-sitter-c: handles adjacent string literal concatenation natively
  - SQLite file inspection: `sqlite3 mydata.db .schema` or `SELECT sql FROM sqlite_master WHERE type='table'`
  - Regex as fallback for simpler cases
- **Complexity**: Low

---

## 4. Raw SQL Files (DDL Schema Files)

- **Name**: Raw SQL Schema Files
- **Type**: Schema File
- **Supported Databases**: Any (PostgreSQL, MySQL, SQLite, SQL Server, Oracle, etc.)
- **Detection Signals**:
  - File extensions: `*.sql`
  - Common directories: `sql/`, `db/`, `schema/`, `database/`, `scripts/`, `migrations/`, `resources/`
  - File naming: `schema.sql`, `init.sql`, `create_tables.sql`, `tables.sql`, `ddl.sql`
  - May be referenced from C source via `#include "schema.sql"` (unusual), embedded as string literals, or loaded at runtime via `fopen`/`sqlite3_exec`
- **Entity Definition Style**: Standard SQL DDL.
  ```sql
  CREATE TABLE events (
      event_id    INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type  TEXT NOT NULL,
      payload     BLOB,
      occurred_at INTEGER NOT NULL
  );
  ```
- **Extraction Approach**:
  1. Glob all `*.sql` files recursively.
  2. For each file, parse `CREATE TABLE [IF NOT EXISTS] <name>` statements.
  3. Capture column definitions within each `CREATE TABLE` block.
  4. Also parse `CREATE VIEW`, `CREATE INDEX ON <tablename>` for secondary signals.
  5. Scan C source files for `fopen` calls with `.sql` filename arguments — these point to SQL files loaded at runtime.
  6. Look for SQL content embedded as multi-line string literals in C source (`char *schema = "CREATE TABLE ..."`) — extract and parse.
- **Key Challenges**:
  - SQL dialects differ; backtick identifiers (MySQL), double-quote identifiers (PostgreSQL/SQLite), bracket identifiers (SQL Server) all need handling.
  - Migration files may contain `DROP TABLE` / `ALTER TABLE` — need ordered processing to get final schema.
  - Stored procedure bodies may contain `CREATE TEMP TABLE` that are not persistent application entities.
- **Analysis Tools**:
  - pg_query, sql-parser, custom regex: `CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)`
- **Complexity**: Low

---

## 5. Embedded SQL / ESQL/C (ecpg)

- **Name**: Embedded SQL in C (ESQL/C, ecpg)
- **Type**: Raw SQL (Embedded)
- **Supported Databases**: PostgreSQL (ecpg), Oracle Pro*C, IBM DB2 ESQL/C
- **Detection Signals**:
  - File extensions: `*.pgc` (ecpg for PostgreSQL), `*.pc` (Oracle Pro*C), `*.sqc` (IBM DB2), `*.ec` (Informix ESQL/C)
  - Build tools: `ecpg` preprocessor invocation in Makefile or `CMakeLists.txt`; `proc` (Oracle); `db2 prep` (DB2)
  - Include patterns in generated `.c` files: `#include <ecpglib.h>`, `#include <sqlca.h>`
  - Syntax in source: `EXEC SQL ...;` blocks
- **Entity Definition Style**: SQL statements embedded directly in C code with `EXEC SQL` prefix.
  ```c
  EXEC SQL BEGIN DECLARE SECTION;
    int    customer_id;
    char   customer_name[64];
  EXEC SQL END DECLARE SECTION;

  EXEC SQL SELECT customer_id, customer_name
           INTO :customer_id, :customer_name
           FROM customers
           WHERE active = 1;
  ```
- **Extraction Approach**:
  1. Detect `*.pgc`, `*.pc`, `*.sqc`, `*.ec` files or `EXEC SQL` patterns in `*.c` files.
  2. Extract all `EXEC SQL ... ;` blocks.
  3. Within those blocks, parse the embedded SQL for `FROM`, `INTO`, `UPDATE`, `CREATE TABLE` table references.
  4. `EXEC SQL BEGIN DECLARE SECTION` / `END DECLARE SECTION` blocks declare host variable types — extract these as hints for entity shapes.
  5. `EXEC SQL DECLARE cursor_name CURSOR FOR SELECT ...` statements reveal table access patterns.
- **Key Challenges**:
  - ESQL/C files require the `ecpg` preprocessor to produce valid C; the pre-processed `.c` output is more parseable but may not be in the repo.
  - Host variable bindings (`:variable_name`) need to be correlated with their C type declarations.
  - Oracle Pro*C syntax differs from ecpg; detection signals need to cover both.
- **Analysis Tools**:
  - Regex: `EXEC\s+SQL\s+(.*?)\s*;` (with DOTALL flag for multi-line)
  - Custom parser for `EXEC SQL` blocks
  - SQL parser applied to extracted statement bodies
- **Complexity**: High

---

## 6. ODBC (sql.h / sqlext.h)

- **Name**: ODBC (Open Database Connectivity)
- **Type**: Raw SQL
- **Supported Databases**: Any database with an ODBC driver (SQL Server, Oracle, PostgreSQL, MySQL, SQLite, etc.)
- **Detection Signals**:
  - Dependencies: `-lodbc` or `-liodbc` in Makefile; `find_package(ODBC ...)` in CMakeLists.txt; `ODBC::ODBC` target
  - Include patterns: `#include <sql.h>`, `#include <sqlext.h>`, `#include <sqltypes.h>`, `#include <odbcinst.h>`
  - Function usage: `SQLAllocHandle`, `SQLDriverConnect`, `SQLConnect`, `SQLExecDirect`, `SQLPrepare`, `SQLExecute`, `SQLFetch`, `SQLGetData`, `SQLBindCol`
- **Entity Definition Style**: SQL strings passed to `SQLExecDirect` or `SQLPrepare`. No entity annotations.
  ```c
  SQLAllocHandle(SQL_HANDLE_STMT, hdbc, &hstmt);
  SQLExecDirect(hstmt, (SQLCHAR*)"SELECT order_id, order_date FROM orders", SQL_NTS);
  SQLBindCol(hstmt, 1, SQL_C_LONG, &order_id, 0, &ind1);
  SQLBindCol(hstmt, 2, SQL_C_CHAR, order_date, sizeof(order_date), &ind2);
  ```
- **Extraction Approach**:
  1. Detect `#include <sql.h>` or ODBC function usage.
  2. Extract string literals from `SQLExecDirect(hstmt, "...", SQL_NTS)` — second argument.
  3. Extract string literals from `SQLPrepare(hstmt, "...", SQL_NTS)` — second argument.
  4. Note: ODBC uses `SQLCHAR*` casts, so string arguments may appear as `(SQLCHAR*)"SELECT ..."` — strip the cast.
  5. Parse extracted SQL for table names.
  6. `SQLDescribeCol` and `SQLColAttribute` calls at runtime describe result columns; static analysis cannot capture these.
  7. ODBC DSN configuration (`.odbc.ini`, `odbc.ini`, `odbcinst.ini`) reveals target database type.
- **Key Challenges**:
  - ODBC is database-agnostic; the actual database type is only known from the DSN/connection string at runtime.
  - `SQLTables` system catalog calls reveal accessible tables but are not static.
  - Wide-character (`SQLExecDirectW`, `SQLWCHAR*`) variants require Unicode string extraction.
- **Analysis Tools**:
  - tree-sitter-c, regex: `SQLExecDirect\s*\([^,]+,\s*(?:\(SQLCHAR\*\))?\s*"([^"]+)"`
  - DSN config file parsing (INI format)
- **Complexity**: Medium

---

## 7. Database Schema Files (.sql DDL)

*(Covered in depth under section 4 — Raw SQL Files. See that section for full extraction approach.)*

This entry specifically covers DDL files that define the authoritative schema, as opposed to query files. Key indicators that a `.sql` file is a schema definition (not a query file):
- Majority of statements are `CREATE TABLE`, `CREATE INDEX`, `CREATE VIEW`, `ALTER TABLE`
- File is located in a `schema/`, `ddl/`, or `database/` directory
- File contains `-- schema version` or similar comments
- File is referenced in build or deployment scripts

---

## 8. Protobuf C (protobuf-c)

- **Name**: protobuf-c
- **Type**: Schema File / Serialization Framework
- **Supported Databases**: N/A (serialization format)
- **Detection Signals**:
  - File extensions: `*.proto`
  - Dependencies: `protobuf-c` in package manager or `CMakeLists.txt` (`find_library(PROTOBUF_C ...)`, `target_link_libraries(... protobuf-c ...)`); `protoc-c` or `protoc --c_out` invocation in build scripts
  - Include patterns: `#include <protobuf-c/protobuf-c.h>`, generated `*.pb-c.h` and `*.pb-c.c` files
- **Entity Definition Style**: `.proto` message definitions, identical to C++ Protobuf.
  ```proto
  message DeviceRecord {
    uint64 device_id = 1;
    string device_name = 2;
    string firmware_version = 3;
    repeated string capabilities = 4;
  }
  ```
- **Extraction Approach**:
  1. Glob for all `*.proto` files.
  2. Parse `message MessageName { ... }` blocks for top-level message names.
  3. Cross-reference with `*.pb-c.h` generated files to confirm C code generation.
  4. Identify persistence signals: messages used as values in SQLite/PostgreSQL blobs, referenced in `CREATE TABLE` column types (`BLOB`, `BYTEA`).
- **Key Challenges**:
  - `*.proto` files may define wire-format messages rather than stored entities.
  - Distinguishing between API messages and storage messages requires cross-referencing with SQL queries that store `BLOB` fields.
- **Analysis Tools**:
  - Regex: `^message\s+(\w+)\s*\{`; tree-sitter-proto grammar
- **Complexity**: Medium

---

## 9. Struct Definitions with Table-Mapping Conventions (Heuristic)

- **Name**: C Struct as Implicit Entity (Heuristic)
- **Type**: Heuristic Entity Signal
- **Supported Databases**: Any (SQLite, PostgreSQL, MySQL, etc.)
- **Detection Signals**:
  - Struct names with common suffixes: `_t`, `_record`, `_row`, `_entity`, `_db`, `_data`, e.g., `user_record_t`, `product_row_t`
  - Structs defined in files named `db.h`, `models.h`, `entities.h`, `records.h`, `schema.h`
  - Struct fields with database-like names: `id`, `created_at`, `updated_at`, `deleted_at`, fields ending in `_id`
  - Structs immediately referenced in SQL-related function calls (their addresses passed to bind functions)
  - `typedef struct { ... } TableName;` patterns where the typedef name matches a known table name from SQL scan
- **Entity Definition Style**: Plain C structs used as row containers.
  ```c
  typedef struct {
      int64_t  user_id;      /* PRIMARY KEY */
      char     username[64];
      char     email[128];
      int64_t  created_at;   /* Unix timestamp */
      int      is_active;
  } user_record_t;
  ```
- **Extraction Approach**:
  1. Parse all `*.h` header files for `struct` and `typedef struct` definitions.
  2. Score each struct against heuristics:
     - Contains an `id` or `*_id` field (+2 points)
     - Contains `created_at`, `updated_at` (+1 point each)
     - Struct name ends in `_record`, `_row`, `_entity`, `_db` (+2 points)
     - Defined in a file with a database-related name (+1 point)
     - Referenced in a file containing SQL function calls (+3 points)
     - At least 3 fields (+1 point)
  3. Structs scoring >= 4 are candidate entities.
  4. Cross-reference struct field names with column names found in SQL string analysis.
- **Key Challenges**:
  - Many C structs are not database entities; false positive rate is significant.
  - Field names in C may be abbreviated or use different conventions than SQL column names.
  - Comment annotations (e.g., `/* PRIMARY KEY */`, `/* FK: users.id */`) are highly informative but require comment parsing.
- **Analysis Tools**:
  - tree-sitter-c: parse struct declarations, field names, typedef names
  - Regex: `typedef\s+struct\s*\{[^}]+\}\s*(\w+)\s*;`
- **Complexity**: High

---

## 10. Header Files with Table-Mapping Structs

- **Name**: Database Header Files (Explicit Mapping Headers)
- **Type**: Schema File (Implicit)
- **Supported Databases**: Any
- **Detection Signals**:
  - File names: `db.h`, `database.h`, `models.h`, `entities.h`, `schema.h`, `tables.h`, `records.h`, `orm.h`
  - Files in `include/db/`, `src/db/`, `include/models/`, `src/models/` directories
  - Header files that `#include` both a database library header (`sqlite3.h`, `libpq-fe.h`, `mysql.h`) and define structs
  - Comment blocks with `/* Table: tablename */` or `// @table tablename` annotations
- **Entity Definition Style**: Structs in dedicated header files, often with comments documenting the mapping.
  ```c
  /* Table: orders */
  typedef struct {
      int64_t  order_id;       /* PK */
      int64_t  customer_id;    /* FK: customers.customer_id */
      double   total_amount;
      int64_t  order_date;     /* Unix timestamp */
      int      status;         /* 0=pending, 1=complete, 2=cancelled */
  } order_t;
  ```
- **Extraction Approach**:
  1. Identify candidate header files by name and directory patterns above.
  2. Parse struct definitions in those headers.
  3. Extract `/* Table: name */` or `// @table name` comment annotations for authoritative table names.
  4. In absence of annotations, derive table name from struct name: strip `_t` suffix, lowercase, optionally pluralize.
  5. Extract field names from struct members as column candidates.
- **Key Challenges**:
  - No universal comment convention; annotations are developer-specific.
  - Struct names often differ from table names in non-obvious ways.
  - Pointer fields, nested structs, and arrays represent relationships, not plain columns.
- **Analysis Tools**:
  - tree-sitter-c with comment parsing
  - Regex for comment-based annotations: `/\*\s*[Tt]able:\s*(\w+)\s*\*/`
- **Complexity**: High

---

## Repository Detection Plan

### Step 1: Build System and Dependency Analysis
- Scan for `CMakeLists.txt`, `Makefile`, `configure.ac`, `meson.build`, `*.mk` files
- Extract `-l<library>` flags and `find_package` / `pkg-config` calls to identify database libraries
- Build a project-level map: which database libraries are in use

### Step 2: Header Include Analysis
- Glob for `*.c`, `*.h` files
- Grep for known database include patterns:

| Include | Framework |
|---|---|
| `<libpq-fe.h>` | libpq (PostgreSQL) |
| `<mysql/mysql.h>` | MySQL C Connector |
| `<sqlite3.h>` | SQLite C API |
| `<sql.h>` + `<sqlext.h>` | ODBC |
| `<ecpglib.h>` | ecpg (PostgreSQL ESQL/C) |
| `<sqlca.h>` | ESQL/C (generic) |
| `<protobuf-c/protobuf-c.h>` | Protobuf C |

### Step 3: SQL String Extraction
For each detected SQL library, extract SQL string literals from relevant function calls:

| Function Pattern | Library |
|---|---|
| `PQexec(*, "SQL")` | libpq |
| `PQexecParams(*, "SQL", ...)` | libpq |
| `mysql_query(*, "SQL")` | MySQL |
| `mysql_real_query(*, "SQL", *)` | MySQL |
| `sqlite3_exec(*, "SQL", ...)` | SQLite |
| `sqlite3_prepare_v2(*, "SQL", ...)` | SQLite |
| `SQLExecDirect(*, "SQL", *)` | ODBC |
| `SQLPrepare(*, "SQL", *)` | ODBC |

Apply SQL parser to all extracted strings; collect table names from `FROM`, `INTO`, `UPDATE`, `CREATE TABLE`, `JOIN` clauses.

### Step 4: ESQL/C File Processing
- Glob for `*.pgc`, `*.pc`, `*.sqc`, `*.ec` files
- Extract `EXEC SQL ... ;` blocks and apply SQL parser

### Step 5: Schema File Discovery
- Glob for `*.sql` files recursively
- Classify each file as schema/DDL vs. query/DML by statement composition
- Parse `CREATE TABLE` statements from DDL files
- Process migration files in version order if migration directories are detected

### Step 6: Protobuf Schema Discovery
- Glob for `*.proto` files
- Extract `message` definitions
- Cross-reference with SQL blob storage patterns to identify persisted messages

### Step 7: Struct Heuristic Analysis
- Parse all `*.h` header files for struct definitions
- Apply scoring heuristics (see section 9)
- Include high-scoring structs as low-confidence entity candidates

### Step 8: Cross-Reference and Deduplication
- Merge entity names from:
  - SQL `CREATE TABLE` statements (high confidence)
  - SQL `FROM`/`INTO`/`UPDATE` usage (medium confidence)
  - Struct heuristic analysis (low confidence)
  - Protobuf messages (medium confidence — if cross-referenced with blob storage)
- Deduplicate by normalizing names (lowercase, strip underscores/pluralization)
- Assign confidence scores and source locations

### Step 9: Output
- Produce entity list with: name, probable table/collection name, framework, confidence, source file(s)
- Flag entities found only in schema files but not in application SQL as "possibly legacy"
- Flag entities found only via struct heuristics as "unconfirmed"
