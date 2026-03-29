# PHP Data Entity Storage Methods

A catalog of PHP frameworks, libraries, and approaches for data entity storage, intended to support automated static analysis of repositories to extract data entity definitions (database tables, document collections, etc.).

---

## Table of Contents

1. [Doctrine ORM](#1-doctrine-orm)
2. [Eloquent ORM (Laravel)](#2-eloquent-orm-laravel)
3. [Laravel Migrations](#3-laravel-migrations)
4. [Propel ORM](#4-propel-orm)
5. [CakePHP ORM](#5-cakephp-orm)
6. [Symfony + Doctrine](#6-symfony--doctrine)
7. [Zend DB / Laminas DB](#7-zend-db--laminas-db)
8. [RedBeanPHP](#8-redbeanphp)
9. [Yii2 ActiveRecord](#9-yii2-activerecord)
10. [Phinx Migrations](#10-phinx-migrations)
11. [Spot ORM](#11-spot-orm)
12. [Cycle ORM](#12-cycle-orm)
13. [PDO Raw SQL](#13-pdo-raw-sql)
14. [MySQLi Raw SQL](#14-mysqli-raw-sql)
15. [MongoDB (mongodb/mongodb)](#15-mongodb-mongodbmongodb)
16. [Eloquent with MongoDB (jenssegers/mongodb)](#16-eloquent-with-mongodb-jenssegersmongodb)
17. [Redis (Predis / PhpRedis)](#17-redis-predis--phpredis)
18. [Elasticsearch (elastic/elasticsearch)](#18-elasticsearch-elasticelasticsearch)
19. [Database Schema SQL Files](#19-database-schema-sql-files)
20. [Protobuf PHP](#20-protobuf-php)
21. [OpenAPI-Generated Models](#21-openapi-generated-models)
22. [Laravel Model Factories](#22-laravel-model-factories)
23. [PHP Data Objects with Raw SQL (Advanced Patterns)](#23-php-data-objects-with-raw-sql-advanced-patterns)

---

## 1. Doctrine ORM

**Name**: Doctrine ORM

**Type**: Relational ORM

**Supported Databases**: MySQL, PostgreSQL, SQLite, Oracle, Microsoft SQL Server, MariaDB (via DBAL abstraction)

**Detection Signals**:
- `composer.json` dependencies: `doctrine/orm`, `doctrine/dbal`, `doctrine/common`
- Attribute annotations: `#[Entity]`, `#[Table(name: "...")]`, `#[Column]`, `#[Id]`, `#[GeneratedValue]`
- Legacy PHPDoc annotations: `@Entity`, `@Table(name="...")`, `@Column`, `@Id`, `@GeneratedValue`
- Class implements or uses `Doctrine\ORM\Mapping` namespace
- XML mapping files: `config/doctrine/*.orm.xml`, `Resources/config/doctrine/*.orm.xml`
- YAML mapping files (deprecated): `*.orm.yml`
- `doctrine.yaml` or `config/packages/doctrine.yaml` (Symfony integration)
- `EntityManager`, `EntityRepository` usage in code
- `DoctrineBundle` in `config/bundles.php`

**Entity Definition Style**:
- PHP class with `#[Entity]` or `@Entity` attribute/annotation; each property mapped via `#[Column]` / `@Column`
- XML: `<entity name="App\Entity\Product" table="products">` blocks in `.orm.xml` files
- YAML (deprecated): `App\Entity\Product: { type: entity, table: products, ... }`
- Superclass mapping via `#[MappedSuperclass]`
- Embeddables via `#[Embeddable]`

**Extraction Approach**:
1. Parse `composer.json` to confirm `doctrine/orm` dependency.
2. Scan PHP files for `#[Entity]`, `#[Table]` attributes or `@Entity`, `@Table` PHPDoc annotations using a PHP AST parser (tree-sitter or php-parser).
3. For each matched class, extract the class name and `#[Table(name: "...")]` / `@Table(name="...")` value; fall back to snake_case of class name if no explicit table name.
4. Scan for `#[Column]` / `@Column` on properties to enumerate fields.
5. Scan `*.orm.xml` files: parse `<entity>` elements for `name` and `table` attributes; collect `<field>` / `<column>` children.
6. Scan `*.orm.yml` files: parse YAML, extract top-level keys as entity class names and `table` sub-keys.
7. Cross-reference with `doctrine/migrations` migration files (see section 1 note on migrations).

**Key Challenges**:
- Mixed annotation styles (attributes in PHP 8+ vs. PHPDoc in older code; some codebases use both).
- Entity inheritance (`#[InheritanceType("JOINED")]`, `#[InheritanceType("SINGLE_TABLE")]`) — table may be shared or split.
- Mapped superclasses do not map to their own tables.
- Embeddables map to columns in the owning entity's table, not a separate table.
- Table name may be derived via a naming strategy (e.g., `DefaultNamingStrategy` pluralizes; custom strategies may exist).
- XML / YAML mappings require separate parsing pipelines.

**Analysis Tools**:
- tree-sitter PHP grammar for attribute and annotation parsing
- `nikic/php-parser` (PHP-based AST parser) for deep attribute analysis
- Standard XML parser for `.orm.xml`
- YAML parser for `.orm.yml`

**Complexity**: Medium

---

## 2. Eloquent ORM (Laravel)

**Name**: Eloquent ORM

**Type**: Relational ORM

**Supported Databases**: MySQL, PostgreSQL, SQLite, SQL Server

**Detection Signals**:
- `composer.json` dependencies: `laravel/framework`, `illuminate/database`
- Class extends `Illuminate\Database\Eloquent\Model` or `App\Models\` base class (itself extending `Model`)
- Properties: `protected $table`, `protected $fillable`, `protected $guarded`, `protected $primaryKey`, `protected $casts`
- Relationship methods: `hasMany()`, `belongsTo()`, `hasOne()`, `belongsToMany()`, `hasManyThrough()`, `morphTo()`, `morphMany()`
- File location: `app/Models/*.php` (Laravel 8+), `app/*.php` (older Laravel)
- `config/database.php` present
- `.env` file with `DB_CONNECTION`, `DB_DATABASE`

**Entity Definition Style**:
- PHP class extending `Model`; table name inferred by pluralizing the snake_case class name, or overridden via `protected $table = 'custom_name'`
- No explicit column declarations in the model; schema lives in migration files
- `$fillable` / `$guarded` arrays hint at column names
- `$casts` array reveals column names and types

**Extraction Approach**:
1. Parse `composer.json` for `laravel/framework` or `illuminate/database`.
2. Use a PHP AST parser to find all classes extending `Model` (direct or through intermediary base classes like `App\Models\Model`).
3. For each model class:
   a. Check `protected $table` property — use its value as the table name.
   b. If absent, apply Laravel's default: pluralize the snake_case version of the class name (e.g., `UserProfile` → `user_profiles`).
4. Extract `$fillable`, `$guarded`, `$casts`, `$primaryKey` arrays for column hints.
5. Parse relationship method bodies for related model class references to map entity relationships.
6. Cross-reference with migration files in `database/migrations/` for authoritative schema.

**Key Challenges**:
- Dynamic `$table` values (e.g., set in constructor or via method override) cannot be statically resolved.
- Trait-based columns (`SoftDeletes`, `HasUuid`, custom traits) add implicit columns.
- Multi-tenancy patterns (table names set at runtime).
- Polymorphic relationships (`morphTo`, `morphMany`) create `*_type` and `*_id` columns that aren't explicit.
- `$appends` and computed attributes can be confused with real columns.
- Inheritance hierarchies (base model → child models).

**Analysis Tools**:
- tree-sitter PHP grammar
- `nikic/php-parser` for PHP AST
- Custom pluralization logic matching Laravel's `Str::plural()` behavior

**Complexity**: Medium

---

## 3. Laravel Migrations

**Name**: Laravel Migrations (Schema Builder)

**Type**: Migration Tool / Schema Definition

**Supported Databases**: MySQL, PostgreSQL, SQLite, SQL Server

**Detection Signals**:
- `composer.json`: `laravel/framework`
- Directory: `database/migrations/` containing PHP files
- Files named with timestamp pattern: `YYYY_MM_DD_HHMMSS_description.php`
- Class extends `Migration` (or uses `use Illuminate\Database\Migrations\Migration`)
- `Schema::create(...)`, `Schema::table(...)`, `Schema::drop(...)`, `Schema::rename(...)` calls
- `Blueprint` class usage within `Schema::create` closures

**Entity Definition Style**:
- `Schema::create('table_name', function (Blueprint $table) { ... })` blocks define tables
- Column definitions: `$table->string('name')`, `$table->integer('id')`, `$table->timestamps()`, etc.
- `Schema::table()` modifies existing tables (additive — `add_column`, indexes)
- `Schema::rename('old', 'new')` renames tables

**Extraction Approach**:
1. Locate all files in `database/migrations/` matching the timestamp naming pattern.
2. Sort files chronologically by filename timestamp.
3. For each migration file, parse the PHP AST:
   a. Find `Schema::create($tableName, ...)` — extract string literal `$tableName` as new table.
   b. Find `Schema::drop($tableName)` / `Schema::dropIfExists($tableName)` — mark table as dropped.
   c. Find `Schema::rename($from, $to)` — track renames.
   d. Find `Schema::table($tableName, ...)` — collect column additions/modifications.
4. Within `Blueprint` closures, collect all column definition method calls (`->string()`, `->integer()`, `->text()`, etc.) to build column lists.
5. Apply migration history sequentially to derive the final schema state.
6. Fall back to `database/migrations/` + `app/Models/` cross-referencing for validation.

**Key Challenges**:
- Variable table names in `Schema::create($variable, ...)` cannot be statically resolved.
- Squashed migrations (single `schema.php` file replacing many migration files).
- Conditional logic (`if (env(...))`) within migrations.
- Anonymous migration classes (Laravel 9+) vs. named classes.
- `$table->morphs('taggable')` creates two columns (`taggable_id`, `taggable_type`) implicitly.
- Pivot table migrations may represent join tables, not first-class entities.

**Analysis Tools**:
- tree-sitter PHP grammar
- PHP AST parser for method call extraction

**Complexity**: Medium

---

## 4. Propel ORM

**Name**: Propel ORM

**Type**: Relational ORM / Schema File

**Supported Databases**: MySQL, PostgreSQL, SQLite, Oracle, MSSQL

**Detection Signals**:
- `composer.json`: `propel/propel`
- `schema.xml` file at project root or in `app/`, `config/`
- `propel.json` or `propel.yaml` configuration file
- Generated model classes in `src/` or `app/` extending `BaseObject` or `ActiveRecordInterface`
- `propel/` directory with `build/` subdirectory

**Entity Definition Style**:
- Primary definition in `schema.xml`: `<table name="book" phpName="Book">` with `<column>` children
- Generated PHP classes are derived from schema — not hand-authored entity definitions

**Extraction Approach**:
1. Detect `propel/propel` in `composer.json`.
2. Locate `schema.xml` (check root, `app/`, `config/`, `propel/`).
3. Parse XML: extract all `<table name="...">` elements; `name` attribute is the physical table name.
4. For each table, collect `<column name="..." type="..." ...>` children.
5. Note `<foreign-key foreignTable="...">` for relationship mapping.
6. If multiple schemas exist (multi-database), parse each.

**Key Challenges**:
- Propel supports multi-schema XML files and database-level namespacing.
- Generated base classes obscure the true source of truth (always prefer `schema.xml`).
- Behavior plugins (e.g., `timestampable`, `sluggable`) add implicit columns.

**Analysis Tools**:
- Standard XML parser
- tree-sitter for generated class analysis (fallback only)

**Complexity**: Low

---

## 5. CakePHP ORM

**Name**: CakePHP ORM

**Type**: Relational ORM

**Supported Databases**: MySQL, PostgreSQL, SQLite, SQL Server

**Detection Signals**:
- `composer.json`: `cakephp/cakephp`
- Table classes in `src/Model/Table/` named `*Table.php`
- Entity classes in `src/Model/Entity/` named `*.php`
- Table class extends `Cake\ORM\Table`
- Entity class extends `Cake\ORM\Entity`
- `$this->setTable('...')` or `protected $_accessible` in table/entity classes
- `config/app.php` with `Datasources` configuration

**Entity Definition Style**:
- `Table` class (e.g., `ArticlesTable extends Table`): defines associations, validation, behaviors
- Table name inferred by CakePHP convention: class name prefix (e.g., `ArticlesTable` → `articles`), or overridden via `$this->setTable('custom_name')`
- `Entity` class defines accessible fields via `$_accessible` array
- Schema introspected at runtime (no explicit column declarations in the class)

**Extraction Approach**:
1. Confirm `cakephp/cakephp` in `composer.json`.
2. Scan `src/Model/Table/*Table.php` files.
3. For each Table class:
   a. Apply CakePHP convention: strip `Table` suffix, convert to snake_case plural (e.g., `UserProfilesTable` → `user_profiles`).
   b. Search for `$this->setTable(...)` or `protected $table` override.
4. Scan `src/Model/Entity/*.php` for corresponding entity classes to cross-reference field accessibility.
5. Look for `$this->addBehavior('Timestamp')` etc. to note implicit columns.

**Key Challenges**:
- CakePHP uses a convention-heavy approach; table names are implicit unless overridden.
- Plugin table classes follow the same pattern but live under `plugins/PluginName/src/Model/Table/`.
- Behaviors (e.g., `Tree`, `Counter Cache`) add implicit columns.

**Analysis Tools**:
- tree-sitter PHP grammar
- File path conventions for discovery

**Complexity**: Medium

---

## 6. Symfony + Doctrine

**Name**: Symfony + Doctrine (DoctrineBundle)

**Type**: Relational ORM (Doctrine ORM via Symfony integration)

**Supported Databases**: Same as Doctrine ORM (MySQL, PostgreSQL, SQLite, Oracle, MSSQL)

**Detection Signals**:
- `composer.json`: `symfony/framework-bundle`, `doctrine/doctrine-bundle`, `doctrine/orm`
- `config/packages/doctrine.yaml` present
- `config/bundles.php` contains `Doctrine\Bundle\DoctrineBundle\DoctrineBundle`
- Entity classes in `src/Entity/` with `#[Entity]` / `@Entity`
- Repository classes in `src/Repository/` extending `ServiceEntityRepository`
- `doctrine:schema:validate` or `doctrine:migrations:*` console commands in use

**Entity Definition Style**:
- Identical to Doctrine ORM (see section 1) — PHP attributes or PHPDoc annotations
- Symfony encourages PHP 8 attributes: `#[ORM\Entity]`, `#[ORM\Table(name: "...")]`, `#[ORM\Column]`
- Migrations managed by `doctrine/migrations` in `migrations/` directory

**Extraction Approach**:
1. Detect both `symfony/framework-bundle` and `doctrine/orm` / `doctrine/doctrine-bundle` in `composer.json`.
2. Follow the same extraction steps as Doctrine ORM (section 1).
3. Additionally, check `config/packages/doctrine.yaml` for entity mapping configuration (auto-mapping paths, naming strategies).
4. Scan `migrations/` directory for `doctrine/migrations` migration files as secondary signal.

**Key Challenges**:
- Same as Doctrine ORM.
- Symfony's `AutoMapping` feature may mean entity directories differ from the default `src/Entity/`.
- Multiple entity managers (for multi-database setups) may map different entity namespaces.

**Analysis Tools**:
- tree-sitter PHP grammar
- YAML parser for `doctrine.yaml`

**Complexity**: Medium

---

## 7. Zend DB / Laminas DB

**Name**: Zend DB / Laminas DB

**Type**: Query Builder / Table Gateway / Raw SQL

**Supported Databases**: MySQL, PostgreSQL, SQLite, Oracle, MSSQL, IBM DB2

**Detection Signals**:
- `composer.json`: `zendframework/zend-db` (legacy) or `laminas/laminas-db`
- Classes extending `Laminas\Db\TableGateway\AbstractTableGateway` or `Zend\Db\TableGateway\AbstractTableGateway`
- `$this->table` property in TableGateway classes
- `Laminas\Db\Sql\Select`, `Laminas\Db\Sql\Insert`, `Laminas\Db\Sql\Update` usage
- `module.config.php` with database adapter configuration

**Entity Definition Style**:
- `TableGateway` pattern: class has a `protected $table = 'table_name'` property
- Row objects may extend `Laminas\Db\RowGateway\AbstractRowGateway` with `protected $primaryKeyColumn` and `protected $table`
- No schema-level column declarations; relies on database introspection at runtime

**Extraction Approach**:
1. Detect `laminas/laminas-db` or `zendframework/zend-db` in `composer.json`.
2. Scan for classes extending `AbstractTableGateway` or `TableGateway`.
3. Extract `protected $table = '...'` property values as table names.
4. Search for `new TableGateway('table_name', ...)` instantiation patterns.
5. Scan for `new Select('table_name')`, `new Insert('table_name')` etc. as secondary signals.

**Key Challenges**:
- Table names may be passed as constructor arguments dynamically.
- Laminas is also used as a pure query builder without gateway classes.
- Limited column information available without runtime introspection.

**Analysis Tools**:
- tree-sitter PHP grammar

**Complexity**: Medium

---

## 8. RedBeanPHP

**Name**: RedBeanPHP

**Type**: Relational ORM (Schema-on-the-fly)

**Supported Databases**: MySQL, PostgreSQL, SQLite

**Detection Signals**:
- `composer.json`: `gabordemooij/redbean`
- Global function calls: `R::dispense('bean_type')`, `R::store()`, `R::load('bean_type', ...)`, `R::find('bean_type', ...)`
- Static method calls on `R` or `RedBeanPHP\R`
- `R::setup(...)` for connection configuration

**Entity Definition Style**:
- No explicit entity class; tables are auto-created from bean type strings at runtime
- Bean type string is the table name: `R::dispense('product')` → `product` table
- Columns are auto-created from property assignments; no static schema declaration

**Extraction Approach**:
1. Detect `gabordemooij/redbean` in `composer.json`.
2. Scan all PHP files for `R::dispense('...')`, `R::load('...')`, `R::find('...')`, `R::count('...')` calls.
3. Extract string literals from the first argument as bean type / table name candidates.
4. Deduplicate and list unique bean type strings.
5. Note: column information is not statically inferable.

**Key Challenges**:
- Bean types are often constructed dynamically (variables, concatenation) — not statically resolvable.
- RedBeanPHP auto-creates and modifies tables; no authoritative static schema exists.
- Fuid mode (fluid schema) vs frozen mode: in frozen mode, the schema is fixed but not declared in code.

**Analysis Tools**:
- tree-sitter PHP grammar for method call scanning

**Complexity**: High

---

## 9. Yii2 ActiveRecord

**Name**: Yii2 ActiveRecord

**Type**: Relational ORM

**Supported Databases**: MySQL, PostgreSQL, SQLite, MSSQL, Oracle

**Detection Signals**:
- `composer.json`: `yiisoft/yii2`
- Classes extending `yii\db\ActiveRecord`
- Static method `public static function tableName()` returning a string literal
- `$this->hasMany(RelatedClass::class, [...])`, `$this->hasOne(...)` relationship declarations
- `config/db.php` or `config/main.php` with `db` component configuration
- `console/migrations/` or `migrations/` directory with `m*_*.php` migration files

**Entity Definition Style**:
- PHP class extending `yii\db\ActiveRecord` with `tableName()` returning the physical table name
- Column rules defined via `rules()` method; attribute names hinted via `attributeLabels()` and `rules()`
- No explicit column-level property declarations (schema inferred at runtime)

**Extraction Approach**:
1. Detect `yiisoft/yii2` in `composer.json`.
2. Scan for classes extending `yii\db\ActiveRecord`.
3. For each class, find the `tableName()` static method and extract the returned string literal.
4. If no `tableName()` override, apply Yii2 default: `{{%snake_case_class_name}}` (table prefix + snake_case).
5. Scan `console/migrations/` or `migrations/` for `m*_*.php` migration files extending `yii\db\Migration`.
6. In migration files, search for `$this->createTable('{{%table_name}}', [...])` calls; extract table names (strip `{{%}}` prefix notation).

**Key Challenges**:
- Yii2 uses `{{%table_name}}` prefix notation; the `%` is replaced with a configured prefix.
- `tableName()` may return a dynamic value.
- Migrations may use `$this->db->schema->getTableNames()` for dynamic operations.

**Analysis Tools**:
- tree-sitter PHP grammar

**Complexity**: Medium

---

## 10. Phinx Migrations

**Name**: Phinx Migrations

**Type**: Migration Tool

**Supported Databases**: MySQL, PostgreSQL, SQLite, SQL Server

**Detection Signals**:
- `composer.json`: `robmorgan/phinx`
- `phinx.php`, `phinx.yml`, or `phinx.json` configuration file
- Migration files in `db/migrations/` or configured path, named `YYYYMMDDHHMMSS_ClassName.php`
- Classes extending `Phinx\Migration\AbstractMigration`
- `$this->table('...')` calls in migration `change()`, `up()`, `down()` methods
- `$this->hasTable('...')` for conditional checks

**Entity Definition Style**:
- `$this->table('table_name')->addColumn(...)->create()` pattern defines tables
- `$this->table('table_name')->addColumn('col', 'type')->update()` modifies tables
- Column types: `string`, `integer`, `boolean`, `text`, `datetime`, `decimal`, etc.

**Extraction Approach**:
1. Detect `robmorgan/phinx` in `composer.json`.
2. Locate `phinx.php` / `phinx.yml` / `phinx.json` to find migration path configuration.
3. Scan migration files (classes extending `AbstractMigration`).
4. Parse `$this->table('...')` calls: extract string literal as table name.
5. Chain method calls on the table builder: collect `->addColumn('name', 'type', [...])` calls for column info.
6. Track `->create()` (new table) vs. `->update()` (modification) calls.
7. Apply chronological ordering of migrations to derive final schema state.

**Key Challenges**:
- Variable table names in `$this->table($variable)` are not statically resolvable.
- `$this->execute('CREATE TABLE ...')` bypasses the builder API.
- Seed files (`db/seeds/`) reference tables but don't define them.

**Analysis Tools**:
- tree-sitter PHP grammar
- YAML / JSON / PHP parsers for `phinx.yml` / `phinx.json` / `phinx.php`

**Complexity**: Low

---

## 11. Spot ORM

**Name**: Spot ORM (Spot2)

**Type**: Relational ORM

**Supported Databases**: MySQL, PostgreSQL, SQLite (via Doctrine DBAL)

**Detection Signals**:
- `composer.json`: `vlucas/spot2`
- Classes extending `Spot\Entity`
- Static method `static function fields()` returning array of field definitions
- `static function table()` returning table name string
- `Spot\Locator` and `Spot\Config` usage

**Entity Definition Style**:
- PHP class extending `Spot\Entity` with static `fields()` method:
  ```php
  public static function fields() {
      return ['id' => ['type' => 'integer', 'primary' => true], 'name' => ['type' => 'string']];
  }
  ```
- Optional `table()` method override; defaults to snake_case class name

**Extraction Approach**:
1. Detect `vlucas/spot2` in `composer.json`.
2. Scan for classes extending `Spot\Entity`.
3. For each class, extract the `table()` static method return value (string literal).
4. If absent, derive table name from snake_case of class name.
5. Parse the `fields()` return array for column names and types.

**Key Challenges**:
- `fields()` may use constants or external references making static extraction incomplete.
- Relatively uncommon; fewer codebases to validate against.

**Analysis Tools**:
- tree-sitter PHP grammar

**Complexity**: Medium

---

## 12. Cycle ORM

**Name**: Cycle ORM

**Type**: Relational ORM (Data Mapper)

**Supported Databases**: MySQL, PostgreSQL, SQLite, SQL Server (via Cycle DBAL)

**Detection Signals**:
- `composer.json`: `cycle/orm`, `cycle/annotated`, `cycle/schema-builder`
- PHP 8 Attributes: `#[Entity(table: '...')]`, `#[Column(type: '...')]`, `#[HasMany]`, `#[BelongsTo]`
- Older PHPDoc annotations: `@entity(table="...")`, `@column(type="...")`
- Entity classes in `src/Entity/` or `app/Entity/`
- `CycleORM\Schema` or `Cycle\ORM\ORM` instantiation

**Entity Definition Style**:
- PHP class with `#[Entity]` attribute and `#[Column]` on properties
- Table name specified via `#[Entity(table: 'table_name')]` or inferred from class name
- Supports PHP attributes, annotations, and programmatic schema definition

**Extraction Approach**:
1. Detect `cycle/orm` or `cycle/annotated` in `composer.json`.
2. Scan PHP files for `#[Entity]` attributes or `@entity` annotations.
3. Extract `table` parameter from `#[Entity(table: '...')]`.
4. If absent, apply default naming: snake_case of class name.
5. Collect `#[Column]` attributes on properties for field definitions.
6. Look for `#[HasMany(target: AnotherEntity::class)]` etc. for relationship signals.

**Key Challenges**:
- Cycle ORM supports both annotation and programmatic schema — programmatic schemas require runtime analysis.
- Schema caching (serialized to PHP array) — if present, the cached schema is the authoritative source.

**Analysis Tools**:
- tree-sitter PHP grammar for attribute parsing

**Complexity**: Medium

---

## 13. PDO Raw SQL

**Name**: PHP Data Objects (PDO) — Raw SQL

**Type**: Raw SQL

**Supported Databases**: Any PDO-supported database (MySQL, PostgreSQL, SQLite, Oracle, MSSQL, etc.)

**Detection Signals**:
- `new PDO(...)` instantiation
- `$pdo->prepare('SELECT ... FROM table_name ...')` or `$pdo->query('...')`
- `$stmt->execute(...)` patterns
- No ORM dependency in `composer.json`

**Entity Definition Style**:
- No entity classes; tables referenced via string literals in SQL statements
- Table names embedded in SQL: `SELECT * FROM users`, `INSERT INTO orders (...)`, `CREATE TABLE products (...)`

**Extraction Approach**:
1. Scan for `new PDO(...)` to identify PDO usage.
2. Extract all string literals passed to `->prepare()`, `->query()`, `->exec()`.
3. Apply SQL parsing / regex to extract table names from:
   - `FROM table_name`
   - `JOIN table_name`
   - `INSERT INTO table_name`
   - `UPDATE table_name`
   - `CREATE TABLE [IF NOT EXISTS] table_name`
   - `DROP TABLE table_name`
4. Deduplicate extracted table names.
5. Optionally look for `CREATE TABLE` statements in `.sql` files or heredoc strings.

**Key Challenges**:
- SQL strings may be built dynamically via concatenation or sprintf — not statically parsable.
- SQL may be stored in separate `.sql` files (scan those separately).
- Aliased table names in queries (`FROM users u`) require alias resolution.
- Subqueries complicate table extraction.
- High false-positive rate from non-table identifiers in SQL fragments.

**Analysis Tools**:
- tree-sitter PHP grammar for string extraction
- SQL-specific regex or lightweight SQL parser for table name extraction
- `greenlion/php-sql-parser` (PHP library) for deeper SQL parsing

**Complexity**: High

---

## 14. MySQLi Raw SQL

**Name**: MySQLi — Raw SQL

**Type**: Raw SQL

**Supported Databases**: MySQL, MariaDB

**Detection Signals**:
- `new mysqli(...)` or `mysqli_connect(...)` calls
- `$mysqli->query('...')`, `$mysqli->prepare('...')`
- `mysqli_query($conn, '...')` procedural form

**Entity Definition Style**:
- Same as PDO — table names in raw SQL strings

**Extraction Approach**:
- Same approach as PDO (section 13), but search for `mysqli` function calls and method calls instead of `PDO`.
- Also scan for `mysqli_query`, `mysqli_prepare` procedural calls.

**Key Challenges**:
- Same as PDO.
- Procedural style (global functions) is common in legacy code; string arguments may be in variables.

**Analysis Tools**:
- tree-sitter PHP grammar

**Complexity**: High

---

## 15. MongoDB (mongodb/mongodb)

**Name**: MongoDB PHP Library

**Type**: NoSQL (Document Store)

**Supported Databases**: MongoDB

**Detection Signals**:
- `composer.json`: `mongodb/mongodb`
- `MongoDB\Client` instantiation
- `$client->selectDatabase('db_name')->selectCollection('collection_name')` or `$client->dbName->collectionName`
- `$collection->insertOne(...)`, `$collection->find(...)`, `$collection->updateOne(...)` operations
- `.env` or config: `MONGODB_URI`, `MONGODB_DATABASE`

**Entity Definition Style**:
- No schema declaration; collections are created implicitly
- Collection names appear as string arguments to `selectCollection('...')` or as properties: `$db->users`

**Extraction Approach**:
1. Detect `mongodb/mongodb` in `composer.json`.
2. Scan for `new MongoDB\Client(...)`.
3. Extract collection names from:
   - `->selectCollection('collection_name')` — string literal argument
   - `$db->collectionName` — property access on a database object (heuristic)
   - `new MongoDB\Collection(...)` constructor arguments
4. Scan for document structure in `insertOne([...])` / `insertMany([...])` for field hints.

**Key Challenges**:
- Collection names often passed as variables.
- Schemaless by design — no authoritative field list.
- Collection names via property access (`$db->users`) require database variable tracking.

**Analysis Tools**:
- tree-sitter PHP grammar

**Complexity**: High

---

## 16. Eloquent with MongoDB (jenssegers/mongodb)

**Name**: Eloquent MongoDB (jenssegers/mongodb)

**Type**: NoSQL ORM (Document Store)

**Supported Databases**: MongoDB

**Detection Signals**:
- `composer.json`: `jenssegers/mongodb` or `mongodb/laravel-mongodb` (newer package name)
- Classes extending `Jenssegers\Mongodb\Eloquent\Model` or `MongoDB\Laravel\Eloquent\Model`
- `protected $connection = 'mongodb'` in model
- `protected $collection = 'collection_name'` property (equivalent to `$table`)

**Entity Definition Style**:
- Same Eloquent-style class as Laravel ORM (section 2), but using MongoDB-specific base class
- Collection name: `protected $collection = 'custom_name'` or inferred by pluralizing class name

**Extraction Approach**:
1. Detect `jenssegers/mongodb` or `mongodb/laravel-mongodb` in `composer.json`.
2. Scan for classes extending `Jenssegers\Mongodb\Eloquent\Model` or `MongoDB\Laravel\Eloquent\Model`.
3. Extract `protected $collection` value; fall back to pluralized snake_case class name.
4. Extract `$fillable`, `$guarded`, `$casts` for field hints.

**Key Challenges**:
- Same as standard Eloquent (dynamic overrides, traits).
- MongoDB's schemaless nature means field lists are not authoritative.

**Analysis Tools**:
- tree-sitter PHP grammar

**Complexity**: Medium

---

## 17. Redis (Predis / PhpRedis)

**Name**: Redis — Predis / PhpRedis

**Type**: Key-Value Store / Cache

**Supported Databases**: Redis

**Detection Signals**:
- `composer.json`: `predis/predis` (Predis) or `ext-redis` (PhpRedis native extension)
- `new Predis\Client(...)` or `new Redis()` instantiation
- `$redis->set('key', ...)`, `$redis->get('key')`, `$redis->hSet(...)`, `$redis->lPush(...)` operations
- `.env` or config: `REDIS_HOST`, `REDIS_URL`

**Entity Definition Style**:
- No schema or entity definition; data stored via arbitrary key patterns
- Key naming conventions (e.g., `user:{id}`, `session:{token}`) carry implicit schema

**Extraction Approach**:
1. Detect `predis/predis` in `composer.json` or `new Redis()` instantiation.
2. Extract key string patterns from `->set('key_pattern', ...)`, `->hSet('hash_name', ...)`, `->get('key_pattern')`.
3. Identify recurring key prefixes as potential "entity" signals (e.g., `user:*`, `order:*`).
4. Note: Redis is typically used for caching/sessions, not primary entity storage.

**Key Challenges**:
- Key names are almost always dynamic; static analysis yields minimal useful data.
- Redis is rarely the primary store for complex entities.

**Analysis Tools**:
- tree-sitter PHP grammar

**Complexity**: High

---

## 18. Elasticsearch (elastic/elasticsearch)

**Name**: Elasticsearch PHP Client

**Type**: Search Index / Document Store

**Supported Databases**: Elasticsearch, OpenSearch

**Detection Signals**:
- `composer.json`: `elastic/elasticsearch`, `elasticsearch/elasticsearch`
- `Elasticsearch\ClientBuilder::create()` or `Elastic\Elasticsearch\ClientBuilder::create()`
- Index operations: `$client->index(['index' => 'index_name', 'body' => [...]])`, `$client->search(['index' => 'index_name', ...])`
- Mapping definitions: `$client->indices()->create(['index' => 'index_name', 'body' => ['mappings' => [...]]])`
- `.env`: `ELASTICSEARCH_HOST`

**Entity Definition Style**:
- Index name as string in API calls; mappings defined in `body.mappings.properties` arrays
- No formal class-based entity; index name is the entity container

**Extraction Approach**:
1. Detect `elastic/elasticsearch` in `composer.json`.
2. Scan for `$client->index(...)`, `$client->search(...)`, `$client->indices()->create(...)` calls.
3. Extract `index` key values from the array argument as index names.
4. From `indices()->create()` calls, extract `body.mappings.properties` for field definitions.
5. Look for external JSON/YAML mapping files if index configurations are externalized.

**Key Challenges**:
- Index names commonly set via configuration variables, not string literals.
- Mappings often stored in separate JSON files, not inline in PHP code.

**Analysis Tools**:
- tree-sitter PHP grammar
- JSON parser for external mapping files

**Complexity**: High

---

## 19. Database Schema SQL Files

**Name**: Raw SQL Schema Files

**Type**: Schema File / DDL

**Supported Databases**: Any (MySQL, PostgreSQL, SQLite, etc.)

**Detection Signals**:
- Files: `*.sql`, `schema.sql`, `structure.sql`, `database.sql`, `init.sql`, `setup.sql`
- Directories: `sql/`, `db/`, `database/`, `schema/`, `migrations/`
- File content: `CREATE TABLE`, `CREATE VIEW`, `ALTER TABLE`, `CREATE INDEX`

**Entity Definition Style**:
- Standard DDL: `CREATE TABLE table_name (column_name data_type constraints, ...)`
- Views: `CREATE VIEW view_name AS SELECT ...`

**Extraction Approach**:
1. Glob for `*.sql` files across the repository.
2. Parse each file for `CREATE TABLE [IF NOT EXISTS] table_name (...)` statements.
3. Extract `table_name` and the column list within parentheses.
4. Also extract `CREATE VIEW view_name` as a secondary signal.
5. Use a lightweight SQL parser or regex: `CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\`?[\w]+\`?)`.
6. Handle MySQL backtick quoting, PostgreSQL double-quote quoting.

**Key Challenges**:
- Multiple SQL dialects with different quoting conventions.
- `CREATE TABLE ... AS SELECT ...` (CTAS) — no column list in DDL.
- Procedural SQL (stored procedures, triggers) may contain `CREATE TABLE` in dynamic SQL strings.
- Large dump files with millions of rows (only DDL at the top is relevant).

**Analysis Tools**:
- Regex-based SQL scanner
- `greenlion/php-sql-parser` or Python's `sqlglot` for dialect-aware parsing
- tree-sitter SQL grammar

**Complexity**: Low

---

## 20. Protobuf PHP

**Name**: Protocol Buffers (PHP)

**Type**: Schema File / Data Definition

**Supported Databases**: N/A (serialization format, often used alongside storage layers)

**Detection Signals**:
- `composer.json`: `google/protobuf`
- `.proto` files in the repository (`*.proto`)
- Generated PHP files: classes extending `Google\Protobuf\Internal\Message`
- `_generated/` or `proto/` directories

**Entity Definition Style**:
- `.proto` file: `message EntityName { string field_name = 1; ... }`
- Generated PHP class: `class EntityName extends \Google\Protobuf\Internal\Message`

**Extraction Approach**:
1. Detect `google/protobuf` in `composer.json` or `.proto` files in the repo.
2. Parse `.proto` files for `message MessageName { ... }` blocks.
3. Extract `MessageName` as entity name and field declarations for field list.
4. Generated PHP classes are derivative — prefer `.proto` files as source of truth.
5. Map proto `message` names to storage entities if cross-referenced with ORM models.

**Key Challenges**:
- Protobuf messages are serialization DTOs, not necessarily direct database entities.
- Mapping between proto messages and storage tables requires additional context.

**Analysis Tools**:
- tree-sitter proto grammar
- Regex: `message\s+(\w+)\s*\{`

**Complexity**: Medium

---

## 21. OpenAPI-Generated Models

**Name**: OpenAPI / Swagger Generated PHP Models

**Type**: Schema File / Generated Code

**Supported Databases**: N/A (API contract, often mirrors storage entities)

**Detection Signals**:
- `openapi.yaml`, `openapi.json`, `swagger.yaml`, `swagger.json` files
- `composer.json`: `swagger-api/swagger-codegen`, `openapi-generator` related packages
- Generated model classes in `lib/Model/`, `src/Model/`, `generated/Model/`
- Classes with `@SWG\Definition`, `@OA\Schema` annotations or `#[OA\Schema]` attributes

**Entity Definition Style**:
- OpenAPI spec: `components.schemas.EntityName` with `properties` defining fields
- Generated PHP classes annotated with `@OA\Schema(schema="EntityName")`

**Extraction Approach**:
1. Locate `openapi.yaml` / `openapi.json` / `swagger.yaml`.
2. Parse `components.schemas` (OpenAPI 3.x) or `definitions` (Swagger 2.x) for schema names.
3. For each schema object, collect `properties` as field definitions.
4. Generated PHP classes are derivative — prefer spec files.
5. If only generated classes exist, scan for `@OA\Schema` / `#[OA\Schema]` annotations.

**Key Challenges**:
- OpenAPI schemas are API contracts, not necessarily 1:1 with database tables.
- Composition (`allOf`, `anyOf`, `oneOf`) complicates entity boundaries.

**Analysis Tools**:
- YAML / JSON parser for spec files
- tree-sitter PHP grammar for annotation scanning

**Complexity**: Medium

---

## 22. Laravel Model Factories

**Name**: Laravel Model Factories

**Type**: Entity Signal (Secondary)

**Supported Databases**: Same as Eloquent (MySQL, PostgreSQL, SQLite, SQL Server)

**Detection Signals**:
- Directory: `database/factories/` with files named `*Factory.php`
- Classes extending `Illuminate\Database\Eloquent\Factories\Factory`
- `protected $model = ModelClass::class` property in factory
- `HasFactory` trait used in Eloquent model classes
- `factory(ModelClass::class)` or `ModelClass::factory()` in test files

**Entity Definition Style**:
- Factory class references a model via `protected $model`; `definition()` method returns array of fake data with keys matching column names

**Extraction Approach**:
1. Scan `database/factories/*Factory.php`.
2. For each factory, extract the `$model` property value (FQCN of the model).
3. Parse the `definition()` method return array keys as column name hints.
4. Cross-reference with the corresponding model class and migration for validation.
5. Use factory column keys as a supplement when migration files are unavailable.

**Key Challenges**:
- `definition()` may use `fake()->...` for values but the keys are static column names — reliable signal.
- Factories may use `->state()` and `->afterCreating()` which may reference additional columns.

**Analysis Tools**:
- tree-sitter PHP grammar

**Complexity**: Low

---

## 23. PHP Data Objects with Raw SQL (Advanced Patterns)

**Name**: PDO / Raw SQL — Advanced Query Patterns

**Type**: Raw SQL (Advanced)

**Supported Databases**: Any

**Detection Signals**:
- Same as section 13 (PDO), plus:
- Repository pattern classes with `$this->pdo->prepare(...)` in methods
- Query builder strings constructed via `sprintf`, `implode`, `str_replace`
- External `.sql` files loaded via `file_get_contents`

**Entity Definition Style**:
- Table names in SQL template strings, often as class constants or configuration values

**Extraction Approach**:
1. Scan for PHP class constants defining table names: `const TABLE = 'users'`, `const TABLE_NAME = 'orders'`.
2. Scan for static properties: `protected static $tableName = 'products'`.
3. Scan for `.sql` file inclusions via `file_get_contents` + `$pdo->exec`.
4. Apply the same SQL string extraction as section 13.

**Key Challenges**:
- Table name as constant requires constant value resolution across files.
- SQL templates across multiple files require cross-file analysis.

**Analysis Tools**:
- tree-sitter PHP grammar
- Cross-file constant resolution logic

**Complexity**: High

---

## Repository Detection Plan

The following plan outlines a recommended order and strategy for automated static analysis of a PHP repository to extract data entities.

### Phase 1: Framework Identification

1. Read `composer.json` (`require` and `require-dev` sections).
2. Map detected packages to frameworks using this table:

| Package | Framework/Approach |
|---|---|
| `laravel/framework` or `illuminate/database` | Eloquent ORM + Laravel Migrations |
| `doctrine/orm` | Doctrine ORM |
| `doctrine/doctrine-bundle` | Symfony + Doctrine |
| `symfony/framework-bundle` | Symfony (check for Doctrine too) |
| `cakephp/cakephp` | CakePHP ORM |
| `propel/propel` | Propel ORM |
| `yiisoft/yii2` | Yii2 ActiveRecord |
| `robmorgan/phinx` | Phinx Migrations |
| `vlucas/spot2` | Spot ORM |
| `cycle/orm` | Cycle ORM |
| `jenssegers/mongodb` or `mongodb/laravel-mongodb` | Eloquent MongoDB |
| `mongodb/mongodb` | Raw MongoDB |
| `predis/predis` | Redis (Predis) |
| `elastic/elasticsearch` | Elasticsearch |
| `gabordemooij/redbean` | RedBeanPHP |
| `laminas/laminas-db` or `zendframework/zend-db` | Laminas/Zend DB |
| `google/protobuf` | Protobuf PHP |

3. If no ORM detected, assume raw SQL (PDO / MySQLi) usage.

### Phase 2: Primary Entity Extraction (by framework)

Execute the framework-specific extraction strategy from the relevant section above. Priority order for authoritative sources:

1. **Schema/migration files** (most authoritative): `schema.xml` (Propel), `database/migrations/` (Laravel), `db/migrate/` (Yii2/Phinx), `.sql` files
2. **Annotated entity classes**: Doctrine `#[Entity]`, Cycle `#[Entity]`, Eloquent `extends Model`
3. **Table gateway classes**: Laminas `AbstractTableGateway`, CakePHP `Table` classes
4. **Runtime-inferred patterns**: RedBeanPHP, raw SQL strings

### Phase 3: Cross-Validation

- Cross-reference entity names found in model classes with those found in migration files.
- Flag discrepancies (model without migration, migration without model).
- Resolve table name aliases and renames from migration history.

### Phase 4: Secondary Signals

Extract supplementary entity signals from:
- Laravel Model Factories (`database/factories/`) — column name hints
- `.env` / `config/database.php` — database name and connection type
- OpenAPI spec files — API-level schema names
- Protobuf `.proto` files — serialization entity names
- Elasticsearch mapping files — index names

### Phase 5: SQL File Scan (Fallback)

- Glob for `*.sql` files in `sql/`, `db/`, `database/`, `schema/`, `migrations/`
- Extract `CREATE TABLE` statements
- Merge with ORM-derived entity list

### Phase 6: Confidence Scoring

Assign confidence levels to extracted entities:

| Source | Confidence |
|---|---|
| `schema.xml` / `CREATE TABLE` in SQL file | High |
| Laravel migration `Schema::create` | High |
| Doctrine `#[Entity]` / `#[Table]` | High |
| Eloquent `extends Model` (with `$table`) | High |
| Eloquent `extends Model` (name-inferred) | Medium |
| CakePHP `*Table` class (convention) | Medium |
| RedBeanPHP `R::dispense` | Low |
| Raw SQL string extraction | Low |
| Factory `definition()` keys | Low (supplementary) |

### Recommended Parsing Tools

- **PHP AST**: tree-sitter with the [tree-sitter-php](https://github.com/tree-sitter/tree-sitter-php) grammar
- **PHP AST (deep)**: `nikic/php-parser` invoked via a PHP subprocess or pre-parsed to JSON
- **SQL**: `sqlglot` (Python) or regex-based scanner for `CREATE TABLE` patterns
- **XML**: `lxml` (Python) or `SimpleXML` (PHP) for `schema.xml`, `.orm.xml`
- **YAML**: `PyYAML` or `js-yaml` for `phinx.yml`, `.orm.yml`, `doctrine.yaml`
- **JSON**: Standard JSON parsers for `openapi.json`, `phinx.json`
- **Protobuf**: tree-sitter with [tree-sitter-proto](https://github.com/mitchellh/tree-sitter-proto) grammar
