# Perl Data Entity Storage Methods

A catalog of every significant data entity storage framework, library, and approach used in Perl projects. This document supports automated static analysis of Perl repositories to extract a list of data entities (database tables, document collections, etc.).

---

## Table of Contents

1. [DBIx::Class (DBIC)](#1-dbixclass-dbic)
2. [DBIx::Class::Schema::Loader](#2-dbixclassschemaloader)
3. [Rose::DB::Object](#3-rosedbobject)
4. [Class::DBI](#4-classdbi)
5. [Alzabo ORM](#5-alzabo-orm)
6. [DBI (Raw Database Interface)](#6-dbi-raw-database-interface)
7. [DBD::* Drivers](#7-dbd-drivers)
8. [Mojo::Pg / Mojo::mysql](#8-mojopg--mojomysql)
9. [SQL::Abstract](#9-sqlabstract)
10. [Catalyst + DBIx::Class Patterns](#10-catalyst--dbixclass-patterns)
11. [Dancer2 + Database Plugins](#11-dancer2--database-plugins)
12. [Mason + Database](#12-mason--database)
13. [Plack/PSGI Application Database Patterns](#13-plackpsgi-application-database-patterns)
14. [MongoDB Driver (MongoDB::MongoClient)](#14-mongodb-driver-mongodbmongoclient)
15. [Redis::Client / Redis](#15-redisclient--redis)
16. [Search::Elasticsearch](#16-searchelasticsearch)
17. [Storable Module](#17-storable-module)
18. [Raw SQL Files (.sql DDL)](#18-raw-sql-files-sql-ddl)
19. [YAML/JSON Config Files with Schema Definitions](#19-yamljson-config-files-with-schema-definitions)
20. [Repository Detection Plan](#20-repository-detection-plan)

---

## 1. DBIx::Class (DBIC)

**Name**: DBIx::Class (DBIC)

**Type**: Relational ORM

**Supported Databases**: PostgreSQL, MySQL/MariaDB, SQLite, Oracle, SQL Server, Sybase, DB2, Firebird, and any DBI-supported database

**Detection Signals**:
- CPAN modules in `cpanfile`, `Makefile.PL`, `Build.PL`, `META.yml`, `META.json`:
  - `DBIx::Class`
  - `DBIx::Class::Core`
  - `DBIx::Class::Schema`
  - `DBIx::Class::ResultSet`
  - `DBIx::Class::Result`
  - `DBIx::Class::ResultSource`
  - `DBIx::Class::InflateColumn`
  - `DBIx::Class::DeploymentHandler`
  - `DBIx::Class::Fixtures`
- `use` statements in source files:
  - `use base 'DBIx::Class::Core'`
  - `use parent 'DBIx::Class::Core'`
  - `use Moose; extends 'DBIx::Class::Core'`
  - `use DBIx::Class::Schema`
  - `__PACKAGE__->load_namespaces()`
  - `__PACKAGE__->load_classes()`
- File naming conventions:
  - `lib/MyApp/Schema.pm` — the schema class
  - `lib/MyApp/Schema/Result/*.pm` — one file per result class (table)
  - `lib/MyApp/Schema/ResultSet/*.pm` — custom resultset classes
  - Directories named `Result`, `ResultSet`, `Schema` under `lib/`
- Config files: DSN often in `myapp.conf`, `myapp.yml`, `myapp.json`, `config/database.yml`, environment variables

**Entity Definition Style**:

Each database table is represented by a Result class (one `.pm` file per table). The class declares its table name and columns using class methods:

```perl
package MyApp::Schema::Result::User;
use base 'DBIx::Class::Core';

__PACKAGE__->table('users');

__PACKAGE__->add_columns(
    id    => { data_type => 'integer', is_auto_increment => 1 },
    name  => { data_type => 'varchar', size => 255 },
    email => { data_type => 'varchar', size => 255, is_nullable => 1 },
);

__PACKAGE__->set_primary_key('id');

__PACKAGE__->has_many(posts => 'MyApp::Schema::Result::Post', 'user_id');
__PACKAGE__->belongs_to(role => 'MyApp::Schema::Result::Role', 'role_id');
__PACKAGE__->might_have(profile => 'MyApp::Schema::Result::Profile', 'user_id');
__PACKAGE__->many_to_many(tags => 'user_tags', 'tag');
```

**Extraction Approach**:

1. **Find Result classes**: Locate all `.pm` files under paths matching `*/Schema/Result/*.pm` or containing `use base 'DBIx::Class'` / `use parent 'DBIx::Class'`.
2. **Extract table name**: Parse each file for `__PACKAGE__->table('...')` — the string argument is the physical table name.
3. **Extract columns**: Parse `__PACKAGE__->add_columns(...)` blocks. Arguments are alternating column names and hashrefs with metadata. Also handle the array-reference form: `__PACKAGE__->add_columns(qw/col1 col2 col3/)`.
4. **Extract primary key**: Parse `__PACKAGE__->set_primary_key(...)` or `__PACKAGE__->set_primary_key(qw(...))`.
5. **Extract unique constraints**: Parse `__PACKAGE__->add_unique_constraint(...)`.
6. **Extract relationships**: Parse method calls `has_many`, `belongs_to`, `might_have`, `has_one`, `many_to_many` — each yields a related result class name.
7. **Extract schema class**: Find the file with `__PACKAGE__->load_namespaces()` or `__PACKAGE__->load_classes(...)` — this is the root schema, and its namespace prefix reveals the result class hierarchy.
8. **Build entity graph**: Combine table names, columns, and relationships into a directed entity graph.

**Key Challenges**:
- `add_columns` can appear multiple times in a single class (columns added incrementally, e.g., in Moose roles or mixins).
- Columns may be defined via `DBIx::Class::InflateColumn::DateTime` or similar components that add virtual columns — these are not physical columns.
- Schema::Loader-generated classes may have a `# DO NOT MODIFY THIS OR ANYTHING ABOVE` comment, above which the auto-generated table/column definitions appear; hand-written additions appear below.
- Dynamic table name resolution: `__PACKAGE__->table(MyApp::Config->table_name('users'))` — cannot be resolved statically.
- `load_namespaces()` with a custom `result_namespace` option changes the expected directory structure.
- Abstract base result classes (those that do not call `->table()`) must be filtered out.
- Relationship declarations reference other result class package names, not table names — a mapping step is required.
- Monolithic schema patterns (all result classes in one file) exist in older codebases.

**Analysis Tools**:
- **PPI** (`PPI::Document`) — the definitive Perl parsing library; parse `->table()`, `->add_columns()` as `PPI::Token::Word` and method call chains.
- **Tree-sitter Perl grammar** — for fast scanning of `__PACKAGE__->table(...)` patterns.
- Regex pre-scan to find candidate files before full PPI parse.

**Complexity**: Medium

---

## 2. DBIx::Class::Schema::Loader

**Name**: DBIx::Class::Schema::Loader

**Type**: Relational ORM (Auto-generated schema from live DB or existing files)

**Supported Databases**: PostgreSQL, MySQL/MariaDB, SQLite, Oracle, SQL Server, Sybase, DB2, Firebird (via DBD::* drivers)

**Detection Signals**:
- CPAN modules:
  - `DBIx::Class::Schema::Loader`
  - `DBIx::Class::Schema::Loader::Base`
- `use` statements:
  - `use DBIx::Class::Schema::Loader qw/make_schema_at/`
  - `use base 'DBIx::Class::Schema::Loader'`
  - `__PACKAGE__->loader_options(...)`
  - `__PACKAGE__->load_namespaces()`
- Scripts: files named `make_schema.pl`, `generate_schema.pl`, `dbicdump` invocations in `Makefile` or shell scripts.
- The `dbicdump` command-line tool (ships with the module).
- Generated file headers containing `# This file was generated by DBIx::Class::Schema::Loader`.

**Entity Definition Style**:

Schema::Loader introspects a live database and auto-generates Result class files. The generated files look identical to hand-written DBIC result classes (using `__PACKAGE__->table()`, `__PACKAGE__->add_columns()`, etc.) but contain a marker comment:

```perl
# Created by DBIx::Class::Schema::Loader
# DO NOT MODIFY THE FIRST PART OF THIS FILE

package MyApp::Schema::Result::User;
use strict;
use warnings;
use base 'DBIx::Class::Core';
__PACKAGE__->table("users");
__PACKAGE__->add_columns(
  "id",   { data_type => "integer", is_auto_increment => 1, ... },
  "name", { data_type => "varchar", size => 255, ... },
);
```

**Extraction Approach**:

1. **Identify loader-generated files**: Scan for the comment `# Created by DBIx::Class::Schema::Loader` or `# DO NOT MODIFY THIS OR ANYTHING ABOVE` — these files have fully auto-generated entity definitions.
2. **Apply the same DBIC extraction approach** (see section 1) — the generated files use identical API calls.
3. **Identify the schema loader script**: Find scripts calling `make_schema_at(...)` — inspect arguments for `db_schema`, `naming`, `dump_directory` options which reveal the schema namespace and output path.
4. **Check loader_options**: `__PACKAGE__->loader_options(db_schema => '%', ...)` — the `db_schema` option may filter which schemas/tables are loaded.
5. **Note static vs. dynamic modes**: In dynamic mode (`use base 'DBIx::Class::Schema::Loader'` without pre-generated files), no static files exist — entity names can only be determined by running the application.

**Key Challenges**:
- Dynamic (runtime) mode generates schema entirely in memory — no static files to parse.
- Partial regeneration: only some tables may be dumped; others may be manually defined.
- Custom `moniker_map` or `col_accessor_map` options rename tables/columns — the package name may not match the table name.
- `db_schema` filtering may exclude certain schemas from the generated output.

**Analysis Tools**:
- PPI for parsing generated Result class files.
- Grep/regex for the loader marker comment to distinguish auto-generated from hand-written classes.

**Complexity**: Low (for static-dump mode), High (for dynamic mode)

---

## 3. Rose::DB::Object

**Name**: Rose::DB::Object

**Type**: Relational ORM

**Supported Databases**: PostgreSQL, MySQL/MariaDB, SQLite, Oracle, Informix, and generic DBI-compatible databases

**Detection Signals**:
- CPAN modules:
  - `Rose::DB::Object`
  - `Rose::DB::Object::Manager`
  - `Rose::DB::Object::Metadata`
  - `Rose::DB`
  - `Rose::DB::Object::Loader`
- `use` statements:
  - `use base 'Rose::DB::Object'`
  - `use parent 'Rose::DB::Object'`
  - `our @ISA = ('Rose::DB::Object')`
  - `Rose::DB::Object::Manager->get_objects(...)`

**Entity Definition Style**:

Each table is represented by a class that inherits from `Rose::DB::Object`. The metadata is declared in an `init_db` method or via the class metadata object:

```perl
package MyApp::Model::User;
use base 'Rose::DB::Object';

__PACKAGE__->meta->setup(
    table   => 'users',
    columns => [
        id    => { type => 'serial', primary_key => 1, not_null => 1 },
        name  => { type => 'varchar', length => 255, not_null => 1 },
        email => { type => 'varchar', length => 255 },
    ],
    primary_key_columns => ['id'],
    relationships => [
        posts => {
            type       => 'one to many',
            class      => 'MyApp::Model::Post',
            column_map => { id => 'user_id' },
        },
    ],
);
```

Alternatively, inline column accessors can be defined:

```perl
__PACKAGE__->meta->table('users');
__PACKAGE__->meta->add_columns(
    Rose::DB::Object::Metadata::Column::Integer->new(name => 'id', ...),
);
```

**Extraction Approach**:

1. **Find Rose::DB::Object subclasses**: Search for files containing `use base 'Rose::DB::Object'` or `use parent 'Rose::DB::Object'`.
2. **Extract table name**: Parse `__PACKAGE__->meta->setup(table => '...')` or `__PACKAGE__->meta->table('...')`.
3. **Extract columns**: Parse the `columns => [...]` array within `meta->setup(...)`, or `meta->add_columns(...)` calls. Column names are the first element of each pair.
4. **Extract relationships**: Parse the `relationships => [...]` array within `meta->setup(...)`. Each entry has a type (e.g., `'one to many'`) and a target `class`.
5. **Handle auto-initialization**: If `Rose::DB::Object::Loader` is used, the class may auto-introspect the database — no static definitions exist.

**Key Challenges**:
- `meta->setup()` arguments can span many lines with complex nested data structures.
- Auto-loader mode (`Rose::DB::Object::Loader`) generates classes in memory — no static files.
- Column type objects (`Rose::DB::Object::Metadata::Column::*`) may be instantiated rather than using hash syntax, making regex-only approaches unreliable.
- Multiple inheritance and mixins can split column definitions across base classes.

**Analysis Tools**:
- PPI for parsing `meta->setup(...)` argument lists.
- Tree-sitter for fast structural pattern detection.

**Complexity**: Medium

---

## 4. Class::DBI

**Name**: Class::DBI

**Type**: Relational ORM (legacy, predecessor to DBIx::Class)

**Supported Databases**: PostgreSQL, MySQL/MariaDB, SQLite, Oracle, and any DBI-supported database

**Detection Signals**:
- CPAN modules:
  - `Class::DBI`
  - `Class::DBI::Pg`
  - `Class::DBI::mysql`
  - `Class::DBI::SQLite`
  - `Class::DBI::AbstractSearch`
  - `Class::DBI::Loader` (auto-generates from DB)
  - `Class::DBI::FromCGI`
- `use` statements:
  - `use base 'Class::DBI'`
  - `use base 'Class::DBI::Pg'`
  - `use parent 'Class::DBI'`
  - `__PACKAGE__->set_db(...)` or `__PACKAGE__->connection(...)`

**Entity Definition Style**:

```perl
package MyApp::Model::Film;
use base 'Class::DBI';

MyApp::Model::Film->set_db('Main', 'dbi:mysql:dbname', 'user', 'pass');
MyApp::Model::Film->table('films');
MyApp::Model::Film->columns(All  => qw/filmid title director/);
MyApp::Model::Film->columns(Primary => qw/filmid/);
MyApp::Model::Film->has_many(actors => 'MyApp::Model::Actor');
MyApp::Model::Film->has_a(director => 'MyApp::Model::Director');
```

**Extraction Approach**:

1. **Find Class::DBI subclasses**: Search for `use base 'Class::DBI'` (or driver-specific variants).
2. **Extract table name**: Parse `->table('...')` method call on the package.
3. **Extract columns**: Parse `->columns(All => qw/.../)` and `->columns(Essential => qw/.../)`. The `qw/.../ ` list contains column names.
4. **Extract primary key**: Parse `->columns(Primary => qw/.../)`  or `->set_primary_key(...)`.
5. **Extract relationships**: Parse `has_many`, `has_a`, `might_have`, `is_a` method calls.
6. **Handle shared DB setup**: A common base class often calls `set_db(...)` — find this class to determine the DSN.

**Key Challenges**:
- `columns()` can be called multiple times with different groups (`All`, `Essential`, `Primary`, `Stringify`) — must aggregate all `All` and `Essential` calls.
- Very old code may use `Class::DBI::mysql` or similar driver subclasses with slightly different APIs.
- Some Class::DBI subclasses override `table()` dynamically.
- Class::DBI::Loader (auto-generation from DB) produces no static definitions.

**Analysis Tools**:
- PPI for method call parsing.
- Regex scanning for `->table(` and `->columns(` patterns for initial discovery.

**Complexity**: Low

---

## 5. Alzabo ORM

**Name**: Alzabo

**Type**: Relational ORM (legacy, schema-file-based)

**Supported Databases**: PostgreSQL, MySQL/MariaDB

**Detection Signals**:
- CPAN modules:
  - `Alzabo`
  - `Alzabo::Create::Schema`
  - `Alzabo::Runtime::Schema`
  - `Alzabo::Create::Table`
  - `Alzabo::ObjectCache`
- `use` statements:
  - `use Alzabo::Runtime::Schema`
  - `use Alzabo::Create::Schema`
  - `Alzabo::Runtime::Schema->load_from_file(...)`
- File naming conventions:
  - Schema definition files stored in `~/.alzabo/schemas/` or a configured directory, named `<schema_name>.alz` or serialized Storable files.
  - Files with `.alzabo` extension.

**Entity Definition Style**:

Alzabo schemas are typically created programmatically via `Alzabo::Create::Schema` and serialized to disk, or defined in a Perl script:

```perl
use Alzabo::Create::Schema;

my $schema = Alzabo::Create::Schema->new(
    name  => 'myapp',
    rdbms => 'MySQL',
);

my $table = $schema->make_table(name => 'users');
$table->make_column(
    name    => 'user_id',
    type    => 'INT',
    attributes => ['UNSIGNED'],
    primary_key => 1,
    sequenced => 1,
);
$table->make_column(name => 'username', type => 'VARCHAR', length => 50);
```

**Extraction Approach**:

1. **Detect Alzabo usage**: Search for `use Alzabo` or `Alzabo::Create::Schema` in source files.
2. **Locate schema files**: Check `~/.alzabo/schemas/` or paths passed to `load_from_file(...)` / `load(name => '...')`.
3. **Parse creation scripts**: Find calls to `make_table(name => '...')` — the `name` value is the table name.
4. **Extract columns**: Parse `make_column(name => '...', type => '...')` calls chained on table objects.
5. **Parse serialized schema files**: Alzabo stores schemas as Storable-serialized Perl objects — these cannot be statically parsed without deserializing. Look instead for the creation scripts.
6. **Extract relationships**: Parse `make_foreign_key(...)` calls.

**Key Challenges**:
- Serialized `.alz` schema files are binary Storable data — not human-readable.
- Schema creation scripts may not live in the main application codebase.
- Alzabo is largely abandoned; real-world codebases using it are very old.
- The creation API uses method chaining on mutable objects, making static analysis of variable names necessary.

**Analysis Tools**:
- PPI for parsing `make_table()` and `make_column()` calls.
- Perl runtime deserialization of `.alz` files if static analysis fails.

**Complexity**: High

---

## 6. DBI (Raw Database Interface)

**Name**: DBI (Database Interface)

**Type**: Raw SQL

**Supported Databases**: All DBI-supported databases (PostgreSQL, MySQL/MariaDB, SQLite, Oracle, SQL Server, DB2, Sybase, ODBC-connected databases, etc.)

**Detection Signals**:
- CPAN modules:
  - `DBI`
- `use` statements:
  - `use DBI`
  - `DBI->connect(...)`
  - `$dbh->prepare(...)`
  - `$dbh->do(...)`
  - `$dbh->selectall_arrayref(...)`
  - `$dbh->selectall_hashref(...)`
  - `$dbh->selectrow_hashref(...)`
  - `$dbh->table_info(...)`
- No specific file naming convention — DBI calls can appear anywhere in `.pm` or `.pl` files.

**Entity Definition Style**:

DBI is a low-level interface; "entities" are referenced as table names embedded in SQL strings:

```perl
use DBI;

my $dbh = DBI->connect(
    'dbi:Pg:dbname=myapp;host=localhost',
    'user', 'password',
    { RaiseError => 1, AutoCommit => 1 }
);

my $sth = $dbh->prepare('SELECT id, name, email FROM users WHERE active = ?');
$sth->execute(1);

$dbh->do('INSERT INTO orders (user_id, total) VALUES (?, ?)', undef, $uid, $total);

my $rows = $dbh->selectall_arrayref(
    'SELECT * FROM products WHERE category_id = ?',
    { Slice => {} }, $cat_id
);
```

**Extraction Approach**:

1. **Detect DBI usage**: Search for `use DBI` and `DBI->connect(` in source files.
2. **Extract SQL strings**: Find all string arguments passed to `prepare(...)`, `do(...)`, `selectall_arrayref(...)`, `selectall_hashref(...)`, `selectrow_hashref(...)`, `selectrow_array(...)`.
3. **Parse SQL for table names**: Apply SQL parsing to extract table names from:
   - `FROM <table>` and `JOIN <table>` clauses (SELECT statements)
   - `INTO <table>` clauses (INSERT statements)
   - `UPDATE <table>` clauses
   - `DELETE FROM <table>` clauses
   - `CREATE TABLE <table>` statements
4. **Handle heredoc SQL**: Many Perl DBI scripts use heredoc syntax for multi-line SQL — detect `<<SQL`, `<<'SQL'`, `<<~SQL` etc. and extract the body.
5. **Handle string interpolation**: SQL strings containing Perl variable interpolation (`"SELECT * FROM $table_name"`) cannot be resolved statically — flag these for manual review.
6. **Aggregate table names**: Collect unique table names across all SQL strings in the file.

**Key Challenges**:
- SQL strings may be dynamically constructed via concatenation or `sprintf` — table names invisible to static analysis.
- Table names in `$table_name` variables require data-flow analysis to resolve.
- Heredoc SQL is syntactically distinct and requires special parser handling.
- SQL strings may contain comments, whitespace, and newlines that complicate regex extraction.
- Prepared statement placeholders (`?` or `:name`) must be handled without confusing them for table names.
- Table aliases (`FROM users u`) must be distinguished from the table name.
- CTEs (`WITH cte_name AS (...)`) introduce pseudo-table names that should not be treated as physical tables.

**Analysis Tools**:
- PPI for locating string literals passed to DBI methods.
- `SQL::Statement` CPAN module for parsing SQL strings once extracted.
- `SQL::Parser` for more complex DDL parsing.
- Regex with word-boundary anchors as a fallback for simple cases.
- Tree-sitter SQL grammar for robust SQL parsing.

**Complexity**: High

---

## 7. DBD::* Drivers

**Name**: DBD::Pg, DBD::mysql, DBD::SQLite, DBD::Oracle, DBD::ODBC, DBD::Sybase, DBD::DB2, etc.

**Type**: Raw SQL (Database Driver layer beneath DBI)

**Supported Databases**: Each driver targets a specific database:
- `DBD::Pg` — PostgreSQL
- `DBD::mysql` — MySQL / MariaDB
- `DBD::SQLite` — SQLite
- `DBD::Oracle` — Oracle
- `DBD::ODBC` — any ODBC-connected database
- `DBD::Sybase` — Sybase / SQL Server (TDS protocol)
- `DBD::DB2` — IBM DB2
- `DBD::InterBase` / `DBD::Firebird` — Firebird / InterBase
- `DBD::CSV` — CSV files as tables
- `DBD::JDBC` — JDBC bridge

**Detection Signals**:
- CPAN modules: any `DBD::*` module in dependency files.
- DSN strings in `DBI->connect(...)` calls:
  - `'dbi:Pg:...'`
  - `'dbi:mysql:...'`
  - `'dbi:SQLite:...'`
  - `'dbi:Oracle:...'`
  - `'dbi:ODBC:...'`
- `use DBD::SQLite` (uncommon; usually loaded indirectly by DBI)
- Config files containing DSN strings.

**Entity Definition Style**:

DBD drivers do not define entities themselves — they are the transport layer. Entity definitions come from SQL strings (same as DBI above) or from driver-specific schema introspection calls:

```perl
# Driver-specific schema introspection via DBI methods
my @tables = $dbh->tables(undef, 'public', undef, 'TABLE');
my $sth = $dbh->table_info(undef, 'public', '%', 'TABLE');
my $col_sth = $dbh->column_info(undef, 'public', 'users', '%');
```

**Extraction Approach**:

1. **Detect the database type**: Parse the DSN string in `DBI->connect(...)` to identify which `DBD::*` driver is used — this determines the SQL dialect.
2. **Apply DBI extraction approach** (see section 6) with dialect-specific SQL parsing.
3. **Handle SQLite-specific patterns**: SQLite databases are file-based — look for `.sqlite`, `.db`, `.sqlite3` file references in the DSN (`dbi:SQLite:dbname=myapp.db`). Parse these files directly using an SQLite schema extractor if available.
4. **Handle driver-specific schema calls**: `$dbh->tables(...)` calls indicate runtime schema discovery — flag for manual review.

**Key Challenges**:
- DSN strings may be stored in config files or environment variables, not hardcoded.
- `DBD::CSV` maps CSV files to tables — the "table name" is the filename without extension.
- Driver-specific SQL extensions (e.g., PostgreSQL `RETURNING`, MySQL `AUTO_INCREMENT`) must be handled gracefully by the SQL parser.

**Analysis Tools**:
- Same as DBI (section 6).
- SQLite CLI or `DBD::SQLite` for direct schema extraction from `.db` files.

**Complexity**: Medium (detection), High (entity extraction)

---

## 8. Mojo::Pg / Mojo::mysql

**Name**: Mojo::Pg, Mojo::mysql, Mojo::SQLite

**Type**: Raw SQL with async support (Mojolicious ecosystem)

**Supported Databases**:
- `Mojo::Pg` — PostgreSQL
- `Mojo::mysql` — MySQL / MariaDB
- `Mojo::SQLite` — SQLite

**Detection Signals**:
- CPAN modules:
  - `Mojo::Pg`
  - `Mojo::mysql`
  - `Mojo::SQLite`
- `use` statements:
  - `use Mojo::Pg`
  - `use Mojo::mysql`
  - `use Mojo::SQLite`
  - `Mojo::Pg->new(...)`
  - `$pg->db->query(...)`
  - `$pg->db->select(...)`
  - `$pg->migrations->from_file(...)`
  - `$pg->migrations->from_string(...)`
- File naming conventions:
  - Migration files: `migrations/*.sql`, `*.migrations`, files referenced in `from_file(...)` calls.

**Entity Definition Style**:

Mojo::Pg and related modules use raw SQL queries. Migrations are SQL-based:

```perl
use Mojo::Pg;

my $pg = Mojo::Pg->new('postgresql://user:pass@/myapp');

# Inline migration
$pg->migrations->name('myapp')->from_string(<<'SQL');
  -- 1 up
  CREATE TABLE users (
      id   SERIAL PRIMARY KEY,
      name TEXT NOT NULL
  );
  -- 1 down
  DROP TABLE users;
SQL
$pg->migrations->migrate;

# Query
my $results = $pg->db->query('SELECT id, name FROM users WHERE active = ?', 1);
```

**Extraction Approach**:

1. **Detect Mojo::Pg/mysql/SQLite**: Search for `use Mojo::Pg`, `use Mojo::mysql`, `use Mojo::SQLite`.
2. **Extract inline migration SQL**: Find `->migrations->from_string(...)` with heredoc or string arguments — parse the SQL within for `CREATE TABLE` statements.
3. **Extract migration files**: Find `->migrations->from_file(...)` calls — the file path argument points to a SQL file. Parse that file for `CREATE TABLE` statements.
4. **Extract query table names**: Parse `$pg->db->query(...)`, `$pg->db->select(...)`, `$pg->db->insert(...)`, `$pg->db->update(...)`, `$pg->db->delete(...)` calls — extract SQL strings and parse for table names.
5. **Handle migration format**: Mojo migrations use `-- N up` / `-- N down` comment markers to delimit migration steps — parse between these markers for DDL.

**Key Challenges**:
- Inline SQL strings with Perl variable interpolation cannot be statically resolved.
- Migration SQL may be split across many version steps with additive `ALTER TABLE` statements.
- The `from_data` method loads SQL from Perl's `__DATA__` section — requires reading the `__DATA__` block of the source file.
- `Mojo::mysql` uses slightly different migration format syntax from `Mojo::Pg`.

**Analysis Tools**:
- PPI for extracting SQL strings and `__DATA__` sections.
- SQL parser (SQL::Statement, Tree-sitter SQL) for DDL extraction.

**Complexity**: Medium

---

## 9. SQL::Abstract

**Name**: SQL::Abstract

**Type**: Query Builder (generates SQL from Perl data structures)

**Supported Databases**: Database-agnostic (generates ANSI SQL; used with DBI and any DBD driver)

**Detection Signals**:
- CPAN modules:
  - `SQL::Abstract`
  - `SQL::Abstract::More`
  - `SQL::Abstract::Classic`
- `use` statements:
  - `use SQL::Abstract`
  - `SQL::Abstract->new(...)`
  - `$sqla->select(...)`
  - `$sqla->insert(...)`
  - `$sqla->update(...)`
  - `$sqla->delete(...)`
  - `$sqla->where(...)`

**Entity Definition Style**:

SQL::Abstract does not define entities — it generates SQL from Perl data structures. Table names appear as string arguments:

```perl
use SQL::Abstract;
use DBI;

my $sqla = SQL::Abstract->new;
my ($sql, @bind) = $sqla->select(
    'users',                         # table name
    ['id', 'name', 'email'],         # columns
    { active => 1, role => 'admin' } # where clause
);

my $dbh = DBI->connect(...);
my $sth = $dbh->prepare($sql);
$sth->execute(@bind);
```

**Extraction Approach**:

1. **Detect SQL::Abstract**: Search for `use SQL::Abstract`.
2. **Extract table names**: Parse `$sqla->select('table', ...)`, `$sqla->insert('table', ...)`, `$sqla->update('table', ...)`, `$sqla->delete('table', ...)` — the first argument is the table name.
3. **Handle variable table names**: If the first argument is a variable (`$sqla->select($table_name, ...)`), flag for manual review.
4. **Handle SQL::Abstract::More**: The extended module supports JOINs as `[-join => ['table1', 'table2']]` — parse these join specifications for additional table names.
5. **Cross-reference with DBI**: SQL::Abstract is always used with DBI — combine findings from both.

**Key Challenges**:
- Table names may be passed via variable rather than string literal.
- Subqueries and CTEs introduce pseudo-table references.
- SQL::Abstract::More has an extended syntax for joins and subqueries.

**Analysis Tools**:
- PPI for method call argument extraction.

**Complexity**: Low

---

## 10. Catalyst + DBIx::Class Patterns

**Name**: Catalyst MVC Framework with DBIx::Class

**Type**: Web Framework + Relational ORM Integration

**Supported Databases**: All DBIx::Class-supported databases

**Detection Signals**:
- CPAN modules:
  - `Catalyst`
  - `Catalyst::Runtime`
  - `Catalyst::Model::DBIC::Schema`
  - `Catalyst::Plugin::Authentication`
  - `Catalyst::Controller::REST`
- `use` statements:
  - `use Catalyst`
  - `use parent 'Catalyst::Model::DBIC::Schema'`
  - `use base 'Catalyst::Model::DBIC::Schema'`
  - `__PACKAGE__->config(schema_class => 'MyApp::Schema', ...)`
- File naming conventions:
  - `lib/MyApp.pm` — root Catalyst application class
  - `lib/MyApp/Model/DB.pm` — DBIC model glue
  - `lib/MyApp/Schema.pm` — DBIC schema class
  - `lib/MyApp/Schema/Result/*.pm` — DBIC result classes
  - `myapp.conf`, `myapp.yml`, `myapp_local.conf` — application config files

**Entity Definition Style**:

Catalyst apps using DBIC follow the standard DBIC result class pattern (see section 1). The Catalyst model class is thin glue:

```perl
# lib/MyApp/Model/DB.pm
package MyApp::Model::DB;
use base 'Catalyst::Model::DBIC::Schema';

__PACKAGE__->config(
    schema_class => 'MyApp::Schema',
    connect_info => {
        dsn      => 'dbi:Pg:dbname=myapp',
        user     => 'myapp',
        password => 'secret',
    }
);
```

**Extraction Approach**:

1. **Detect Catalyst**: Find `lib/MyApp.pm` with `use Catalyst` and the application plugin list.
2. **Find the DBIC model**: Search for `lib/*/Model/*.pm` files with `use parent 'Catalyst::Model::DBIC::Schema'`.
3. **Extract schema_class**: Parse `__PACKAGE__->config(schema_class => '...')` — this points to the DBIC schema class.
4. **Apply full DBIC extraction**: Follow the schema class to find all result classes (see section 1).
5. **Check config files**: DSN information in `myapp.conf`, `myapp.yml`, `myapp_local.conf` (Config::General, YAML, or JSON format) may override or replace inline config.
6. **Handle multiple models**: A Catalyst app may have multiple DBIC models pointing to different schema classes and databases.

**Key Challenges**:
- Config files may use `Config::General`, `YAML`, `JSON`, or custom format — need to support multiple parsers.
- Local config files (`*_local.conf`) override base config and may contain real DSNs.
- Catalyst components may use authentication stores that add tables (e.g., `Catalyst::Authentication::Store::DBIx::Class` adds user/role tables).

**Analysis Tools**:
- PPI for source parsing.
- Config::General, YAML::XS, JSON parsers for config files.

**Complexity**: Medium

---

## 11. Dancer2 + Database Plugins

**Name**: Dancer2 with Dancer2::Plugin::DBIC, Dancer2::Plugin::Database, or Dancer2::Plugin::DBIx::Class

**Type**: Web Framework + Database Integration

**Supported Databases**: All DBI-supported databases (depends on plugin)

**Detection Signals**:
- CPAN modules:
  - `Dancer2`
  - `Dancer2::Plugin::DBIC`
  - `Dancer2::Plugin::Database`
  - `Dancer2::Plugin::DBIx::Class`
  - `Dancer::Plugin::Database` (Dancer v1)
  - `Dancer::Plugin::DBIC` (Dancer v1)
- `use` statements:
  - `use Dancer2`
  - `use Dancer2::Plugin::DBIC`
  - `use Dancer2::Plugin::Database`
  - `schema('schema_name')->resultset('TableName')`
  - `database()->quick_select('table_name', ...)`
  - `database->prepare('SELECT ...')`
- File naming conventions:
  - `config.yml` — Dancer2 application config
  - `environments/development.yml`, `environments/production.yml`
  - `lib/MyApp/Schema/Result/*.pm` (when using DBIC plugin)

**Entity Definition Style**:

- **Dancer2::Plugin::DBIC**: Uses DBIC schema (see section 1). Config wires schema class to named schema handles.
- **Dancer2::Plugin::Database**: Uses raw DBI — entities appear in SQL strings.

```yaml
# config.yml (Dancer2::Plugin::DBIC)
plugins:
  DBIC:
    default:
      schema_class: MyApp::Schema
      dsn: "dbi:Pg:dbname=myapp"
      user: myapp
      pass: secret
```

```perl
# Using Dancer2::Plugin::Database (raw DBI wrapper)
my $users = database->quick_select('users', { active => 1 });
my $sth    = database->prepare('SELECT id, name FROM orders');
```

**Extraction Approach**:

1. **Detect Dancer2**: Find `config.yml` with Dancer2 structure, or source files with `use Dancer2`.
2. **Check plugin configuration**: Parse `config.yml` under `plugins:` key:
   - For `DBIC` plugin: find `schema_class` value and apply DBIC extraction.
   - For `Database` plugin: note DSN for context.
3. **For DBIC plugin**: Apply full DBIC extraction (see section 1).
4. **For Database plugin**: Scan route handlers for `database->quick_select('table', ...)`, `database->quick_insert('table', ...)`, `database->quick_update('table', ...)`, `database->quick_delete('table', ...)` — the first argument is the table name.
5. **For raw SQL**: Scan for `database->prepare('...')` and `database->do('...')` — extract and parse SQL strings.

**Key Challenges**:
- Named database handles (`database('secondary')`) require tracking multiple connections.
- Environment-specific config files override base config — parse all environment files.
- Dancer v1 vs. Dancer2 API differences are minor but present.

**Analysis Tools**:
- YAML::XS for config file parsing.
- PPI for source file analysis.

**Complexity**: Medium

---

## 12. Mason + Database

**Name**: Mason (HTML::Mason / Mason2) with embedded Perl database access

**Type**: Template System with Embedded Perl

**Supported Databases**: Any DBI-supported database

**Detection Signals**:
- CPAN modules:
  - `HTML::Mason`
  - `Mason`
  - `Mason::Plugin::DBIx::Class`
- File naming conventions:
  - `.mas`, `.mhtml`, `.mc` — Mason component files
  - `autohandler` — Mason auto-handler component
  - `dhandler` — Mason default handler component
  - `Components/` or `comp/` directories

**Entity Definition Style**:

Mason components are Perl + HTML hybrids. Database access is typically raw DBI or via an injected model object:

```
<%init>
my $dbh = $m->comp('/lib/dbh.mc');
my $sth = $dbh->prepare('SELECT id, title, author FROM articles WHERE published = 1');
$sth->execute;
</%init>
```

Or via injected context:

```
<%args>
$schema
</%args>
<%init>
my @users = $schema->resultset('User')->search({ active => 1 });
</%init>
```

**Extraction Approach**:

1. **Detect Mason**: Find `.mas`, `.mhtml`, or `.mc` files, or `use HTML::Mason` / `use Mason` in source.
2. **Extract Perl blocks**: Parse Mason component files for `<%init>`, `<%once>`, `<%shared>`, and inline `<% %>` code blocks.
3. **Apply DBI extraction** to Perl code within components: search for `$dbh->prepare(...)`, `$dbh->do(...)`, etc.
4. **Apply DBIC extraction** if schema objects are used: search for `->resultset('...')` calls.
5. **Follow component composition**: Mason `$m->comp(...)` calls may route to database-accessing sub-components — track these cross-component relationships.

**Key Challenges**:
- Mason syntax mixes HTML and Perl — standard Perl parsers cannot handle `.mas` files directly.
- Must strip Mason markup before applying PPI or regex-based analysis.
- Database connections may be established in `autohandler` or shared init components and passed down.

**Analysis Tools**:
- Custom Mason-aware parser or regex extraction of `<%...%>` and `<% ... %>` blocks.
- PPI applied to extracted Perl code blocks.

**Complexity**: High

---

## 13. Plack/PSGI Application Database Patterns

**Name**: Plack / PSGI (raw PSGI apps, Middleware stacks)

**Type**: Web Application Interface Layer

**Supported Databases**: Any DBI-supported database

**Detection Signals**:
- CPAN modules:
  - `Plack`
  - `Plack::Builder`
  - `Plack::Request`
  - `Plack::Middleware::DBIx::ConnectInfo`
  - `Plack::Middleware::Static`
- File naming conventions:
  - `app.psgi` — PSGI application entry point
  - `*.psgi` — any PSGI file
  - `bin/app.pl` with PSGI-style `my $app = sub { ... }`

**Entity Definition Style**:

PSGI apps are bare Perl closures. Database access follows DBI, DBIC, or any ORM pattern directly:

```perl
# app.psgi
use Plack::Builder;
use DBI;
use MyApp::Schema;

my $schema = MyApp::Schema->connect('dbi:Pg:dbname=myapp', 'user', 'pass');

my $app = sub {
    my $env = shift;
    my @users = $schema->resultset('User')->all;
    # ...
};

builder {
    mount '/api' => $app;
};
```

**Extraction Approach**:

1. **Detect PSGI**: Find `*.psgi` files or `use Plack::Builder` in source.
2. **Treat as standard Perl source**: Apply DBI, DBIC, or ORM-specific extraction as appropriate to the patterns found within.
3. **Check Plack middleware config**: Middleware like `Plack::Middleware::DBIx::ConnectInfo` may inject a database handle — find DSN in middleware configuration.
4. **Trace schema construction**: The `$schema = MyApp::Schema->connect(...)` call in `app.psgi` identifies the DBIC schema class — follow it for entity extraction.

**Key Challenges**:
- PSGI apps may wire together many sub-applications from different packages.
- Middleware stacks can inject database handles whose source is non-obvious.

**Analysis Tools**:
- PPI for standard Perl analysis.

**Complexity**: Low (detection), varies by underlying ORM/SQL approach

---

## 14. MongoDB Driver (MongoDB::MongoClient)

**Name**: MongoDB Perl Driver (MongoDB, MongoDB::MongoClient)

**Type**: NoSQL (Document Store)

**Supported Databases**: MongoDB

**Detection Signals**:
- CPAN modules:
  - `MongoDB`
  - `MongoDB::MongoClient`
  - `MongoDB::Database`
  - `MongoDB::Collection`
  - `Mango` (Mojolicious MongoDB driver)
- `use` statements:
  - `use MongoDB`
  - `use MongoDB::MongoClient`
  - `MongoDB::MongoClient->new(...)`
  - `$client->get_database('...')`
  - `$db->get_collection('...')`
  - `$db->collection('...')`
  - `$collection->insert_one(...)`
  - `$collection->find(...)`
- Config: MongoDB connection strings (`mongodb://...`) in config files.

**Entity Definition Style**:

MongoDB is schema-less; "entities" are collections. Collection names appear as string arguments to accessor methods:

```perl
use MongoDB;

my $client = MongoDB->connect('mongodb://localhost:27017');
my $db = $client->get_database('myapp');

# Collection access — 'users' is the collection name
my $users = $db->get_collection('users');
$users->insert_one({ name => 'Alice', email => 'alice@example.com' });

my $cursor = $users->find({ active => 1 });
```

With document models (e.g., `Mongoose` or custom base classes):

```perl
package MyApp::Model::User;
use Moose;
with 'MongoDB::Role::_Sendable';
# Collection name often derived from class name or explicitly set
```

**Extraction Approach**:

1. **Detect MongoDB usage**: Search for `use MongoDB` or `use MongoDB::MongoClient`.
2. **Extract database names**: Parse `$client->get_database('...')` — the string argument is the database name.
3. **Extract collection names**: Parse `$db->get_collection('...')`, `$db->collection('...')`, `$db->run_command(...)` — the first argument is the collection name.
4. **Handle direct property access**: Older driver versions support `$db->collection_name` as a method call — scan for `$db->` followed by identifiers that are not known driver methods.
5. **Check for Mongoose or ODM**: If a Mongoose-like ODM is used, find class definitions with `collection => 'name'` or deriving collection name from the class name.
6. **Check config files**: MongoDB URI in `mongodb://host:port/dbname` format — the path component is the database name.

**Key Challenges**:
- MongoDB is schema-less — collection names are the only "entity" signal; field structure is not statically defined.
- Collection names may be constructed dynamically (e.g., per-tenant sharding: `"users_$tenant_id"`).
- Older `MongoDB::MongoClient` API differs from newer `MongoDB` API.
- `Mango` (Mojolicious driver) has a different API.

**Analysis Tools**:
- PPI for method call extraction.
- Regex for collection name string literal patterns.

**Complexity**: Medium

---

## 15. Redis::Client / Redis

**Name**: Redis Perl Client (Redis, Redis::Fast, AnyEvent::Redis)

**Type**: NoSQL (Key-Value Store / Data Structures)

**Supported Databases**: Redis

**Detection Signals**:
- CPAN modules:
  - `Redis`
  - `Redis::Fast`
  - `AnyEvent::Redis`
  - `Mojo::Redis2`
  - `RedisDB`
- `use` statements:
  - `use Redis`
  - `use Redis::Fast`
  - `Redis->new(...)`
  - `$redis->set(...)`, `$redis->get(...)`
  - `$redis->hset(...)`, `$redis->hgetall(...)`
  - `$redis->lpush(...)`, `$redis->rpop(...)`

**Entity Definition Style**:

Redis has no schema. "Entities" are key namespaces (key prefixes), hash names, set names, sorted set names, and stream names:

```perl
use Redis;

my $redis = Redis->new(server => 'localhost:6379');

# String key — namespace "user:" is an entity signal
$redis->set("user:$user_id:name", $name);
$redis->set("user:$user_id:email", $email);

# Hash (represents a single object's fields)
$redis->hset("user:$user_id", name => $name, email => $email);
$redis->hgetall("user:$user_id");

# Sorted set (leaderboard, index)
$redis->zadd("leaderboard:scores", $score, $user_id);

# List
$redis->lpush("queue:jobs", $job_json);
```

**Extraction Approach**:

1. **Detect Redis usage**: Search for `use Redis` or `use Redis::Fast`.
2. **Extract key patterns**: Scan `$redis->set(...)`, `$redis->get(...)`, `$redis->hset(...)`, `$redis->hgetall(...)`, `$redis->zadd(...)`, `$redis->lpush(...)`, etc. — the first argument is the key or key pattern.
3. **Identify key namespaces**: Apply regex to extract the prefix before the first `:` or `_` separator — these prefixes represent logical entity groups (e.g., `user`, `session`, `queue`).
4. **Handle interpolated keys**: Keys like `"user:$user_id"` — extract the literal prefix `user` before the interpolated portion.
5. **Flag as weak signals**: Redis "entities" are informal namespaces, not formal schema — treat as supplementary signals.

**Key Challenges**:
- No formal schema — key namespace conventions vary widely between projects.
- Fully dynamic key construction (`$redis->set($key, $value)`) yields no static signal.
- Redis data structure type (string, hash, list, set, sorted set, stream) determines how "entity-like" a key is — hashes are most entity-like.

**Analysis Tools**:
- PPI for method call extraction.
- Regex for key prefix pattern extraction.

**Complexity**: High (for entity extraction — signals are weak)

---

## 16. Search::Elasticsearch

**Name**: Search::Elasticsearch (official Perl Elasticsearch client)

**Type**: NoSQL (Search Engine / Document Store)

**Supported Databases**: Elasticsearch, OpenSearch

**Detection Signals**:
- CPAN modules:
  - `Search::Elasticsearch`
  - `Search::Elasticsearch::Client::7_0::Direct`
  - `Elasticsearch` (older module name)
- `use` statements:
  - `use Search::Elasticsearch`
  - `Search::Elasticsearch->new(...)`
  - `$es->index(...)`, `$es->search(...)`
  - `$es->indices->create(...)`
  - `$es->indices->put_mapping(...)`

**Entity Definition Style**:

Elasticsearch "entities" are indices (and optionally document types, deprecated since ES 7). Index names and mappings define the schema:

```perl
use Search::Elasticsearch;

my $es = Search::Elasticsearch->new(nodes => 'localhost:9200');

# Create index with mapping — 'users' is the index (entity) name
$es->indices->create(
    index => 'users',
    body  => {
        mappings => {
            properties => {
                name  => { type => 'keyword' },
                email => { type => 'keyword' },
                bio   => { type => 'text' },
            }
        }
    }
);

# Index a document
$es->index(index => 'users', body => { name => 'Alice', email => 'alice@example.com' });

# Search
$es->search(index => 'users', body => { query => { match_all => {} } });
```

**Extraction Approach**:

1. **Detect Search::Elasticsearch**: Search for `use Search::Elasticsearch`.
2. **Extract index names**: Parse `$es->index(index => '...')`, `$es->search(index => '...')`, `$es->indices->create(index => '...')`, `$es->indices->put_mapping(index => '...')` — the `index` key value is the entity name.
3. **Extract mappings**: In `$es->indices->create(...)` calls, parse the `body => { mappings => { properties => { ... } } }` structure for field definitions.
4. **Check for index pattern files**: Index mappings may be stored in separate JSON files (e.g., `elasticsearch/mappings/users.json`) — scan for these and parse for index name and properties.
5. **Handle index aliases**: `$es->indices->put_alias(...)` introduces alias names — these are not separate entities but aliases for existing indices.

**Key Challenges**:
- Index names may be dynamic (e.g., time-series indices: `"logs-$date"`).
- Mappings may be maintained in separate JSON files not easily linked to source code.
- Type-based routing (deprecated) adds complexity in older codebases.

**Analysis Tools**:
- PPI for method call extraction.
- JSON parser for external mapping files.

**Complexity**: Medium

---

## 17. Storable Module

**Name**: Storable (Perl core serialization module)

**Type**: File-Based Object Serialization (weak entity signal)

**Supported Databases**: Filesystem (not a database in the traditional sense)

**Detection Signals**:
- CPAN/core modules:
  - `Storable`
  - `MLDBM` (multi-level DBM using Storable)
  - `DB_File` with Storable serialization
- `use` statements:
  - `use Storable`
  - `Storable::store(...)`, `Storable::retrieve(...)`
  - `Storable::nstore(...)` (network-order/portable)
  - `Storable::dclone(...)` (deep clone — no persistence)
- File naming conventions:
  - `.storable`, `.store`, `.dat` files
  - Serialized object files in `data/`, `cache/`, `tmp/` directories

**Entity Definition Style**:

Storable serializes arbitrary Perl data structures to files. It does not define entities — rather, Perl objects (usually blessed hashrefs) are serialized. The "entity" is implicitly the package name of the serialized object:

```perl
use Storable qw(store retrieve nstore);

# Storing a blessed object
my $user = bless { id => 1, name => 'Alice', email => 'alice@example.com' }, 'MyApp::User';
store $user, 'data/user_1.storable';

# Retrieving
my $user = retrieve('data/user_1.storable');

# Storing a plain hashref
my $data = { users => [...], sessions => [...] };
store $data, 'data/app_state.storable';
```

**Extraction Approach**:

1. **Detect Storable usage**: Search for `use Storable` and `Storable::store(...)` calls.
2. **Identify stored data structures**: Find the variable or expression passed to `store(...)` / `nstore(...)` — trace back to its construction to identify what type of data is being persisted.
3. **Extract class names from blessed objects**: Find `bless ..., 'ClassName'` expressions near `store(...)` calls — the class name is a weak entity signal.
4. **Identify file paths**: Extract the second argument to `store(...)` / `nstore(...)` for persistence file naming patterns.
5. **Flag as supplementary**: Storable is a persistence mechanism, not a database — treat discovered "entities" as supplementary, lower-confidence signals.
6. **Check MLDBM**: If `MLDBM` is used with `Storable`, it creates a tied hash backed by a DBM file — the DBM filename (passed to `tie`) and the hash keys are "collection" names.

**Key Challenges**:
- Serialized data has no formal schema — the "entity" shape is entirely implicit.
- `dclone` does not persist data and should be ignored.
- File paths may be dynamically constructed, making it impossible to enumerate all stored "entity types" statically.
- MLDBM adds another layer of indirection.

**Analysis Tools**:
- PPI for `bless`, `store`, `retrieve` pattern detection.

**Complexity**: High (for entity extraction — signals are very weak)

---

## 18. Raw SQL Files (.sql DDL)

**Name**: Raw SQL DDL files

**Type**: Schema File / Migration Tool

**Supported Databases**: All SQL databases (dialect varies)

**Detection Signals**:
- File patterns:
  - `*.sql` — any SQL file
  - `schema.sql`, `schema_dump.sql`, `db/schema.sql`
  - `migrations/*.sql`, `db/migrate/*.sql`
  - `sql/create_*.sql`, `sql/tables/*.sql`
  - `t/fixtures/*.sql` — test fixtures
  - `script/schema.sql`
  - `DDL/*.sql`
- Content signals within `.sql` files:
  - `CREATE TABLE`
  - `CREATE INDEX`
  - `ALTER TABLE`
  - `CREATE VIEW`
  - `CREATE SEQUENCE`
- Tool-specific migration file patterns:
  - `DBIx::Class::DeploymentHandler`: `dbicdh/*/deploy/*/001_auto.sql`
  - `sqitch`: `deploy/*.sql`, `revert/*.sql`, `verify/*.sql` + `sqitch.conf`, `sqitch.plan`
  - `Flyway` (if used with Perl apps): `V1__Create_users_table.sql`
  - `App::Sqitch`: `sqitch.conf` config file, `sqitch.plan` migration plan

**Entity Definition Style**:

Standard SQL DDL:

```sql
CREATE TABLE users (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(255) NOT NULL,
    email      VARCHAR(255) UNIQUE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE orders (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    total      NUMERIC(10,2),
    status     VARCHAR(50) DEFAULT 'pending'
);

CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE VIEW active_users AS SELECT * FROM users WHERE active = true;
```

**Extraction Approach**:

1. **Discover SQL files**: Glob for `**/*.sql` patterns across the repository.
2. **Parse DDL statements**: Apply a SQL parser (SQL::Statement, Tree-sitter SQL grammar, or pg_query for PostgreSQL-specific SQL) to each file.
3. **Extract table names**: Parse `CREATE TABLE [IF NOT EXISTS] [schema.]table_name (...)` — extract the table name (strip schema prefix if present).
4. **Extract column definitions**: Parse the column list within the `CREATE TABLE` body.
5. **Extract ALTER TABLE additions**: Parse `ALTER TABLE table_name ADD COLUMN col_name type` statements for tables defined elsewhere.
6. **Extract views**: Parse `CREATE VIEW view_name AS SELECT ...` — note as views (derived entities), not physical tables.
7. **Handle migration sequences**: If using sqitch, DBIx::Class::DeploymentHandler, or numbered migration files, process files in order — later `ALTER TABLE` statements modify earlier `CREATE TABLE` definitions.
8. **Identify dialect**: Check for `SERIAL` vs `AUTOINCREMENT` vs `IDENTITY` to determine PostgreSQL vs SQLite vs SQL Server dialect; adjust parser accordingly.

**Key Challenges**:
- Multiple SQL dialects in the same repository (test fixtures vs. production migrations).
- `CREATE TABLE IF NOT EXISTS` and `CREATE OR REPLACE` variants.
- Schema-qualified names (`public.users`, `myschema.orders`) must be handled.
- Vendor-specific extensions (PostgreSQL arrays, JSON columns, MySQL `ENGINE=InnoDB`).
- Views and materialized views are entities but not physical tables — should be distinguished.
- Temp tables (`CREATE TEMP TABLE`, `CREATE TEMPORARY TABLE`) are ephemeral and usually not data entities.

**Analysis Tools**:
- `SQL::Statement` CPAN module for basic SQL parsing.
- `SQL::Translator` (SQLFairy) — full DDL parser and schema object model; supports many dialects.
- Tree-sitter SQL grammar for fast, robust parsing.
- `pgFormatter` / `pg_query` for PostgreSQL-specific parsing.
- Regex as a fallback: `CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)`.

**Complexity**: Low (for simple DDL), Medium (for multi-dialect migration sequences)

---

## 19. YAML/JSON Config Files with Schema Definitions

**Name**: YAML / JSON configuration files with embedded schema or entity definitions

**Type**: Schema File / Configuration-Driven Schema

**Supported Databases**: Varies (often used with ORMs or custom frameworks)

**Detection Signals**:
- File patterns:
  - `schema.yml`, `schema.yaml`, `db_schema.yml`
  - `config/schema.yml`, `config/models.yml`
  - `entities.yml`, `tables.yml`, `models.json`
  - `META.yml`, `META.json` (CPAN distribution metadata — not DB schema but module metadata)
  - Any YAML/JSON file containing keys like `tables:`, `collections:`, `entities:`, `models:`
- Framework-specific files:
  - **Jifty** (Perl web framework): `lib/MyApp/Model/*.pm` with `use Jifty::DBI::Record` — but also `config/config.yml` for DSN.
  - **Fey::ORM** config files.
  - **ObjectDB** / custom ORMs: YAML-based schema files.
  - **DBIx::Class::Schema::Loader** dump_directory with associated `*.yaml` schema cache files.

**Entity Definition Style**:

Example custom YAML schema (varies by framework):

```yaml
# schema.yml — hypothetical custom schema definition
tables:
  users:
    columns:
      id:     { type: integer, primary_key: true, auto_increment: true }
      name:   { type: varchar, length: 255, nullable: false }
      email:  { type: varchar, length: 255 }
    indexes:
      - columns: [email], unique: true

  orders:
    columns:
      id:       { type: integer, primary_key: true, auto_increment: true }
      user_id:  { type: integer, foreign_key: users.id }
      total:    { type: decimal, precision: 10, scale: 2 }
```

**Extraction Approach**:

1. **Discover YAML/JSON files**: Glob for `**/*.yml`, `**/*.yaml`, `**/*.json` in the repository.
2. **Filter for schema-related files**: Check for keys `tables`, `collections`, `entities`, `models`, `schema` at the top level.
3. **Parse YAML/JSON**: Use `YAML::XS`, `YAML::Tiny`, or `JSON::XS` to parse the file into a Perl data structure.
4. **Extract entity names**: Iterate over keys of `tables:`, `collections:`, `entities:` hashes — each key is an entity name.
5. **Extract field definitions**: For each entity, parse the nested column/field definitions.
6. **Handle framework-specific schemas**: For known frameworks (Jifty, Fey::ORM), apply framework-specific extraction logic.
7. **Cross-reference with source**: YAML schema files are often consumed by code — verify by searching source files for the schema file path or the framework's `load_schema(...)` method.

**Key Challenges**:
- No standard schema definition format — each custom framework uses its own YAML structure.
- False positives: most YAML files in Perl projects are application config, not schema definitions.
- Schema files may define entities at multiple nesting levels.
- JSON API response schemas (OpenAPI, JSON Schema) define data structures but are not database schemas — must distinguish.

**Analysis Tools**:
- YAML::XS, YAML::Tiny, JSON::XS for parsing.
- Heuristics (key name matching) to identify schema-bearing files.

**Complexity**: High (highly project-specific)

---

## 20. Repository Detection Plan

Given an unknown Perl repository, follow this ordered detection procedure to identify which data entity storage approaches are in use.

### Step 1: Inventory Dependency Files

Parse the following files to enumerate declared CPAN dependencies:

| File | Parser |
|------|--------|
| `cpanfile` | `Module::CPANfile` or regex `requires 'ModuleName'` |
| `Makefile.PL` | Regex for `PREREQ_PM`, `requires`, `build_requires` |
| `Build.PL` | Regex for `requires`, `recommends` |
| `META.yml` | YAML parser — `requires`, `build_requires`, `runtime.requires` |
| `META.json` | JSON parser — `prereqs.runtime.requires` |
| `dist.ini` (Dist::Zilla) | INI parser — `[Prereqs]` section |
| `minil.toml` (Minilla) | TOML parser |

**Decision matrix** based on detected modules:

| Detected Module | Approach |
|----------------|----------|
| `DBIx::Class` | Section 1 |
| `DBIx::Class::Schema::Loader` | Section 2 |
| `Rose::DB::Object` | Section 3 |
| `Class::DBI` | Section 4 |
| `Alzabo` | Section 5 |
| `DBI` | Section 6 |
| `DBD::Pg` / `DBD::mysql` / `DBD::SQLite` / `DBD::Oracle` | Section 7 |
| `Mojo::Pg` / `Mojo::mysql` / `Mojo::SQLite` | Section 8 |
| `SQL::Abstract` | Section 9 |
| `Catalyst::Model::DBIC::Schema` | Section 10 |
| `Dancer2::Plugin::DBIC` / `Dancer2::Plugin::Database` | Section 11 |
| `HTML::Mason` / `Mason` | Section 12 |
| `Plack` | Section 13 |
| `MongoDB` / `MongoDB::MongoClient` | Section 14 |
| `Redis` / `Redis::Fast` | Section 15 |
| `Search::Elasticsearch` | Section 16 |
| `Storable` | Section 17 |

### Step 2: Scan File System Structure

Examine directory layout for structural signals:

```
lib/
  <AppName>/
    Schema.pm                    → DBIx::Class schema root
    Schema/
      Result/                    → DBIx::Class result classes (one per table)
      ResultSet/                 → DBIx::Class custom resultsets
    Model/
      DB.pm                      → Catalyst/Dancer2 DBIC model glue
migrations/                      → SQL migration files
db/
  schema.sql                     → Raw SQL DDL
  migrate/                       → SQL migration files
sqitch/
  sqitch.conf                    → App::Sqitch config
  sqitch.plan                    → migration plan
dbicdh/                          → DBIx::Class::DeploymentHandler
*.psgi                           → Plack/PSGI application entry point
config.yml / myapp.conf          → Framework config (DSN, schema_class)
```

### Step 3: Scan Source Files for Use Statements

Run targeted grep/search across all `.pm` and `.pl` files:

```
# Priority 1 — ORM detection
use base 'DBIx::Class'
use parent 'DBIx::Class'
use base 'Class::DBI'
use base 'Rose::DB::Object'
__PACKAGE__->table(
__PACKAGE__->add_columns(
__PACKAGE__->meta->setup(

# Priority 2 — Raw SQL / Query Builder
use DBI
DBI->connect(
$dbh->prepare(
use SQL::Abstract
use Mojo::Pg
use Mojo::mysql

# Priority 3 — NoSQL
use MongoDB
use Redis
use Search::Elasticsearch

# Priority 4 — Framework detection
use Catalyst
use Dancer2
use HTML::Mason
use Plack::Builder
```

### Step 4: Scan for SQL Files

```
# Find all SQL files
**/*.sql

# Find sqitch artifacts
sqitch.conf
sqitch.plan
deploy/*.sql
revert/*.sql
verify/*.sql

# Find DBIC deployment handler artifacts
dbicdh/**/*.sql
```

Parse all discovered `.sql` files for `CREATE TABLE` statements.

### Step 5: Scan Config Files

Parse config files for DSN strings and schema class references:

| File | Parser | Keys to Check |
|------|--------|---------------|
| `*.yml`, `*.yaml` | YAML::XS | `dsn`, `database`, `schema_class`, `connect_info` |
| `*.json` | JSON::XS | same |
| `*.conf` (Catalyst) | Config::General | same |
| `.env`, `app.env` | key=value regex | `DATABASE_URL`, `DB_DSN`, `POSTGRES_DSN` |
| `*.ini` | Config::IniFiles | `dsn`, `database` |

DSN string patterns to identify database type:
- `dbi:Pg:` → PostgreSQL
- `dbi:mysql:` → MySQL/MariaDB
- `dbi:SQLite:` → SQLite
- `dbi:Oracle:` → Oracle
- `dbi:ODBC:` → ODBC
- `mongodb://` → MongoDB
- Redis: `server => 'host:6379'` pattern

### Step 6: Apply Framework-Specific Extraction

Based on findings from steps 1–5, apply the appropriate extraction procedure:

1. **If DBIx::Class** (sections 1–2):
   - Find all files under `*/Schema/Result/` or matching `use base 'DBIx::Class::Core'`.
   - For each file: extract `->table(...)`, `->add_columns(...)`, `->set_primary_key(...)`, relationship declarations.
   - Distinguish Schema::Loader-generated files from hand-written by checking for the `# Created by DBIx::Class::Schema::Loader` marker.

2. **If Rose::DB::Object** (section 3):
   - Find all files with `use base 'Rose::DB::Object'`.
   - Extract `meta->setup(table => '...', columns => [...])`.

3. **If Class::DBI** (section 4):
   - Find all files with `use base 'Class::DBI'`.
   - Extract `->table(...)` and `->columns(All => qw/.../)`.

4. **If raw DBI / DBD::*** (sections 6–7):
   - Find all `$dbh->prepare(...)`, `$dbh->do(...)`, `$dbh->selectall_*()` calls.
   - Extract SQL strings (literal and heredoc).
   - Parse SQL for table names using SQL::Statement or Tree-sitter SQL grammar.
   - Flag interpolated SQL strings as dynamic/unresolvable.

5. **If SQL files found** (section 18):
   - Parse each SQL file with SQL::Translator or regex.
   - Extract `CREATE TABLE` names.
   - Apply `ALTER TABLE` modifications in migration order.

6. **If MongoDB** (section 14):
   - Extract `$db->get_collection('...')` and `$db->collection('...')` calls.

7. **If Elasticsearch** (section 16):
   - Extract `$es->index(index => '...')` and `$es->indices->create(index => '...')` calls.

### Step 7: Build Entity Inventory

Aggregate all discovered entities with provenance:

```
Entity Name    | Source Type          | Source File / Location        | Confidence
---------------|----------------------|-------------------------------|------------
users          | DBIx::Class Result   | lib/MyApp/Schema/Result/User.pm | High
orders         | DBIx::Class Result   | lib/MyApp/Schema/Result/Order.pm | High
products       | CREATE TABLE (SQL)   | db/schema.sql:12              | High
sessions       | DBI prepare()        | lib/MyApp/Session.pm:45       | Medium
cache:user:*   | Redis key pattern    | lib/MyApp/Cache.pm:23         | Low
```

**Confidence levels**:
- **High**: Explicit ORM table declaration or `CREATE TABLE` in DDL.
- **Medium**: Table name extracted from SQL string literal in DBI call.
- **High**: Collection name extracted from MongoDB literal call.
- **Low**: Redis key namespace, Storable class name, dynamically constructed SQL.

### Step 8: Resolve Conflicts and Deduplication

- Deduplicate entity names discovered from multiple sources (e.g., same table in DBIC result class AND in `schema.sql` migration).
- Cross-reference DBIC result class package names with physical table names (the `->table('...')` declaration is canonical).
- Flag entities that appear only in test fixtures or test schema files as test-only entities.
- Flag entities with dynamically constructed names as unresolvable.

---

*Document generated 2026-03-27. Covers Perl 5 ecosystem as of CPAN state circa 2025–2026.*
