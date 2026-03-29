# Lua: Data Entity Storage Methods

A catalog of frameworks, libraries, and approaches for data entity storage in Lua, oriented toward automated static analysis of repositories to extract database tables, document collections, and similar data entities.

---

## Frameworks and Approaches

---

### 1. LuaSQL

- **Name**: LuaSQL
- **Type**: Raw SQL / Database Connectivity Layer
- **Supported Databases**: MySQL, PostgreSQL, SQLite, ODBC, Oracle, Firebird
- **Detection Signals**:
  - LuaRocks `.rockspec` or installed rock names: `luasql-mysql`, `luasql-postgres`, `luasql-sqlite3`, `luasql-odbc`, `luasql-oracle`, `luasql-firebird`
  - `luarocks.lock` file entries with matching package names
  - Require patterns: `require "luasql.mysql"`, `require "luasql.postgres"`, `require "luasql.sqlite3"`, `require("luasql.mysql")`
  - Variable patterns: `local env = luasql.mysql()`, `local conn = env:connect(...)`, `local cur = conn:execute("...")`
  - SQL execution: `conn:execute("SELECT ...")`, `conn:execute("CREATE TABLE ...")`
- **Entity Definition Style**: No ORM layer. Tables are referenced and defined entirely through raw SQL strings passed to `conn:execute(...)`. No Lua-level entity representation exists.
- **Extraction Approach**:
  1. Search all `.lua` files for `require.*luasql` to confirm LuaSQL usage and identify the database driver.
  2. Search for `:execute(` calls — extract string literal arguments (both single-quoted and double-quoted strings).
  3. Also extract Lua long string arguments: `[[ CREATE TABLE ... ]]` and `[=[ ... ]=]` forms.
  4. Parse extracted strings for `CREATE TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(\w+)` patterns.
  5. Also extract `INSERT INTO\s+(\w+)` and `SELECT.*FROM\s+(\w+)` for table names referenced in DML.
  6. Search for `.sql` files in the project that are loaded via `io.open(...)` or `os.execute(...)` and passed to `conn:execute`.
- **Key Challenges**:
  - SQL is entirely in Lua string literals or external files — no type-level schema.
  - Lua's multi-line string syntax (`[[...]]`, `[=[...]=]`) must be handled alongside quoted strings.
  - String concatenation for SQL (`"CREATE TABLE " .. tableName`) produces non-static table names that cannot be resolved statically.
  - LuaSQL drivers are generic; the same `:execute` pattern applies regardless of the specific database type.
- **Analysis Tools**: Regex for `require` and `:execute` patterns; SQL DDL parser; tree-sitter-lua for reliable multi-line string extraction.
- **Complexity**: High (raw SQL in dynamic strings)

---

### 2. lua-resty-mysql / lua-resty-postgres / pgmoon

- **Name**: lua-resty-mysql, lua-resty-postgres, pgmoon
- **Type**: Raw SQL / Async Database Client (OpenResty/Nginx context)
- **Supported Databases**: MySQL (lua-resty-mysql), PostgreSQL (lua-resty-postgres, pgmoon)
- **Detection Signals**:
  - `.rockspec` or OPM (OpenResty Package Manager) listings: `lua-resty-mysql`, `pgmoon`, `lua-resty-postgres`
  - `nginx.conf` or `openresty.conf` files present in the project
  - Lua code in `content_by_lua_block`, `content_by_lua_file`, `init_by_lua_block` Nginx directives
  - Require patterns: `require "resty.mysql"`, `require "resty.postgres"`, `require "pgmoon"`
  - Object patterns: `local mysql = require "resty.mysql"`, `local db = mysql:new()`, `db:connect(...)`, `db:query("...")`
  - pgmoon patterns: `local pgmoon = require("pgmoon")`, `pg:query("...")`
- **Entity Definition Style**: Raw SQL queries passed to `:query(...)` or `:send_query(...)`. No ORM layer. Schema is defined in SQL strings or external migration files.
- **Extraction Approach**:
  1. Detect OpenResty context by searching for `nginx.conf`, `openresty.conf`, or `ngx.` API usage in Lua files.
  2. Search for `require "resty.mysql"`, `require "pgmoon"`, `require "resty.postgres"`.
  3. Extract string arguments from `:query("...")` and `:send_query("...")` calls.
  4. Parse SQL strings for `CREATE TABLE`, `INSERT INTO`, `SELECT.*FROM` to enumerate table names.
  5. Check for schema initialization scripts in `sql/`, `migrations/`, or project root directories.
  6. For inline Lua in `nginx.conf`, extract `content_by_lua_block { ... }` content and apply the same parsing rules.
