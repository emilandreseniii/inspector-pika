# Shell: Data Entity Storage Methods

A catalog of frameworks, approaches, and patterns for data entity storage that appear in shell script repositories (Bash, sh, Zsh, ksh, Fish, POSIX sh). This document covers how shell scripts interact with databases and how to extract database entity names from those interactions via static analysis.

**Important note on realism**: Shell scripts are infrastructure and automation tools, not application development environments. They do not have ORMs or schema definition layers. Shell's role in database interaction is limited to: (1) running database CLI tools with SQL arguments, (2) executing SQL files, (3) bootstrapping or migrating database schemas as part of deployment automation, and (4) containing environment and configuration that reveals which database is in use. Static analysis of shell repositories for entity extraction focuses primarily on DDL embedded in scripts and referenced SQL files. This is inherently a low-signal domain — false negatives are common and expected.

---

## Frameworks and Approaches

---

### 1. Raw SQL Scripts Executed via psql / mysql / sqlite3 CLI

- **Name**: psql / mysql / sqlite3 CLI execution
- **Type**: Raw SQL / Database CLI
- **Supported Databases**: PostgreSQL (psql), MySQL/MariaDB (mysql), SQLite (sqlite3)
- **Detection Signals**:
  - Shebang lines: `#!/bin/bash`, `#!/bin/sh`, `#!/usr/bin/env bash`, `#!/bin/zsh`
  - CLI invocations: `psql`, `mysql`, `sqlite3`, `mariadb` commands in `.sh`, `.bash`, `.zsh` files, `Makefile` targets, or CI configuration files
  - SQL file arguments: `psql -f schema.sql`, `psql < migrations/001.sql`, `mysql db_name < dump.sql`, `sqlite3 app.db < init.sql`
  - Inline SQL arguments: `psql -c "CREATE TABLE ..."`, `mysql -e "CREATE TABLE ..."`, `sqlite3 app.db "CREATE TABLE ..."`
  - Variable-based SQL: `psql -c "$SQL_VARIABLE"` (not statically extractable)
  - Connection strings: `psql "postgres://user:pass@host/dbname"`, `psql -h host -d dbname`
  - Environment variables: `$PGHOST`, `$PGDATABASE`, `$PGUSER`, `$MYSQL_HOST`, `$DB_NAME` in connection commands
- **Entity Definition Style**: SQL DDL strings passed directly to CLI tools via `-c` / `-e` flags, via `<` file redirection, or via heredocs. No shell-level entity abstraction exists.
- **Extraction Approach**:
  1. Search all `.sh`, `.bash`, `.zsh` files and `Makefile` for `psql`, `mysql`, `mariadb`, `sqlite3` invocations.
  2. For `-f file.sql` or `< file.sql` arguments, locate the referenced SQL file and parse it for `CREATE TABLE` DDL (see entry 7: Raw SQL Files).
  3. For `-c "..."` or `-e "..."` inline SQL arguments, extract the quoted string and parse for `CREATE TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(\w+)`.
  4. For heredoc patterns (see entry 4), extract the heredoc content and parse as SQL.
  5. Record the CLI tool type (`psql` → PostgreSQL, `mysql`/`mariadb` → MySQL, `sqlite3` → SQLite) as the database type signal.
