# Data Entity Storage Methods in TypeScript

**Purpose**: This document catalogs every significant data entity storage framework, library, and approach used in TypeScript projects. It is a complete standalone reference for automated static analysis of TypeScript repositories to extract data entities (database tables, document collections, etc.).

**Relationship to JavaScript document**: TypeScript projects use all the same frameworks as JavaScript projects, often with additional type information that makes static analysis easier. This document covers TypeScript-specific considerations for each framework, notes which frameworks are TypeScript-native vs. JavaScript libraries with type definitions added, and extends the analysis approaches to take advantage of TypeScript's type system. See also the [JavaScript companion document](../javascript/data-entity-storage-methods.md) for the full base-level coverage.

**Last Updated**: 2026-03-27

---

## Framework Classification: TypeScript-Native vs. JS-with-Types

| Framework / Library | TypeScript Status |
|---|---|
| **Prisma** | TypeScript-native. Schema generates TS types. Client is fully typed. |
| **Drizzle ORM** | TypeScript-native. Schemas are TS code. Type inference is a core feature. |
| **Kysely** | TypeScript-native. Designed around TS generics; `Database` interface is the schema. |
| **MikroORM** | TypeScript-native. Full TS support from day one; `ts-morph` metadata provider. |
| **TypeORM** | TypeScript-native (originally). Has `@Entity()` decorators; designed for TS. |
| **type-graphql** | TypeScript-native. Uses TS decorators and `reflect-metadata`. |
| **Typegoose** | TypeScript-native. Mongoose wrapper using TS class decorators. |
| **class-validator** | TypeScript-native. Designed for TS classes with decorators. |
| **Sequelize (sequelize-typescript)** | JS library + `sequelize-typescript` adds decorator-based TS API. |
| **Mongoose** | JS library + community `@types/mongoose` + `mongoose` has built-in types since v6. |
| **Objection.js** | JS library + `@types/objection`. `jsonSchema` is plain JS; no TS-specific entity definition. |
| **Bookshelf.js** | JS library + `@types/bookshelf`. No TS-native entity definition. |
| **Waterline / Sails.js** | JS library. Minimal TS support. |
| **node-postgres (pg)** | JS library + `@types/pg`. |
| **mysql2** | JS library + built-in types since v2.x. |
| **better-sqlite3** | JS library + built-in types. |
| **Knex** | JS library + built-in types. |
| **firebase-admin** | JS library + built-in types since v9. |
| **AWS SDK DynamoDB** | JS library + built-in types (v3 is fully typed). |
| **ioredis / redis** | JS libraries + built-in types. |
| **@elastic/elasticsearch** | JS library + built-in types. |
| **mongodb** | JS library + built-in types since v4. |
| **Nexus** | TypeScript-native. Code-first GraphQL schema with TS type generation. |
| **Pothos** | TypeScript-native. Fully typed GraphQL schema builder. |
| **Zod** | TypeScript-native. Runtime validation with full TS inference. |

---

## Table of Contents