- **Key Challenges**:
  - OpenResty Lua code is often embedded in Nginx config directives; the entry points may be indirect.
  - Connection pooling (via `ngx.socket`) means queries may be assembled inside anonymous functions.
  - SQL is raw — same challenges as LuaSQL.
  - `nginx.conf` requires its own parser to extract embedded Lua blocks.
- **Analysis Tools**: tree-sitter-lua; regex; Nginx config text extraction for `*_by_lua_block` directives.
- **Complexity**: High

---

### 3. lsqlite3 / luasqlite3

- **Name**: lsqlite3, lsqlite3complete, luasqlite3
- **Type**: SQLite Binding
- **Supported Databases**: SQLite
- **Detection Signals**:
  - `.rockspec`: `lsqlite3`, `lsqlite3complete`
  - Require patterns: `require "lsqlite3"`, `require("lsqlite3complete")`, `require "sqlite3"`
  - Object patterns: `local db = sqlite3.open("file.db")`, `db:exec("...")`, `db:execute("...")`, `db:prepare("...")`
  - LÖVE framework context: `love.filesystem` API calls (`love.filesystem.read(...)`, `love.filesystem.getPath(...)`) alongside lsqlite3 patterns; `conf.lua` or `main.lua` in project root
- **Entity Definition Style**: Pure SQLite SQL strings. Tables are defined via `db:exec("CREATE TABLE ...")` or `db:prepare("CREATE TABLE ...")` followed by `stmt:step()`.
- **Extraction Approach**:
  1. Search for `require.*lsqlite3` or `require.*sqlite3` patterns.
  2. Extract string arguments from `db:exec(`, `db:execute(`, `:prepare(` calls.
  3. Parse for `CREATE TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(\w+)` patterns.
  4. Extract the SQLite database file path from `sqlite3.open("path")` for project context.
  5. In LÖVE projects, also check for `.sql` files loaded via `love.filesystem.read(...)`.
- **Key Challenges**: Same raw SQL challenges as LuaSQL. In LÖVE game projects, SQLite is often used for save data or configuration rather than structured application entities — weight confidence accordingly.
- **Analysis Tools**: Regex, tree-sitter-lua.
- **Complexity**: High

---

### 4. Tarantool Built-in Spaces

- **Name**: Tarantool (built-in Lua database engine)
- **Type**: In-Process NoSQL / Relational-capable Data Store (Lua-native)
- **Supported Databases**: Tarantool (native msgpack-based storage with optional SQL via `box.execute`)
- **Detection Signals**:
  - Project structure: `init.lua` at project root containing `box.cfg{...}` call
  - Lua API usage: `box.schema.space.create(...)`, `box.space.<name>`, `box.execute(...)`
  - Config files: `tarantool.yaml` or `config.yaml` (Tarantool 3.x declarative config format), `.tarantool.yml`
  - Docker/CI: `FROM tarantool/tarantool` in `Dockerfile` or `docker-compose.yml`
  - Global `box` object access in any `.lua` file (Tarantool-specific global)
- **Entity Definition Style**: Spaces (equivalent to tables or collections) are created with `box.schema.space.create("space_name", {...options...})`. Column definitions (format) are set via `box.space.space_name:format({...})`. Indexes are defined with `box.space.space_name:create_index("index_name", {parts = {...}})`. With Tarantool 2.x SQL mode, `box.execute("CREATE TABLE ...")` is also valid. In Tarantool 3.x, spaces may be declared in the YAML config.
  ```lua
  box.schema.space.create('orders', {if_not_exists = true})
  box.space.orders:format({
      {name = 'id',         type = 'unsigned'},
      {name = 'customer',   type = 'string'},
      {name = 'status',     type = 'string'},
  })
  box.space.orders:create_index('primary', {parts = {'id'}})
  ```
- **Extraction Approach**:
  1. Detect Tarantool context by searching for `box.cfg`, `box.schema`, or `box.space` in `.lua` files, or a `tarantool.yaml` / `config.yaml` file.
  2. Search for `box\.schema\.space\.create\s*\(\s*['"]([^'"]+)['"]` — extract the first argument as the space name.
  3. Search for `box\.space\.(\w+)` — the identifier after `box.space.` is a space name reference.
  4. Search for `:format\s*\(\s*\{` on a known space object to extract field definitions.
  5. Search for `box\.execute\s*\(\s*['"](\s*CREATE\s+TABLE\s+[^'"]+)['"]` for SQL-mode table definitions.
  6. For Tarantool 3.x, parse `tarantool.yaml` or `config.yaml`: look for a `spaces:` YAML section with space name keys and `format:` sub-sections.
