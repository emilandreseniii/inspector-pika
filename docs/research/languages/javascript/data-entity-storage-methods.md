# Data Entity Storage Methods in JavaScript

**Purpose**: This document catalogs every significant data entity storage framework, library, and approach used in JavaScript projects. It is designed to support automated static analysis of JS/TS repositories to extract a list of data entities (database tables, document collections, key-value namespaces, etc.).

**Last Updated**: 2026-03-27

---

## Table of Contents

1. [Prisma](#1-prisma)
2. [TypeORM](#2-typeorm)
3. [Sequelize](#3-sequelize)
4. [Drizzle ORM](#4-drizzle-orm)
5. [MikroORM](#5-mikroorm)
6. [Objection.js + Knex](#6-objectionjs--knex)
7. [Mongoose (MongoDB)](#7-mongoose-mongodb)
8. [MongoDB Native Driver](#8-mongodb-native-driver)
9. [node-postgres (pg) — Raw SQL](#9-node-postgres-pg--raw-sql)
10. [mysql2 — Raw SQL](#10-mysql2--raw-sql)
11. [better-sqlite3 — Raw SQL](#11-better-sqlite3--raw-sql)
12. [Kysely](#12-kysely)
13. [Bookshelf.js](#13-bookshelfjs)
14. [Waterline (Sails.js)](#14-waterline-sailsjs)
15. [Firestore (firebase-admin)](#15-firestore-firebase-admin)
16. [DynamoDB (AWS SDK)](#16-dynamodb-aws-sdk)
17. [Redis (ioredis / node-redis)](#17-redis-ioredis--node-redis)
18. [Elasticsearch (Official Client)](#18-elasticsearch-official-client)
19. [MongoDB Native Driver (detailed)](#8-mongodb-native-driver)
20. [Hasura Migration Files](#19-hasura-migration-files)
21. [Database Migration Files (db-migrate, node-pg-migrate, umzug, Flyway)](#20-database-migration-files)
22. [Raw SQL Files](#21-raw-sql-files)
23. [GraphQL Schema as Entity Signal](#22-graphql-schema-as-entity-signal)
24. [Zod Schemas as Entity Signals](#23-zod-schemas-as-entity-signals)
25. [class-validator Decorated Classes](#24-class-validator-decorated-classes)
26. [OpenAPI Schemas as Entity Signals](#25-openapi-schemas-as-entity-signals)
27. [NestJS Patterns](#26-nestjs-patterns)
28. [Repository Detection Plan](#27-repository-detection-plan)

---

## 1. Prisma

- **Name**: Prisma
- **Type**: Relational ORM / Schema File
- **Supported Databases**: PostgreSQL, MySQL, MariaDB, SQLite, SQL Server, CockroachDB, MongoDB (preview)
- **Detection Signals**:
  - `package.json` dependencies: `"prisma"`, `"@prisma/client"`
  - Config/schema file: `prisma/schema.prisma` (default path), any `*.prisma` file anywhere in the repo
  - Scripts in `package.json` referencing: `prisma generate`, `prisma migrate`, `prisma db push`
  - Directory: `prisma/` at project root
  - Import pattern: `import { PrismaClient } from '@prisma/client'`, `require('@prisma/client')`
  - Monorepo: `packages/*/prisma/schema.prisma`
- **Entity Definition Style**: Declarative schema language (`.prisma` format). Each `model` block defines a table or document collection. Example:
  ```prisma
  model User {
    id    Int    @id @default(autoincrement())
    email String @unique
    posts Post[]
  }
  ```
  The model name is the logical entity name; the underlying table name defaults to the snake_case plural of the model name but is overridden by `@@map("table_name")`.
- **Extraction Approach**:
  1. Locate all `*.prisma` files via recursive glob.
  2. For each file, extract all `model` blocks with the regex `^model\s+(\w+)\s*\{` — the capture group is the model (entity) name.
  3. Within each model block, scan for `@@map("table_name")` — if present, this is the actual table/collection name; otherwise derive from the model name.
  4. For field-level mapping, `@map("column_name")` overrides column names but does not affect the entity name.
  5. Extract `enum` blocks (`^enum\s+(\w+)\s*\{`) — these are value types, not tables.
  6. Parse the `datasource` block to determine the `provider` (postgresql, mysql, sqlite, mongodb, sqlserver, cockroachdb).
  7. For multi-schema PostgreSQL, look for `@@schema("schema_name")` attributes.
  8. The most reliable programmatic approach: call `getDMMF({ datamodelPath })` from `@prisma/internals` to get a fully parsed DMMF JSON object with `datamodel.models` array.
- **Key Challenges**:
  - `@@map` and field-level `@map` directives decouple logical names from physical names — always check for them.
  - Multi-file schema (`prismaSchemaFolder` preview feature in Prisma 5+): schema spread across multiple `.prisma` files in a directory; must aggregate all files.
  - MongoDB provider uses embedded documents and `@map("_id")` — subdocuments do not create separate collections.
  - `@relation` fields reference other models but do not themselves represent columns (unless a relation scalar field is present).
  - Views (`@@view` in Prisma 5+) should be distinguished from tables.
  - Generated client may be at a custom output path (`output` in `generator` block).
- **Analysis Tools**: `@prisma/internals` (`getDMMF()`) for the most robust parsing; regex on raw text for quick/lightweight extraction; tree-sitter Prisma grammar (`tree-sitter-prisma`) for AST-based parsing.
- **Complexity**: Low

---

## 2. TypeORM

- **Name**: TypeORM
- **Type**: Relational ORM
- **Supported Databases**: PostgreSQL, MySQL, MariaDB, SQLite, SQL Server, Oracle, CockroachDB, MongoDB (experimental)
- **Detection Signals**:
  - `package.json` dependency: `"typeorm"`
  - Import: `import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm'`
  - Decorator usage on classes: `@Entity()`, `@Entity("table_name")`, `@Entity({ name: "table_name" })`
  - Config files: `ormconfig.json`, `ormconfig.js`, `ormconfig.ts`, `ormconfig.yaml`, `ormconfig.yml`, `ormconfig.env`, `data-source.ts`, `data-source.js`
  - Directory conventions: `src/entity/`, `src/entities/`, `src/models/`
  - File naming convention: `*.entity.ts`, `*.entity.js`
  - Legacy XML entity files: `*.entity.xml`
- **Entity Definition Style**:
  - **Decorator-based (primary)**: A TypeScript/JavaScript class decorated with `@Entity()` maps to a database table. The table name defaults to the snake_case version of the class name unless overridden:
    ```js
    @Entity('users')
    class User {
      @PrimaryGeneratedColumn()
      id;
      @Column()
      email;
    }
    ```
  - **`EntitySchema` (DataMapper pattern)**: `new EntitySchema({ name: 'User', tableName: 'users', columns: { ... } })` — used in pure JavaScript projects or when avoiding decorators.
  - **XML (legacy)**: XML files with `<entity name="User" table="users">` root elements (rarely used, from early versions).
- **Extraction Approach**:
  1. Read `ormconfig.*` or `DataSource` constructor call to find the `entities` glob pattern (e.g., `"entities": ["src/entity/**/*.ts"]`). This tells you which files contain entity definitions.
  2. For decorator-based: parse each entity file's AST. Find class declarations with a `@Entity(...)` decorator. Extract the table name from the decorator argument:
     - `@Entity()` → derive table name from class name (snake_case, e.g., `UserProfile` → `user_profile`)
     - `@Entity("my_table")` → string literal is the table name
     - `@Entity({ name: "my_table" })` → `name` property is the table name
  3. For `EntitySchema`: find `new EntitySchema({ name: '...', tableName: '...' })` — use `tableName` if present, else `name`.
  4. For XML files: parse `<entity>` root element, read `name` and `table` attributes.
  5. Check for `@ViewEntity()` decorator — these map to database views, not tables; distinguish accordingly.
  6. Check for `@ChildEntity()` — signals Single Table Inheritance (STI) sub-type; does **not** create a separate table.
  7. Check for `@TableInheritance({ column: ... })` on a parent entity — this parent and all `@ChildEntity()` children share one table.
- **Key Challenges**:
  - `@Entity()` can accept a string, an options object with `name`, or nothing — all three must be handled.
  - Single Table Inheritance (STI): `@TableInheritance()` + `@ChildEntity()` means one table has multiple entity class representations.
  - Concrete Table Inheritance (CTI): each entity in the hierarchy gets its own table.
  - Abstract base entity classes (`abstract: true` or TS `abstract class`) without `@Entity()` do not create tables.
  - `@ViewEntity()` creates a view, not a table.
  - TypeORM supports multiple `DataSource` connections — each may have its own set of entities.
  - Entity subscribers and listeners in `*.subscriber.ts` files reference entities but do not define new ones.
- **Analysis Tools**: `@typescript-eslint/parser` (for TypeScript files), `@babel/parser` with `@babel/plugin-proposal-decorators` plugin (for JS), `acorn` + `acorn-walk` for plain JS without decorators. Tree-sitter with TypeScript grammar.
- **Complexity**: Medium

---

## 3. Sequelize

- **Name**: Sequelize
- **Type**: Relational ORM
- **Supported Databases**: PostgreSQL, MySQL, MariaDB, SQLite, SQL Server, DB2, Snowflake (via dialect packages)
- **Detection Signals**:
  - `package.json` dependencies: `"sequelize"`, `"sequelize-typescript"`, `"sequelize-cli"` (devDependency)
  - Import: `import { Model, DataTypes } from 'sequelize'`, `const { Sequelize, Model } = require('sequelize')`
  - Config files: `.sequelizerc` (CLI config), `config/config.json`, `config/config.js`, `config/database.js`
  - Directory conventions: `models/`, `db/models/`, `src/models/`
  - Migration files in: `migrations/`, `db/migrate/` (Sequelize-CLI default)
  - Seed files in: `seeders/`
- **Entity Definition Style**:
  - **`Model.init()` (ES6 class)**:
    ```js
    class User extends Model {}
    User.init(
      { id: { type: DataTypes.INTEGER, primaryKey: true }, email: DataTypes.STRING },
      { sequelize, modelName: 'User', tableName: 'users' }
    );
    ```
  - **`sequelize.define()`**:
    ```js
    const User = sequelize.define('User', { email: DataTypes.STRING }, { tableName: 'users' });
    ```
  - **`sequelize-typescript` decorators**:
    ```ts
    @Table({ tableName: 'users' })
    class User extends Model<User> {
      @Column email: string;
    }
    ```
- **Extraction Approach**:
  1. Find the models directory from `.sequelizerc` (`models-path`) or default `models/`.
  2. For `sequelize.define('ModelName', attrs, options)`: extract the first argument as the model name and the `tableName` from the options object.
  3. For `Model.init(attrs, { modelName: '...', tableName: '...' })`: extract `modelName` and `tableName` from the options object.
  4. For `sequelize-typescript` (`@Table`): find `@Table(...)` decorators on classes; extract `tableName` from the decorator argument. If absent, derive from class name.
  5. If `tableName` is not explicitly set:
     - Default: Sequelize pluralizes the model name (e.g., `User` → `users`, `Person` → `people`).
     - If `underscored: true` option is set, camelCase model names become snake_case table names.
     - If `freezeTableName: true` is set globally or per-model, no pluralization is applied.
  6. Check for `belongsToMany` associations: `User.belongsToMany(Role, { through: 'user_roles' })` — the `through` string or model creates a join table.
- **Key Challenges**:
  - Implicit table naming involves pluralization and underscoring logic that must be replicated. Sequelize uses `inflection` library for pluralization — edge cases apply.
  - Dynamic model loading via `fs.readdirSync(modelsDir).filter(...).forEach(file => require(path.join(modelsDir, file)))` — must scan the directory rather than follow imports.
  - Global options (`sequelize.options.define.underscored`, `freezeTableName`) affect all models and must be checked.
  - `paranoid: true` adds a `deletedAt` column but does not affect the table name.
  - `belongsToMany` with a `through` model that is itself a defined model: that model already has its own table definition.
  - Sequelize CLI migration files (`queryInterface.createTable('table_name', ...)`) are a secondary source.
- **Analysis Tools**: `@babel/parser`, `acorn` + `acorn-walk`, `@typescript-eslint/parser` for sequelize-typescript. Tree-sitter.
- **Complexity**: Medium

---

## 4. Drizzle ORM

- **Name**: Drizzle ORM
- **Type**: Relational ORM / Query Builder / Schema-as-Code
- **Supported Databases**: PostgreSQL, MySQL, MariaDB, SQLite, Turso, Neon, PlanetScale, Cloudflare D1
- **Detection Signals**:
  - `package.json` dependencies: `"drizzle-orm"`, `"drizzle-kit"`
  - Import patterns:
    - `import { pgTable } from 'drizzle-orm/pg-core'`
    - `import { mysqlTable } from 'drizzle-orm/mysql-core'`
    - `import { sqliteTable } from 'drizzle-orm/sqlite-core'`
  - Config file: `drizzle.config.ts`, `drizzle.config.js`, `drizzle.config.cjs`
  - Schema files: commonly `src/db/schema.ts`, `db/schema.ts`, `src/schema.ts`, `lib/db/schema.ts` — path configurable in config
  - Migration directory: `drizzle/` (default), contains `*.sql` migration files and `_journal.json`
- **Entity Definition Style**: Pure TypeScript/JavaScript. Tables are defined as exported constants by calling the database-specific table function:
  ```js
  // PostgreSQL
  export const users = pgTable('users', {
    id: serial('id').primaryKey(),
    email: text('email').notNull().unique(),
  });
  // MySQL
  export const orders = mysqlTable('orders', { ... });
  // SQLite
  export const sessions = sqliteTable('sessions', { ... });
  ```
  The **first string argument** is the actual physical table name. The **variable name** is the TypeScript identifier used in queries.
- **Extraction Approach**:
  1. Read `drizzle.config.ts` / `drizzle.config.js` — find the `schema` property. This is a file path or glob pattern pointing to schema file(s).
  2. If no config file, search for files importing from `drizzle-orm/pg-core`, `drizzle-orm/mysql-core`, or `drizzle-orm/sqlite-core`.
  3. Parse each schema file. Find all call expressions where the callee is `pgTable`, `mysqlTable`, or `sqliteTable` (or their aliased imports).
  4. Extract the first argument (string literal) as the physical table name.
  5. The variable name assigned to the call is the logical name used in query code.
  6. For views: look for `pgView(name, ...)`, `mysqlView(name, ...)`, `sqliteView(name, ...)` — these are views, not tables.
  7. For Drizzle migrations (SQL files in the `out` directory): parse `CREATE TABLE` statements as a cross-check.
- **Key Challenges**:
  - Schema can be split into multiple files (per-domain modules), all referenced in `drizzle.config`.
  - The table name argument can theoretically be a variable or template literal (unusual but possible).
  - Drizzle supports schema-qualified table names for PostgreSQL: `pgSchema('myschema').table('users', ...)` — the schema name is a separate object.
  - `pgEnum`, `mysqlEnum` create database enum types, not tables.
  - `$with` and `withRecursive` create CTEs in queries — not physical tables.
- **Analysis Tools**: `@typescript-eslint/parser`, `@babel/parser`, `acorn`. For migration SQL: `node-sql-parser` or `pgsql-ast-parser`.
- **Complexity**: Low

---

## 5. MikroORM

- **Name**: MikroORM
- **Type**: Relational ORM / MongoDB ORM
- **Supported Databases**: PostgreSQL, MySQL, MariaDB, SQLite, MongoDB, SQL Server (experimental)
- **Detection Signals**:
  - `package.json` dependencies: `"@mikro-orm/core"`, `"@mikro-orm/postgresql"`, `"@mikro-orm/mysql"`, `"@mikro-orm/sqlite"`, `"@mikro-orm/mongodb"`, `"@mikro-orm/knex"`, `"@mikro-orm/cli"`
  - Import: `import { Entity, Property, PrimaryKey, ManyToOne } from '@mikro-orm/core'`
  - Config files: `mikro-orm.config.ts`, `mikro-orm.config.js`, `mikro-orm.config.json`, `.env` with `MIKRO_ORM_*` variables
  - CLI config in `package.json`: `"mikro-orm": { "useTsNode": true, "configPaths": ["./src/mikro-orm.config.ts"] }`
  - Directory conventions: `src/entities/`, `entities/`, `src/**/entities/`
- **Entity Definition Style**:
  - **Decorator-based (primary)**:
    ```js
    @Entity({ tableName: 'users' })  // tableName optional; defaults to snake_case of class name
    class User {
      @PrimaryKey()
      id;
      @Property()
      email;
    }
    ```
  - **`EntitySchema`**:
    ```js
    const UserSchema = new EntitySchema({
      name: 'User',
      tableName: 'users',
      properties: { id: { type: 'number', primary: true }, email: { type: 'string' } }
    });
    ```
  - **`TsMorphMetadataProvider`** (TypeScript only): reads TypeScript type information to infer metadata without explicit decorators. Entity classes are still registered in config.
- **Extraction Approach**:
  1. Read MikroORM config to find `entities` and `entitiesTs` arrays (file globs or class references).
  2. For decorator-based: parse each entity file, find classes decorated with `@Entity(...)`. Extract `tableName` from the decorator options, or derive from class name (snake_case).
  3. For MongoDB driver: `@Entity({ collection: 'users' })` — use `collection` property for collection name.
  4. For `EntitySchema`: find `new EntitySchema({ name: '...', tableName: '...' })` — extract both properties.
  5. For `abstract: true` entities in the `@Entity()` decorator: these are abstract base entities and do not create tables.
  6. Check for embedded entities (`@Embeddable()` decorator) — these map to columns on the parent entity, not separate tables.
- **Key Challenges**:
  - Both relational and MongoDB entities use `@Entity()` — the database driver (from config) determines semantics.
  - `abstract: true` in `@Entity({ abstract: true })` means no dedicated table (used with STI or as a mixin).
  - `@Embeddable()` / `@Embedded()` — embeddable objects map to columns in the parent table, not new tables.
  - `TsMorphMetadataProvider` resolves types at compile time; pure static analysis cannot replicate this without running `ts-morph`.
  - MikroORM 5+ introduced the `Collection<T>` class for relationships — these define no new tables.
  - Custom naming strategy (config `namingStrategy`) may affect how class names map to table names.
- **Analysis Tools**: `@typescript-eslint/parser`, `ts-morph` (for TsMorphMetadataProvider patterns), `@babel/parser`.
- **Complexity**: Medium

---

## 6. Objection.js + Knex

- **Name**: Objection.js + Knex
- **Type**: Relational ORM (Objection.js) + Query Builder / Migration Tool (Knex)
- **Supported Databases**: PostgreSQL, MySQL, MariaDB, SQLite, SQL Server, Oracle (all via Knex)
- **Detection Signals**:
  - `package.json` dependencies: `"objection"` and/or `"knex"`
  - Import: `import { Model } from 'objection'`, `const { Model } = require('objection')`
  - Config files: `knexfile.js`, `knexfile.ts`, `knexfile.cjs`, `knexfile.mjs`
  - Migration directory: `migrations/` (Knex default), `db/migrations/`
  - Seed directory: `seeds/`, `db/seeds/`
  - Files: `*.model.js`, `models/*.js`
  - Knex can be used standalone (without Objection.js); look for `require('knex')` or `import knex from 'knex'`
- **Entity Definition Style**:
  - **Objection.js models**:
    ```js
    class User extends Model {
      static get tableName() { return 'users'; }
      static get jsonSchema() {
        return { type: 'object', properties: { id: { type: 'integer' }, email: { type: 'string' } } };
      }
    }
    ```
  - **Knex schema builder** (in migrations):
    ```js
    exports.up = knex => knex.schema.createTable('users', table => {
      table.increments('id');
      table.string('email').notNullable();
    });
    exports.down = knex => knex.schema.dropTable('users');
    ```
- **Extraction Approach**:
  1. **Objection.js models**: Find all classes extending `Model` (imported from `objection`). Within each class body, extract:
     - `static get tableName()` getter — the return value string is the table name.
     - `static tableName = '...'` class field — the value is the table name.
  2. **Knex migrations**: Read `knexfile.js` to find the `migrations.directory` config. Scan all migration files in that directory. Parse each file for:
     - `knex.schema.createTable('name', ...)` / `knex.schema.createTableIfNotExists('name', ...)`
     - `knex.schema.table('name', ...)` / `knex.schema.alterTable('name', ...)` — table modification, not creation
     - `knex.schema.renameTable('old', 'new')` — track renames
     - `knex.schema.dropTable('name')` — track deletions
  3. Apply chronological ordering of migrations to determine the final table set.
  4. `static relationMappings` in Objection.js models reveals foreign key targets and join table names for many-to-many relationships.
- **Key Challenges**:
  - `tableName` can be a static getter, a static property, or (rarely) a method — all must be detected.
  - Knex can be used without Objection.js — in that case the only entity information comes from migrations and raw query calls.
  - `schema.alterTable()` / `schema.table()` indicate existing tables being modified — these tables must have been created in an earlier migration.
  - Dynamic table names (e.g., `tableName = this.constructor.name.toLowerCase()`) defeat static analysis.
  - The `jsonSchema` static property provides column definitions but its absence doesn't mean no entity.
- **Analysis Tools**: `@babel/parser`, `acorn` + `acorn-walk`, `@typescript-eslint/parser`.
- **Complexity**: Medium

---

## 7. Mongoose (MongoDB)

- **Name**: Mongoose
- **Type**: NoSQL ORM (Document)
- **Supported Databases**: MongoDB
- **Detection Signals**:
  - `package.json` dependency: `"mongoose"`
  - Import: `import mongoose from 'mongoose'`, `import { Schema, model } from 'mongoose'`, `const mongoose = require('mongoose')`
  - Patterns: `mongoose.model('Name', schema)`, `model('Name', schema)`
  - File conventions: `models/*.js`, `*.model.js`, `schemas/*.js`
- **Entity Definition Style**: Schema-then-model pattern:
  ```js
  const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, unique: true }
  });
  const User = mongoose.model('User', userSchema);
  ```
  Or with explicit collection name:
  ```js
  const User = mongoose.model('User', userSchema, 'user_records');
  ```
  The model name (`'User'`) is the logical name; the collection name defaults to the lowercase plural (`users`) unless a third argument is provided or `{ collection: 'name' }` is passed to `new Schema()`.
- **Extraction Approach**:
  1. Find all files with `mongoose` import/require.
  2. Parse for `mongoose.model(name, schema, [collection])` or `model(name, schema, [collection])` calls:
     - First argument: model name string (logical name)
     - Optional third argument: explicit collection name string
  3. If no third argument, check the schema definition for `{ collection: 'name' }` in `new Schema({...}, { collection: 'name' })`.
  4. If no explicit collection name, derive: lowercase the model name + pluralize (e.g., `User` → `users`, `Mouse` → `mice`).
  5. **Discriminators**: `ModelClass.discriminator('SubTypeName', subSchema)` — shares the parent model's collection; adds a `__t` or custom discriminator key field. Do not count as a new collection.
  6. Gather all unique collection names found across the codebase.
- **Key Challenges**:
  - `mongoose.model('User')` with a single argument is a **model retrieval** call, not a definition — skip these.
  - Discriminators share a collection — the parent model's collection is the actual storage unit.
  - Subdocument schemas defined with `new Schema({...})` and embedded in parent schemas are **not** separate collections.
  - Pluralization uses mongoose's built-in pluralize function (based on `mongoose-legacy-pluralize` or `mongoose` internal) — edge cases like `Person` → `people` require the actual library logic.
  - Collection names can be set via `mongoose.pluralize(null)` (globally disables pluralization) or per-model.
  - Models registered to specific connections (`connection.model(...)` rather than `mongoose.model(...)`) also define collections.
- **Analysis Tools**: `@babel/parser`, `acorn` + `acorn-walk`. For collection name derivation with correct pluralization, invoke `mongoose` itself in a script if possible.
- **Complexity**: Medium

---

## 8. MongoDB Native Driver

- **Name**: MongoDB Native Driver (`mongodb` npm package)
- **Type**: NoSQL Driver (Raw)
- **Supported Databases**: MongoDB, MongoDB Atlas, DocumentDB (partial compatibility)
- **Detection Signals**:
  - `package.json` dependency: `"mongodb"`
  - Import: `import { MongoClient } from 'mongodb'`, `const { MongoClient } = require('mongodb')`
  - Patterns: `db.collection('name')`, `client.db('dbName').collection('name')`, `db.createCollection('name')`
- **Entity Definition Style**: No schema or model definition. Collections are addressed by string name at runtime through method calls. No compile-time registration of collections.
- **Extraction Approach**:
  1. Parse all source files for `.collection('name')` call expressions — extract string literal arguments.
  2. Also look for `db.createCollection('name')` and `db.command({ create: 'name' })`.
  3. `client.db('dbName').collection('collectionName')` — extract the second `.collection()` call's string argument.
  4. Aggregate all unique collection name strings across the codebase.
  5. For index operations: `collection.createIndex(...)` and `db.createIndex(collectionName, ...)` can confirm collection names.
- **Key Challenges**:
  - Collection names frequently come from variables, constants, or config rather than inline literals, requiring constant propagation.
  - `process.env.COLLECTION_NAME` as a collection name is not statically resolvable.
  - No central registry — must scan every file.
  - The same collection name string may appear dozens of times as repeated access; deduplicate.
  - MongoDB change streams (`collection.watch()`) and aggregation pipelines (`collection.aggregate()`) reference collections by name.
- **Analysis Tools**: `@babel/parser`, `acorn` + `acorn-walk`, tree-sitter. String literal extraction is straightforward; variable resolution requires data-flow analysis.
- **Complexity**: High

---

## 9. node-postgres (pg) — Raw SQL

- **Name**: node-postgres (`pg`)
- **Type**: Raw SQL / Query Driver
- **Supported Databases**: PostgreSQL, CockroachDB (compatible), Amazon RDS PostgreSQL
- **Detection Signals**:
  - `package.json` dependencies: `"pg"`, `"pg-pool"`, `"pg-native"`, `"@types/pg"`
  - Import: `import { Pool, Client } from 'pg'`, `const { Pool, Client } = require('pg')`
  - Patterns: `pool.query('SQL', [params])`, `client.query('SQL')`, `db.query('SQL')`
  - Often wrapped: `const db = { query: (sql, params) => pool.query(sql, params) }`
- **Entity Definition Style**: No entity model definitions. SQL is passed as strings directly to query functions. Tables are identified by parsing SQL within JavaScript string literals or tagged template literals.
- **Extraction Approach**:
  1. Find all `pool.query(...)`, `client.query(...)`, or any `.query(...)` call expressions.
  2. Extract the first argument if it is a string literal, template literal, or tagged template (`` sql`SELECT ...` ``).
  3. Apply SQL parsing to each extracted string. Look for table references in:
     - `FROM <table_name>`
     - `JOIN <table_name>` / `INNER JOIN` / `LEFT JOIN` / `RIGHT JOIN` / `FULL JOIN`
     - `INSERT INTO <table_name>`
     - `UPDATE <table_name>`
     - `DELETE FROM <table_name>`
     - `CREATE TABLE [IF NOT EXISTS] <table_name>`
     - `TRUNCATE <table_name>`
  4. Scan for SQL strings stored in variables (`const sql = 'SELECT ...'`) or in separate `.sql` files loaded via `fs.readFileSync` — trace these and parse them.
  5. Aggregate all unique table names; strip schema prefix to get the base name if needed (e.g., `public.users` → `users`).
- **Key Challenges**:
  - Template literals with interpolations (`SELECT * FROM ${schema}.${table}`) cannot be fully resolved statically.
  - SQL strings built via concatenation (`'SELECT * FROM ' + tableName`) require string constant folding.
  - CTEs (`WITH cte_name AS (...)`) introduce temporary names that look like table references.
  - Table aliases (`FROM users u`, `FROM users AS u`) — use the actual table name, not the alias.
  - Schema-qualified names (`public.users`, `audit.events`) — store with or without schema prefix consistently.
  - Subqueries contribute additional table references.
- **Analysis Tools**: `@babel/parser` or `acorn` for JS AST; `node-sql-parser` (supports PostgreSQL dialect) for SQL strings; `pgsql-ast-parser` for more accurate PostgreSQL parsing; tree-sitter with SQL grammar.
- **Complexity**: High

---

## 10. mysql2 — Raw SQL

- **Name**: mysql2 (and legacy `mysql`)
- **Type**: Raw SQL / Query Driver
- **Supported Databases**: MySQL, MariaDB, Amazon Aurora (MySQL-compatible)
- **Detection Signals**:
  - `package.json` dependencies: `"mysql2"`, `"mysql"`, `"@types/mysql"`
  - Import: `import mysql from 'mysql2'`, `import mysql from 'mysql2/promise'`, `const mysql = require('mysql2')`
  - Patterns: `connection.query('SQL', params)`, `connection.execute('SQL', params)`, `pool.query('SQL')`
- **Entity Definition Style**: No entity model definitions. See node-postgres entry for the approach.
- **Extraction Approach**: Identical to node-postgres (section 9) — locate query/execute calls, extract SQL strings, parse for table names using a MySQL-dialect SQL parser.
- **Key Challenges**:
  - MySQL uses backtick-quoted identifiers (`` `table_name` ``) — the SQL parser must handle backtick unquoting.
  - Same challenges as node-postgres: template literal interpolations, concatenation, aliases, CTEs.
  - `mysql2/promise` uses the same API; both the promise and callback variants must be detected.
- **Analysis Tools**: `@babel/parser`, `acorn`; `node-sql-parser` with MySQL dialect.
- **Complexity**: High

---

## 11. better-sqlite3 — Raw SQL

- **Name**: better-sqlite3 (and `sqlite3`, `@vscode/sqlite3`, `sql.js`)
- **Type**: Raw SQL / Query Driver
- **Supported Databases**: SQLite
- **Detection Signals**:
  - `package.json` dependencies: `"better-sqlite3"`, `"sqlite3"`, `"@vscode/sqlite3"`, `"sql.js"`, `"@databases/sqlite"`
  - Import: `import Database from 'better-sqlite3'`, `const Database = require('better-sqlite3')`
  - Patterns: `db.prepare('SQL').run()`, `db.prepare('SQL').get()`, `db.prepare('SQL').all()`, `db.exec('SQL')`
- **Entity Definition Style**: No entity model definitions. SQL strings passed to `prepare()` or `exec()`.
- **Extraction Approach**:
  1. Find `db.prepare(sql)`, `db.exec(sql)` call expressions.
  2. Extract SQL string literals from these calls and apply SQL parsing.
  3. `db.exec()` is commonly used for schema setup with `CREATE TABLE` — these are the highest-value targets.
  4. `db.prepare()` is used for parameterized queries — extract table names from the SQL pattern.
- **Key Challenges**:
  - SQLite has more permissive SQL syntax — use a SQLite-specific parser.
  - `db.exec()` often contains multiple SQL statements separated by semicolons; parse each statement separately.
  - SQLite `WITHOUT ROWID` tables and `VIRTUAL TABLE` (FTS, R-Tree) are valid tables.
  - In-memory databases (`:memory:`) have the same API but no persistence.
- **Analysis Tools**: `@babel/parser`, `acorn`; `node-sql-parser` with SQLite dialect; `sql-formatter` (formatting, not parsing).
- **Complexity**: High

---

## 12. Kysely

- **Name**: Kysely
- **Type**: Type-Safe SQL Query Builder
- **Supported Databases**: PostgreSQL, MySQL, SQLite, MS SQL Server, and others via community dialects (Neon, PlanetScale, libSQL/Turso, etc.)
- **Detection Signals**:
  - `package.json` dependency: `"kysely"`
  - Import: `import { Kysely, sql } from 'kysely'`
  - Patterns: `db.selectFrom('tableName')`, `db.insertInto('tableName')`, `db.updateTable('tableName')`, `db.deleteFrom('tableName')`, `db.schema.createTable('tableName')`
  - Type definition file: typically contains a `Database` interface mapping table names to row types
  - Migration files: `*.migration.ts` or files exporting `{ up, down }` functions using `db.schema`
- **Entity Definition Style**: TypeScript interface defines the database structure:
  ```ts
  interface Database {
    users: UsersTable;
    orders: OrdersTable;
  }
  const db = new Kysely<Database>({ dialect });
  ```
  The keys of the `Database` interface are the actual table names. This is the authoritative source.
- **Extraction Approach**:
  1. Find `new Kysely<Database>(...)` or `new Kysely<T>(...)` instantiations. Identify the type argument `T`.
  2. Resolve `T` to an interface definition. The keys of that interface are the table names.
  3. As a fallback: scan all source files for `db.selectFrom('...')`, `db.insertInto('...')`, `db.updateTable('...')`, `db.deleteFrom('...')` — extract the string literal argument from each.
  4. For schema migrations: find `db.schema.createTable('name')` calls — extract the name.
  5. For CamelKysely or `CamelCasePlugin`: table names in the interface may be camelCase while physical names are snake_case; account for the mapping.
- **Key Challenges**:
  - The `Database` interface may be in a separate file (often `src/db/types.ts` or similar) and imported — must follow imports to find the definition.
  - `WithSchemaPlugin` adds schema-qualified table access; `withSchema('public').selectFrom('users')` — extract `users`.
  - `Kysely` can be subclassed or wrapped; `Database` type may not be directly visible.
  - Dynamic table names (rare in Kysely due to its type safety goals, but possible via `sql` template tag).
- **Analysis Tools**: `@typescript-eslint/parser`, `ts-morph` (for interface resolution). For JS usage: `@babel/parser`.
- **Complexity**: Medium

---

## 13. Bookshelf.js

- **Name**: Bookshelf.js
- **Type**: Relational ORM (built on Knex)
- **Supported Databases**: PostgreSQL, MySQL, MariaDB, SQLite (all via Knex)
- **Detection Signals**:
  - `package.json` dependency: `"bookshelf"` (always paired with `"knex"`)
  - Import: `import bookshelf from './bookshelf'`, `const bookshelf = require('./bookshelf')`
  - Pattern: `bookshelf.Model.extend({ tableName: 'users', ... })`
  - Files: `models/*.js`, `*.model.js`
  - Note: Bookshelf.js development has been largely inactive since ~2019; found in legacy codebases
- **Entity Definition Style**:
  - **`Model.extend()`** (primary):
    ```js
    const User = bookshelf.Model.extend({
      tableName: 'users',
      hasTimestamps: true
    });
    ```
  - **ES6 class** (newer style):
    ```js
    class User extends bookshelf.Model {
      get tableName() { return 'users'; }
    }
    ```
- **Extraction Approach**:
  1. Find all `bookshelf.Model.extend({ tableName: '...', ... })` call expressions. Extract the `tableName` property from the object argument.
  2. For ES6 class style: find classes extending a Bookshelf Model base. Look for `get tableName()` getter or `tableName` property returning a string.
  3. Also parse Knex migration files associated with the project (see section 6) for `createTable` calls.
- **Key Challenges**:
  - `tableName` can be a function (for multi-tenancy patterns) rather than a string literal — defeats static analysis.
  - Bookshelf collections (e.g., `bookshelf.Collection.extend({ model: User })`) wrap models but don't define new tables.
  - Legacy plugin usage (`bookshelf-cascade-delete`, etc.) may affect model definitions.
- **Analysis Tools**: `@babel/parser`, `acorn` + `acorn-walk`.
- **Complexity**: Medium

---

## 14. Waterline (Sails.js)

- **Name**: Waterline (Sails.js)
- **Type**: Multi-adapter ORM (Relational / NoSQL)
- **Supported Databases**: MySQL, PostgreSQL, MongoDB, Redis, in-memory, and many others via adapters (`sails-mysql`, `sails-postgresql`, `sails-mongo`, etc.)
- **Detection Signals**:
  - `package.json` dependencies: `"sails"`, `"waterline"`, `"sails-hook-orm"`, `"sails-mysql"`, `"sails-postgresql"`, `"sails-mongo"`
  - Directory: `api/models/` (Sails.js convention for model files)
  - Config: `config/datastores.js` (Sails v1+), `config/connections.js` (Sails v0.12), `config/models.js`
  - Each model file exports a plain object with `attributes`
- **Entity Definition Style**:
  ```js
  // api/models/User.js
  module.exports = {
    tableName: 'users',  // optional; defaults to identity (filename lowercase)
    attributes: {
      name: { type: 'string', required: true },
      email: { type: 'string', isEmail: true }
    }
  };
  ```
  The model's **identity** is the lowercased filename without extension (e.g., `UserProfile.js` → `userprofile`). The `tableName` property overrides the physical table/collection name.
- **Extraction Approach**:
  1. Find the `api/models/` directory.
  2. For each `.js` file, parse the `module.exports` object.
  3. Extract `tableName` if present; otherwise use the lowercased filename (without `.js`) as the identity.
  4. Extract `attributes` for field definitions.
  5. Read `config/datastores.js` to determine the adapter (and thus the database type) for each model's datastore.
  6. Check `config/models.js` for global `tableName` prefix patterns or schema settings.
- **Key Challenges**:
  - Sails.js `migrate: 'safe'` means Waterline does not auto-manage schema — models may exist without corresponding tables being auto-created.
  - Many-to-many (`collection: 'Model', via: 'field', through: 'JoinModel'`) — `through` references a join model file.
  - Waterline supports polymorphic associations (less common).
  - Sails v0 (`connections.js`) vs Sails v1+ (`datastores.js`) — different config file names for the same concept.
- **Analysis Tools**: `@babel/parser`, `acorn` + `acorn-walk` (simple CommonJS module.exports parsing).
- **Complexity**: Low

---

## 15. Firestore (firebase-admin)

- **Name**: Firestore via `firebase-admin` or `@firebase/firestore`
- **Type**: NoSQL (Document / Hierarchical)
- **Supported Databases**: Google Cloud Firestore
- **Detection Signals**:
  - `package.json` dependencies: `"firebase-admin"`, `"firebase"`, `"@firebase/firestore"`, `"@google-cloud/firestore"`
  - Import: `import { getFirestore } from 'firebase-admin/firestore'`, `import admin from 'firebase-admin'`
  - Patterns: `db.collection('users')`, `admin.firestore().collection('users')`, `getFirestore().collection('users')`
  - Config: `firebase.json` at project root
  - Security rules: `firestore.rules`
  - Index config: `firestore.indexes.json`
  - Service account: `serviceAccountKey.json`
- **Entity Definition Style**: Schemaless — no formal entity definition. Collections are addressed by string path at runtime:
  ```js
  const usersRef = db.collection('users');
  const userRef = db.collection('users').doc(userId);
  const postsRef = db.collection('users').doc(userId).collection('posts'); // subcollection
  ```
  Firestore security rules and index files provide structural signals.
- **Extraction Approach**:
  1. **Source code**: Parse all files for `.collection('name')` calls. Extract string literal arguments.
  2. For subcollections, trace chained `.collection()` calls to build collection path hierarchies.
  3. **`firestore.rules`**: Parse the rules file for `match /collectionName/{document=**}` patterns — these enumerate expected top-level and nested collections. This is often the most reliable static source.
  4. **`firestore.indexes.json`**: The `indexes` array contains `collectionGroup` fields naming collections. The `fieldOverrides` array also contains `collectionGroup` references.
  5. **`firebase.json`**: Check for `firestore.rules` and `firestore.indexes` paths to locate the rules and index files.
- **Key Challenges**:
  - Collection paths constructed dynamically (`db.collection(collectionName)` where `collectionName` is a variable).
  - Deeply nested subcollections are hierarchical, not flat tables.
  - Firestore has no enforced schema; documents in the same collection can have entirely different structures.
  - Collection groups allow querying across all subcollections with the same name — the group name is the collection name.
  - Firebase Emulator Suite configs may be present; distinguish from production configs.
- **Analysis Tools**: `@babel/parser`, `acorn`; custom text parser for Firestore Rules (CEL-like language); `js-yaml` / JSON for index config.
- **Complexity**: High

---

## 16. DynamoDB (AWS SDK)

- **Name**: DynamoDB via AWS SDK v2 (`aws-sdk`) or v3 (`@aws-sdk/client-dynamodb`)
- **Type**: NoSQL (Key-Value / Document)
- **Supported Databases**: AWS DynamoDB, DynamoDB Local
- **Detection Signals**:
  - `package.json` dependencies: `"aws-sdk"` (v2), `"@aws-sdk/client-dynamodb"`, `"@aws-sdk/lib-dynamodb"` (v3)
  - Also: `"dynamodb-toolbox"`, `"@aws/dynamodb-data-mapper"`, `"dynamoose"`, `"nestjs-dynamoose"`
  - Import: `import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb'`
  - Patterns: `client.send(new PutItemCommand({ TableName: 'users', ... }))`, `dynamodb.putItem({ TableName: 'users', ... }).promise()`
  - Infrastructure: `serverless.yml`, `template.yaml` (SAM), CDK files (`new Table(...)`), Terraform `.tf` files
- **Entity Definition Style**: No ORM schema in application code. Tables are referenced via `TableName` string in command parameters. Table definitions live in infrastructure-as-code:
  - CloudFormation / SAM: `Type: AWS::DynamoDB::Table` resource
  - AWS CDK: `new dynamodb.Table(this, 'Id', { tableName: 'users', partitionKey: { name: 'id', type: AttributeType.STRING } })`
  - Serverless Framework: `resources.Resources.UsersTable.Type: AWS::DynamoDB::Table`
  - Terraform: `resource "aws_dynamodb_table" "users" { name = "users" ... }`
- **Extraction Approach**:
  1. **Application code**: Parse source files for `TableName` property in object literals passed to DynamoDB commands. Extract string literal values.
  2. **`serverless.yml`**: Parse YAML, find `resources.Resources` section. For each resource with `Type: AWS::DynamoDB::Table`, extract `Properties.TableName`.
  3. **`template.yaml` (SAM/CloudFormation)**: Same as above.
  4. **CDK code**: Find `new Table(this, 'LogicalId', { tableName: '...' })` or `new dynamodb.Table(...)` — extract `tableName` from the options object.
  5. **Terraform**: Look for `resource "aws_dynamodb_table" "name" { name = "..." }` blocks in `.tf` files.
  6. **`dynamodb-toolbox`**: Find `new Table({ name: 'users', ... })` — the `name` property.
  7. **`dynamoose`**: Find `dynamoose.model('users', schema)` — first argument is the table name.
- **Key Challenges**:
  - Table names almost always come from environment variables (`process.env.USERS_TABLE_NAME`) — statically unresolvable without inspecting `.env` or `serverless.yml` environment variables.
  - Multiple tables may be defined in separate CloudFormation stack files or separate CDK constructs.
  - DynamoDB single-table design pattern: all entities share one table, distinguished by partition key prefixes. Detection must rely on application logic, not just the table name.
  - `dynamodb-toolbox` Entity class (`new Entity({ name: 'User', table, ... })`) defines logical entity types within a DynamoDB table — not new tables.
- **Analysis Tools**: `@babel/parser`, `acorn`; `js-yaml` for serverless/CloudFormation YAML; `@typescript-eslint/parser` for CDK TypeScript.
- **Complexity**: High

---

## 17. Redis (ioredis / node-redis)

- **Name**: Redis via `ioredis` or `node-redis` (`redis`)
- **Type**: Key-Value / Cache / Pub-Sub / Sorted Set Store
- **Supported Databases**: Redis, Redis Stack (with modules), Valkey, KeyDB, AWS ElastiCache (Redis), Upstash Redis
- **Detection Signals**:
  - `package.json` dependencies: `"ioredis"`, `"redis"`, `"@redis/client"`, `"redis-om"`, `"bull"`, `"bullmq"`, `"@bull-board/api"`, `"ioredis-mock"`
  - Import: `import Redis from 'ioredis'`, `import { createClient } from 'redis'`
  - Patterns: `redis.set('key', value)`, `redis.hset('hashKey', ...)`, `redis.zadd('sortedSetKey', ...)`, `client.set('key', value)`
- **Entity Definition Style**: No formal schema. "Entities" in Redis are inferred from key naming patterns. Higher-level libraries add schema:
  - **`redis-om`**: `new Schema(User, { name: { type: 'string' } }, { dataStructure: 'HASH' })` — the class name and schema define an entity.
  - **BullMQ / Bull**: `new Queue('emailQueue', { connection })` — queue name is the entity identifier.
  - **ioredis cluster**: same API; no new entity definition mechanism.
- **Extraction Approach**:
  1. **Raw Redis**: Extract string literal arguments to `redis.set(key, ...)`, `redis.get(key)`, `redis.hset(key, ...)`, etc. Identify key naming patterns/prefixes (e.g., `'user:' + id` → `user` namespace; `session:${sessionId}` → `session`).
  2. **`redis-om`**: Find `new Schema(ClassName, { ... }, { dataStructure: '...' })` — the first argument (class or class name string) and schema define an entity.
  3. **BullMQ / Bull**: Find `new Queue('queueName', ...)`, `new Worker('queueName', ...)` — extract the queue name string.
  4. **Key prefix analysis**: Collect all Redis key string constants. Group by common prefixes (split on `:`, `-`, `_`) to identify entity namespaces.
- **Key Challenges**:
  - Redis is schemaless; "entities" are an application-level concept inferred from key patterns.
  - Key names with dynamic parts (user IDs, timestamps) obscure the base entity type.
  - Redis is typically a caching layer on top of a primary database — its "entities" may duplicate those found in the ORM.
  - `SCAN` / `KEYS` patterns like `user:*` hint at key namespaces but are dynamic.
- **Analysis Tools**: `@babel/parser`, `acorn`.
- **Complexity**: High (for key namespace extraction) / Low (for BullMQ queue names, redis-om schemas)

---

## 18. Elasticsearch (Official Client)

- **Name**: Elasticsearch Official JavaScript Client (`@elastic/elasticsearch`)
- **Type**: Search Engine / Document Store
- **Supported Databases**: Elasticsearch, OpenSearch (via `@opensearch-project/opensearch`)
- **Detection Signals**:
  - `package.json` dependencies: `"@elastic/elasticsearch"`, `"@opensearch-project/opensearch"`, `"elasticsearch"` (legacy v6 client)
  - Import: `import { Client } from '@elastic/elasticsearch'`
  - Patterns: `client.index({ index: 'products', ... })`, `client.search({ index: 'products', ... })`, `client.indices.create({ index: 'products', ... })`
  - Mapping files: JSON files in `mappings/`, `elasticsearch/`, `config/es/`, or similar
- **Entity Definition Style**: No ORM schema in code. Indices are addressed by string name in API call objects. Index mappings (defining field types) may be stored in separate JSON files and applied programmatically:
  ```js
  await client.indices.create({
    index: 'products',
    body: {
      mappings: { properties: { name: { type: 'text' }, price: { type: 'float' } } }
    }
  });
  ```
- **Extraction Approach**:
  1. Parse source files for Elasticsearch client method calls. Extract the `index` property string from the call argument object for: `client.index(...)`, `client.search(...)`, `client.get(...)`, `client.update(...)`, `client.delete(...)`, `client.indices.create(...)`, `client.indices.putMapping(...)`.
  2. Also check `client.indices.putAlias({ index: '...', name: '...' })` — both the underlying index and the alias may be relevant.
  3. Search for JSON mapping definition files (`*-mapping.json`, `*-settings.json`, `*-index.json`) and parse their top-level structure for index names.
  4. Check for index template creation: `client.indices.putIndexTemplate({ name: 'template_name', body: { index_patterns: ['logs-*'] } })`.
- **Key Challenges**:
  - Index names often include version suffixes or environment prefixes (e.g., `products_v2`, `dev_users`) — normalize if needed.
  - Wildcard index patterns in search calls (`users_*`) represent multiple indices, not a single entity.
  - Index aliases allow multiple indices to share a name — the logical entity is the alias, not the backing index.
  - Index templates define mappings for dynamically created indices (e.g., time-series indices) — the pattern (not the name) is the entity descriptor.
  - Data streams (`client.indices.createDataStream({ name: 'logs-app' })`) are a newer concept distinct from regular indices.
- **Analysis Tools**: `@babel/parser`, `acorn`.
- **Complexity**: Medium

---

## 19. Hasura Migration Files

- **Name**: Hasura (Hasura Console / Hasura CLI migrations)
- **Type**: GraphQL Engine / Migration Tool
- **Supported Databases**: PostgreSQL, MySQL, MS SQL Server, BigQuery, Snowflake, MongoDB (via Data Connectors)
- **Detection Signals**:
  - Directory: `hasura/` at project root, or `hasura-backend/`, `backend/hasura/`
  - Config file: `hasura/config.yaml` containing `version`, `endpoint`, `admin_secret` (or env var refs)
  - Migration directory: `hasura/migrations/<database_name>/` (e.g., `hasura/migrations/default/`)
  - Each migration is a timestamped directory containing `up.sql` and optionally `down.sql`
  - Metadata directory: `hasura/metadata/` (v2 format) or `hasura/metadata/databases/` (v3 format)
  - Table metadata: `hasura/metadata/databases/<db_name>/tables/` — one YAML file per tracked table
  - Consolidated tables: `hasura/metadata/databases/<db_name>/tables/tables.yaml` listing all tracked tables
- **Entity Definition Style**: SQL migration files (`up.sql`) with `CREATE TABLE` DDL. Metadata YAML files enumerate tracked tables with their relationships, computed fields, permissions, and event triggers.
- **Extraction Approach**:
  1. **Metadata (most reliable)**: Parse `hasura/metadata/databases/*/tables/tables.yaml`. Each entry contains `table.schema` and `table.name` — these are the tracked database entities.
  2. **Per-table metadata files**: In newer Hasura CLI format, each `hasura/metadata/databases/<db>/tables/<schema>_<table>.yaml` file represents one tracked table.
  3. **Migration SQL**: Parse `up.sql` files in all migration directories for `CREATE TABLE` statements.
  4. Cross-reference metadata and migration sources to build the complete entity list.
  5. Filter out `hasura_` prefixed tables (Hasura internal tables) if needed.
- **Key Challenges**:
  - Hasura can track **views** and custom function return types as queryable entities — metadata files do not distinguish tables from views without additional inspection.
  - Remote relationships reference external services (other databases, REST, GraphQL) — these are not local tables.
  - Multi-database setups have separate metadata trees per database source.
  - Hasura actions and custom types (`custom_types` in metadata) define GraphQL types that may not correspond to database tables.
- **Analysis Tools**: `js-yaml` for metadata YAML; `node-sql-parser` or `pgsql-ast-parser` for migration SQL.
- **Complexity**: Low

---

## 20. Database Migration Files

- **Name**: Database Migration Tools: `db-migrate`, `node-pg-migrate`, `umzug`, Flyway (used with JS)
- **Type**: Migration Tool / Schema Evolution
- **Supported Databases**: PostgreSQL, MySQL, MariaDB, SQLite, SQL Server, Oracle (varies by tool)
- **Detection Signals**:
  - `package.json` dependencies: `"db-migrate"`, `"db-migrate-pg"`, `"db-migrate-mysql"`, `"db-migrate-sqlite3"`, `"node-pg-migrate"`, `"umzug"`, `"@umzug/core"`, `"@umzug/sequelize"`, `"@umzug/mongoose"`
  - Config files: `database.json` (db-migrate), `node-pg-migrate` configuration via env vars
  - Migration directories: `migrations/`, `db/migrations/`, `database/migrations/`
  - Flyway (JS projects): `db/migration/` with `V<version>__<description>.sql` file naming convention
  - Flyway config: `flyway.conf`, `flyway.toml`
  - Scripts in `package.json`: `migrate`, `db:migrate`, `db-migrate up`
- **Entity Definition Style**:
  - **db-migrate**: JS migration files with `exports.up` and `exports.down` using the `db` object:
    ```js
    exports.up = (db, callback) => db.createTable('users', { id: { type: 'int', primaryKey: true }, email: 'string' }, callback);
    exports.down = (db, callback) => db.dropTable('users', callback);
    ```
  - **node-pg-migrate**: JS/TS files with exported `up` and `down` functions using the `pgm` object:
    ```js
    exports.up = (pgm) => { pgm.createTable('users', { id: 'id', email: { type: 'varchar', notNull: true } }); };
    ```
  - **umzug**: Framework-agnostic; migration files export `up` and `down` functions that call the underlying ORM/query client (commonly Sequelize's `queryInterface.createTable('name', attrs)`).
  - **Flyway**: Pure SQL migration files (`V1__Create_users_table.sql`).
- **Extraction Approach**:
  1. **db-migrate**: Find all migration files. Parse for `db.createTable('name', ...)` calls — extract the first argument.
  2. **node-pg-migrate**: Parse for `pgm.createTable('name', ...)` — extract the first argument. Also `pgm.renameTable('old', 'new')` for rename tracking.
  3. **umzug (with Sequelize)**: Parse for `queryInterface.createTable('name', attrs)` — extract the first argument.
  4. **Flyway SQL**: Parse all `V*.sql` files for `CREATE TABLE` statements using a SQL parser.
  5. Sort all migration files by version/timestamp. Apply `createTable` additions and `dropTable` / `renameTable` changes chronologically to determine the final table state.
- **Key Challenges**:
  - `downTable` in down migrations complicates final-state analysis — a table dropped in down but created in up is present in the current state.
  - `renameTable('old', 'new')` — must track the current name across all subsequent migrations.
  - Conditional logic in migrations (`if (await tableExists) { ... }`) requires control flow analysis.
  - Migrations may create temporary tables (used for data transformation) that are later dropped.
  - SQL within migration JS files (via raw `db.runSql('CREATE TABLE ...')`) requires nested SQL parsing.
  - db-migrate v0.x and v1.x have slightly different API signatures.
- **Analysis Tools**: `@babel/parser`, `acorn`; `node-sql-parser` for SQL within migrations; `js-yaml` for any YAML-based migration configs.
- **Complexity**: Medium

---

## 21. Raw SQL Files

- **Name**: Raw SQL Files (standalone DDL / schema files)
- **Type**: Raw SQL / Schema Definition
- **Supported Databases**: Any relational database
- **Detection Signals**:
  - Files: `*.sql`, `schema.sql`, `init.sql`, `seed.sql`, `create_tables.sql`, `ddl.sql`, `structure.sql`
  - Directories: `sql/`, `db/`, `database/`, `scripts/`, `migrations/`, `supabase/migrations/`
  - Referenced in `package.json` scripts or Makefiles: `psql -f schema.sql`, `sqlite3 db.sqlite < schema.sql`
  - Docker Compose: SQL files mounted to `/docker-entrypoint-initdb.d/` in DB service volumes
  - Supabase: `supabase/migrations/*.sql` (Supabase CLI migration format)
- **Entity Definition Style**: Standard SQL DDL:
  ```sql
  CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT NOW()
  );
  ```
- **Extraction Approach**:
  1. Glob for all `*.sql` files in the repository, excluding `node_modules/` and build directories.
  2. Parse each file with a SQL parser. Extract:
     - `CREATE TABLE [IF NOT EXISTS] [schema.]table_name (...)` — extract `table_name` (and optional schema prefix)
     - `CREATE TABLE [IF NOT EXISTS] [schema.]table_name AS SELECT ...` — CTAS; extract `table_name`
     - `CREATE VIEW [schema.]view_name AS SELECT ...` — mark as view if distinguishing tables from views
  3. Handle schema-qualified names (`public.users` → entity `users` in schema `public`).
  4. Handle database-specific identifier quoting:
     - PostgreSQL: `"table_name"` (double quotes)
     - MySQL: `` `table_name` `` (backticks)
     - SQLite: both styles supported
  5. Exclude `TEMPORARY` / `TEMP` tables if they represent intermediate processing state rather than persistent entities.
- **Key Challenges**:
  - Database-specific SQL syntax variations require a dialect-aware parser.
  - Stored procedures and functions may contain `CREATE TEMP TABLE` or `CREATE TABLE` for intermediate results — distinguish from persistent schema.
  - Comments containing `CREATE TABLE` strings cause false positives with regex; use a proper SQL parser.
  - `CREATE TABLE ... LIKE other_table` creates a table based on another; track the new name.
  - Supabase projects have RLS policy SQL alongside table DDL — the DDL is still parseable.
- **Analysis Tools**: `node-sql-parser` (multi-dialect: MySQL, PostgreSQL, SQLite, MariaDB, Hive, Snowflake); `pgsql-ast-parser` (PostgreSQL only, more accurate); custom regex as a fallback for simple cases.
- **Complexity**: Low (with a proper SQL parser) / Medium (with complex SQL or stored procedures)

---

## 22. GraphQL Schema as Entity Signal

- **Name**: GraphQL Schema (SDL files, Nexus, type-graphql, Pothos, Apollo, Yoga)
- **Type**: API Schema Layer / Entity Signal
- **Supported Databases**: Any (GraphQL is database-agnostic)
- **Detection Signals**:
  - `package.json` dependencies: `"graphql"`, `"@nestjs/graphql"`, `"nexus"`, `"type-graphql"`, `"@pothos/core"`, `"apollo-server"`, `"apollo-server-express"`, `"@apollo/server"`, `"graphql-yoga"`, `"mercurius"`, `"strawberry-graphql"` (Python, not JS)
  - Schema files: `*.graphql`, `*.gql`, `schema.graphql`, `typeDefs.ts`
  - Generated files: `nexus-typegen.ts`, `schema.gen.ts`, `generated/schema.graphql`
  - Import: `import { gql } from 'graphql-tag'`, `import { buildSchema } from 'graphql'`
  - NestJS: `@Resolver()`, `@ObjectType()`, `@Field()` decorators from `@nestjs/graphql`
  - type-graphql: `@ObjectType()`, `@Resolver()` from `type-graphql`
  - Nexus: `objectType({ name: 'User', definition(t) { ... } })`
  - Pothos: `builder.objectType('User', { ... })`
- **Entity Definition Style**:
  - **SDL (Schema Definition Language)**: `type User { id: ID! email: String! posts: [Post!]! }` in `.graphql` or `.gql` files.
  - **type-graphql**: `@ObjectType() class User { @Field() id: number; @Field() email: string; }` — class name is the type name.
  - **Nexus**: `const User = objectType({ name: 'User', definition(t) { t.nonNull.string('email') } })`.
  - **Pothos**: `builder.objectType('User', { fields: (t) => ({ id: t.id({}), email: t.string({}) }) })`.
  - **`gql` tagged template literals**: `const typeDefs = gql\`type User { ... }\`` — inline SDL in JS/TS files.
- **Extraction Approach**:
  1. **SDL files**: Parse all `*.graphql` and `*.gql` files with the `graphql` package's `parse()` function. Extract all `ObjectTypeDefinition` nodes (type names). Exclude `Query`, `Mutation`, `Subscription`, `PageInfo`, `Error*`, and common utility types.
  2. **`gql` tagged templates**: Find all `` gql`...` `` tagged template literals in JS/TS files. Extract the template content and parse as SDL.
  3. **type-graphql**: Find classes decorated with `@ObjectType()`. The class name (or the `name` option in `@ObjectType({ name: 'User' })`) is the type name.
  4. **Nexus**: Find `objectType({ name: '...', ... })` calls — extract the `name` string.
  5. **Pothos**: Find `builder.objectType('TypeName', ...)` — extract the first string argument.
  6. Cross-reference GraphQL type names with ORM entity/model names for confirmation that these represent database entities.
- **Key Challenges**:
  - GraphQL types include non-entity types: input types (`UserInput`), pagination wrappers (`UserConnection`, `UserEdge`), union types, interfaces, error types — these should be filtered.
  - GraphQL type names may differ from database table names (e.g., `ProductListing` → `product_listings`).
  - Federated GraphQL schemas may pull types from multiple subgraphs; use the `@key` directive as a signal that a type is an entity (Apollo Federation).
  - Generated schema files may be stale — prefer source-of-truth (SDL files or code-first definitions).
  - Interface types in GraphQL may correspond to abstract entities without direct table representations.
- **Analysis Tools**: `graphql` package (`parse()`, `buildSchema()`) for SDL; `@typescript-eslint/parser` for code-first patterns; `@babel/parser` for JS files with `gql` tags.
- **Complexity**: Medium

---

## 23. Zod Schemas as Entity Signals

- **Name**: Zod
- **Type**: Runtime Validation Library / Entity Signal (secondary)
- **Supported Databases**: Any (Zod is database-agnostic)
- **Detection Signals**:
  - `package.json` dependency: `"zod"`
  - Import: `import { z } from 'zod'`, `import z from 'zod'`
  - Patterns: `z.object({ ... })`, `z.string()`, `z.number()`, `z.infer<typeof UserSchema>`
  - File conventions: `*.schema.ts`, `*.validator.ts`, `*.dto.ts`, `src/schemas/`
  - Integration packages: `"drizzle-zod"`, `"zod-prisma"`, `"zod-prisma-types"`, `"@anatine/zod-nestjs"`, `"nestjs-zod"` — these **generate** Zod schemas from ORM models; in these cases the ORM model is the authoritative source
- **Entity Definition Style**:
  ```ts
  export const UserSchema = z.object({
    id: z.number(),
    email: z.string().email(),
    name: z.string().optional(),
  });
  export type User = z.infer<typeof UserSchema>;
  ```
  The exported variable name is the entity signal.
- **Extraction Approach**:
  1. Find all exported variables assigned `z.object(...)` expressions.
  2. The variable name is the entity name signal. Apply naming convention heuristics:
     - Strip suffixes: `Schema`, `Dto`, `Model`, `Validator`, `Input`, `Output`, `Response`, `Request` → remaining stem is the potential entity name.
     - Prefer names that match known ORM entity names.
  3. Cross-reference Zod schema names with database access code (ORM model names, query table names) to confirm they represent database entities rather than DTOs.
  4. For integration libraries (`drizzle-zod`, `zod-prisma`): locate the ORM schema (Drizzle/Prisma) as the authoritative source; the generated Zod schemas are derivatives.
- **Key Challenges**:
  - Zod is heavily used for API input/output validation, configuration schemas, environment variable validation, and form schemas — the vast majority of Zod schemas are **not** database entity definitions.
  - High false-positive rate without cross-referencing.
  - `z.object({}).extend({})`, `.merge()`, `.partial()`, `.pick()` create derived schemas whose names may differ from the base entity.
  - `z.discriminatedUnion(...)` defines union types, not tables.
- **Analysis Tools**: `@typescript-eslint/parser`, `@babel/parser`.
- **Complexity**: High (low signal-to-noise ratio without ORM cross-referencing)

---

## 24. class-validator Decorated Classes

- **Name**: class-validator + class-transformer
- **Type**: Validation Library / Entity Signal (secondary)
- **Supported Databases**: Any (library is database-agnostic)
- **Detection Signals**:
  - `package.json` dependencies: `"class-validator"`, `"class-transformer"`
  - Import: `import { IsString, IsEmail, IsNumber, IsNotEmpty, IsOptional } from 'class-validator'`
  - Pattern: Classes with property decorators like `@IsString()`, `@IsEmail()`, `@IsInt()`, `@IsNotEmpty()`
  - Often co-located with ORM decorators: `@Entity()` (TypeORM), `@Schema()` (Mongoose), `@ObjectType()` (GraphQL)
  - Common in NestJS projects where DTOs use class-validator extensively
- **Entity Definition Style**:
  ```ts
  export class CreateUserDto {
    @IsEmail()
    email: string;

    @IsString()
    @IsNotEmpty()
    name: string;
  }
  ```
- **Extraction Approach**:
  1. Find classes that import from `class-validator` and apply validation decorators on properties.
  2. Cross-reference: if the class **also** has ORM decorators (`@Entity()`, `@Schema()`, etc.), it is a confirmed database entity.
  3. If the class **only** has `class-validator` decorators, treat as a weak signal — likely a DTO.
  4. Naming heuristics:
     - Classes named `*Entity`, `*Model`, `*Document`, `*Record` → stronger entity signal.
     - Classes named `*Dto`, `*Input`, `*Request`, `*Response`, `*Payload` → DTO signal, likely not a direct entity.
  5. In NestJS: DTOs in `src/*/dto/` directories are rarely database entities; entities in `src/*/entities/` are.
- **Key Challenges**:
  - NestJS projects use class-validator heavily for DTO validation; these are request/response shapes, not database tables.
  - A single class may serve as both a DTO and a database entity (anti-pattern but it happens).
  - `class-transformer` `@Transform()` and `@Exclude()` decorators appear alongside `class-validator` but provide no entity signal themselves.
- **Analysis Tools**: `@typescript-eslint/parser`, `@babel/parser`.
- **Complexity**: High (without ORM cross-referencing)

---

## 25. OpenAPI Schemas as Entity Signals

- **Name**: OpenAPI / Swagger Schemas
- **Type**: API Specification / Entity Signal (secondary)
- **Supported Databases**: Any (database-agnostic)
- **Detection Signals**:
  - Files: `openapi.json`, `openapi.yaml`, `openapi.yml`, `swagger.json`, `swagger.yaml`, `swagger.yml`, `api.yaml`, `api-spec.yaml`, `*.oas.yaml`, `*.oas.json`
  - Directories: `docs/api/`, `api/`, `spec/`, `openapi/`
  - `package.json` dependencies: `"swagger-jsdoc"`, `"swagger-ui-express"`, `"@nestjs/swagger"`, `"fastify-swagger"`, `"@fastify/swagger"`, `"express-openapi"`, `"openapi-backend"`, `"@hapi/hapi"` + `"hapi-swagger"`
  - NestJS: `@ApiProperty()`, `@ApiTags()`, `@ApiSchema()` decorators from `@nestjs/swagger`
  - JSDoc annotations: `@swagger` or `@openapi` comments above route handlers
- **Entity Definition Style**:
  - **OpenAPI 3.x**: `components.schemas.<EntityName>` with `type: object` and `properties`.
  - **Swagger 2.x**: `definitions.<EntityName>`.
  - **NestJS `@ApiProperty()`**: Metadata on DTO/entity class properties that generates OpenAPI spec.
  - **`swagger-jsdoc`**: JSDoc comments with YAML/JSON swagger spec fragments.
- **Extraction Approach**:
  1. Locate OpenAPI spec files via glob (`openapi.{json,yaml,yml}`, `swagger.{json,yaml,yml}`).
  2. Parse with `js-yaml` (YAML) or `JSON.parse` (JSON). Navigate to `components.schemas` (OpenAPI 3.x) or `definitions` (Swagger 2.x).
  3. Extract all keys whose schema has `type: object` and at least one property. Each key is a potential entity name.
  4. Filter common non-entity schemas: pagination wrappers (`*Page`, `*List`, `*Response`), error schemas (`Error`, `ApiError`, `ValidationError`), generic wrappers (`ApiResponse<T>`).
  5. For NestJS `@ApiProperty()`: classes decorated with `@ApiProperty()` where those classes also have ORM decorators are confirmed entities. Cross-reference with TypeORM/Mongoose entity scanning.
  6. For `swagger-jsdoc`: find JSDoc blocks with `@swagger` or `@openapi` annotations in source files; parse the YAML fragment within.
- **Key Challenges**:
  - OpenAPI schemas include many non-entity types — request bodies, response envelopes, error types, pagination types.
  - Schema names may use different conventions than database table names (e.g., `UserResponse` vs. `users` table).
  - Code-generated OpenAPI specs (from decorators or runtime introspection) may be stale or absent in the repository.
  - Swagger 2.x `definitions` and OpenAPI 3.x `components.schemas` have different paths.
  - `$ref` resolution: schemas may reference other schemas with `$ref: '#/components/schemas/User'` — dereference for complete analysis.
- **Analysis Tools**: `js-yaml`; `JSON.parse`; `@apidevtools/swagger-parser` for full $ref resolution; `@typescript-eslint/parser` for NestJS decorator analysis.
- **Complexity**: High (without ORM cross-referencing) / Medium (when combined with ORM entity list)

---

## 26. NestJS Patterns

- **Name**: NestJS (framework integration and conventions)
- **Type**: Framework Convention / Entity Signal Amplifier
- **Supported Databases**: Depends on the ORM module used (TypeORM, Prisma, Mongoose, Sequelize, MikroORM)
- **Detection Signals**:
  - `package.json` dependencies: `"@nestjs/core"`, `"@nestjs/common"`, `"@nestjs/typeorm"`, `"@nestjs/mongoose"`, `"@nestjs/sequelize"`, `"@nestjs/prisma"` (community), `"@mikro-orm/nestjs"`
  - Directory conventions:
    - `src/modules/<domain>/entities/*.entity.ts` (TypeORM)
    - `src/modules/<domain>/schemas/*.schema.ts` (Mongoose)
    - `src/<domain>/<domain>.entity.ts`
  - Module files: `*.module.ts` — contain `imports` array with ORM feature module declarations
  - Controller files: `*.controller.ts`
  - Service files: `*.service.ts` — often inject repositories
- **Entity Definition Style**: NestJS itself does not define entities — it wires ORM-specific entity definitions into dependency injection modules. The module files are structural signals.
- **Extraction Approach**:
  1. Detect NestJS from `@nestjs/core` in `package.json` dependencies.
  2. Determine the ORM in use from `@nestjs/typeorm`, `@nestjs/mongoose`, `@nestjs/sequelize`, etc.
  3. Scan `*.module.ts` files for ORM feature module declarations:
     - **TypeORM**: `TypeOrmModule.forFeature([UserEntity, OrderEntity])` — extract class names from the array; these are entity classes.
     - **Mongoose**: `MongooseModule.forFeature([{ name: 'User', schema: UserSchema }, { name: 'Order', schema: OrderSchema }])` — extract the `name` strings.
     - **Sequelize**: `SequelizeModule.forFeature([User, Order])` — extract class names from the array.
     - **Prisma**: `PrismaModule` (community) or direct `PrismaService` injection — refer to `prisma/schema.prisma` for entities.
  4. Follow the referenced entity class names to their definition files (typically `*.entity.ts`).
  5. Check `@InjectRepository(UserEntity)` in services — confirms which entities are used.
  6. File naming convention: `*.entity.ts` → TypeORM entity; `*.schema.ts` → Mongoose schema; `*.model.ts` → varies.
- **Key Challenges**:
  - `TypeOrmModule.forRootAsync(...)` and `MongooseModule.forRootAsync(...)` read database config dynamically (from `ConfigService`) — the entity list is still in `forFeature()` calls.
  - NestJS multi-database support: `TypeOrmModule.forFeature([...], 'secondary')` — the second argument is the connection name; entities belong to a specific connection.
  - Entities spread across many feature modules require scanning all module files.
  - NestJS micro-services can use different transport mechanisms; repositories in micro-services still use ORMs.
  - Barrel files (`index.ts`) re-exporting entities can complicate import tracing.
- **Analysis Tools**: `@typescript-eslint/parser` (TypeScript is standard in NestJS); `ts-morph` for import resolution.
- **Complexity**: Medium (NestJS conventions narrow the search space; ORM-specific complexity applies underneath)

---

## 27. Repository Detection Plan

Given an arbitrary JavaScript/TypeScript repository, use the following ordered strategy to determine which data storage approaches are in use and extract entity names with confidence scoring.

---

### Phase 1: Dependency Analysis (Highest Signal, Lowest Cost)

Parse `package.json` `dependencies` and `devDependencies`. Map known package names to approaches:

| Package Name(s) | Approach |
|---|---|
| `prisma`, `@prisma/client` | Prisma |
| `typeorm` | TypeORM |
| `sequelize`, `sequelize-typescript`, `sequelize-cli` | Sequelize |
| `drizzle-orm`, `drizzle-kit` | Drizzle ORM |
| `@mikro-orm/core` | MikroORM |
| `objection` | Objection.js (also check for `knex`) |
| `knex` | Knex (migrations / query builder) |
| `mongoose` | Mongoose |
| `mongodb` | MongoDB Native Driver |
| `pg`, `pg-pool`, `pg-native` | node-postgres (raw SQL) |
| `mysql2`, `mysql` | mysql2 (raw SQL) |
| `better-sqlite3`, `sqlite3`, `sql.js` | SQLite raw |
| `kysely` | Kysely |
| `bookshelf` | Bookshelf.js |
| `sails`, `waterline`, `sails-hook-orm` | Waterline / Sails.js |
| `firebase-admin`, `firebase`, `@firebase/firestore` | Firestore |
| `@aws-sdk/client-dynamodb`, `aws-sdk`, `dynamoose`, `dynamodb-toolbox` | DynamoDB |
| `ioredis`, `redis`, `@redis/client` | Redis |
| `@elastic/elasticsearch`, `elasticsearch` | Elasticsearch |
| `@nestjs/core` | NestJS (check sub-packages for ORM) |
| `@nestjs/typeorm` | NestJS + TypeORM |
| `@nestjs/mongoose` | NestJS + Mongoose |
| `@nestjs/sequelize` | NestJS + Sequelize |
| `@mikro-orm/nestjs` | NestJS + MikroORM |
| `db-migrate`, `db-migrate-pg` | db-migrate |
| `node-pg-migrate` | node-pg-migrate |
| `umzug`, `@umzug/core` | Umzug |
| `nexus`, `type-graphql`, `@pothos/core` | GraphQL (code-first) |
| `graphql` | GraphQL (check for SDL files) |
| `zod` | Zod schemas (secondary signal) |
| `class-validator` | class-validator (secondary signal) |
| `@nestjs/swagger`, `swagger-jsdoc` | OpenAPI/Swagger (secondary signal) |
| `bull`, `bullmq` | BullMQ queue names (Redis-based) |

---

### Phase 2: File System Signals (High Confidence)

Perform recursive glob searches for canonical file/directory patterns:

```
# Prisma
prisma/schema.prisma
**/*.prisma

# TypeORM
ormconfig.{json,js,ts,yaml,yml,env}
data-source.{ts,js}
src/**/*.entity.ts
src/**/*.entity.js

# Drizzle
drizzle.config.{ts,js,cjs}
drizzle/**/*.sql

# MikroORM
mikro-orm.config.{ts,js,json}

# Sequelize
.sequelizerc
config/config.{json,js}

# Knex
knexfile.{js,ts,cjs,mjs}

# Sails / Waterline
api/models/*.js
config/datastores.js
config/connections.js

# Hasura
hasura/config.yaml
hasura/metadata/databases/*/tables/tables.yaml
hasura/migrations/**/*.sql

# Firebase / Firestore
firebase.json
firestore.rules
firestore.indexes.json

# Migrations (general)
migrations/*.{js,ts,sql}
db/migrations/*.{js,ts,sql}
database/migrations/*.{js,ts,sql}
supabase/migrations/*.sql

# Flyway
db/migration/V*.sql
**/V[0-9]*.sql

# Raw SQL
**/*.sql

# GraphQL SDL
**/*.graphql
**/*.gql

# OpenAPI
openapi.{json,yaml,yml}
swagger.{json,yaml,yml}
api-spec.{yaml,yml,json}
```

---

### Phase 3: Import Pattern Scanning (Medium Confidence)

For repos where Phase 1/2 are incomplete, grep source files for import patterns:

```
/from ['"]typeorm['"]/
/from ['"]sequelize['"]/
/from ['"]mongoose['"]/
/from ['"]drizzle-orm\//
/from ['"]@mikro-orm\//
/from ['"]objection['"]/
/from ['"]kysely['"]/
/from ['"]firebase-admin\//
/from ['"]@aws-sdk\/client-dynamodb['"]/
/from ['"]@elastic\/elasticsearch['"]/
/require\(['"]mongoose['"]\)/
/require\(['"]pg['"]\)/
/require\(['"]mysql2['"]\)/
/require\(['"]better-sqlite3['"]\)/
```

---

### Phase 4: Entity Extraction (Per-Approach)

Apply the extraction strategy for each detected approach:

| Approach | Extraction Target | Expected Accuracy |
|---|---|---|
| Prisma | `*.prisma` model blocks | High |
| TypeORM | `@Entity()` decorators | High |
| Drizzle ORM | `pgTable()/mysqlTable()/sqliteTable()` calls | High |
| MikroORM | `@Entity()` decorators / `EntitySchema` | High |
| Mongoose | `mongoose.model()` calls | High |
| Sequelize | `Model.init()` / `sequelize.define()` | High |
| Waterline / Sails | `api/models/*.js` filenames + `tableName` | High |
| Knex migrations | `createTable()` calls in migrations | Medium-High |
| node-pg-migrate | `pgm.createTable()` calls | Medium-High |
| db-migrate | `db.createTable()` calls | Medium-High |
| Hasura metadata | `tables.yaml` | High |
| Raw SQL files | `CREATE TABLE` statements | Medium-High |
| Kysely | `Database` interface keys + `createTable()` | Medium |
| Bookshelf.js | `.extend({ tableName })` / class `get tableName()` | Medium |
| MongoDB Native | `.collection('name')` string literals | Medium |
| DynamoDB | `TableName` literals + infra-as-code | Medium |
| Firestore | `firestore.rules` + `.collection()` strings | Medium |
| Elasticsearch | `index` property in client calls | Medium |
| Redis | Queue names (BullMQ) / redis-om Schema | Low-Medium |
| GraphQL SDL | `type` definitions cross-referenced with ORM | Low-Medium |
| OpenAPI schemas | `components.schemas` cross-referenced with ORM | Low-Medium |
| Zod schemas | Exported `z.object()` names — supplementary only | Low |
| class-validator | Co-located with ORM decorators only | Low |

---

### Phase 5: Cross-Validation and Deduplication

1. **Normalize names**: Convert all entity/table names to a canonical form (lowercase, replace `-` and spaces with `_`) for comparison.
2. **De-duplicate**: `User` (TypeORM entity), `users` (migration `createTable`), `users` (raw SQL `CREATE TABLE`) → all resolve to the same entity.
3. **Cross-reference**: ORM entity names should match migration-created table names. Discrepancies indicate either a naming convention difference or a migration not yet applied.
4. **Assign confidence levels**:
   - **Confirmed** (multiple independent signals): entity appears in schema file + migration file, or ORM decorator + module registration.
   - **Probable** (single high-confidence signal): entity in Prisma schema, TypeORM decorator, or Drizzle schema.
   - **Inferred** (single low-confidence signal): entity inferred from raw SQL strings, GraphQL types, or Zod schema names.
5. **Flag edge cases**: STI inheritance (multiple entity classes, one table), discriminated unions (one collection, multiple types), abstract base entities (no table), views vs. tables.

---

### Recommended Tooling Stack

| Task | Recommended Tool |
|---|---|
| JavaScript AST parsing | `@babel/parser` (with `@babel/traverse`) |
| TypeScript AST parsing | `@typescript-eslint/parser` or `ts-morph` |
| SQL parsing | `node-sql-parser` (multi-dialect) |
| PostgreSQL SQL parsing | `pgsql-ast-parser` |
| GraphQL SDL parsing | `graphql` package (`parse()`) |
| YAML parsing | `js-yaml` |
| JSON parsing | Native `JSON.parse` |
| File globbing | `fast-glob` |
| Prisma schema parsing | `@prisma/internals` (`getDMMF()`) |
| Tree-sitter (generic) | `tree-sitter` + language grammars |
| $ref resolution (OpenAPI) | `@apidevtools/swagger-parser` |