1. [Prisma](#1-prisma)
2. [TypeORM](#2-typeorm)
3. [Sequelize + sequelize-typescript](#3-sequelize--sequelize-typescript)
4. [Drizzle ORM](#4-drizzle-orm)
5. [MikroORM](#5-mikroorm)
6. [Objection.js + Knex](#6-objectionjs--knex)
7. [Mongoose (MongoDB)](#7-mongoose-mongodb)
8. [Typegoose](#8-typegoose)
9. [MongoDB Native Driver](#9-mongodb-native-driver)
10. [node-postgres (pg) — Raw SQL](#10-node-postgres-pg--raw-sql)
11. [mysql2 — Raw SQL](#11-mysql2--raw-sql)
12. [better-sqlite3 — Raw SQL](#12-better-sqlite3--raw-sql)
13. [Kysely](#13-kysely)
14. [Bookshelf.js](#14-bookshelfjs)
15. [Waterline (Sails.js)](#15-waterline-sailsjs)
16. [Firestore (firebase-admin)](#16-firestore-firebase-admin)
17. [DynamoDB (AWS SDK)](#17-dynamodb-aws-sdk)
18. [Redis (ioredis / node-redis)](#18-redis-ioredis--node-redis)
19. [Elasticsearch (Official Client)](#19-elasticsearch-official-client)
20. [Hasura Migration Files](#20-hasura-migration-files)
21. [Database Migration Files (db-migrate, node-pg-migrate, umzug, Flyway)](#21-database-migration-files)
22. [Raw SQL Files](#22-raw-sql-files)
23. [GraphQL Schema as Entity Signal (Nexus, type-graphql, Pothos)](#23-graphql-schema-as-entity-signal)
24. [Zod Schemas as Entity Signals](#24-zod-schemas-as-entity-signals)
25. [class-validator Decorated Classes](#25-class-validator-decorated-classes)
26. [OpenAPI Schemas as Entity Signals](#26-openapi-schemas-as-entity-signals)
27. [NestJS Patterns (TypeORM / Prisma / Mongoose / MikroORM)](#27-nestjs-patterns)
28. [Repository Detection Plan](#28-repository-detection-plan)

---

## 1. Prisma

- **Name**: Prisma
- **Type**: Relational ORM / Schema File
- **TypeScript Status**: TypeScript-native — generates a fully typed `PrismaClient` from the schema
- **Supported Databases**: PostgreSQL, MySQL, MariaDB, SQLite, SQL Server, CockroachDB, MongoDB (preview)
- **Detection Signals**:
  - `package.json` dependencies: `"prisma"`, `"@prisma/client"`
  - Config/schema file: `prisma/schema.prisma` (default), any `*.prisma` file
  - Scripts referencing: `prisma generate`, `prisma migrate`, `prisma db push`
  - Generated types: `node_modules/@prisma/client` (or custom `output` path in `generator` block)
  - Import pattern: `import { PrismaClient } from '@prisma/client'`
  - Monorepo: `packages/*/prisma/schema.prisma`
- **Entity Definition Style**: Declarative `.prisma` schema language. `model` blocks define entities. The generated TypeScript client provides `prismaClient.modelName` accessors — model names map directly to client property names.
  ```prisma
  model User {
    id    Int    @id @default(autoincrement())
    email String @unique
    posts Post[]
  }
  ```
  TypeScript-specific: the generated `Prisma.UserSelect`, `Prisma.UserWhereInput`, etc. types encode the full field schema in the TypeScript type system.
- **Extraction Approach**:
  1. Locate all `*.prisma` files via recursive glob.
  2. Parse each file for `model` blocks: regex `^model\s+(\w+)\s*\{` — capture group is the model name.
  3. Check for `@@map("table_name")` inside each model block — this overrides the physical table name.
  4. Parse the `datasource` block for the `provider` (database type).
  5. **Programmatic (most reliable)**: Use `getDMMF({ datamodelPath })` from `@prisma/internals`. Returns `dmmf.datamodel.models` — an array of objects with `name`, `dbName` (the `@@map` value if set), and `fields`.
  6. For multi-file schemas (Prisma 5+ `prismaSchemaFolder`): locate all `*.prisma` files in the configured directory and aggregate.
  7. TypeScript bonus: the generated `Prisma` namespace exports `ModelName` enum and `ModelPayload` types — these can be inspected in the type-check output but are not needed for entity list extraction.
- **Key Challenges**:
  - `@@map` decouples model name from table name — always check.
  - MongoDB provider: embedded documents are not separate collections. Only top-level `model` blocks with no `@embedded` are collections.
  - `@@schema` attribute (multi-schema PostgreSQL) — the same model name exists in different schemas.
  - Views (`@@view` in Prisma 5+): parse `model ... @@view` to distinguish views from tables.
  - Generator output path may be customized; the generated client is not needed for entity extraction, only for type-level analysis.
- **Analysis Tools**: `@prisma/internals` (`getDMMF()`); regex on raw `.prisma` text; tree-sitter Prisma grammar.
- **Complexity**: Low

---

## 2. TypeORM

- **Name**: TypeORM
- **Type**: Relational ORM
- **TypeScript Status**: TypeScript-native — decorators require `"experimentalDecorators": true` and `"emitDecoratorMetadata": true` in `tsconfig.json`
- **Supported Databases**: PostgreSQL, MySQL, MariaDB, SQLite, SQL Server, Oracle, CockroachDB, MongoDB (experimental)
- **Detection Signals**:
  - `package.json` dependency: `"typeorm"`
  - `tsconfig.json`: `"experimentalDecorators": true` and `"emitDecoratorMetadata": true` (required for TypeORM)
  - Import: `import { Entity, Column, PrimaryGeneratedColumn, DataSource } from 'typeorm'`
  - Decorator usage: `@Entity()`, `@Column()`, `@PrimaryGeneratedColumn()`, `@ManyToOne()`, etc.
  - Config files: `ormconfig.json`, `ormconfig.ts`, `data-source.ts`
  - File naming convention: `*.entity.ts`
  - Directory conventions: `src/entity/`, `src/entities/`
  - NestJS: `src/**/*.entity.ts`, `TypeOrmModule.forFeature([...])` in module files
- **Entity Definition Style**:
  - **Decorator-based (primary)**:
    ```ts
    @Entity('users')
    export class User {
      @PrimaryGeneratedColumn()
      id: number;

      @Column({ unique: true })
      email: string;

      @OneToMany(() => Post, post => post.author)
      posts: Post[];
    }
    ```
  - **`EntitySchema<T>` (DataMapper)**:
    ```ts
    const UserSchema = new EntitySchema<User>({
      name: 'User',
      tableName: 'users',
      columns: { id: { type: Number, primary: true, generated: true }, email: { type: String } }
    });
    ```
  - TypeScript-specific: `@Entity()` without a table name argument derives the table name from the class name in snake_case. TypeScript class names (PascalCase) reliably map to snake_case table names.
- **Extraction Approach**:
  1. Check `tsconfig.json` for `"experimentalDecorators": true` as a TypeORM signal.
  2. Find `data-source.ts` or `ormconfig.*` to identify the `entities` glob pattern.
  3. Parse entity files with `@typescript-eslint/parser` (preferred over Babel for TS files). Identify:
     - Class declarations with `@Entity(...)` decorator. Extract table name from decorator argument.
     - `@Entity()` → snake_case the TypeScript class name (e.g., `UserProfile` → `user_profile`).
     - `@Entity('users')` → `'users'` is the table name.
     - `@Entity({ name: 'users', schema: 'public' })` → `name` is the table name.
  4. For `EntitySchema<T>`: find `new EntitySchema<T>({ name: '...', tableName: '...' })` — extract both `name` and `tableName`.
  5. TypeScript bonus: `@ViewEntity()` is clearly distinguishable by decorator name. `@ChildEntity()` indicates STI sub-type (no new table). `@TableInheritance()` on a parent signals STI.
  6. TypeScript inheritance: check if a decorated class extends another `@Entity()` class vs. an abstract base class — the former may use CTI (each class has a table), the latter STI (one table for the hierarchy).
- **Key Challenges**:
  - `"emitDecoratorMetadata": true` is required; if absent, TypeORM entity files may fail to function correctly at runtime but are still parseable statically.
  - TypeORM supports legacy `@Entity()` with `useClass` patterns in NestJS; the entity resolution is the same but wrapped in DI configuration.
  - TypeScript `abstract` keyword on a class (`abstract class BaseEntity`) means no table if not explicitly decorated with `@Entity()`.
  - TypeORM v0.2.x vs. v0.3.x: `createConnection()` vs. `DataSource` constructor — different config file conventions.
  - `@ViewEntity()` is a view, not a table.
- **Analysis Tools**: `@typescript-eslint/parser` (primary for TS); `ts-morph` for deep type resolution; tree-sitter with TypeScript grammar.
- **Complexity**: Medium

---

## 3. Sequelize + sequelize-typescript

- **Name**: Sequelize + sequelize-typescript
- **Type**: Relational ORM
- **TypeScript Status**: `sequelize-typescript` adds TypeScript decorators on top of the JS `sequelize` library
- **Supported Databases**: PostgreSQL, MySQL, MariaDB, SQLite, SQL Server, DB2, Snowflake
- **Detection Signals**:
  - `package.json` dependencies: `"sequelize"`, `"sequelize-typescript"`, optionally `"sequelize-cli"`
  - `tsconfig.json`: `"experimentalDecorators": true` (required for sequelize-typescript)
  - Import: `import { Model, Table, Column, PrimaryKey } from 'sequelize-typescript'`
  - Decorator usage: `@Table(...)`, `@Column(...)`, `@PrimaryKey`, `@BelongsTo(...)` on classes
  - Config files: `.sequelizerc`, `config/config.ts`, `config/database.ts`
  - File conventions: `*.model.ts`, `models/*.ts`
- **Entity Definition Style**:
  - **sequelize-typescript decorators**:
    ```ts
    @Table({ tableName: 'users', timestamps: true })
    export class User extends Model {
      @PrimaryKey
      @AutoIncrement
      @Column(DataType.INTEGER)
      id: number;

      @Column({ type: DataType.STRING, allowNull: false, unique: true })
      email: string;

      @HasMany(() => Post)
      posts: Post[];
    }
    ```
  - **Plain Sequelize `Model.init()` in TypeScript** (no sequelize-typescript):
    ```ts
    class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {}
    User.init(
      { id: { type: DataTypes.INTEGER, primaryKey: true }, email: DataTypes.STRING },
      { sequelize, modelName: 'User', tableName: 'users' }
    );
    ```
- **Extraction Approach**:
  1. **sequelize-typescript**: Parse `*.ts` model files. Find classes decorated with `@Table(...)`:
     - `@Table({ tableName: 'users' })` → `tableName` is the physical name.
     - `@Table` (no argument) → derive from class name.
     - `@Table({ freezeTableName: true })` → use exact class name as table name.
  2. **Plain Sequelize TypeScript**: Parse for `Model.init({ ... }, { modelName: '...', tableName: '...' })` calls. TypeScript generic parameters `<InferAttributes<User>>` do not contain the table name.
  3. Check `.sequelizerc` for `models-path`.
  4. Apply Sequelize's pluralization logic for models without explicit `tableName`.
  5. TypeScript bonus: `@BelongsToMany(() => Role, () => UserRole)` — `UserRole` is a join table model that should have its own `@Table` decorator.
- **Key Challenges**:
  - `sequelize-typescript` and plain `sequelize` in TypeScript have different decorator imports and styles.
  - Global Sequelize options (`underscored: true`, `freezeTableName: true`) in the `Sequelize` constructor affect all models.
  - `@Scopes(...)` and `@DefaultScope(...)` decorators do not affect entity identity.
  - TypeScript generic parameters in `Model<Attributes, CreationAttributes>` carry type info but not entity names.
- **Analysis Tools**: `@typescript-eslint/parser`; `ts-morph` for import resolution.
- **Complexity**: Medium

---

## 4. Drizzle ORM

- **Name**: Drizzle ORM
- **Type**: Relational ORM / Query Builder / Schema-as-Code
- **TypeScript Status**: TypeScript-native — schema is TypeScript code; type inference flows from schema to queries automatically
- **Supported Databases**: PostgreSQL, MySQL, MariaDB, SQLite, Turso, Neon, PlanetScale, Cloudflare D1
- **Detection Signals**:
  - `package.json` dependencies: `"drizzle-orm"`, `"drizzle-kit"`
  - Import: `import { pgTable, text, serial, integer } from 'drizzle-orm/pg-core'`
  - Config: `drizzle.config.ts` (TypeScript config file — key signal in TS projects)
  - Schema files: `src/db/schema.ts`, `db/schema.ts`, `src/schema.ts`
  - Generated type file: often `src/db/types.ts` with inferred types like `type User = typeof users.$inferSelect`
  - Migration directory: `drizzle/` (default), contains `*.sql` files and `_journal.json`
- **Entity Definition Style**:
  ```ts
  import { pgTable, serial, text, integer, timestamp } from 'drizzle-orm/pg-core';

  export const users = pgTable('users', {
    id: serial('id').primaryKey(),
    email: text('email').notNull().unique(),
    createdAt: timestamp('created_at').defaultNow(),
  });

  export const posts = pgTable('posts', {
    id: serial('id').primaryKey(),
    authorId: integer('author_id').references(() => users.id),
    title: text('title').notNull(),
  });

  // Type inference (TypeScript-specific — not needed for entity extraction):
  export type User = typeof users.$inferSelect;
  export type NewUser = typeof users.$inferInsert;
  ```
  The **first string argument** to `pgTable`/`mysqlTable`/`sqliteTable` is the physical table name. The **variable name** (`users`, `posts`) is the TypeScript identifier.
- **Extraction Approach**:
  1. Read `drizzle.config.ts` — parse the `schema` property to find schema file path(s).
  2. Parse schema files with `@typescript-eslint/parser`. Find call expressions where:
     - Callee is `pgTable`, `mysqlTable`, `sqliteTable` (or their re-exported / aliased names)
     - First argument is a string literal → this is the physical table name
     - Variable name of the assignment is the TypeScript identifier
  3. For schema namespacing (PostgreSQL): `pgSchema('myschema').table('users', ...)` — extract schema name and table name separately.
  4. TypeScript type exports (`type User = typeof users.$inferSelect`) confirm which table variables are intended as entity types — useful for disambiguation.
  5. Drizzle migrations in `drizzle/*.sql` contain `CREATE TABLE` statements as a backup source.
- **Key Challenges**:
  - Re-exported or aliased table functions: `import { pgTable as table } from 'drizzle-orm/pg-core'` followed by `table('users', ...)` — must track aliased imports.
  - Schema spread across multiple files: each file may export tables; aggregate from all files referenced in `drizzle.config.ts`.
  - `pgEnum`, `mysqlEnum`, `sqliteText(..., { enum: [...] })` define enum types, not tables.
  - Drizzle `$with` CTE definitions and relational query config objects are not table definitions.
- **Analysis Tools**: `@typescript-eslint/parser` (TypeScript AST is richer here than for JS); `ts-morph` for import alias resolution.
- **Complexity**: Low

---

## 5. MikroORM

- **Name**: MikroORM
- **Type**: Relational ORM / MongoDB ORM
- **TypeScript Status**: TypeScript-native — full TypeScript support from day one; `ts-morph` metadata provider enables no-decorator entity definition
- **Supported Databases**: PostgreSQL, MySQL, MariaDB, SQLite, MongoDB, SQL Server (experimental)
- **Detection Signals**:
  - `package.json` dependencies: `"@mikro-orm/core"`, `"@mikro-orm/postgresql"`, `"@mikro-orm/mysql"`, `"@mikro-orm/sqlite"`, `"@mikro-orm/mongodb"`, `"@mikro-orm/cli"`
  - Import: `import { Entity, Property, PrimaryKey, ManyToOne, Collection } from '@mikro-orm/core'`
  - Config: `mikro-orm.config.ts` (TypeScript-first config)
  - `tsconfig.json`: `"experimentalDecorators": true` (for decorator-based entities)
  - Entity files: `src/entities/*.ts`, `*.entity.ts`
  - CLI config in `package.json`: `"mikro-orm": { "useTsNode": true }`
- **Entity Definition Style**:
  - **Decorator-based**:
    ```ts
    @Entity({ tableName: 'users' })
    export class User {
      @PrimaryKey()
      id!: number;

      @Property()
      email!: string;

      @OneToMany(() => Post, post => post.author)
      posts = new Collection<Post>(this);
    }
    ```
  - **`EntitySchema<T>`**:
    ```ts
    export const UserSchema = new EntitySchema<User>({
      name: 'User',
      tableName: 'users',
      properties: {
        id: { type: 'number', primary: true },
        email: { type: 'string' }
      }
    });
    ```
  - **`TsMorphMetadataProvider`** (TypeScript-exclusive): reads TypeScript type declarations to infer entity metadata. Entities are plain TypeScript classes without `@Entity()` decorator, registered in config.
- **Extraction Approach**:
  1. Read `mikro-orm.config.ts` to find `entities` (compiled JS paths) and `entitiesTs` (TypeScript source paths). Use `entitiesTs` for static analysis of TypeScript source.
  2. For decorator-based: parse with `@typescript-eslint/parser`. Find classes with `@Entity(...)`. Extract `tableName` from decorator options.
  3. For `EntitySchema<T>`: find `new EntitySchema<T>({ name: '...', tableName: '...' })` calls.
  4. For `TsMorphMetadataProvider`: classes registered in `entities` without `@Entity()` decorator are still entities. Identify them by their presence in the config's entity list.
  5. TypeScript-specific: `abstract` classes decorated with `@Entity({ abstract: true })` do not create tables — the `abstract: true` option in the decorator (not the TS `abstract` keyword) controls this.
  6. For MongoDB: `@Entity({ collection: 'users' })` — use `collection` property.
- **Key Challenges**:
  - `TsMorphMetadataProvider` is TypeScript-exclusive and the most powerful MikroORM feature for TS projects — entity detection without decorators requires special handling.
  - `@Embeddable()` decorated classes map to columns in the parent entity, not new tables.
  - MikroORM's `CustomBaseEntity` or similar base classes extend with common fields — do not count as entities unless also decorated with `@Entity()`.
  - MikroORM 5 vs. 6 have minor API differences; config structure is similar.
- **Analysis Tools**: `@typescript-eslint/parser`; `ts-morph` (especially for TsMorphMetadataProvider analysis).
- **Complexity**: Medium

---

## 6. Objection.js + Knex

- **Name**: Objection.js + Knex
- **Type**: Relational ORM (Objection.js) + Query Builder / Migration Tool (Knex)
- **TypeScript Status**: JS libraries with TypeScript definitions (`@types/objection`, Knex has built-in types)
- **Supported Databases**: PostgreSQL, MySQL, MariaDB, SQLite, SQL Server, Oracle (all via Knex)
- **Detection Signals**:
  - `package.json` dependencies: `"objection"`, `"knex"`, possibly `"@types/objection"`
  - Import: `import { Model, QueryBuilder } from 'objection'`
  - Config: `knexfile.ts` (TypeScript knexfile is a strong signal)
  - File naming: `*.model.ts`, `models/*.ts`
- **Entity Definition Style**:
  ```ts
  import { Model, JSONSchema } from 'objection';

  export class User extends Model {
    static tableName = 'users';

    id!: number;
    email!: string;

    static get jsonSchema(): JSONSchema {
      return {
        type: 'object',
        required: ['email'],
        properties: { id: { type: 'integer' }, email: { type: 'string' } }
      };
    }
  }
  ```
  TypeScript-specific: `static tableName` can be typed as `static tableName: string = 'users'` — a class field, not a getter.
- **Extraction Approach**:
  1. Find TypeScript classes extending `Model` from `objection`.
  2. Extract `static tableName` (class field or static property): find `static tableName = '...'` or `static get tableName() { return '...'; }`.
  3. TypeScript static class field syntax (`static tableName: string = 'users'`) is handled by `@typescript-eslint/parser` as a `PropertyDefinition` node with `static: true`.
  4. Parse Knex migration files (`knexfile.ts`, migration `*.ts` files) for `createTable()` calls.
- **Key Challenges**: Same as the JavaScript version. TypeScript adds no new challenges here; static typing makes `tableName` more consistently a string literal.
- **Analysis Tools**: `@typescript-eslint/parser`; `@babel/parser` as fallback.
- **Complexity**: Medium

---

## 7. Mongoose (MongoDB)

- **Name**: Mongoose
- **Type**: NoSQL ORM (Document)
- **TypeScript Status**: JS library; built-in TypeScript types since Mongoose v6.0 (2021); `@types/mongoose` for older versions
- **Supported Databases**: MongoDB
- **Detection Signals**:
  - `package.json` dependency: `"mongoose"` (v6+ has built-in types)
  - Import: `import mongoose, { Schema, model, Document, Model } from 'mongoose'`
  - TypeScript-specific pattern: `model<IUser, Model<IUser>>('User', userSchema)` with generics
  - Files: `*.model.ts`, `models/*.ts`, `schemas/*.ts`
- **Entity Definition Style**:
  ```ts
  interface IUser {
    name: string;
    email: string;
  }

  const userSchema = new Schema<IUser>({
    name: { type: String, required: true },
    email: { type: String, unique: true }
  });

  export const User = model<IUser>('User', userSchema);
  // OR with explicit collection:
  export const User = model<IUser>('User', userSchema, 'user_records');
  ```
  TypeScript generics (`<IUser>`) carry type information but the **model name string** and optional **collection name string** are what determine the MongoDB collection.
- **Extraction Approach**:
  1. Parse all `*.ts` files for `model<T>('ModelName', schema, ['collection'])` calls (or `model('ModelName', schema, ['collection'])` without generic).
  2. Extract the first string argument (model name) and optional third string argument (explicit collection name).
  3. If no collection name: apply mongoose's pluralization (lowercase + pluralize the model name).
  4. TypeScript bonus: the generic type parameter `<IUser>` may reference an interface; the interface name often matches the entity (e.g., `IUser` → entity `User`). This is a supplementary signal.
  5. Check for `new Schema<T>({ ... }, { collection: 'name' })` — the `collection` option in `SchemaOptions` is an explicit collection name.
- **Key Challenges**: Same as the JavaScript version. TypeScript generics add noise but do not change the fundamental extraction approach.
- **Analysis Tools**: `@typescript-eslint/parser`.
- **Complexity**: Medium

---

## 8. Typegoose

- **Name**: Typegoose (`@typegoose/typegoose`)
- **Type**: NoSQL ORM (Mongoose wrapper with TypeScript decorators)
- **TypeScript Status**: TypeScript-native — requires `"experimentalDecorators": true` and `"emitDecoratorMetadata": true`
- **Supported Databases**: MongoDB (via Mongoose)
- **Detection Signals**:
  - `package.json` dependency: `"@typegoose/typegoose"`
  - Import: `import { prop, getModelForClass, modelOptions } from '@typegoose/typegoose'`
  - Decorator usage: `@prop()`, `@modelOptions()`, `@index()` on classes
  - TypeScript config: `"experimentalDecorators": true`, `"emitDecoratorMetadata": true`
  - Often appears alongside `"mongoose"` in dependencies
- **Entity Definition Style**:
  ```ts
  @modelOptions({ schemaOptions: { collection: 'users' } })
  export class User {
    @prop({ required: true })
    public name!: string;

    @prop({ unique: true })
    public email!: string;
  }

  export const UserModel = getModelForClass(User);
  ```
  The class name is the model name. The collection name defaults to the lowercase plural of the class name (via Mongoose) or is overridden by `@modelOptions({ schemaOptions: { collection: 'users' } })`.
- **Extraction Approach**:
  1. Find classes decorated with `@prop()` (or any Typegoose decorator like `@index()`, `@pre()`, `@post()`).
  2. More specifically: find `getModelForClass(ClassName)` calls — the argument is the entity class.
  3. For each such class, check for `@modelOptions({ schemaOptions: { collection: 'name' } })` — extract the `collection` value if present.
  4. If no `collection` override, apply Mongoose's pluralization rule to the class name to get the collection name.
  5. TypeScript-specific: embedded subdocuments use `@prop({ type: () => SubDocument })` — the referenced class is embedded, not a separate collection, unless it also has `getModelForClass()` called on it.
- **Key Challenges**:
  - `@SubModelOptions()` / embedded classes share the parent model's collection.
  - `@discriminatorKey()` signals inheritance with shared collection (same as Mongoose discriminators).
  - Typegoose `PropType` enum (`ARRAY`, `MAP`) for complex properties — not new entities.
  - The class used with `getModelForClass` may be extended or composed from other classes (mixins).
- **Analysis Tools**: `@typescript-eslint/parser`; `ts-morph` for inheritance chain analysis.
- **Complexity**: Medium

---

## 9. MongoDB Native Driver

- **Name**: MongoDB Native Driver (`mongodb` npm package)
- **Type**: NoSQL Driver (Raw)
- **TypeScript Status**: Built-in TypeScript types since v4 (2021). Generic collection typing: `db.collection<UserDocument>('users')`.
- **Supported Databases**: MongoDB
- **Detection Signals**:
  - `package.json` dependency: `"mongodb"`
  - Import: `import { MongoClient, Collection, Db } from 'mongodb'`
  - TypeScript-specific pattern: `db.collection<UserDocument>('users')` — generic type parameter hints at the entity type
- **Entity Definition Style**: No schema. Collections addressed by string name. TypeScript generic parameters provide type information:
  ```ts
  interface UserDocument {
    _id: ObjectId;
    email: string;
    name: string;
  }
  const usersCollection: Collection<UserDocument> = db.collection<UserDocument>('users');
  ```
- **Extraction Approach**:
  1. Parse for `db.collection<T>('name')` or `db.collection('name')` calls — extract the string literal argument.
  2. TypeScript bonus: the generic type argument `<UserDocument>` or `<IUser>` is a secondary signal that can cross-reference with interface definitions, but the string literal is authoritative.
  3. `db.createCollection<T>('name')` is an explicit collection creation call — extract `name`.
  4. Aggregate all unique collection name strings.
- **Key Challenges**: Same as the JavaScript version. TypeScript generics help identify associated types but don't resolve dynamic collection names.
- **Analysis Tools**: `@typescript-eslint/parser`.
- **Complexity**: High

---

## 10. node-postgres (pg) — Raw SQL

- **Name**: node-postgres (`pg`)
- **Type**: Raw SQL / Query Driver
- **TypeScript Status**: `@types/pg` for older versions; built-in types for newer versions
- **Supported Databases**: PostgreSQL
- **Detection Signals**:
  - `package.json` dependencies: `"pg"`, `"@types/pg"`, `"pg-pool"`
  - Import: `import { Pool, Client, QueryResult } from 'pg'`
  - TypeScript-specific: `pool.query<UserRow>('SELECT ...', params)` — generic typing
- **Entity Definition Style**: No entity definitions. SQL strings in query calls.
- **Extraction Approach**: Same as the JavaScript version (see [JavaScript document](../javascript/data-entity-storage-methods.md#9-node-postgres-pg--raw-sql)). TypeScript generics on query calls (`pool.query<T>(sql)`) do not contain the table name, but the generic type name `T` (`UserRow`, `IUser`) is a supplementary naming signal.
- **Key Challenges**: Same as JavaScript version. Template literal tagged with `sql` from `postgres` or `@pgtyped/query` packages adds typed SQL — parse the template string content.
- **Analysis Tools**: `@typescript-eslint/parser`; `node-sql-parser` or `pgsql-ast-parser` for SQL strings.
- **Complexity**: High

---

## 11. mysql2 — Raw SQL

- **Name**: mysql2
- **Type**: Raw SQL / Query Driver
- **TypeScript Status**: Built-in types since mysql2 v2.x
- **Supported Databases**: MySQL, MariaDB
- **Detection Signals**:
  - `package.json` dependency: `"mysql2"`
  - Import: `import mysql from 'mysql2/promise'`, `import { Connection, Pool, RowDataPacket } from 'mysql2/promise'`
- **Entity Definition Style**: No entity definitions. SQL strings in query calls.
- **Extraction Approach**: Same as the JavaScript version. TypeScript generics (`connection.query<RowDataPacket[]>('SELECT ...')`) do not affect entity extraction.
- **Analysis Tools**: `@typescript-eslint/parser`; `node-sql-parser` with MySQL dialect.
- **Complexity**: High

---

## 12. better-sqlite3 — Raw SQL

- **Name**: better-sqlite3
- **Type**: Raw SQL / Query Driver
- **TypeScript Status**: Built-in types
- **Supported Databases**: SQLite
- **Detection Signals**:
  - `package.json` dependency: `"better-sqlite3"`
  - Import: `import Database from 'better-sqlite3'`
- **Entity Definition Style**: No entity definitions. SQL strings in `prepare()`/`exec()` calls.
- **Extraction Approach**: Same as the JavaScript version.
- **Analysis Tools**: `@typescript-eslint/parser`; `node-sql-parser` with SQLite dialect.
- **Complexity**: High

---

## 13. Kysely

- **Name**: Kysely
- **Type**: Type-Safe SQL Query Builder
- **TypeScript Status**: TypeScript-native — the `Database` interface is the schema; type safety flows from it to all query operations
- **Supported Databases**: PostgreSQL, MySQL, SQLite, MS SQL Server; community dialects for Neon, PlanetScale, Turso (libSQL), Cloudflare D1
- **Detection Signals**:
  - `package.json` dependency: `"kysely"`
  - Import: `import { Kysely, sql, Generated, ColumnType } from 'kysely'`
  - TypeScript-specific: `new Kysely<Database>(...)` — the `Database` generic type argument is key
  - Type definition files: typically `src/db/types.ts` or `src/database.ts` containing the `Database` interface
  - Migration files: `*.ts` migration files using `db.schema.createTable(...)`
- **Entity Definition Style**:
  ```ts
  // Database type definition (THE authoritative entity source)
  interface UsersTable {
    id: Generated<number>;
    email: string;
    created_at: ColumnType<Date, string | undefined, never>;
  }

  interface OrdersTable {
    id: Generated<number>;
    user_id: number;
    total: number;
  }

  export interface Database {
    users: UsersTable;
    orders: OrdersTable;
  }

  // Instantiation
  export const db = new Kysely<Database>({ dialect });
  ```
  The keys of the `Database` interface (`users`, `orders`) are the **exact physical table names**.
- **Extraction Approach**:
  1. Find `new Kysely<T>(...)` — identify the type argument `T`.
  2. Use `@typescript-eslint/parser` to locate the `Database` interface definition. Its property names are the table names.
  3. If `T` is imported from another file, follow the import to find the interface definition.
  4. As a fallback or cross-check: parse all `db.selectFrom('...')`, `db.insertInto('...')`, `db.updateTable('...')`, `db.deleteFrom('...')` calls — extract string literal arguments.
  5. For schema migrations: `db.schema.createTable('name')...execute()` — extract the table name.
  6. TypeScript advantage: the `Database` interface is the single source of truth. If present, it gives a 100% accurate list of table names with no need for query scanning.
- **Key Challenges**:
  - The `Database` interface may be defined in a separate types file, auto-generated (e.g., by `kysely-codegen`), or assembled from multiple `interface` declarations merged via declaration merging.
  - `WithSchemaPlugin` allows schema-qualified names: `db.withSchema('public').selectFrom('users')` — still extractable.
  - `CamelCasePlugin` transforms snake_case table names to camelCase in queries and types — the physical name in the database is still snake_case.
  - `Kysely` may be wrapped in a custom `Database` class that obscures the type parameter.
- **Analysis Tools**: `@typescript-eslint/parser` (primary); `ts-morph` (for following interface imports and type resolution).
- **Complexity**: Low (with `Database` interface) / Medium (without it, using query scanning)

---

## 14. Bookshelf.js

- **Name**: Bookshelf.js
- **Type**: Relational ORM (built on Knex)
- **TypeScript Status**: JS library with `@types/bookshelf`; largely inactive since ~2019; found in legacy TS codebases
- **Supported Databases**: PostgreSQL, MySQL, MariaDB, SQLite (all via Knex)
- **Detection Signals**: Same as JavaScript version, with `@types/bookshelf` in dependencies.
- **Entity Definition Style**: Same as JavaScript version (`bookshelf.Model.extend({ tableName: '...' })`). TypeScript projects may use the ES6 class extension style.
- **Extraction Approach**: Same as JavaScript version. `@typescript-eslint/parser` can parse TS Bookshelf code.
- **Key Challenges**: Same as JavaScript version.
- **Analysis Tools**: `@typescript-eslint/parser`.
- **Complexity**: Medium

---

## 15. Waterline (Sails.js)

- **Name**: Waterline (Sails.js)
- **Type**: Multi-adapter ORM
- **TypeScript Status**: Sails.js has limited TypeScript support. Community types exist but are incomplete. Most Sails.js projects remain in JavaScript.
- **Supported Databases**: MySQL, PostgreSQL, MongoDB, Redis, in-memory, and others via adapters
- **Detection Signals**: Same as JavaScript version.
- **Entity Definition Style**: Same as JavaScript version. If encountered in a TypeScript Sails project, the model files may be `.ts` but still use the same plain-object export pattern.
- **Extraction Approach**: Same as JavaScript version; use `@typescript-eslint/parser` if files are `.ts`.
- **Key Challenges**: Same as JavaScript version. TypeScript adds minimal benefit here due to Waterline's limited TS support.
- **Analysis Tools**: `@typescript-eslint/parser` or `@babel/parser`.
- **Complexity**: Low

---

## 16. Firestore (firebase-admin)

- **Name**: Firestore via `firebase-admin` or `@firebase/firestore`
- **Type**: NoSQL (Document / Hierarchical)
- **TypeScript Status**: `firebase-admin` has built-in types; supports generic typed document references: `db.collection('users').withConverter<User>(...)`
- **Supported Databases**: Google Cloud Firestore
- **Detection Signals**: Same as JavaScript version.
- **Entity Definition Style**: Same as JavaScript version (schemaless, collections by string name). TypeScript adds `.withConverter<T>()` patterns.
- **Extraction Approach**:
  1. Same as JavaScript version: parse `.collection('name')` calls, `firestore.rules`, `firestore.indexes.json`.
  2. TypeScript bonus: `db.collection('users').withConverter<UserConverter>()` — the string `'users'` is the collection name, and `UserConverter` type hints at the entity shape.
  3. Typed collection references: `const usersRef: CollectionReference<User> = db.collection('users') as CollectionReference<User>` — extract `'users'`.
- **Key Challenges**: Same as JavaScript version.
- **Analysis Tools**: `@typescript-eslint/parser`; custom rules file parser.
- **Complexity**: High

---

## 17. DynamoDB (AWS SDK)

- **Name**: DynamoDB via AWS SDK v3 (`@aws-sdk/client-dynamodb`)
- **Type**: NoSQL (Key-Value / Document)
- **TypeScript Status**: AWS SDK v3 is fully typed. `@aws-sdk/lib-dynamodb` provides `DynamoDBDocumentClient` with typed marshaling.
- **Supported Databases**: AWS DynamoDB
- **Detection Signals**: Same as JavaScript version. AWS CDK TypeScript (`new Table(this, 'Id', { ... })`) is especially common in TypeScript projects.
- **Entity Definition Style**: Same as JavaScript version. `TableName` string in command objects. AWS CDK TypeScript:
  ```ts
  import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
  const usersTable = new dynamodb.Table(this, 'UsersTable', {
    tableName: 'users',
    partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
  });
  ```
- **Extraction Approach**:
  1. Same as JavaScript version: scan for `TableName` in source files and infrastructure code.
  2. TypeScript CDK: parse `new dynamodb.Table(this, 'LogicalId', { tableName: '...', ... })` — extract `tableName` from the options object. If `tableName` is absent from CDK code, the table name is synthesized at deploy time (not statically determinable).
  3. `dynamodb-toolbox` TypeScript: `new Table({ name: 'users', partitionKey: 'pk', ... })` — extract `name`.
- **Key Challenges**: Same as JavaScript version. Table names from environment variables remain the primary challenge.
- **Analysis Tools**: `@typescript-eslint/parser`; `js-yaml` for Serverless/CloudFormation YAML.
- **Complexity**: High

---

## 18. Redis (ioredis / node-redis)

- **Name**: Redis via `ioredis` or `node-redis`
- **Type**: Key-Value Store / Cache
- **TypeScript Status**: Both `ioredis` and `redis` have built-in TypeScript types. `redis-om` is TypeScript-native.
- **Supported Databases**: Redis, Redis Stack, Valkey, Upstash
- **Detection Signals**: Same as JavaScript version.
- **Entity Definition Style**:
  - **`redis-om` (TypeScript-native)**:
    ```ts
    import { Schema, Entity } from 'redis-om';

    interface User extends Entity {
      name: string;
      email: string;
    }

    const userSchema = new Schema<User>('user', {
      name: { type: 'string' },
      email: { type: 'string' },
    }, { dataStructure: 'HASH' });
    ```
    The `'user'` string is the key prefix / entity name.
  - **BullMQ** (TypeScript):
    ```ts
    import { Queue, Worker } from 'bullmq';
    const emailQueue = new Queue<EmailJobData>('emails', { connection });
    ```
    The `'emails'` string is the queue name (entity identifier).
- **Extraction Approach**:
  1. `redis-om`: Find `new Schema<T>('keyPrefix', ...)` — extract the key prefix string.
  2. BullMQ: Find `new Queue<T>('queueName', ...)` — extract queue name.
  3. Raw Redis: Extract key string literals from `redis.set(key, ...)` calls — same as JS.
- **Key Challenges**: Same as JavaScript version.
- **Analysis Tools**: `@typescript-eslint/parser`.
- **Complexity**: High (key namespaces) / Low (redis-om schemas, BullMQ queues)

---

## 19. Elasticsearch (Official Client)

- **Name**: Elasticsearch Official TypeScript Client (`@elastic/elasticsearch`)
- **Type**: Search Engine / Document Store
- **TypeScript Status**: Built-in TypeScript types; supports generic document typing: `client.index<UserDocument>({ index: 'users', ... })`
- **Supported Databases**: Elasticsearch, OpenSearch
- **Detection Signals**: Same as JavaScript version.
- **Entity Definition Style**: Same as JavaScript version. TypeScript adds generic document types:
  ```ts
  interface UserDocument {
    id: string;
    email: string;
    name: string;
  }
  await client.index<UserDocument>({ index: 'users', document: { ... } });
  ```
- **Extraction Approach**: Same as JavaScript version. TypeScript generic `<UserDocument>` is a supplementary signal (the interface name hints at the entity type), but the `index` string is authoritative.
- **Analysis Tools**: `@typescript-eslint/parser`.
- **Complexity**: Medium

---

## 20. Hasura Migration Files

- **Name**: Hasura (Hasura CLI migrations)
- **Type**: GraphQL Engine / Migration Tool
- **TypeScript Status**: N/A — Hasura migrations are SQL files; the Hasura console/server is not a TypeScript artifact. TypeScript codegen from Hasura schema uses `graphql-codegen`.
- **Supported Databases**: PostgreSQL, MySQL, MS SQL Server, BigQuery, Snowflake, MongoDB
- **Detection Signals**: Same as JavaScript version.
- **Entity Definition Style**: Same as JavaScript version (SQL `up.sql` files + metadata YAML).
- **Extraction Approach**: Same as JavaScript version. Parse `tables.yaml` and `up.sql` migration files.
- **Key Challenges**: Same as JavaScript version.
- **Analysis Tools**: `js-yaml`; `node-sql-parser` or `pgsql-ast-parser`.
- **Complexity**: Low

---

## 21. Database Migration Files

- **Name**: Migration Tools: `db-migrate`, `node-pg-migrate`, `umzug`, Flyway
- **Type**: Migration Tool / Schema Evolution
- **TypeScript Status**: `node-pg-migrate` supports TypeScript migrations. `umzug` is TypeScript-friendly. `db-migrate` has `@types/db-migrate`.
- **Supported Databases**: PostgreSQL, MySQL, SQLite, etc.
- **Detection Signals**: Same as JavaScript version. TypeScript migration files (`*.ts`) are an additional signal.
- **Entity Definition Style**: Same as JavaScript version.
- **Extraction Approach**: Same as JavaScript version. Use `@typescript-eslint/parser` for TypeScript migration files.
- **Key Challenges**: Same as JavaScript version.
- **Analysis Tools**: `@typescript-eslint/parser`; `node-sql-parser`.
- **Complexity**: Medium

---

## 22. Raw SQL Files

- **Name**: Raw SQL Files
- **Type**: Raw SQL / Schema Definition
- **TypeScript Status**: N/A — SQL files are database artifacts, not TypeScript code.
- **Supported Databases**: Any relational database
- **Detection Signals**: Same as JavaScript version (`*.sql`, `schema.sql`, `supabase/migrations/*.sql`, etc.).
- **Entity Definition Style**: Standard SQL DDL `CREATE TABLE` statements.
- **Extraction Approach**: Same as JavaScript version. Parse `CREATE TABLE` statements.
- **Key Challenges**: Same as JavaScript version.
- **Analysis Tools**: `node-sql-parser`; `pgsql-ast-parser`.
- **Complexity**: Low (with proper SQL parser)

---

## 23. GraphQL Schema as Entity Signal

- **Name**: GraphQL Schema — Nexus, type-graphql, Pothos, Apollo, SDL files
- **Type**: API Schema Layer / Entity Signal
- **TypeScript Status**: Nexus, type-graphql, and Pothos are all TypeScript-native; `graphql` library has built-in types
- **Supported Databases**: Any (GraphQL is database-agnostic)
- **Detection Signals**:
  - `package.json` dependencies: `"graphql"`, `"nexus"`, `"type-graphql"`, `"@pothos/core"`, `"@nestjs/graphql"`, `"@apollo/server"`, `"graphql-yoga"`
  - TypeScript config: `"experimentalDecorators": true` required for type-graphql
  - Schema files: `*.graphql`, `*.gql`
  - Generated types: `nexus-typegen.ts`, `graphql.schema.ts`, `src/graphql/generated/`
  - `reflect-metadata` import (signals type-graphql or TypeORM are in use)
- **Entity Definition Style**:
  - **type-graphql** (TypeScript-native):
    ```ts
    @ObjectType()
    export class User {
      @Field(() => Int)
      id: number;

      @Field()
      email: string;

      @Field(() => [Post])
      posts: Post[];
    }
    ```
  - **Nexus** (TypeScript-native):
    ```ts
    export const User = objectType({
      name: 'User',
      definition(t) {
        t.nonNull.int('id');
        t.nonNull.string('email');
      },
    });
    ```
  - **Pothos** (TypeScript-native):
    ```ts
    const UserType = builder.objectType('User', {
      fields: (t) => ({
        id: t.exposeID('id', {}),
        email: t.exposeString('email', {}),
      }),
    });
    ```
  - **SDL files**: Same as JavaScript version.
- **Extraction Approach**:
  1. **type-graphql**: Parse `*.ts` files for classes decorated with `@ObjectType()`. Extract class name or `name` option from decorator argument. Filter out `@InputType()`, `@ArgsType()`, `@InterfaceType()`, `@UnionType()` for strict entity identification.
  2. **Nexus**: Find `objectType({ name: '...', ... })` — extract `name` string.
  3. **Pothos**: Find `builder.objectType('TypeName', ...)` — extract first argument.
  4. **SDL files**: Parse with `graphql.parse()`. Extract `ObjectTypeDefinition` nodes, skip `Query`, `Mutation`, `Subscription`, `*Connection`, `*Edge`, `*Input`.
  5. **NestJS GraphQL**: `@ObjectType()` from `@nestjs/graphql` — same approach as type-graphql.
  6. Cross-reference GraphQL type names with database entity names (ORM models) to confirm DB backing.
  7. **Apollo Federation**: `@ObjectType()` with `@Directive('@key(fields: "id")')` — `@key` directive signals a federated entity (often DB-backed).
- **Key Challenges**:
  - type-graphql classes may be used as both GraphQL types and database entities (combined with `@Entity()` decorators) or as pure API types.
  - Nexus `interfaceType`, `unionType`, `enumType` are not entity definitions.
  - Pothos plugins (Prisma plugin, Drizzle plugin) auto-generate types from ORM schemas — in these cases the ORM schema is the authoritative source.
  - Generated type files (`nexus-typegen.ts`) may be more complete than source definitions but are derived artifacts.
- **Analysis Tools**: `@typescript-eslint/parser`; `graphql` package (`parse()`).
- **Complexity**: Medium

---

## 24. Zod Schemas as Entity Signals

- **Name**: Zod
- **Type**: Runtime Validation Library / Entity Signal (secondary)
- **TypeScript Status**: TypeScript-native — `z.infer<typeof schema>` is a core feature; schemas generate TypeScript types
- **Supported Databases**: Any (Zod is database-agnostic)
- **Detection Signals**: Same as JavaScript version.
- **Entity Definition Style**:
  ```ts
  export const UserSchema = z.object({
    id: z.number(),
    email: z.string().email(),
    name: z.string().optional(),
    createdAt: z.date(),
  });
  export type User = z.infer<typeof UserSchema>;
  ```
  TypeScript-specific: `z.infer<typeof UserSchema>` creates a TypeScript type — the type name `User` is an additional signal.
- **Extraction Approach**:
  1. Same as JavaScript version: find exported `z.object(...)` assignments. Extract variable names.
  2. TypeScript bonus: find `type X = z.infer<typeof XSchema>` or `type X = z.output<typeof XSchema>` — the type alias name `X` is an entity name signal (often more readable than the schema variable name).
  3. Integration packages: `drizzle-zod` (`createInsertSchema(users)`, `createSelectSchema(users)`), `zod-prisma-types` — these generate Zod schemas from ORM models. The ORM model (Drizzle, Prisma) is the authoritative entity source.
  4. `@opentelemetry/semantic-conventions`, `fastify-type-provider-zod`, `trpc` with Zod — all use Zod for API shapes, not DB entities.
- **Key Challenges**: Same as JavaScript version. High false-positive rate without ORM cross-referencing.
- **Analysis Tools**: `@typescript-eslint/parser`.
- **Complexity**: High (without ORM cross-referencing) / Low (when used with `drizzle-zod`, `zod-prisma`)

---

## 25. class-validator Decorated Classes

- **Name**: class-validator + class-transformer
- **Type**: Validation Library / Entity Signal (secondary)
- **TypeScript Status**: TypeScript-native; requires `"experimentalDecorators": true`
- **Supported Databases**: Any (library is database-agnostic)
- **Detection Signals**: Same as JavaScript version. In TypeScript projects, `class-validator` classes are commonly found in:
  - `src/**/*.dto.ts` (Data Transfer Objects — usually NOT database entities)
  - `src/**/*.entity.ts` (when combined with TypeORM — ARE database entities)
  - `src/**/*.schema.ts` (when combined with Mongoose — ARE database entities)
- **Entity Definition Style**:
  ```ts
  export class CreateUserDto {
    @IsEmail()
    email: string;

    @IsString()
    @MinLength(2)
    name: string;
  }

  @Entity('users')  // TypeORM + class-validator combined
  export class User {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    @IsEmail()
    email: string;
  }
  ```
- **Extraction Approach**:
  1. Find TypeScript classes with `class-validator` decorators (`@IsString()`, `@IsEmail()`, etc.).
  2. **High confidence**: If the same class also has `@Entity()` (TypeORM), `@Schema()` (Mongoose), `@ObjectType()` (GraphQL), treat as confirmed entity.
  3. **Low confidence**: If only `class-validator` decorators are present, treat as a DTO (API input/output shape).
  4. TypeScript file path heuristics:
     - `*.entity.ts` → likely DB entity
     - `*.dto.ts` → likely DTO
     - `*.model.ts` → ambiguous
     - `*.schema.ts` → likely DB schema
- **Key Challenges**: Same as JavaScript version. The DTO/entity distinction is clearer in TypeScript NestJS projects due to strict file naming conventions.
- **Analysis Tools**: `@typescript-eslint/parser`.
- **Complexity**: Medium (with ORM cross-referencing) / High (standalone)

---

## 26. OpenAPI Schemas as Entity Signals

- **Name**: OpenAPI / Swagger Schemas
- **Type**: API Specification / Entity Signal (secondary)
- **TypeScript Status**: `@nestjs/swagger` is TypeScript-native; `swagger-jsdoc` works with both JS and TS
- **Supported Databases**: Any (database-agnostic)
- **Detection Signals**: Same as JavaScript version.
- **Entity Definition Style**:
  - **`@nestjs/swagger`**:
    ```ts
    @ApiSchema({ name: 'User' })
    export class UserResponseDto {
      @ApiProperty({ description: 'User ID', example: 1 })
      id: number;

      @ApiProperty({ description: 'Email address' })
      email: string;
    }
    ```
  - Same OpenAPI YAML/JSON file structure as JavaScript version.
- **Extraction Approach**:
  1. Same as JavaScript version: parse `openapi.{json,yaml}` files for `components.schemas`.
  2. TypeScript-specific: NestJS `@ApiSchema()` on a class names the OpenAPI schema for that class. If that class also has `@Entity()`, it is a confirmed DB entity.
  3. `@nestjs/swagger`'s `@ApiProperty()` decorators generate the OpenAPI schema from TypeScript classes — the class itself is the entity definition, not the generated spec.
- **Key Challenges**: Same as JavaScript version.
- **Analysis Tools**: `@typescript-eslint/parser`; `js-yaml`; `@apidevtools/swagger-parser`.
- **Complexity**: High (without ORM cross-referencing)

---

## 27. NestJS Patterns

- **Name**: NestJS (TypeScript-first Node.js framework)
- **Type**: Framework Convention / Entity Signal Amplifier
- **TypeScript Status**: TypeScript-native — NestJS is built for TypeScript; JavaScript support exists but is uncommon
- **Supported Databases**: Depends on ORM module (TypeORM, Prisma, Mongoose, Sequelize, MikroORM, Drizzle)
- **Detection Signals**:
  - `package.json` dependencies: `"@nestjs/core"`, `"@nestjs/common"`
  - ORM modules: `"@nestjs/typeorm"`, `"@nestjs/mongoose"`, `"@nestjs/sequelize"`, `"@mikro-orm/nestjs"`, `"@nestjs/prisma"` (community)
  - TypeScript config: `"experimentalDecorators": true`, `"emitDecoratorMetadata": true` (required for NestJS)
  - `nest-cli.json` at project root
  - `main.ts` with `NestFactory.create(AppModule)`
  - Directory conventions:
    - `src/modules/<domain>/<domain>.module.ts`
    - `src/modules/<domain>/entities/*.entity.ts`
    - `src/modules/<domain>/schemas/*.schema.ts`
    - `src/modules/<domain>/dto/*.dto.ts`
  - Module files: `*.module.ts` with `@Module({ imports: [...], controllers: [...], providers: [...] })`
- **Entity Definition Style**: NestJS wires ORM-specific entities into its dependency injection system via module declarations. The module file is the map of which entities belong to which domain.
  ```ts
  @Module({
    imports: [
      TypeOrmModule.forFeature([User, Order, Product]),
      // OR
      MongooseModule.forFeature([
        { name: User.name, schema: UserSchema },
        { name: Order.name, schema: OrderSchema },
      ]),
    ],
    controllers: [UsersController],
    providers: [UsersService],
  })
  export class UsersModule {}
  ```
- **Extraction Approach**:
  1. Detect NestJS from `@nestjs/core` in dependencies and presence of `nest-cli.json`.
  2. Check which ORM module is in use from `@nestjs/typeorm`, `@nestjs/mongoose`, `@nestjs/sequelize`, `@mikro-orm/nestjs`.
  3. Scan all `*.module.ts` files for ORM feature module calls:
     - **TypeORM**: `TypeOrmModule.forFeature([UserEntity, OrderEntity])` — array items are entity class references. Follow each class reference to its definition file.
     - **Mongoose**: `MongooseModule.forFeature([{ name: 'User', schema: UserSchema }, ...])` — extract `name` strings (these are the Mongoose model names, not necessarily collection names; derive collection name from model name).
     - **Sequelize**: `SequelizeModule.forFeature([User, Order])` — array items are Sequelize model classes.
     - **MikroORM**: `MikroOrmModule.forFeature([User, Order])` or `MikroOrmModule.forFeature({ entities: [User, Order] })` — array items are entity classes.
  4. For Prisma with NestJS: look for `PrismaService` injection (`@Injectable() export class PrismaService extends PrismaClient {}`) and refer to `prisma/schema.prisma` for entity definitions.
  5. TypeScript advantage: class references in `forFeature([User, Order])` are TypeScript class identifiers that directly link to entity class definitions — follow the import to find the class decorated with `@Entity()`.
  6. **File naming convention scan** (high reliability):
     - All `*.entity.ts` files → TypeORM entities
     - All `*.schema.ts` files → Mongoose schemas
     - Confirm by checking for `@Entity()` / `new Schema()` within each file
  7. Check `@InjectRepository(User)` in service constructors — confirms which entity classes have active repositories.
- **Key Challenges**:
  - `TypeOrmModule.forRootAsync(...)` / `MongooseModule.forRootAsync(...)` — dynamic root config; entity list is still in `forFeature()`.
  - Multi-tenancy patterns may use dynamic connections — entity resolution becomes runtime-dependent.
  - NestJS multi-database: `TypeOrmModule.forFeature([...], 'analytics')` — second argument is the connection name; entities belong to specific connections.
  - Modules may be in deeply nested directories or organized by feature vs. layer.
  - `@Global()` modules make providers available application-wide; globally registered entity modules should be included.
  - Circular dependencies between modules (resolved via `forwardRef()`) may complicate import tracing.
- **Analysis Tools**: `@typescript-eslint/parser` (TypeScript is the norm in NestJS); `ts-morph` for import resolution and class definition lookup.
- **Complexity**: Medium (NestJS file conventions significantly narrow the search space)

---

## 28. Repository Detection Plan

Given an arbitrary TypeScript repository, use the following strategy to determine which data storage approaches are in use and extract entity names.

> **Note**: This plan extends the [JavaScript repository detection plan](../javascript/data-entity-storage-methods.md#27-repository-detection-plan). TypeScript-specific steps are added here.

---

### Phase 0: TypeScript Environment Check

Before scanning for entities, confirm the TypeScript setup:

1. Check for `tsconfig.json` at project root (and workspace-level `tsconfig.json` in monorepos).
2. Check `tsconfig.json` for `"experimentalDecorators": true` → signals TypeORM, MikroORM, type-graphql, Typegoose, NestJS, or class-validator.
3. Check `tsconfig.json` for `"emitDecoratorMetadata": true` → signals TypeORM, MikroORM, type-graphql, NestJS (required for runtime type reflection).
4. Check `tsconfig.json` `paths` / `baseUrl` for path aliases — these affect import resolution during entity file tracing.
5. Check for `nest-cli.json` → signals NestJS project.
6. Check for `tsup.config.ts`, `rollup.config.ts`, `vite.config.ts` → signals the build tool (affects output paths but not source analysis).

---

### Phase 1: Dependency Analysis

Parse `package.json` for the full list of known frameworks. See [JavaScript Phase 1](../javascript/data-entity-storage-methods.md#phase-1-dependency-analysis-highest-confidence-lowest-effort).

TypeScript-specific additions:

| Package Name | TypeScript Signal |
|---|---|
| `typeorm` + `"experimentalDecorators": true` in tsconfig | TypeORM with TS decorators |
| `@typegoose/typegoose` | Typegoose (TS-native Mongoose wrapper) |
| `type-graphql` | type-graphql GraphQL entities |
| `nexus` | Nexus GraphQL schema |
| `@pothos/core` | Pothos GraphQL schema builder |
| `@nestjs/core` | NestJS framework (check sub-packages) |
| `@nestjs/typeorm` | NestJS + TypeORM |
| `@nestjs/mongoose` | NestJS + Mongoose |
| `@nestjs/sequelize` | NestJS + Sequelize |
| `@mikro-orm/nestjs` | NestJS + MikroORM |
| `ts-morph` | May indicate MikroORM TsMorphMetadataProvider |
| `reflect-metadata` | Confirms decorator-based ORM (TypeORM, MikroORM, type-graphql, NestJS) |
| `kysely-codegen` | Kysely with auto-generated Database interface |

---

### Phase 2: File System Signals

Same as [JavaScript Phase 2](../javascript/data-entity-storage-methods.md#phase-2-file-system-signals-high-confidence).

TypeScript-specific file patterns:

```
tsconfig.json                        (TS environment confirmation)
nest-cli.json                        (NestJS framework signal)
src/**/*.entity.ts                   (TypeORM / NestJS TypeORM entities)
src/**/*.schema.ts                   (Mongoose / NestJS Mongoose schemas)
src/**/*.model.ts                    (Sequelize / MikroORM models)
src/**/*.module.ts                   (NestJS module files with forFeature() calls)
src/db/types.ts                      (Kysely Database interface)
src/database.ts                      (Kysely db setup)
drizzle.config.ts                    (Drizzle ORM TypeScript config)
mikro-orm.config.ts                  (MikroORM TypeScript config)
data-source.ts                       (TypeORM DataSource)
```

---

### Phase 3: Import Pattern Scanning

Same as JavaScript Phase 3 but use `@typescript-eslint/parser` instead of `acorn` for `.ts` files.

TypeScript-specific import patterns to scan:

```
/from ['"]@typegoose\/typegoose['"]/
/from ['"]type-graphql['"]/
/from ['"]nexus['"]/
/from ['"]@pothos\/core['"]/
/from ['"]@nestjs\/typeorm['"]/
/from ['"]@nestjs\/mongoose['"]/
/from ['"]@nestjs\/sequelize['"]/
/from ['"]@mikro-orm\/nestjs['"]/
/from ['"]sequelize-typescript['"]/
```

---

### Phase 4: Entity Extraction (Per-Approach)

TypeScript-specific extraction notes (supplements [JavaScript Phase 4](../javascript/data-entity-storage-methods.md#phase-4-entity-extraction-per-approach)):

| Approach | TypeScript Advantage |
|---|---|
| Prisma | Same as JS. `@prisma/internals` `getDMMF()` works identically. |
| TypeORM | `@typescript-eslint/parser` handles TS class decorators natively. TS `abstract` keyword = no table. |
| Drizzle ORM | `Database` type exports and `$inferSelect` types confirm entity status. |
| MikroORM | `ts-morph` can fully resolve `TsMorphMetadataProvider` entities without decorators. |
| Mongoose | Generic types `<IUser>` provide supplementary entity name signal. |
| Typegoose | TS decorator AST is cleanly parseable; `getModelForClass(User)` directly references entity class. |
| Kysely | `Database` interface keys are the exact table names; TypeScript makes this the single source of truth. |
| NestJS | `*.entity.ts` / `*.schema.ts` naming + `forFeature([...])` class references — highly reliable. |
| type-graphql | `@ObjectType()` on classes; TypeScript class names and field types are typed. |
| Nexus / Pothos | Code-first GraphQL with TS inference; `objectType` calls are clearly named. |
| Zod | `z.infer<typeof XSchema>` type alias names supplement schema variable names. |

---

### Phase 5: Cross-Validation and Confidence Scoring

Same as [JavaScript Phase 5](../javascript/data-entity-storage-methods.md#phase-5-cross-validation-and-deduplication).

TypeScript-specific cross-validation opportunities:

1. **TypeORM + class-validator co-location**: A class with both `@Entity()` and `@IsEmail()` is a confirmed entity with validation.
2. **NestJS module + entity file name**: `TypeOrmModule.forFeature([User])` in `users.module.ts` + `users.entity.ts` file in the same directory → high-confidence entity.
3. **Kysely `Database` interface + query calls**: If the `Database` interface lists `users` and queries use `db.selectFrom('users')`, 100% confirmation.
4. **type-graphql `@ObjectType()` + `@Entity()`**: A class with both decorators is both a GraphQL type and a DB entity.
5. **Zod schema + ORM**: `UserSchema = z.object(...)` co-located in the same file as `UserEntity` (TypeORM) → Zod schema is a validation layer over the entity.
6. **`ts-morph` type tracing**: For MikroORM's `TsMorphMetadataProvider`, use `ts-morph` to trace which classes are registered in the MikroORM config's `entities` list — these are entities even without decorators.

---

### Recommended Tooling Stack (TypeScript Projects)

| Task | Recommended Tool |
|---|---|
| TypeScript AST parsing | `@typescript-eslint/parser` (primary) |
| TypeScript type resolution | `ts-morph` (for imports, generics, interface lookup) |
| TypeScript compilation | `typescript` compiler API (`ts.createProgram`) for full type info |
| JavaScript AST fallback | `@babel/parser` |
| SQL parsing | `node-sql-parser` (multi-dialect) |
| PostgreSQL SQL | `pgsql-ast-parser` |
| GraphQL SDL parsing | `graphql` package (`parse()`) |
| YAML parsing | `js-yaml` |
| File globbing | `fast-glob` |
| Prisma schema | `@prisma/internals` (`getDMMF()`) |
| OpenAPI $ref resolution | `@apidevtools/swagger-parser` |
| Tree-sitter (optional) | `tree-sitter` + `tree-sitter-typescript` |

---

### TypeScript-Specific Analysis Priorities

When a TypeScript repository is detected, prioritize these extraction approaches in order of reliability:

1. **Prisma `schema.prisma`** — single file, unambiguous, `getDMMF()` gives perfect results.
2. **Drizzle `Database` interface / schema file** — TS-native; `pgTable('name', ...)` first argument is exact.
3. **Kysely `Database` interface** — if present, gives 100% accurate table list.
4. **TypeORM `*.entity.ts` files** — well-defined naming convention; `@Entity()` decorator is clear.
5. **MikroORM `@Entity()` decorators** — same as TypeORM; `ts-morph` handles TsMorphMetadataProvider.
6. **NestJS `*.module.ts` `forFeature()` calls** — module-to-entity mapping is explicit.
7. **Typegoose `getModelForClass()` calls** — directly references entity classes.
8. **Mongoose `model()` calls** — extractable string arguments.
9. **Hasura metadata YAML** — structured, unambiguous.
10. **Migration file `createTable()` / SQL `CREATE TABLE`** — historical record; cross-validate with ORM.
11. **GraphQL `@ObjectType()` / `objectType()`** — good signal when cross-referenced with ORM.
12. **Raw SQL in query calls** — high effort, lower confidence.
13. **Zod schemas** — supplementary only.
14. **OpenAPI schemas** — supplementary only.