- **Key Challenges**:
  - Space names may be stored in variables: `local name = "orders"; box.schema.space.create(name, ...)` — requires variable tracking to resolve.
  - Tarantool 3.x introduces a declarative YAML config where spaces may be defined outside Lua entirely.
  - System spaces (`_schema`, `_space`, `_index`, `_user`, etc.) have names beginning with `_` — exclude these.
  - Versioned migrations in Tarantool often use custom migration scripts that may rename or drop spaces.
  - Space names with Tarantool's default `id`-based access (`box.space[512]`) are not statically resolvable.
- **Analysis Tools**: tree-sitter-lua for Lua AST; YAML parser (PyYAML, etc.) for Tarantool 3.x config; regex for `box.schema.space.create` patterns.
- **Complexity**: Medium (Tarantool-specific APIs are distinctive enough to parse reliably from source)

---

### 5. Redis via lua-resty-redis / redis-lua

- **Name**: lua-resty-redis, redis-lua
- **Type**: Key-Value / Data Structure Store Client
- **Supported Databases**: Redis
- **Detection Signals**:
  - `.rockspec` or OPM: `lua-resty-redis`, `redis-lua`
  - Require patterns: `require "resty.redis"`, `require "redis"`
  - Object patterns: `local red = redis:new()`, `red:connect(...)`, `red:set(...)`, `red:get(...)`, `red:hset(...)`, `red:lpush(...)`, `red:zadd(...)`
  - Pipeline patterns: `red:init_pipeline()`, `red:commit_pipeline()`
- **Entity Definition Style**: Redis has no schema. Logical "entities" are inferred from key naming conventions and Redis data structure commands:
  - `HSET key ...` → Hash (map-like object, analogous to a document)
  - `LPUSH/RPUSH key ...` → List
  - `ZADD key ...` → Sorted Set
  - `SET key value` → String
  - Key naming patterns like `"user:123"`, `"session:<token>"` suggest logical entity type prefixes.
- **Extraction Approach**:
  1. Detect Redis library usage via require patterns.
  2. Extract the first string argument (key pattern) from `red:hset(`, `red:set(`, `red:lpush(`, `red:zadd(` etc.
  3. Identify key naming patterns: `"entitytype:<id>"` prefix → extract `entitytype` as a logical entity name.
  4. Group by common static prefix before the first `:` separator.
  5. Note which Redis data structures (Hash, List, Set, SortedSet, Stream) are used per entity type.
- **Key Challenges**: Redis enforces no schema. Key patterns may be dynamically constructed from Lua variables. This approach produces low-confidence signals at best and should be marked as such. Redis key namespacing conventions are project-specific and not universally standard.
- **Analysis Tools**: Regex, tree-sitter-lua.
- **Complexity**: High (low-signal environment)

---

### 6. Lapis Framework

- **Name**: Lapis (Lua/MoonScript web framework with PostgreSQL via `lapis.db`)
- **Type**: Active Record ORM / Query Builder
- **Supported Databases**: PostgreSQL (primary), SQLite (via `lapis.db.sqlite`)
- **Detection Signals**:
  - `.rockspec`: `lapis`
  - Require patterns: `require "lapis"`, `require "lapis.db"`, `require "lapis.db.model"`, `require "lapis.db.schema"`
  - Lua model patterns: `Model:extend("table_name")` from `lapis.db.model`
  - MoonScript model patterns: `class MyModel extends Model` with `@table_name` or `table_name:` class property
  - Migration patterns: `lapis.db.schema` module functions: `create_table(...)`, `add_column(...)`, `drop_table(...)`, `rename_table(...)`, `create_index(...)`
  - Config: `config.lua` or `config.moon` with `lapis.config` calls; Nginx config generated by Lapis in the project root
- **Entity Definition Style**: Lua models use `Model:extend("table_name")` where the first argument is the PostgreSQL table name. MoonScript models define a `table_name` class property. The `lapis.db.schema` module provides a migration DSL where `create_table("table_name", {...})` defines the schema explicitly.
  ```lua
  -- Lua style
  local Model = require("lapis.db.model").Model
  local Users = Model:extend("users")
  ```
  ```moonscript
  -- MoonScript style
  class Users extends Model
    @table_name: => "users"
  ```
