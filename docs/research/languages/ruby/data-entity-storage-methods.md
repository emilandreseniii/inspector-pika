# Ruby Data Entity Storage Methods

A catalog of Ruby frameworks, libraries, and approaches for data entity storage, intended to support automated static analysis of repositories to extract data entity definitions (database tables, document collections, etc.).

---

## Table of Contents

1. [ActiveRecord (Rails)](#1-activerecord-rails)
2. [ActiveRecord Migrations](#2-activerecord-migrations)
3. [Rails schema.rb](#3-rails-schemarb)
4. [Rails structure.sql](#4-rails-structuresql)
5. [Sequel](#5-sequel)
6. [ROM (rom-rb)](#6-rom-rom-rb)
7. [DataMapper (discontinued)](#7-datamapper-discontinued)
8. [Mongoid](#8-mongoid)
9. [MongoMapper (discontinued)](#9-mongomapper-discontinued)
10. [Redis (redis-rb / Ohm)](#10-redis-redis-rb--ohm)
11. [Elasticsearch (elasticsearch-ruby / Searchkick)](#11-elasticsearch-elasticsearch-ruby--searchkick)
12. [Hanami::Model](#12-hanamimodel)
13. [dry-struct](#13-dry-struct)
14. [Grape API Entities](#14-grape-api-entities)
15. [GraphQL Ruby Schema Types](#15-graphql-ruby-schema-types)
16. [Protobuf Ruby](#16-protobuf-ruby)
17. [Shrine (file attachments)](#17-shrine-file-attachments)
18. [ActiveModel (non-DB models)](#18-activemodel-non-db-models)

---

## 1. ActiveRecord (Rails)

**Name**: ActiveRecord (Ruby on Rails)

**Type**: Relational ORM

**Supported Databases**: MySQL, PostgreSQL, SQLite, SQL Server, Oracle (via adapters)

**Detection Signals**:
- `Gemfile` dependencies: `rails`, `activerecord`, or specific adapter gems: `pg`, `mysql2`, `sqlite3`
- Classes inheriting `ApplicationRecord` (Rails 5+) or `ActiveRecord::Base` (Rails 4 and earlier)
- File location: `app/models/*.rb` (standard Rails convention)
- `config/database.yml` present (definitive Rails signal)
- `.env` / `config/application.rb` with `DATABASE_URL`
- `db/migrate/` directory (presence of migration files)
- `db/schema.rb` or `db/structure.sql` present
- `self.table_name = 'custom_name'` property override in model
- Association macros: `has_many`, `belongs_to`, `has_one`, `has_and_belongs_to_many`, `has_many :through`
- Scope definitions: `scope :name, -> { ... }`
- `validates`, `before_save`, `after_create` callbacks

**Entity Definition Style**:
- Ruby class inheriting `ApplicationRecord` or `ActiveRecord::Base`
- No explicit column declarations in the model; schema defined entirely in migrations / `schema.rb`
- Table name: conventionally plural snake_case of class name (e.g., `UserProfile` → `user_profiles`); override via `self.table_name = 'custom_name'`
- Column names surfaced via `$fillable`-equivalent: `attr_accessible` (Rails 3), `strong_parameters` (Rails 4+, in controllers)
- Virtual attributes via `attr_accessor` (not persisted)

**Extraction Approach**:
1. Parse `Gemfile` / `Gemfile.lock` to confirm `activerecord` or `rails`.
2. Use a Ruby AST parser (tree-sitter-ruby or `parser` gem) to find all class definitions.
3. Identify classes inheriting `ApplicationRecord` or `ActiveRecord::Base` (direct or through intermediate base classes).
4. For each model class:
   a. Check for `self.table_name = '...'` — use as table name.
   b. If absent, apply Rails convention: `ActiveSupport::Inflector.tableize(ClassName)` → pluralized snake_case.
5. Extract `has_many :relation_name`, `belongs_to :relation_name` for relationship mapping.
6. Cross-reference with `db/schema.rb` (section 3) for authoritative column definitions.
7. Note `include` / `extend` module calls for trait-like column additions (e.g., `Paranoia`, `ActsAsTaggableOn`).

**Key Challenges**:
- Dynamic `self.table_name` (set via lambda or method) is not statically resolvable.
- STI (Single Table Inheritance): multiple model classes share one table via a `type` column; the parent class defines the table.
- Polymorphic associations: `belongs_to :commentable, polymorphic: true` creates `*_type` / `*_id` columns implicitly.
- Multi-database setups: `connects_to database: { writing: :primary }` — model uses a non-default database.
- Concern modules (`include SomeModule`) can add associations and callbacks that imply columns.
- Abstract models (`self.abstract_class = true`) do not map to tables.
- Delegated types (Rails 6.1+): `delegated_type :entryable, types: %w[Message Comment]`.

**Analysis Tools**:
- tree-sitter with [tree-sitter-ruby](https://github.com/tree-sitter/tree-sitter-ruby) grammar
- Ruby `parser` gem (produces s-expression AST)
- `rubocop-ast` for AST node traversal

**Complexity**: Medium

---

## 2. ActiveRecord Migrations

**Name**: ActiveRecord Migrations

**Type**: Migration Tool / Schema Definition

**Supported Databases**: MySQL, PostgreSQL, SQLite, SQL Server (same as ActiveRecord)

**Detection Signals**:
- Directory: `db/migrate/` containing Ruby files
- Files named with timestamp pattern: `YYYYMMDDHHMMSS_description.rb`
- Classes inheriting `ActiveRecord::Migration` or `ActiveRecord::Migration[6.1]` (versioned form)
- Method calls: `create_table`, `drop_table`, `rename_table`, `add_column`, `remove_column`, `change_column`, `add_index`
- `change`, `up`, `down` method definitions within migration class

**Entity Definition Style**:
- `create_table :table_name do |t|` blocks define new tables
- Column macros inside block: `t.string :name`, `t.integer :count`, `t.timestamps`, `t.references :user`
- `add_column :table_name, :column_name, :type` for additive schema changes
- `rename_table :old_name, :new_name` for table renames

**Extraction Approach**:
1. Locate all files in `db/migrate/` matching the timestamp filename pattern.
2. Sort files chronologically by the leading timestamp in filename.
3. For each migration file, parse the Ruby AST:
   a. Find `create_table :table_name` (or string `'table_name'`) — record as new table.
   b. Find `drop_table :table_name` — mark as dropped.
   c. Find `rename_table :old, :new` — track rename.
   d. Find `add_column :table_name, :column_name, :type` — add column to table.
   e. Find `remove_column :table_name, :column_name` — remove column.
4. Within `create_table` blocks, collect `t.string`, `t.integer`, `t.text`, `t.boolean`, `t.references`, `t.timestamps`, etc. column definitions.
5. Apply migration history sequentially to reconstruct the final schema state.
6. Note: `db/schema.rb` is the canonical result of applying all migrations (see section 3).

**Key Challenges**:
- Variable table names: `create_table variable_name` — not statically resolvable.
- `execute('CREATE TABLE ...')` or `execute(sql_string)` bypasses the DSL.
- Squashed migrations: a single `db/migrate/YYYYMMDDHHMMSS_squashed.rb` replaces many older files.
- Reversible vs. irreversible migrations (`change` vs. `up`/`down`).
- `t.references :user` creates `user_id` (integer) and optionally `user_type` (for polymorphic) — two implicit columns.
- `t.timestamps` creates two columns: `created_at` and `updated_at`.

**Analysis Tools**:
- tree-sitter-ruby grammar
- Ruby `parser` gem

**Complexity**: Medium

---

## 3. Rails schema.rb

**Name**: Rails schema.rb

**Type**: Schema File (Canonical)

**Supported Databases**: MySQL, PostgreSQL, SQLite, SQL Server

**Detection Signals**:
- File: `db/schema.rb` (present in virtually all Rails projects using SQL databases)
- Content begins with `ActiveRecord::Schema[x.x].define(version: ...)` or `ActiveRecord::Schema.define(version: ...)`
- `create_table` blocks within the schema definition

**Entity Definition Style**:
- `create_table "table_name", force: :cascade do |t|` blocks — one per table
- Column macros within block: `t.string "column_name"`, `t.integer "column_name"`, `t.datetime "column_name"`, etc.
- `t.index ["column_name"], name: "index_name"` for index definitions

**Extraction Approach**:
1. Check for `db/schema.rb` existence.
2. Parse the file with a Ruby AST parser.
3. Extract all `create_table "table_name"` (or `:table_name`) calls — each is a table.
4. For each table, collect all column definition method calls (`t.string`, `t.integer`, `t.text`, `t.boolean`, `t.decimal`, `t.datetime`, `t.references`, `t.timestamps`, etc.).
5. Extract column name (first argument) and type (method name) for each column.
6. This is the most reliable source for Rails relational schema — prefer over individual migrations.

**Key Challenges**:
- `schema.rb` may be out of sync with migrations if not regenerated (run `rails db:schema:dump`).
- Databases with advanced features (views, stored procedures, custom types) use `structure.sql` instead — `schema.rb` will be absent.
- `t.references :user` in schema.rb generates `user_id bigint` — the column name includes the `_id` suffix.

**Analysis Tools**:
- tree-sitter-ruby grammar
- Ruby `parser` gem
- Simple regex: `create_table\s+["':]([\w]+)` for quick table name extraction

**Complexity**: Low

---

## 4. Rails structure.sql

**Name**: Rails structure.sql

**Type**: Schema File (Canonical — DDL format)

**Supported Databases**: PostgreSQL (primary), MySQL, SQLite (when `config.active_record.schema_format = :sql`)

**Detection Signals**:
- File: `db/structure.sql`
- `config/application.rb` contains `config.active_record.schema_format = :sql`
- File content: raw SQL DDL statements (`CREATE TABLE`, `CREATE INDEX`, `CREATE SEQUENCE`, etc.)

**Entity Definition Style**:
- Standard SQL DDL: `CREATE TABLE public.users (id bigint NOT NULL, name character varying, ...)`
- PostgreSQL-specific types, sequences, constraints are preserved verbatim
- Views defined as `CREATE VIEW ...`

**Extraction Approach**:
1. Check for `db/structure.sql` existence.
2. Apply SQL parsing (same as SQL schema file extraction):
   a. Regex or SQL parser for `CREATE TABLE [schema.]table_name (...)` statements.
   b. Extract table name and column definitions.
3. Also extract `CREATE VIEW` statements as secondary signals.
4. Handle PostgreSQL schema prefixes (e.g., `public.users` → table `users` in schema `public`).

**Key Challenges**:
- PostgreSQL-specific DDL syntax (e.g., `PARTITION BY`, `INHERITS`) requires a PostgreSQL-aware SQL parser.
- Comments, extensions, and custom types mixed in the file.
- Multiple schemas (`public`, custom) may exist in the same file.

**Analysis Tools**:
- `sqlglot` (Python, supports PostgreSQL dialect)
- tree-sitter SQL grammar
- Regex for basic `CREATE TABLE` extraction

**Complexity**: Low

---

## 5. Sequel

**Name**: Sequel

**Type**: Relational ORM / Query Builder

**Supported Databases**: MySQL, PostgreSQL, SQLite, Oracle, MSSQL, DB2, and others

**Detection Signals**:
- `Gemfile`: `sequel`
- `Sequel::Model` subclasses: `class User < Sequel::Model` or `class User < Sequel::Model(:users)`
- `DB.create_table(:table_name)` blocks in migration or schema files
- `Sequel.connect(...)` or `DB = Sequel.connect(...)` database connection setup
- Migration files extending `Sequel::Migration` or using `Sequel.migration { change { ... } }`

**Entity Definition Style**:
- **Model approach**: `class Article < Sequel::Model` — table name inferred (pluralized snake_case) or explicit via `Sequel::Model(:table_name)` or `set_dataset :table_name`
- **Schema DSL approach**: `DB.create_table(:table_name) do ... end` — columns defined inline with `String :name`, `Integer :count`, `DateTime :created_at`
- **Migration approach**: `Sequel.migration { change { create_table(:table_name) { ... } } }`

**Extraction Approach**:
1. Detect `sequel` in `Gemfile` or `Gemfile.lock`.
2. Scan for `Sequel::Model` subclasses:
   a. `class Foo < Sequel::Model` — table name is pluralized snake_case (`foo` → `foos`).
   b. `class Foo < Sequel::Model(:custom_table)` — table name is the symbol/string argument.
   c. `set_dataset :table_name` or `set_dataset DB[:table_name]` — extract table name.
3. Scan for `DB.create_table(:name)` or `create_table(:name)` calls:
   a. Extract symbol/string as table name.
   b. Parse block for column definitions: `String :col`, `Integer :col`, `primary_key :id`, `foreign_key :user_id`.
4. Scan for Sequel migration files (typically in `db/migrations/` or `migrate/`).

**Key Challenges**:
- Sequel's dataset can be any SQL expression — `set_dataset DB[:users].where(active: true)` still maps to `users`.
- `DB.create_table?` (conditional) and `DB.alter_table` for modifications.
- Plugins (e.g., `plugin :timestamps`, `plugin :paranoia`) add implicit columns.
- Column definitions use Ruby type methods (`String`, `Integer`) rather than method calls — unusual pattern.

**Analysis Tools**:
- tree-sitter-ruby grammar
- Ruby `parser` gem

**Complexity**: Medium

---

## 6. ROM (rom-rb)

**Name**: ROM (Ruby Object Mapper)

**Type**: Relational ORM / Data Mapper

**Supported Databases**: PostgreSQL, MySQL, SQLite, and others via adapters (`rom-sql`, `rom-mongo`, `rom-http`)

**Detection Signals**:
- `Gemfile`: `rom`, `rom-rb`, `rom-sql`, `rom-core`
- `ROM::Relation` subclasses (or `ROM::SQL::Relation` with `rom-sql`)
- `schema(:table_name)` or `schema(:table_name, infer: true)` call within relation class
- `ROM::Configuration` or `ROM.container` setup
- Relation files in `lib/persistence/relations/` or similar

**Entity Definition Style**:
- Relation class with explicit schema: `schema(:users) do attribute :id, Types::Integer; attribute :name, Types::String; end`
- Or inferred schema: `schema(:users, infer: true)` — relies on database introspection (not statically analyzable)
- Association declarations: `associations do has_many :posts; belongs_to :account end`

**Extraction Approach**:
1. Detect `rom`, `rom-sql`, or `rom-rb` in `Gemfile`.
2. Scan for classes inheriting `ROM::Relation`, `ROM::SQL::Relation`, or including `ROM::Relation[:sql]`.
3. For each relation class:
   a. Find `schema(:table_name)` or `schema(:table_name, infer: true)` — extract symbol/string as table name.
   b. If `infer: true`, table name is known but columns are runtime-introspected.
   c. If explicit schema block, parse `attribute :col_name, Types::TypeName` for column names and types.
4. Look for `ROM::Configuration` setup to identify adapter types (SQL vs MongoDB).

**Key Challenges**:
- `infer: true` schemas are not statically analyzable for columns — only table name is recoverable.
- ROM is often used without Rails; configuration patterns vary widely.
- `rom-changeset` and `rom-repository` layers do not directly define tables.

**Analysis Tools**:
- tree-sitter-ruby grammar
- Ruby `parser` gem

**Complexity**: Medium

---

## 7. DataMapper (discontinued)

**Name**: DataMapper

**Type**: Relational ORM (discontinued; still found in legacy codebases)

**Supported Databases**: MySQL, PostgreSQL, SQLite, and others via adapters

**Detection Signals**:
- `Gemfile`: `dm-core`, `data_mapper`, `dm-migrations`, `dm-sqlite-adapter`, `dm-postgres-adapter`
- Classes including `DataMapper::Resource` mixin: `include DataMapper::Resource`
- `property :column_name, Type` declarations within model classes
- `DataMapper.setup(:default, 'adapter://...')` in setup files

**Entity Definition Style**:
- Ruby class with `include DataMapper::Resource`
- `property :id, Serial` for primary key; `property :name, String`, `property :age, Integer`, etc.
- `storage_names[:default] = 'custom_table_name'` for explicit table name override
- Associations: `has n, :posts`, `belongs_to :user`

**Extraction Approach**:
1. Detect `dm-core` or `data_mapper` in `Gemfile`.
2. Scan for classes with `include DataMapper::Resource`.
3. For each class:
   a. Check `storage_names[:default] = '...'` for explicit table name.
   b. Otherwise, derive table name by applying DataMapper's convention: pluralized snake_case class name.
4. Parse all `property :name, Type` declarations for column names and types.
5. Extract relationship declarations: `has n, :relation`, `belongs_to :relation`.

**Key Challenges**:
- DataMapper is discontinued (last release ~2012) but still present in legacy codebases.
- `storage_names` can have multiple keys for different repositories; default is `:default`.
- Custom type objects (e.g., `DataMapper::Property::EpochTime`) require type mapping.

**Analysis Tools**:
- tree-sitter-ruby grammar
- Ruby `parser` gem

**Complexity**: Medium

---

## 8. Mongoid

**Name**: Mongoid

**Type**: NoSQL ORM (Document Store)

**Supported Databases**: MongoDB

**Detection Signals**:
- `Gemfile`: `mongoid`
- Classes with `include Mongoid::Document` mixin
- `field :name, type: String` declarations within model classes
- `mongoid.yml` or `config/mongoid.yml` configuration file
- `embeds_many`, `embeds_one`, `embedded_in` relationship macros
- `store_in collection: 'custom_name'` for explicit collection name

**Entity Definition Style**:
- Ruby class with `include Mongoid::Document` and explicit `field` declarations
- `field :name, type: String, default: nil` — each field is explicitly declared
- Collection name: `store_in collection: 'custom_name'` or inferred as pluralized snake_case of class name
- Embedded documents: `embeds_many :addresses` — `Address` documents stored within the parent document, not a separate collection

**Extraction Approach**:
1. Detect `mongoid` in `Gemfile`.
2. Scan for classes with `include Mongoid::Document`.
3. For each class:
   a. Check `store_in collection: '...'` for explicit collection name.
   b. Otherwise, derive: pluralized snake_case of class name.
   c. Note if class also includes `Mongoid::EmbeddedDocument` — it does not have its own collection.
4. Collect all `field :name, type: TypeClass` declarations for field names and types.
5. Extract `embeds_many`, `embeds_one`, `has_many`, `has_one`, `belongs_to` for relationship map.
6. Check `mongoid.yml` for database name and client configuration.

**Key Challenges**:
- Embedded documents share their parent's collection — not separate collections.
- `Mongoid::Document` classes used as embeddables can be tricky to distinguish from root documents.
- Dynamic attributes (`include Mongoid::Attributes::Dynamic`) allow arbitrary fields — not statically discoverable.
- Concerns (`include SomeConcern`) may add additional `field` declarations from external modules.
- Inheritance: if a class inherits another `Mongoid::Document` class, it shares the same collection (with a `_type` discriminator).

**Analysis Tools**:
- tree-sitter-ruby grammar
- Ruby `parser` gem
- YAML parser for `mongoid.yml`

**Complexity**: Medium

---

## 9. MongoMapper (discontinued)

**Name**: MongoMapper

**Type**: NoSQL ORM (Document Store, discontinued)

**Supported Databases**: MongoDB

**Detection Signals**:
- `Gemfile`: `mongo_mapper`
- Classes with `include MongoMapper::Document` or `include MongoMapper::EmbeddedDocument`
- `key :name, String` declarations within model classes
- `mongo_mapper.yml` or inline `MongoMapper.connection = Mongo::Connection.new` setup

**Entity Definition Style**:
- Ruby class with `include MongoMapper::Document`
- `key :name, Type` declarations: `key :name, String`, `key :age, Integer`
- Collection name: `set_collection_name 'custom_name'` or inferred (pluralized snake_case)

**Extraction Approach**:
1. Detect `mongo_mapper` in `Gemfile`.
2. Scan for classes with `include MongoMapper::Document`.
3. For each class:
   a. Check `set_collection_name '...'` override.
   b. Otherwise, derive collection name: pluralized snake_case.
4. Collect `key :name, Type` declarations for field names and types.
5. Note `EmbeddedDocument` classes — no separate collection.

**Key Challenges**:
- MongoMapper is effectively abandoned (last release ~2015); found only in legacy codebases.
- Similar challenges to Mongoid re: embedded documents and dynamic fields.

**Analysis Tools**:
- tree-sitter-ruby grammar
- Ruby `parser` gem

**Complexity**: Medium

---

## 10. Redis (redis-rb / Ohm)

**Name**: Redis — redis-rb / Ohm

**Type**: Key-Value Store / Cache / Simple Object Store

**Supported Databases**: Redis

**Detection Signals**:
- `Gemfile`: `redis`, `redis-rb`, `ohm`
- `Redis.new(...)` or `$redis = Redis.new(...)` instantiation
- `$redis.set('key', ...)`, `$redis.get('key')`, `$redis.hset(...)`, `$redis.lpush(...)` operations
- **Ohm-specific**: classes inheriting `Ohm::Model`; `attribute :name`, `set :tags, :Tag` declarations
- `.env` / `config/redis.yml`: `REDIS_URL`, `REDIS_HOST`

**Entity Definition Style**:
- **redis-rb (raw)**: no schema; key naming conventions carry implicit structure
- **Ohm**: `class User < Ohm::Model` with `attribute :name`, `reference :account, :Account`, `set :posts, :Post`, `list :items, :Item`, `counter :views`

**Extraction Approach**:
1. Detect `redis` or `ohm` in `Gemfile`.
2. **For Ohm**:
   a. Scan for classes inheriting `Ohm::Model`.
   b. Extract class name as entity name (Ohm uses class name as key namespace, e.g., `User:1`).
   c. Collect `attribute`, `counter`, `set`, `list`, `reference`, `collection` declarations.
3. **For raw redis-rb**:
   a. Extract key string patterns from `$redis.set('key_pattern', ...)`, `$redis.hset('hash', ...)`.
   b. Identify recurring prefixes as potential entity namespaces.
   c. Note: minimal useful static data for raw redis-rb.

**Key Challenges**:
- Raw redis-rb: key names almost always dynamic; static analysis yields limited results.
- Ohm provides more structure but is rarely used in modern projects.
- Redis commonly used for caching, sessions, queues — not primary entity storage.

**Analysis Tools**:
- tree-sitter-ruby grammar

**Complexity**: High

---

## 11. Elasticsearch (elasticsearch-ruby / Searchkick)

**Name**: Elasticsearch — elasticsearch-ruby / Searchkick

**Type**: Search Index / Document Store

**Supported Databases**: Elasticsearch, OpenSearch

**Detection Signals**:
- `Gemfile`: `elasticsearch`, `elasticsearch-model`, `elasticsearch-rails`, `searchkick`
- `include Elasticsearch::Model` mixin in model classes
- `index_name 'custom_index_name'` or `document_type 'type_name'` declarations
- `settings do mappings do indexes :field_name, type: 'text' end end` in model
- **Searchkick**: `searchkick` keyword in model class body; `search_index_name` override
- `Elasticsearch::Client.new(...)` instantiation for raw usage
- `.env` / config: `ELASTICSEARCH_URL`

**Entity Definition Style**:
- **elasticsearch-model**: `include Elasticsearch::Model` in an ActiveRecord/Sequel/etc. model; index mirrors the model's table
- **Searchkick**: `searchkick` keyword added to an ActiveRecord model; index named by convention (model class name)
- **Raw client**: index names as string arguments to `$client.index(index: 'index_name', ...)`
- Explicit mapping block: `mappings do indexes :title, type: :text; indexes :price, type: :float end`

**Extraction Approach**:
1. Detect `elasticsearch-model`, `elasticsearch-rails`, or `searchkick` in `Gemfile`.
2. **For elasticsearch-model / searchkick**:
   a. Scan for classes with `include Elasticsearch::Model` or `searchkick` call.
   b. Extract `index_name '...'` override; otherwise derive from class name (lowercased plural).
   c. Look for `mappings` block to extract indexed field names and types.
   d. Note the underlying model class for its SQL table name (the index mirrors it).
3. **For raw elasticsearch-ruby**:
   a. Scan for `$client.index(index: '...')`, `$client.search(index: '...')`.
   b. Extract string/symbol `index` values as index names.
4. Look for JSON/YAML index template files (`config/elasticsearch/*.json`).

**Key Challenges**:
- Index names derived from model names require knowing the model class name at analysis time.
- Searchkick automatically handles index aliases (not statically visible).
- Elasticsearch-model indices mirror a relational table — they are secondary storage, not the primary entity definition.

**Analysis Tools**:
- tree-sitter-ruby grammar
- Ruby `parser` gem
- JSON parser for mapping template files

**Complexity**: Medium

---

## 12. Hanami::Model

**Name**: Hanami::Model (Hanami 1.x)

**Type**: Relational ORM (Repository Pattern)

**Supported Databases**: PostgreSQL, SQLite, MySQL (via Sequel adapter in Hanami 1.x)

**Detection Signals**:
- `Gemfile`: `hanami`, `hanami-model`
- Entity classes in `lib/project_name/entities/` inheriting `Hanami::Entity`
- Repository classes in `lib/project_name/repositories/` inheriting `Hanami::Repository`
- `db/migrations/` directory with Hanami migration files
- `config/environment.rb` with `use Hanami::Model` adapter configuration
- `db/schema.sql` or `db/schema.rb` for Hanami projects

**Entity Definition Style**:
- **Hanami 1.x**: `class User < Hanami::Entity` — pure Ruby struct, no persistence logic; separate `UserRepository < Hanami::Repository[UserRelation]`
- **Hanami 2.x** (rom-based): uses ROM relations (see section 6); entity is a value object
- Repository `relation :users` declaration maps to the table name
- Migration DSL similar to Sequel: `create_table :users do ... end`

**Extraction Approach**:
1. Detect `hanami-model` in `Gemfile`.
2. Scan `lib/*/entities/*.rb` for classes inheriting `Hanami::Entity` — each is an entity.
3. Scan `lib/*/repositories/*.rb` for `Hanami::Repository` subclasses.
4. In each repository, find `relation :table_name` to identify the mapped table.
5. Scan `db/migrations/` for `create_table :name` blocks (Sequel-style DSL).
6. Cross-reference with `db/schema.rb` if present.

**Key Challenges**:
- Hanami 1.x and 2.x have very different architectures; confirm version from `Gemfile.lock`.
- Hanami 2.x delegates to ROM (see section 6) — follow ROM extraction steps.
- Entity classes in Hanami 1.x are pure structs; table name is in the repository, not the entity.

**Analysis Tools**:
- tree-sitter-ruby grammar
- Ruby `parser` gem

**Complexity**: Medium

---

## 13. dry-struct

**Name**: dry-struct

**Type**: Entity Signal (Secondary — Value Object / Domain Entity)

**Supported Databases**: N/A (not a persistence layer; used as a typed entity/value object)

**Detection Signals**:
- `Gemfile`: `dry-struct`, `dry-types`
- Classes inheriting `Dry::Struct`
- `attribute :name, Types::String` declarations in class body
- `Types::Coercible::Integer`, `Types::Strict::String`, etc. type references
- Often found alongside `rom-rb` or custom repository patterns

**Entity Definition Style**:
- `class User < Dry::Struct` with `attribute :id, Types::Integer` and `attribute :name, Types::String`
- Represents a domain entity or value object with typed attributes
- Not directly tied to a database table — must be correlated with a repository or relation

**Extraction Approach**:
1. Detect `dry-struct` in `Gemfile`.
2. Scan for classes inheriting `Dry::Struct`.
3. Extract all `attribute :name, Type` declarations as field names.
4. Cross-reference class name with ROM relations or repository classes to infer table mapping.
5. `Dry::Struct` classes alone are not sufficient to identify tables — treat as supplementary signal.

**Key Challenges**:
- No direct table association; must be correlated with a persistence layer separately.
- `dry-struct` entities may not have 1:1 correspondence with tables (aggregate roots, projections).
- `attribute?` (optional attributes) vs `attribute` (required) — both are relevant.

**Analysis Tools**:
- tree-sitter-ruby grammar
- Ruby `parser` gem

**Complexity**: Medium (as a secondary signal)

---

## 14. Grape API Entities

**Name**: Grape API Entities (grape-entity)

**Type**: Entity Signal (Secondary — API Presentation Layer)

**Supported Databases**: N/A (API serialization layer, not persistence)

**Detection Signals**:
- `Gemfile`: `grape-entity`, `grape`
- Classes inheriting `Grape::Entity`
- `expose :field_name`, `expose :field_name, as: :alias` declarations
- Often in `app/api/entities/` or `lib/api/entities/`
- `present model_instance, with: EntityClass` in Grape endpoint

**Entity Definition Style**:
- `class UserEntity < Grape::Entity` with `expose :id`, `expose :name`, `expose :email`
- Entities represent the API view of a model; `expose` declarations hint at field names of the underlying model

**Extraction Approach**:
1. Detect `grape-entity` in `Gemfile`.
2. Scan for classes inheriting `Grape::Entity`.
3. Extract all `expose :field_name` calls — `:field_name` is a hint for model attribute/column names.
4. Note any `expose :field_name, using: AnotherEntity` for nested entity signals.
5. Cross-reference entity class name (stripping `Entity` suffix) with model class names.
6. Use exposed fields as a supplementary column name signal — not authoritative.

**Key Challenges**:
- Grape entities are view objects; they may expose computed attributes, not just columns.
- `expose :full_name` may be a virtual attribute combining `first_name` + `last_name`.
- Entity names may not directly correspond to model/table names.

**Analysis Tools**:
- tree-sitter-ruby grammar

**Complexity**: Low (as a secondary signal)

---

## 15. GraphQL Ruby Schema Types

**Name**: GraphQL Ruby (graphql-ruby)

**Type**: Entity Signal (Secondary — API Schema Layer)

**Supported Databases**: N/A (GraphQL API layer)

**Detection Signals**:
- `Gemfile`: `graphql`
- Classes inheriting `GraphQL::Schema::Object`, `Types::BaseObject`
- `field :name, String, null: false` declarations
- `argument :name, String, required: true` in mutations
- Schema file: `app/graphql/schema.rb` or `app/graphql/types/`
- `graphql` directory structure: `app/graphql/types/`, `app/graphql/mutations/`, `app/graphql/resolvers/`

**Entity Definition Style**:
- `class UserType < Types::BaseObject` with `field :id, ID, null: false` and `field :name, String, null: true`
- Type names (with `Type` suffix stripped) often correspond to model/entity names
- `def self.authorized?(object, context)` and `def self.resolve(obj, args, ctx)` for field resolution

**Extraction Approach**:
1. Detect `graphql` in `Gemfile`.
2. Scan `app/graphql/types/` for classes inheriting `GraphQL::Schema::Object` or `Types::BaseObject`.
3. For each type class:
   a. Class name (stripping `Type` suffix) suggests a corresponding model/entity (e.g., `UserType` → `User` model).
   b. Collect `field :name, TypeClass` declarations as attribute hints.
4. Scan mutations (`app/graphql/mutations/`) for `argument` declarations — these also hint at model fields.
5. Cross-reference type names with ActiveRecord model class names for table mapping.

**Key Challenges**:
- GraphQL types may represent aggregated views, not single tables.
- Type names with suffixes (`InputType`, `PayloadType`) are often not direct model mirrors.
- `connection_type` and `edge_type` are meta-types, not entity representations.
- Fields may be computed/virtual.

**Analysis Tools**:
- tree-sitter-ruby grammar
- Ruby `parser` gem

**Complexity**: Low (as a secondary signal)

---

## 16. Protobuf Ruby

**Name**: Protocol Buffers (Ruby)

**Type**: Schema File / Data Definition

**Supported Databases**: N/A (serialization format)

**Detection Signals**:
- `Gemfile`: `google-protobuf`, `grpc`
- `.proto` files in the repository
- Generated Ruby files: `*_pb.rb` files
- `Google::Protobuf::DescriptorPool` usage
- `require 'google/protobuf'` in Ruby files

**Entity Definition Style**:
- `.proto` file: `message UserProfile { string name = 1; int64 id = 2; }` — source of truth
- Generated `_pb.rb`: `Google::Protobuf::DescriptorPool.generated_pool.lookup("UserProfile").msgclass`
- Classes added via `add_message "MessageName" do optional :name, :string, 1 end`

**Extraction Approach**:
1. Detect `google-protobuf` in `Gemfile` or `.proto` files in repo.
2. Parse `.proto` files (source of truth) for `message MessageName { ... }` blocks.
3. Extract message name and field declarations: `FieldType field_name = field_number`.
4. In generated `*_pb.rb` files, extract `add_message "..."` block content as fallback.
5. Map proto message names to storage entities if cross-referenced with ORM models.

**Key Challenges**:
- Protobuf messages are serialization DTOs, not necessarily direct database entities.
- Nested messages may or may not correspond to embedded/related entities.
- `_pb.rb` files are generated — prefer `.proto` as the source of truth.

**Analysis Tools**:
- tree-sitter proto grammar
- Regex: `message\s+(\w+)\s*\{`
- Ruby `parser` gem for `_pb.rb` analysis

**Complexity**: Medium

---

## 17. Shrine (file attachments)

**Name**: Shrine

**Type**: Entity Signal (Secondary — File Attachment)

**Supported Databases**: N/A (Shrine manages file uploads, not primary entities; but adds columns to existing tables)

**Detection Signals**:
- `Gemfile`: `shrine`
- `include ImageUploader::Attachment(:avatar)` or `include Shrine::Attachment(:photo)` in model classes
- Uploader classes inheriting `Shrine`: `class ImageUploader < Shrine`
- `shrine.yml` or `Shrine.storages` configuration
- Column naming convention: `{attachment_name}_data` (e.g., `avatar_data jsonb` column in the database)

**Entity Definition Style**:
- No separate entity; attaches to an existing model by adding a `{name}_data` JSON/JSONB column
- `include ImageUploader::Attachment(:avatar)` in `User` model → expects `avatar_data` column in `users` table

**Extraction Approach**:
1. Detect `shrine` in `Gemfile`.
2. Scan model classes for `include *Uploader::Attachment(:\w+)` or `include Shrine::Attachment(:\w+)`.
3. Extract the attachment name symbol; derive column name: `{attachment_name}_data`.
4. Associate this column with the model's table as a supplementary column signal.
5. Use as a hint that the model's table has an attachment metadata column.

**Key Challenges**:
- Shrine is not a primary entity store; it only signals additional columns on existing tables.
- Multiple attachment includes per model are common.
- The `_data` column stores JSON, not a simple typed value.

**Analysis Tools**:
- tree-sitter-ruby grammar

**Complexity**: Low (as a secondary signal)

---

## 18. ActiveModel (non-DB models)

**Name**: ActiveModel

**Type**: Entity Signal (Secondary — Non-persisted Model)

**Supported Databases**: N/A (no persistence by default)

**Detection Signals**:
- Classes with `include ActiveModel::Model`, `include ActiveModel::Attributes`, or `include ActiveModel::API`
- `attr_accessor :name`, `attr_reader :name` combined with ActiveModel includes
- `attribute :name, :string` (ActiveModel::Attributes) in class body
- No `ApplicationRecord` inheritance
- Used for form objects, API request objects, service objects

**Entity Definition Style**:
- `class ContactForm include ActiveModel::Model; attr_accessor :name, :email, :message`
- `attribute :name, :string, default: ""` via `ActiveModel::Attributes`
- Represents non-persisted entities (form objects, serializers, request/response wrappers)

**Extraction Approach**:
1. Scan for classes with `include ActiveModel::Model` or `include ActiveModel::Attributes`.
2. Confirm they do NOT inherit `ApplicationRecord` or `ActiveRecord::Base`.
3. Extract `attr_accessor`, `attr_reader` calls and `attribute :name, :type` declarations.
4. Flag these as "non-persisted entities" — they do not correspond to database tables directly.
5. May be relevant as API/domain entity signals, but not primary storage entities.

**Key Challenges**:
- Distinguishing ActiveModel form objects from actual persisted ActiveRecord models.
- Some form objects wrap and mirror actual database entities — useful as secondary signal.
- May be used as serialization layer on top of real models.

**Analysis Tools**:
- tree-sitter-ruby grammar
- Ruby `parser` gem

**Complexity**: Low (as a secondary signal; can cause false positives if treated as primary source)

---

## Repository Detection Plan

The following plan outlines a recommended order and strategy for automated static analysis of a Ruby repository to extract data entities.

### Phase 1: Framework Identification

1. Read `Gemfile` and `Gemfile.lock`.
2. Map detected gems to frameworks using this table:

| Gem | Framework/Approach |
|---|---|
| `rails` or `activerecord` | ActiveRecord + Migrations + schema.rb |
| `sequel` | Sequel ORM |
| `rom` / `rom-sql` / `rom-rb` | ROM Relations |
| `mongoid` | Mongoid (MongoDB) |
| `mongo_mapper` | MongoMapper (MongoDB, legacy) |
| `dm-core` / `data_mapper` | DataMapper (legacy) |
| `redis` / `redis-rb` | Redis raw client |
| `ohm` | Ohm (Redis ORM) |
| `elasticsearch` / `elasticsearch-model` | Elasticsearch |
| `searchkick` | Searchkick (Elasticsearch) |
| `hanami` / `hanami-model` | Hanami::Model |
| `dry-struct` | dry-struct (supplementary) |
| `grape-entity` | Grape entities (supplementary) |
| `graphql` | GraphQL types (supplementary) |
| `google-protobuf` / `grpc` | Protobuf (supplementary) |
| `shrine` | Shrine attachments (supplementary) |

3. Note Rails version from `Gemfile.lock` (`activerecord` version) to handle STI, delegated types, and migration format variations.

### Phase 2: Primary Entity Extraction (authoritative sources first)

Execute in priority order:

**Priority 1 — Canonical Schema Files (most authoritative)**:
1. Check for `db/schema.rb` — parse `create_table` blocks (section 3). This is the single most reliable source for Rails apps.
2. Check for `db/structure.sql` — parse `CREATE TABLE` statements (section 4).
3. Check for `schema.sql` or `*.sql` files in `db/`, `sql/`, `schema/` directories (section 4 approach).

**Priority 2 — Migration Files**:
1. Scan `db/migrate/*.rb` for `create_table`, `drop_table`, `rename_table` (section 2).
2. Apply chronological ordering of migration timestamps.
3. Use only when `schema.rb` / `structure.sql` are absent (migrations are the inputs; schema.rb is the output).

**Priority 3 — ORM Model Classes**:
1. Scan `app/models/**/*.rb` for `ApplicationRecord` / `ActiveRecord::Base` subclasses (section 1).
2. Scan for `Sequel::Model` subclasses (section 5).
3. Scan for `ROM::Relation` subclasses (section 6).
4. Scan for `Mongoid::Document` includes (section 8).
5. Scan for `DataMapper::Resource` includes (section 7, legacy).
6. Scan for `Hanami::Entity` / `Hanami::Repository` (section 12).

### Phase 3: Cross-Validation

- Cross-reference model class names (table name convention) with tables found in `schema.rb` / migrations.
- Flag models without corresponding schema entries and vice versa.
- Resolve table renames from migration history.
- Handle STI: identify `type` column presence in `schema.rb` → multiple models, one table.

### Phase 4: Secondary / Supplementary Signals

Extract supplementary entity signals from:

- **Mongoid** `mongoid.yml` — database name and collection configuration
- **dry-struct** classes (section 13) — field name hints, cross-reference with ROM relations
- **Grape entities** (section 14) — field exposure hints
- **GraphQL types** (section 15) — type → model name mapping hints
- **Protobuf** `.proto` files (section 16) — message names and fields
- **Shrine** attachments (section 17) — `{attachment}_data` column hints
- **ActiveModel** (section 18) — flag as non-persisted, use for completeness
- **Elasticsearch** includes (section 11) — index names mirroring table names
- **`config/database.yml`** — database adapter type, database name, multiple database configuration

### Phase 5: SQL File Scan (Fallback)

- Glob for `*.sql` files in `db/`, `sql/`, `schema/`, `spec/fixtures/`
- Extract `CREATE TABLE` statements with regex or SQL parser
- Extract `CREATE VIEW` statements as secondary signals
- Merge findings with ORM-derived entity list

### Phase 6: Rails-Specific Patterns

Handle Rails-specific complexity:

- **STI detection**: If a `schema.rb` table has a `type` column (string), scan `app/models/` for subclasses of the parent model — all share one table.
- **Polymorphic associations**: Tables with `{name}_type` + `{name}_id` column pairs indicate polymorphic join points.
- **Delegated types** (Rails 6.1+): `delegated_type :entryable, types: %w[Message Comment]` — scan for `delegated_type` calls.
- **Has-and-belongs-to-many join tables**: Tables with two foreign key columns and no `id` are join tables; infer from `has_and_belongs_to_many` declarations in models.
- **Multi-database** (`config/database.yml` with multiple named databases): track which models connect to which database.

### Phase 7: Confidence Scoring

Assign confidence levels to extracted entities:

| Source | Confidence |
|---|---|
| `db/schema.rb` `create_table` | High |
| `db/structure.sql` `CREATE TABLE` | High |
| `*.sql` `CREATE TABLE` in schema files | High |
| ActiveRecord migration `create_table` | High |
| Sequel `DB.create_table` block | High |
| Mongoid `include Mongoid::Document` + `store_in` | High |
| Mongoid `include Mongoid::Document` (name-inferred) | Medium |
| `ActiveRecord::Base` subclass (with `self.table_name`) | High |
| `ActiveRecord::Base` subclass (name-inferred) | Medium |
| DataMapper `include DataMapper::Resource` | Medium |
| ROM `schema(:table_name)` (explicit) | High |
| ROM `schema(:table_name, infer: true)` | Medium |
| Hanami repository `relation :table_name` | High |
| dry-struct class (no direct table mapping) | Low |
| Grape entity `expose` declarations | Low (supplementary) |
| GraphQL type fields | Low (supplementary) |
| Ohm `Ohm::Model` subclass | Medium |
| Protobuf `message` definitions | Low (supplementary) |
| Shrine `Attachment` include | Low (supplementary) |
| ActiveModel (non-persisted) | Low (informational only) |

### Recommended Parsing Tools

- **Ruby AST**: tree-sitter with [tree-sitter-ruby](https://github.com/tree-sitter/tree-sitter-ruby) grammar — recommended for cross-language analysis pipelines
- **Ruby AST (deep)**: Ruby `parser` gem invoked via a Ruby subprocess — most accurate for complex Ruby syntax
- **rubocop-ast**: Built on `parser` gem; provides high-level node matchers
- **SQL**: `sqlglot` (Python) for `structure.sql` and raw `.sql` files (supports PostgreSQL dialect)
- **SQL (simple)**: Regex `CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?([\w.]+)["'`]?` for basic extraction
- **YAML**: `PyYAML` or `js-yaml` for `database.yml`, `mongoid.yml`
- **Gemfile parsing**: `bundler` Ruby gem or regex-based parsing for `Gemfile` / `Gemfile.lock`
- **Protobuf**: tree-sitter with [tree-sitter-proto](https://github.com/mitchellh/tree-sitter-proto) grammar; or regex `message\s+(\w+)\s*\{`