- **Key Challenges**:
  - Inline SQL in `-c` / `-e` flags may span multiple lines via shell line continuation (`\`).
  - SQL variable substitutions (`psql -c "$CREATE_TABLE_SQL"`) are not statically resolvable.
  - Complex shell pipelines (`echo "SELECT ..." | psql`) require pipeline analysis.
  - Shell variable expansion in SQL strings (`"CREATE TABLE ${TABLE_NAME}"`) is not statically resolvable.
  - The same script may be called with different database names or environments; the schema content is what matters, not the connection target.
- **Analysis Tools**: Regex for CLI invocation patterns; bash AST tools (bash-parser, mvdan/sh library); SQL DDL parser for extracted SQL strings.
- **Complexity**: Medium (CLI patterns are distinctive; SQL extraction from flags is feasible for simple cases)

---

### 2. SQL DDL Embedded in Shell Heredocs

- **Name**: SQL DDL in shell heredocs
- **Type**: Raw SQL / Inline Schema Definition
- **Supported Databases**: Any (PostgreSQL, MySQL, SQLite depending on the CLI in the heredoc block)
- **Detection Signals**:
  - Heredoc syntax: `psql <<EOF`, `mysql <<SQL`, `sqlite3 db.sqlite <<'ENDSQL'`, `psql <<-EOF`
  - Heredoc delimiter patterns: `EOF`, `SQL`, `ENDSQL`, `HEREDOC`, `END`, `SQLEOF` (convention varies by project)
  - SQL content between delimiters containing `CREATE TABLE`, `INSERT INTO`, etc.
  - Piped heredocs: `psql <<EOF | tee output.log`
- **Entity Definition Style**: SQL DDL written inline in a shell script, delivered to a database CLI via a heredoc. The heredoc is the most reliable shell-native way to embed multi-line SQL.
  ```bash
  psql -d myapp <<EOF
  CREATE TABLE IF NOT EXISTS users (
      id          SERIAL PRIMARY KEY,
      username    TEXT NOT NULL UNIQUE,
      email       TEXT NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS sessions (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     INTEGER REFERENCES users(id),
      expires_at  TIMESTAMPTZ NOT NULL
  );
  EOF
  ```
- **Extraction Approach**:
  1. Search all shell script files for heredoc patterns: `<<\s*[-]?\s*['"]?(\w+)['"]?` to find heredoc openers.
  2. Extract the content between the heredoc opener and the matching terminator (the terminator alone on a line).
  3. Parse the extracted content for `CREATE TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(\w+)` DDL.
  4. Also check the line containing the heredoc opener for the CLI tool being used (`psql`, `mysql`, `sqlite3`) to determine the database type.
  5. Handle quoted delimiters (`<<'EOF'`, `<<"EOF"`) which suppress variable expansion — the content is literal SQL and more reliably parseable.
  6. Handle the indented form (`<<-EOF`) which strips leading tabs.
- **Key Challenges**:
  - Shell variable expansion inside unquoted heredocs (e.g., `${TABLE_PREFIX}_users`) can partially obfuscate table names.
  - Heredoc content may be a mix of SQL DDL, DML, and shell comments — extract only DDL.
  - Nested heredocs (rare but possible) require careful parsing.
  - Heredoc delimiters are project-specific and may not indicate SQL content — must peek at content.
- **Analysis Tools**: Regex with multiline matching for heredoc boundaries; bash-parser (mvdan/sh) for reliable heredoc extraction; SQL DDL parser for content.
- **Complexity**: Medium-High (heredoc extraction requires stateful parsing; variable expansion adds uncertainty)

---

### 3. Migration Tools Invoked via Shell (Flyway CLI, Liquibase CLI, golang-migrate)

- **Name**: Flyway CLI, Liquibase CLI, golang-migrate, Alembic CLI, Sqitch
- **Type**: Migration Tool (CLI invocation from shell)
- **Supported Databases**: Depends on tool and configured backend
- **Detection Signals**:
  - Flyway: `flyway migrate`, `flyway info`, `flyway -url=jdbc:postgresql://... migrate` in shell scripts or Makefile
  - Flyway config: `flyway.conf`, `flyway.toml`, `conf/flyway.conf` — contains `flyway.url`, `flyway.locations`, `flyway.schemas`
  - Flyway SQL migration files: `V001__create_users.sql`, `V1.0.0__baseline.sql` in a `migrations/` or `sql/` directory
  - Liquibase: `liquibase update`, `liquibase --changelog-file=...` in scripts
  - Liquibase config: `liquibase.properties`, `liquibase.yaml`, `changelog.xml`, `changelog.yaml`
  - golang-migrate: `migrate -path ./migrations -database "$DB_URL" up` in scripts
  - golang-migrate files: `000001_create_users.up.sql`, `000001_create_users.down.sql` in a `migrations/` directory
  - Alembic: `alembic upgrade head`, `alembic revision --autogenerate` (Python, but called from shell scripts)
  - Sqitch: `sqitch deploy`, `sqitch.conf`, `sqitch.plan`, `deploy/*.sql`, `revert/*.sql`
- **Entity Definition Style**: SQL DDL in migration files managed by the migration tool. Shell scripts invoke the migration tool CLI; the entity definitions are in the migration SQL files, not in the shell scripts themselves.
- **Extraction Approach**:
  1. Detect migration tool CLI calls in shell scripts: `grep` for `flyway`, `liquibase`, `migrate`, `alembic`, `sqitch` commands.
  2. For Flyway: locate `flyway.conf` or `flyway.toml`; extract `flyway.locations` to find the SQL migration directory. Then parse all `V*.sql` files in that directory.
  3. For golang-migrate: extract the `-path` argument from `migrate` calls; parse all `*.up.sql` files in that directory.
  4. For Liquibase: locate `changelog.xml` or `changelog.yaml`; parse `<changeSet>` entries with `<createTable>` tags; or follow `<include file="...">` references to SQL changesets.
  5. For Sqitch: locate `sqitch.plan`; for each change entry, parse the corresponding `deploy/*.sql` file.
  6. In all cases, process migration files in their intended sequence (version order) to track renames and drops.
- **Key Challenges**:
  - Migration file paths may be environment-variable-dependent (`migrate -path $MIGRATIONS_DIR`).
  - Liquibase XML/YAML changelogs have their own schema — requires an XML/YAML parser, not just SQL parsing.
  - Multiple environments (dev/staging/prod) may use different migration sets.
  - Down/rollback migration files (`*.down.sql`) should be noted but not included in the current-state schema.
- **Analysis Tools**: Regex for CLI detection; TOML/YAML/XML parsers for config files; SQL DDL parser for migration files.
- **Complexity**: Medium (migration tool patterns are distinctive; SQL files are straightforward to parse once located)

---

### 4. sqlite3 Database File Creation Commands

- **Name**: SQLite database file creation via sqlite3 CLI
- **Type**: Raw SQLite (CLI-based)
- **Supported Databases**: SQLite
- **Detection Signals**:
  - Shell patterns: `sqlite3 app.db "CREATE TABLE ..."`, `sqlite3 "$DB_PATH" < schema.sql`, `sqlite3 ":memory:"` (ephemeral)
  - Database file creation: `touch app.db && sqlite3 app.db < init.sql`, `sqlite3 app.db ".read schema.sql"`
  - Database file presence: `*.sqlite`, `*.db`, `*.sqlite3` files in the repository
  - sqlite3 dot commands: `.read file.sql`, `.schema`, `.tables` in scripts
  - Makefile targets: `db: app.db`, `app.db: schema.sql`
- **Entity Definition Style**: SQL DDL passed directly to `sqlite3` CLI via inline arguments, `<` redirection, or `.read` dot commands. SQLite files committed to the repository are directly inspectable.
- **Extraction Approach**:
  1. Search for `sqlite3\s+\S+\s+"([^"]+)"` inline SQL arguments — extract and parse for DDL.
  2. Search for `sqlite3\s+\S+\s+<\s*(\S+\.sql)` — locate the SQL file and parse it.
  3. Search for `sqlite3\s+\S+\s+["']\.read\s+(\S+)["']` — locate the referenced file.
  4. If `*.sqlite`, `*.db`, or `*.sqlite3` files are present in the repository, inspect them directly using `sqlite3 file.db .schema` or a programmatic SQLite reader — this provides the definitive schema.
  5. Search Makefile for `sqlite3` build rules.
- **Key Challenges**: The database file path argument to `sqlite3` may be an environment variable or shell variable. `:memory:` database paths indicate ephemeral test databases. Inline SQL in shell arguments is often truncated to simple DDL but may include semicolons separating multiple statements.
- **Analysis Tools**: Regex; SQLite CLI or Python `sqlite3` module for direct file schema inspection; SQL DDL parser.
- **Complexity**: Low-Medium (direct file inspection is the most reliable approach)

---

### 5. mysqldump / pg_dump Schema Files

- **Name**: mysqldump, pg_dump, pg_dumpall schema export files
- **Type**: Schema File / Dump File
- **Supported Databases**: MySQL/MariaDB (mysqldump), PostgreSQL (pg_dump, pg_dumpall)
- **Detection Signals**:
  - Files: `*.sql` files in `dumps/`, `backups/`, `db/`, or project root containing dump headers
  - Dump header signatures:
    - `-- MySQL dump 10.x` or `-- MariaDB dump` at the start of the file
    - `-- PostgreSQL database dump` at the start of the file
    - `-- Dump completed on ...` at the end
  - Shell scripts: `mysqldump -u $USER -p$PASS $DB > schema.sql`, `pg_dump -U postgres mydb > dump.sql`
  - Schema-only flags: `pg_dump --schema-only`, `mysqldump --no-data`
- **Entity Definition Style**: Full SQL DDL exported by database CLI tools. Contains `CREATE TABLE`, `CREATE INDEX`, `CREATE SEQUENCE`, and potentially `INSERT INTO` (data dump). Schema-only dumps are the most useful for entity extraction.
- **Extraction Approach**:
  1. Detect dump files by checking for `-- MySQL dump`, `-- MariaDB dump`, or `-- PostgreSQL database dump` in the first few lines of `.sql` files.
  2. Parse dump files for `CREATE TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(["'\`]?\w+["'\`]?)` statements.
  3. Parse `CREATE SEQUENCE` (PostgreSQL) — these imply associated tables.
  4. Parse `CREATE VIEW` — note as views, not base tables.
  5. For MySQL dumps, handle backtick-quoted table names: `CREATE TABLE \`table_name\`` .
  6. Detect shell scripts that invoke `mysqldump --no-data` or `pg_dump --schema-only` to identify schema capture scripts.
- **Key Challenges**:
  - Dump files may be very large (data included); parsing only the DDL section is important for performance.
  - Backtick quoting in MySQL dumps requires special handling.
  - Dump files are often excluded from version control (`.gitignore`); they may not be present in the repository.
  - pg_dump output includes `SET` statements, `SELECT pg_catalog.*` calls, and other non-entity SQL that must be filtered.
- **Analysis Tools**: Regex for `CREATE TABLE` patterns; awareness of backtick vs. double-quote vs. unquoted name styles.
- **Complexity**: Low-Medium (dump file structure is well-defined; `CREATE TABLE` parsing is straightforward)

---

### 6. Database Initialization and Bootstrap Scripts

- **Name**: Database initialization scripts (entrypoint scripts, init.d scripts)
- **Type**: Schema Bootstrap / Initialization Script
- **Supported Databases**: Any
- **Detection Signals**:
  - File naming conventions: `init.sh`, `setup.sh`, `bootstrap.sh`, `setup-db.sh`, `create-db.sh`, `entrypoint.sh`, `docker-entrypoint-initdb.d/*.sh`, `docker-entrypoint-initdb.d/*.sql`
  - Docker-specific: files in `docker/init/`, `initdb/`, `init-scripts/` directories; `docker-compose.yml` volumes mounting to `/docker-entrypoint-initdb.d/`
  - CI/CD scripts: `.github/workflows/*.yml`, `.gitlab-ci.yml`, `Jenkinsfile`, `circle.yml` containing database setup steps
  - Kubernetes: `Job` manifests running SQL initialization; `ConfigMap` entries containing SQL
  - Content signals: `CREATE TABLE`, `CREATE DATABASE`, `CREATE USER`, `GRANT` SQL in shell scripts or referenced SQL files
- **Entity Definition Style**: Shell scripts that call database CLIs with `CREATE TABLE` DDL, often as part of a Docker entrypoint, CI pipeline setup step, or deployment bootstrap.
- **Extraction Approach**:
  1. Scan files named `init*.sh`, `setup*.sh`, `bootstrap*.sh`, `entrypoint*.sh` for database CLI calls.
  2. Parse `docker-entrypoint-initdb.d/` directory structure — all `.sql` and `.sh` files here are executed when a PostgreSQL or MySQL Docker container first starts. Parse `.sql` files for DDL; parse `.sh` files for CLI patterns.
  3. Scan CI/CD configuration files (`.github/workflows/*.yml`, `.gitlab-ci.yml`, `Jenkinsfile`) for steps containing SQL setup commands or references to SQL files.
  4. For Kubernetes `ConfigMap` resources containing SQL strings, extract and parse the SQL.
  5. Apply all standard SQL DDL extraction patterns to the SQL found in these contexts.
- **Key Challenges**:
  - CI/CD files may contain encoded SQL or references to secrets management systems where the SQL is not in the repository.
  - Kubernetes/Helm values files may contain SQL in YAML string blocks.
  - Scripts may call external setup scripts or download SQL from URLs — not statically resolvable.
  - Kubernetes ConfigMap SQL extraction requires YAML parsing with awareness of multi-line string values.
- **Analysis Tools**: Regex; YAML parser for CI/CD and Kubernetes configs; SQL DDL parser.
- **Complexity**: Medium-High (broad variety of file formats and patterns)

---

### 7. Raw SQL Files (.sql) Co-located with Shell Scripts

- **Name**: Raw SQL schema and migration files
- **Type**: Schema File / Migration Tool
- **Supported Databases**: Any
- **Detection Signals**:
  - Files: `*.sql` anywhere in the repository, especially in `migrations/`, `schema/`, `db/`, `sql/`, `database/` directories
  - Numbered or timestamped migration files: `001_create_users.sql`, `V001__create_users.sql`, `20231001_initial_schema.sql`, `000001_create_users.up.sql`
  - Schema baseline files: `schema.sql`, `base.sql`, `init.sql`, `database.sql`
  - Referenced from shell scripts via `-f`, `<`, `.read` patterns (see entries 1 and 4)
- **Entity Definition Style**: Standard SQL DDL in standalone `.sql` files. This is the most reliable source of entity information in any shell repository.
- **Extraction Approach**:
  1. Recursively search for all `*.sql` files in the repository.
  2. For each file, parse `CREATE TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(["'\`]?(\w+)["'\`]?)`.
  3. Also parse `CREATE VIEW\s+(\w+)` — note as views, not base tables.
  4. Track `ALTER TABLE\s+(\w+)\s+RENAME\s+TO\s+(\w+)` for migration-aware renaming.
  5. Track `DROP TABLE\s+(IF\s+EXISTS\s+)?(\w+)` for completeness (tables created then dropped are not current entities).
  6. Process numbered migration files in lexicographic order to build a current-state schema.
  7. Cross-reference with shell scripts that load these files to confirm they are actively executed.
- **Key Challenges**: SQL files may contain only `SELECT` queries (analytical scripts) rather than DDL — filter for `CREATE TABLE` only. Some files may contain both schema bootstrap (`CREATE TABLE`) and data seeding (`INSERT INTO`); DDL is the relevant part for entity extraction.
- **Analysis Tools**: SQL DDL parser; regex for `CREATE TABLE`; file name pattern matching for migration ordering.
- **Complexity**: Low-Medium (SQL files are the most reliable signal; `CREATE TABLE` parsing is straightforward)

---

### 8. docker-compose.yml with Database Service Definitions

- **Name**: docker-compose.yml database service definitions
- **Type**: Infrastructure Configuration (reveals DB type and initialization)
- **Supported Databases**: Any (reveals which database is used by the project)
- **Detection Signals**:
  - Files: `docker-compose.yml`, `docker-compose.yaml`, `docker-compose.dev.yml`, `docker-compose.override.yml`, `compose.yml`
  - Service images: `image: postgres`, `image: postgres:15`, `image: mysql`, `image: mysql:8`, `image: mariadb`, `image: mongo`, `image: redis`, `image: cassandra`, `image: cockroachdb/cockroach`
  - Environment variables in service definitions: `POSTGRES_DB`, `POSTGRES_USER`, `MYSQL_DATABASE`, `MONGO_INITDB_DATABASE`
  - Volume mounts to initialization paths: `./init.sql:/docker-entrypoint-initdb.d/init.sql`, `./migrations:/docker-entrypoint-initdb.d/`
  - Port mappings: `5432:5432` (PostgreSQL), `3306:3306` (MySQL), `27017:27017` (MongoDB)
- **Entity Definition Style**: docker-compose files do not define database entities directly. They reveal: (1) which database technology is in use, (2) the database name (from environment variables), (3) which SQL/sh initialization files are mounted into the container's init directory.
- **Extraction Approach**:
  1. Parse all `docker-compose*.yml` / `docker-compose*.yaml` / `compose.yml` files as YAML.
  2. For each service with a database image (`postgres`, `mysql`, `mariadb`, `mongo`, `redis`, `cassandra`):
     a. Record the image name as the database type.
     b. Extract environment variables: `POSTGRES_DB`, `MYSQL_DATABASE`, `MONGO_INITDB_DATABASE`, etc. — the value is the database name.
  3. Check `volumes:` for mounts to `/docker-entrypoint-initdb.d/` — the host-side paths are SQL or shell initialization files; parse those files for DDL.
  4. Check `command:` and `entrypoint:` overrides for inline SQL or file references.
- **Key Challenges**: docker-compose reveals infrastructure context and database type, but rarely contains entity schema directly. The value is in linking to initialization scripts/files that DO contain schema. Environment variable values may be references to `.env` file variables (`${POSTGRES_DB}` → not directly readable without the `.env` file).
- **Analysis Tools**: YAML parser; follow-up SQL file parsing for referenced initialization paths.
- **Complexity**: Low-Medium (YAML parsing is straightforward; value is in linked file discovery)

---

### 9. .env Files with DATABASE_URL Patterns

- **Name**: `.env` files and environment variable configurations
- **Type**: Configuration Signal (reveals DB type and name)
- **Supported Databases**: Any
- **Detection Signals**:
  - Files: `.env`, `.env.example`, `.env.sample`, `.env.development`, `.env.production`, `.env.test`
  - Environment variable patterns:
    - `DATABASE_URL=postgres://user:pass@host:5432/dbname`
    - `DATABASE_URL=mysql://user:pass@host:3306/dbname`
    - `DATABASE_URL=sqlite:///path/to/db.sqlite`
    - `DATABASE_URL=mongodb://user:pass@host:27017/dbname`
    - `DB_NAME=myapp_production`
    - `PGDATABASE=myapp`, `MYSQL_DATABASE=myapp`
    - `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME` (split format)
- **Entity Definition Style**: `.env` files do not define database entities. They reveal: (1) the database type from the URL scheme or driver-specific variable names, (2) the database name from the URL path or `DB_NAME`/`PGDATABASE`/`MYSQL_DATABASE` variables. The database name is a strong contextual signal.
- **Extraction Approach**:
  1. Search for `.env`, `.env.example`, `.env.sample`, `.env.*` files.
  2. Parse `DATABASE_URL` values: extract the scheme (`postgres`, `mysql`, `sqlite`, `mongodb`) as the DB type and the path component as the database name.
  3. Parse `PGDATABASE`, `MYSQL_DATABASE`, `MONGO_INITDB_DATABASE`, `DB_NAME`, `DATABASE_NAME` values as the database name.
  4. Note: the database name is not a table/entity name, but it provides context about the database technology and instance.
  5. Look for `DATABASE_URL` references in shell scripts to confirm the `.env` file is used by the project.
- **Key Challenges**: `.env` files often contain credentials and are excluded from version control (`.gitignore`). The `.env.example` or `.env.sample` files (safe to commit) may substitute dummy values for the database name. The database name (e.g., `myapp_production`) is not a table entity name.
- **Analysis Tools**: Regex for URL scheme parsing.
- **Complexity**: Low (parsing is trivial; information value is for DB type detection only, not entity names)

---

### 10. Makefile Database Targets

- **Name**: Makefile database targets
- **Type**: Build Tool / Automation (database commands in Makefile rules)
- **Supported Databases**: Any
- **Detection Signals**:
  - Files: `Makefile`, `makefile`, `GNUmakefile`
  - Target names: `db`, `db-setup`, `db-migrate`, `db-create`, `db-drop`, `db-reset`, `migrate`, `migrate-up`, `migrate-down`, `seed`, `schema`, `create-tables`
  - Commands in target recipes containing: `psql`, `mysql`, `sqlite3`, `flyway`, `liquibase`, `migrate` CLI tools
  - Include directives referencing SQL files
- **Entity Definition Style**: Makefiles do not define entities. They automate database setup commands. Makefile targets are entry points for discovering shell commands and SQL file references that DO contain entity definitions.
- **Extraction Approach**:
  1. Parse `Makefile` for target rules.
  2. For targets with names matching database management conventions (`db*`, `migrate*`, `schema*`, `seed*`), extract the recipe commands.
  3. Apply all CLI detection patterns (psql, mysql, sqlite3, flyway, migrate) to the recipe lines.
  4. Extract SQL file references (`-f *.sql`, `< *.sql`) and parse the referenced files.
  5. Extract heredoc SQL from Makefile rules (heredoc syntax in Makefiles is standard shell syntax within recipe lines).
- **Key Challenges**: Makefile syntax is distinct — recipe lines must be indented with a tab, and each recipe line runs in a separate shell instance (unless combined with `;` or `&&`). Variable expansion in Makefiles uses `$(VAR)` syntax, which may obscure file paths or SQL strings.
- **Analysis Tools**: Makefile parser (GNU make `--print-data-base` output, or regex-based parsing); regex for CLI patterns within recipe lines.
- **Complexity**: Medium (Makefile parsing requires understanding recipe line syntax; actual entity extraction defers to SQL file parsing)

---

### 11. Schema Bootstrapping Scripts and CI/CD Database Setup

- **Name**: CI/CD database setup steps and deployment scripts
- **Type**: Deployment Automation
- **Supported Databases**: Any
- **Detection Signals**:
  - GitHub Actions: `.github/workflows/*.yml` containing `services:` with database images, or `run:` steps with `psql`/`mysql`/`sqlite3` commands or migration tool calls
  - GitLab CI: `.gitlab-ci.yml` containing `services:` with database images, `before_script:` or `script:` entries with SQL setup
  - CircleCI: `.circleci/config.yml` with database service containers
  - Travis CI: `.travis.yml` with `services:` entries (`postgresql`, `mysql`, `mongodb`)
  - Jenkins: `Jenkinsfile` with database setup `sh` steps
  - Kubernetes Jobs: `job.yaml` with init containers running SQL setup
  - Helm charts: `templates/job.yaml` with SQL migration steps
- **Entity Definition Style**: CI/CD configs do not define entities. They contain or reference the same database setup commands as standalone shell scripts. The value is in detecting SQL file paths or migration tool invocations that lead to schema definitions.
- **Extraction Approach**:
  1. Parse CI/CD YAML files for `run:`, `script:`, `command:` values containing database CLI invocations.
  2. Extract SQL file paths from `-f` and `<` arguments within those commands.
  3. Extract inline SQL from `-c` / `-e` command arguments.
  4. For `services:` database entries, record the image as the database type.
  5. Follow up by parsing all referenced SQL files for DDL.
- **Key Challenges**: CI/CD YAML has many formats and schemas. SQL may be stored in CI/CD secrets or variables not visible in the configuration file. Multi-line `run:` / `script:` values may contain heredocs or complex shell logic.
- **Analysis Tools**: YAML parser; regex for CLI patterns within YAML string values.
- **Complexity**: High (many formats, indirect references, secrets-based SQL)

---

## Repository Detection Plan

### Step 1: Classify the Repository Type

Determine whether the repository is:
- A **pure shell/infrastructure repo** (primary content is `.sh` files, Makefiles, CI configs): lower recall expected; focus on SQL file discovery.
- A **polyglot repo** (shell scripts alongside application code): shell scripts are supporting infrastructure; primary entity detection should use the application language's approach, with shell used as a supplementary signal.
- A **Docker/container repo** (primarily `Dockerfile`, `docker-compose.yml`): focus on `docker-entrypoint-initdb.d/` mounts and service image detection.
- A **CI/CD pipeline repo** (primarily `.github/`, `.gitlab-ci.yml`, etc.): focus on database service containers and SQL file references.

### Step 2: Identify Database Technologies in Use

1. Parse `docker-compose.yml` for database service images → determines DB type.
2. Parse `.env` / `.env.example` for `DATABASE_URL` → determines DB type and name.
3. Search all `.sh` and `Makefile` files for `psql`, `mysql`, `sqlite3`, `flyway`, `liquibase`, `migrate` invocations → confirms DB type.
4. Check for Flyway (`flyway.conf`, `flyway.toml`), Liquibase (`liquibase.properties`, `changelog.xml`), or golang-migrate (`migrate -database`) patterns.
5. Check for `*.sqlite`, `*.db` files (SQLite usage).

### Step 3: Apply Entity Extraction

Execute in this priority order:

1. **Raw SQL files** (`*.sql` in any directory) — always run; highest confidence
2. **SQLite files** (`*.sqlite`, `*.db`) — inspect directly for schema if committed
3. **Flyway / Liquibase / golang-migrate migration files** — parse in version order
4. **docker-entrypoint-initdb.d/ mounted files** — parse any `.sql` or `.sh` files in the mounted host path
5. **Heredoc SQL** in `.sh` files — extract and parse for DDL
6. **Inline CLI SQL** (`psql -c "..."`, `mysql -e "..."`) — extract from `-c`/`-e` flags
7. **Makefile recipe SQL** — extract CLI calls and SQL file references
8. **CI/CD YAML database setup steps** — extract SQL file references and inline SQL
9. **.env `DATABASE_URL` parsing** — for DB type context only; not entity names

### Step 4: Process Migration Files in Order

If migration files are present (numbered SQL files):
1. Sort migration files by their version prefix (numeric sort).
2. Process only `.up.sql` or `V*.sql` files (forward migrations); exclude `.down.sql` or rollback files.
3. Apply `CREATE TABLE` additions and `DROP TABLE` removals to build the current-state schema.
4. Apply `ALTER TABLE RENAME TO` operations to track entity renames.

### Step 5: Acknowledge Limitations

Static analysis of shell repositories for entity extraction has significant limitations:

- **Variable expansion**: `psql -c "CREATE TABLE ${TABLE_NAME}"`, `sqlite3 "$DB" < "$SCHEMA_FILE"` — table names or file paths stored in shell variables are not statically resolvable without variable tracking.
- **Dynamic SQL construction**: `SQL="CREATE TABLE $NAME (...)"; psql -c "$SQL"` — completely opaque to static analysis.
- **External SQL sources**: scripts that download SQL from URLs (`curl https://... | psql`) are not statically analyzable.
- **Secrets/environment**: many production database scripts rely on environment variables for connection details that are not in the repository.
- **Realistic recall**: Expect 50-80% recall in shell repositories with committed SQL files. Expect 20-50% recall in repositories that construct SQL dynamically from shell variables.

### Key Files to Always Check

| File / Pattern | Significance |
|---|---|
| `*.sql` (all locations) | Primary entity source — always parse |
| `*.sqlite`, `*.db`, `*.sqlite3` | SQLite schema — inspect directly |
| `docker-compose.yml`, `compose.yml` | DB type and initialization file discovery |
| `.env`, `.env.example`, `.env.sample` | DB type and database name |
| `Makefile`, `makefile` | Database automation targets |
| `*.sh`, `*.bash` (all) | Shell scripts with CLI invocations |
| `flyway.conf`, `flyway.toml` | Flyway migration tool config |
| `liquibase.properties`, `changelog.xml` | Liquibase migration config |
| `migrations/`, `db/migrations/`, `sql/` | Migration and schema file directories |
| `docker-entrypoint-initdb.d/` | Docker DB initialization files |
| `.github/workflows/*.yml` | GitHub Actions CI/CD |
| `.gitlab-ci.yml` | GitLab CI/CD |
| `Dockerfile` | Database image usage detection |
| `init.sh`, `setup.sh`, `bootstrap.sh` | DB initialization scripts |

### Confidence Levels

| Signal Type | Confidence |
|---|---|
| `CREATE TABLE` in `.sql` file | High |
| `CREATE TABLE` in static heredoc (quoted delimiter `<<'EOF'`) | High |
| SQLite `.db`/`.sqlite` file: `sqlite_master` table names | High |
| Flyway `V*.sql` migration file `CREATE TABLE` | High |
| golang-migrate `*.up.sql` file `CREATE TABLE` | High |
| Liquibase `<createTable>` in changelog | High |
| `CREATE TABLE` in unquoted heredoc (possible variable expansion) | Medium-High |
| `psql -c "CREATE TABLE ..."` static inline SQL | Medium-High |
| `mysql -e "CREATE TABLE ..."` static inline SQL | Medium-High |
| `docker-entrypoint-initdb.d/*.sql` `CREATE TABLE` | High |
| `POSTGRES_DB` / `MYSQL_DATABASE` value in docker-compose | Context only (DB name, not entity name) |
| `DATABASE_URL` scheme in `.env` | Context only (DB type) |
| `CREATE TABLE` with shell variable in table name | Not extractable |
| SQL via downloaded URL (`curl ... \| psql`) | Not extractable |
| SQL assembled from shell variable (`psql -c "$SQL"`) | Not extractable |

### Realistic Expectations

Shell is the **lowest-signal language** for automated database entity extraction, but it is often the **only source** for infrastructure-focused repositories. The best results come from:

1. Repositories with committed `*.sql` files — the presence of SQL files is the dominant signal; parse them regardless of how they are called from shell.
2. Repositories using Flyway, Liquibase, or golang-migrate — migration files are explicitly versioned and structured.
3. Repositories with Docker setup that mounts `docker-entrypoint-initdb.d/` — very common in containerized projects.
4. SQLite projects with committed database files — direct schema inspection is highly reliable.

Shell analysis is best treated as a **supporting channel** for entity discovery: it helps locate SQL files and confirm which database is in use, while the SQL files themselves are the primary entity source. For polyglot repositories, the shell analysis should be combined with the entity extraction approach for the primary application language.