- **Extraction Approach**:
  1. Detect `require "lapis.db.model"` or `require "lapis"` in `.lua` files.
  2. Search for `Model:extend\s*\(\s*['"]([^'"]+)['"]\s*\)` — extract the table name argument.
  3. For MoonScript files (`.moon`), search for `class\s+(\w+)\s+extends\s+Model` and within the class body, find `@table_name\s*[=:]\s*["']([^"']+)["']` or `table_name\s*:\s*["']([^"']+)["']`.
  4. Search for `lapis.db.schema` usage: `create_table\s*\(\s*['"]([^'"]+)['"]\s*,` — extract the table name.
  5. Also collect `rename_table\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)` for migration tracking.
  6. Check `migrations.lua` or `migrations.moon` files by convention (Lapis migration entry points).
- **Key Challenges**:
  - Lapis projects frequently use MoonScript (`.moon` files), which requires a different parser. MoonScript compiles to Lua but source may only exist as `.moon`.
  - The `Model:extend` pattern is distinctive, but table names stored in variables require dataflow analysis.
  - Lapis's naming convention (when `table_name` is not set) lowercases and pluralizes the class name — apply as a fallback.
- **Analysis Tools**: tree-sitter-lua for `.lua` files; MoonScript AST tools or careful regex for `.moon` files; luacheck.
- **Complexity**: Medium

---

### 7. Raw SQL Files Co-located with the Project

- **Name**: Raw SQL Schema and Migration Files
- **Type**: Schema File / Migration Tool
- **Supported Databases**: Any (MySQL, PostgreSQL, SQLite, etc.)
- **Detection Signals**:
  - Files: `*.sql`, `schema.sql`, `migrations/*.sql`, `db/schema.sql`, `database/*.sql`, `sql/*.sql`
  - Shell or Lua scripts loading SQL: `mysql < schema.sql`, `sqlite3 db.sqlite < init.sql`, `io.open("schema.sql")`, `os.execute("sqlite3 ...")`
  - Numbered migration files: `001_create_users.sql`, `20231001_add_orders.sql`
- **Entity Definition Style**: Standard SQL DDL (`CREATE TABLE`, `CREATE VIEW`, `CREATE INDEX`) in `.sql` files with no Lua-level wrapping.
- **Extraction Approach**:
  1. Recursively search for all `*.sql` files in the project directory tree.
  2. Parse each file for `CREATE TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(["'\`]?(\w+)["'\`]?)` — extract the table name.
  3. Also capture `CREATE VIEW\s+(\w+)` and note these as views rather than tables.
  4. Process numbered migration files in lexicographic order; track `DROP TABLE`, `ALTER TABLE RENAME TO` to maintain a current-state table list.
  5. Cross-reference with Lua files that load these SQL files via `io.open`, `os.execute`, or `os.popen`.
- **Key Challenges**: SQL files may contain both schema DDL and data migrations (DML) — distinguish `CREATE TABLE` (DDL) from `INSERT`/`UPDATE` (DML). Timestamps in migration file names should be used for ordering.
- **Analysis Tools**: SQL DDL parser, regex.
- **Complexity**: Low-Medium (SQL files are the most reliable signal in Lua projects)

---

### 8. luadbi (DBI Interface)

- **Name**: luadbi
- **Type**: Raw SQL / Database Interface Abstraction (DBI-style)
- **Supported Databases**: MySQL, PostgreSQL, SQLite, DB2, Oracle (driver-dependent)
- **Detection Signals**:
  - `.rockspec`: `luadbi`, `luadbi-mysql`, `luadbi-postgresql`, `luadbi-sqlite3`
  - Require patterns: `require "DBI"`, `require("DBI")`
  - Connection patterns: `DBI.Connect("MySQL:dbname=...", ...)`, `DBI.Connect("PostgreSQL:dbname=...", ...)`
  - Statement patterns: `dbh:prepare("...")`, `dbh:do("...")`, `sth:execute(...)`
- **Entity Definition Style**: Raw SQL strings passed to `dbh:do(...)` or `dbh:prepare(...)`. No model layer or entity abstraction.
- **Extraction Approach**:
  1. Detect `require "DBI"` or `require("DBI")` in `.lua` files.
  2. Extract string arguments from `dbh:do(`, `dbh:prepare(` calls.
  3. Parse extracted SQL for `CREATE TABLE\s+(\w+)` DDL.
  4. Also parse `INSERT INTO\s+(\w+)` and `FROM\s+(\w+)` for table reference signals.
- **Key Challenges**: Same raw SQL challenges as LuaSQL. Connection type string (e.g., `"MySQL:dbname=..."`) can be used to identify the database type.
- **Analysis Tools**: Regex, tree-sitter-lua.
- **Complexity**: High

---

### 9. MoonScript ORM Patterns

- **Name**: MoonScript class-based ORM patterns
- **Type**: Structural / Naming Convention Signal
- **Supported Databases**: Any (depends on underlying driver)
- **Detection Signals**:
  - Files: `*.moon` (MoonScript source files) in project directories
  - Class declarations: `class <Name> extends BaseModel`, `class <Name> extends ActiveRecord`, `class <Name> extends Model`
  - Table name conventions: `@table_name = "..."` or `table_name: "..."` class properties
  - Field definitions: `@fields = [...]` or field-like table literals in class body
- **Entity Definition Style**: MoonScript classes that wrap database tables conventionally define a `table_name` or `@table_name` class attribute. This is a community convention rather than a formal ORM requirement. Some projects define `fields` arrays that enumerate column names.
- **Extraction Approach**:
  1. Scan all `.moon` files for `class\s+(\w+)\s+extends\s+(\w*Model\w*|\w*Record\w*|\w*Base\w*)` patterns.
  2. Within each matching class body (indentation-sensitive), search for `table_name\s*[=:]\s*["']([^"']+)["']` or `@table_name\s*[=:]\s*["']([^"']+)["']`.
  3. If no `table_name` is found, apply convention: lowercase, underscored, pluralized class name.
  4. Also search for `@fields\s*=\s*\[` to extract a field list.
- **Key Challenges**: MoonScript is whitespace-sensitive and indentation-significant — regex alone is fragile for class body parsing. MoonScript compiles to Lua, so compiled `.lua` output may be present and easier to parse. The convention for table names varies by project.
- **Analysis Tools**: MoonScript compiler (moonc) for normalization to Lua; tree-sitter (MoonScript grammar has limited availability); careful regex.
- **Complexity**: High

---

### 10. Lua Table Structures with DB-like Field Naming (Heuristic)

- **Name**: Lua Table Definitions as Structural Signals
- **Type**: Heuristic / Shape Signal (last resort)
- **Supported Databases**: Any (indirect)
- **Detection Signals**:
  - Lua table literals with field names matching DB column conventions: `snake_case` names, `id`, `created_at`, `updated_at`, `user_id`, `name`, `email`, etc.
  - Variable or module names: `schema = { ... }`, `fields = { ... }`, `columns = { ... }`, `entity = { ... }`, `model = { ... }`
  - Module patterns that resemble model definitions (file named `models/user.lua` with a table returning field definitions)
- **Entity Definition Style**: Not a formal storage approach. Lua developers sometimes define table schemas as Lua table literals for use with generic database helpers or for documentation purposes. Example: `local User = { id = "integer", name = "text", email = "text" }`.
- **Extraction Approach**:
  1. Search for table literals assigned to variables named `schema`, `fields`, `columns`, `model`, `entity`, `table_def`, or similar.
  2. Extract key names from the table literal.
  3. Score field names against a known DB column name vocabulary (id, created_at, updated_at, name, email, status, etc.).
  4. Also score the enclosing file path (e.g., `models/user.lua` → strong signal).
  5. Treat high-scoring matches as low-confidence entity signals only.
- **Key Challenges**: Extremely high false positive rate. This is a last-resort heuristic for repositories with no formal ORM and no SQL files. Any table-like Lua table literal may trigger this, including configuration objects, UI definitions, and game data.
- **Analysis Tools**: tree-sitter-lua for reliable table literal parsing.
- **Complexity**: High (low confidence signal)

---

## Repository Detection Plan

### Step 1: Identify Storage Technologies in Use

1. Search for `.rockspec` files — parse the `dependencies` table for known database library names: `luasql-*`, `lsqlite3*`, `luadbi*`, `lapis`, `lua-resty-*`, `pgmoon`, `redis-lua`.
2. Check for `luarocks.lock` or a `rocks/` directory for installed dependency snapshots.
3. Search all `.lua` and `.moon` files for `require(...)` calls matching known library identifiers.
4. Check for Tarantool-specific signals: `box.cfg` in any `.lua` file; `tarantool.yaml` or `config.yaml` with Tarantool-style schema syntax.
5. Check for OpenResty signals: `nginx.conf`, `openresty.conf`, or usage of `ngx.` global API.
6. Check for Lapis signals: `config.lua`/`config.moon` with `lapis.config`, `lapis.serve`, or the presence of `views/` and `models/` directory structure alongside `app.lua`/`app.moon`.
7. Search for `*.sql` files anywhere in the repository (always present regardless of framework).
8. Check for `.moon` files — indicates MoonScript usage and Lapis/custom ORM patterns.

### Step 2: Apply Framework-Specific Extraction

Priority order (highest structural signal to lowest):

1. Tarantool `box.schema.space.create(...)` and Tarantool 3.x YAML config `spaces:` — distinctive, reliably parseable
2. Lapis `Model:extend("table_name")` and `lapis.db.schema.create_table(...)` — explicit table names
3. Raw SQL `CREATE TABLE` in `.sql` files — always high confidence
4. SQL strings in `conn:execute()`, `db:exec()`, `dbh:do()`, `:query()` calls — medium confidence (only static literals)
5. MoonScript `extends Model` with `@table_name` property — medium confidence
6. Lua table definitions with DB-like field naming — last resort heuristic

### Step 3: Handle MoonScript

- Check for `.moon` files alongside `.lua` files.
- If MoonScript source is present, apply MoonScript-specific extraction (class patterns, `table_name` attributes).
- If compiled `.lua` output is also present in the same directory (matching filenames), prefer the compiled `.lua` version for parsing reliability.
- If MoonScript is the only source, use the MoonScript-specific regex patterns.

### Step 4: SQL File Sweep (Always Run)

Regardless of the detected framework, sweep all `*.sql` files in the repository:
- Parse `CREATE TABLE (IF NOT EXISTS)? <name>` statements
- Parse `CREATE VIEW <name>` statements (flag as views, not tables)
- Parse `ALTER TABLE <name> RENAME TO <new_name>` (for migration tracking)
- Note the directory structure: `migrations/` vs `schema/` vs `db/` to infer migration vs. bootstrap context

### Step 5: Output

Produce a structured list:
```
entity_name | framework | source_file | source_line | confidence | columns (if extractable)
```

### Key Files to Always Check

| File / Pattern | Significance |
|---|---|
| `*.rockspec` | LuaRocks dependency manifest |
| `luarocks.lock` | Locked dependency versions |
| `*.lua` (all) | Source files for require/API patterns |
| `*.moon` | MoonScript source files |
| `*.sql` | Raw SQL schema/migration files |
| `init.lua` (project root) | Tarantool entry point; general Lua entry point |
| `tarantool.yaml`, `config.yaml` | Tarantool 3.x declarative config |
| `nginx.conf`, `openresty.conf` | OpenResty context signal |
| `config.lua`, `config.moon` | Lapis configuration |
| `migrations.lua`, `migrations.moon` | Lapis migration definitions |
| `app.lua`, `app.moon` | Lapis application root |

### Confidence Levels

| Signal Type | Confidence |
|---|---|
| Tarantool `box.schema.space.create("name", ...)` literal | High |
| Tarantool `box.execute("CREATE TABLE ...")` literal | High |
| Tarantool 3.x YAML `spaces:` section | High |
| Lapis `Model:extend("table_name")` literal | High |
| Lapis `lapis.db.schema.create_table("name", ...)` literal | High |
| `CREATE TABLE` in `.sql` files | High |
| `CREATE TABLE` in static Lua string literal (`:execute`) | Medium |
| `box.space.<name>` access pattern (reference, not creation) | Medium |
| MoonScript `class extends Model` with `@table_name` literal | Medium |
| `Model:extend` with variable table name | Low-Medium |
| Redis key prefix patterns | Low |
| Lua table literals with DB-like field names | Low |

### Realistic Expectations

Lua is a high-variability language for entity detection. Results depend heavily on the framework in use:

- **Tarantool projects**: High recall — `box.schema.space.create` is a distinctive, reliable API with few ambiguous patterns.
- **Lapis projects**: High recall for `Model:extend` patterns; medium recall for MoonScript variants.
- **Raw `.sql` files**: High recall when present and committed to the repository.
- **LuaSQL / lsqlite3 / luadbi / lua-resty-* with raw SQL**: Low to medium recall — entity detection quality depends entirely on whether SQL is in static string literals versus assembled dynamically at runtime.
- **Redis**: Very low confidence — key patterns are inferred heuristics, not schema declarations.

For projects using raw SQL drivers without any SQL files, expect 30-60% recall with significant false negatives where SQL is assembled from variables.
