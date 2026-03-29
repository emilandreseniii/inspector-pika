# Dart / Flutter: Data Entity Storage Methods

A comprehensive catalog of Dart and Flutter frameworks, libraries, and approaches for data entity storage, aimed at supporting automated static analysis to extract database tables, document collections, and other named data entities from Dart/Flutter repositories.

---

## Table of Contents

1. [Drift (formerly Moor)](#1-drift-formerly-moor)
2. [sqflite](#2-sqflite)
3. [ObjectBox](#3-objectbox)
4. [Hive](#4-hive)
5. [Isar](#5-isar)
6. [Floor](#6-floor)
7. [Firebase Cloud Firestore (FlutterFire)](#7-firebase-cloud-firestore-flutterfire)
8. [Firebase Realtime Database](#8-firebase-realtime-database)
9. [Realm Dart](#9-realm-dart)
10. [Sembast](#10-sembast)
11. [SharedPreferences](#11-sharedpreferences)
12. [Supabase Flutter Client](#12-supabase-flutter-client)
13. [Drift Migrations](#13-drift-migrations)
14. [Raw SQL in sqflite](#14-raw-sql-in-sqflite)
15. [Freezed + json_serializable (Entity Signal)](#15-freezed--json_serializable-entity-signal)
16. [Protobuf (protobuf Dart)](#16-protobuf-protobuf-dart)
17. [OpenAPI-Generated Models](#17-openapi-generated-models)
18. [Repository Detection Plan](#repository-detection-plan)

---

## 1. Drift (formerly Moor)

- **Name**: Drift (previously Moor)
- **Type**: Relational ORM / Type-Safe SQL
- **Supported Databases**: SQLite (primary), with experimental PostgreSQL support via `drift_postgres`
- **Detection Signals**:
  - `pubspec.yaml` dependencies: `drift`, `drift_flutter` (runtime); `drift_dev`, `build_runner` (dev)
  - Legacy name: `moor`, `moor_flutter` (pre-2021)
  - Import paths: `import 'package:drift/drift.dart'`, `import 'package:moor/moor.dart'`
  - Class patterns: classes extending `Table` (Drift table definitions); class annotated with `@DriftDatabase`; `@DataClassName('...')` annotation
  - Generated files: `*.drift.dart`, `*.g.dart` (build_runner output)
  - `.drift` schema files: `*.drift` containing SQL-like Drift DSL
  - Database class annotated with `@DriftDatabase(tables: [...])`
- **Entity Definition Style**:
  - Dart classes extending `Table` define tables. Column definitions use getter methods returning typed column builders. Table name defaults to snake_case of the class name, overridable via `get tableName => '...'`.
  - Example:
    ```dart
    class Users extends Table {
      IntColumn get id => integer().autoIncrement()();
      TextColumn get name => text().withLength(min: 1, max: 50)();
      TextColumn get email => text().unique()();

      @override
      String get tableName => 'users';
    }

    @DriftDatabase(tables: [Users, Posts])
    class AppDatabase extends _$AppDatabase { ... }
    ```
  - Alternatively, `.drift` files define tables using SQL-like syntax:
    ```sql
    CREATE TABLE users (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    );
    ```
- **Extraction Approach**:
  1. Detect `drift` or `moor` in `pubspec.yaml`.
  2. Find all Dart files; parse for classes extending `Table` (or `MoorTable` for legacy).
  3. For each `Table` subclass:
     a. Check for `String get tableName =>` getter — use the string literal return value.
     b. If absent, apply Drift's default: snake_case plural of class name (e.g., `UserProfile` → `user_profiles`). Note: Drift uses the class name converted to snake_case; verify pluralization rules.
     c. Extract column names from getter names (e.g., `IntColumn get userId` → column `user_id`).
  4. Find `@DriftDatabase(tables: [...])` annotation arguments — enumerate table classes listed.
  5. Parse `.drift` files for `CREATE TABLE` SQL statements.
  6. Scan generated `*.drift.dart` / `*.g.dart` files for `TableInfo` implementations as a secondary source.
- **Key Challenges**:
  - Column names in Drift are derived from getter names converted to snake_case — requires getter name parsing.
  - `.drift` files use a Drift-specific SQL dialect; standard SQL parsers may need adjustments.
  - Generated files (`*.g.dart`) may be gitignored — always prefer source `Table` classes.
  - Legacy `moor` and current `drift` have identical patterns but different import paths.
- **Analysis Tools**: Dart analyzer (`package:analyzer`); tree-sitter Dart grammar; regex for annotation parsing; SQL parser for `.drift` files.
- **Complexity**: Low to Medium

---

## 2. sqflite

- **Name**: sqflite
- **Type**: SQLite Wrapper / Raw SQL
- **Supported Databases**: SQLite (mobile/desktop via Flutter)
- **Detection Signals**:
  - `pubspec.yaml` dependency: `sqflite`, `sqflite_common_ffi` (desktop)
  - Import paths: `import 'package:sqflite/sqflite.dart'`
  - Call patterns: `openDatabase(...)`, `db.execute(...)`, `db.query(...)`, `db.insert(...)`, `db.rawQuery(...)`, `db.rawInsert(...)`, `db.rawUpdate(...)`
  - `onCreate` callback in `openDatabase` — contains `CREATE TABLE` DDL
  - String literals with SQL content
- **Entity Definition Style**:
  - No Dart class annotations. Tables defined entirely in raw SQL strings passed to `db.execute(...)` or the `onCreate`/`onUpgrade` callbacks of `openDatabase`.
  - Example:
    ```dart
    await db.execute('''
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE
      )
    ''');
    ```
- **Extraction Approach**:
  1. Detect `sqflite` in `pubspec.yaml`.
  2. Find `openDatabase(...)` call expressions — locate the `onCreate` named argument.
  3. Within `onCreate` function body, extract `db.execute(...)` string literal arguments.
  4. Parse SQL strings for `CREATE TABLE` statements.
  5. Also scan entire codebase for `db.execute(...)`, `db.rawQuery(...)` string literals with `CREATE TABLE`.
  6. Look for `onUpgrade` callbacks — extract `ALTER TABLE` / new `CREATE TABLE` statements.
- **Key Challenges**:
  - SQL strings often span multiple lines using triple-quoted strings (`'''...'''`).
  - Migration logic in `onUpgrade` may be version-branched — requires control-flow-aware analysis.
  - SQL built via string concatenation or interpolation is not statically extractable.
  - Helper classes wrapping `sqflite` may abstract the SQL further.
- **Analysis Tools**: `package:analyzer`; tree-sitter Dart grammar; SQL parser; regex for triple-quoted string extraction.
- **Complexity**: High

---

## 3. ObjectBox

- **Name**: ObjectBox
- **Type**: NoSQL / Object Persistence
- **Supported Databases**: ObjectBox (embedded, proprietary)
- **Detection Signals**:
  - `pubspec.yaml` dependencies: `objectbox`, `objectbox_flutter_libs` or `objectbox_sync_flutter_libs`; dev: `objectbox_generator`, `build_runner`
  - Import paths: `import 'package:objectbox/objectbox.dart'`
  - Annotations: `@Entity()` on class declarations; `@Id()` on integer field; `@Property(type: PropertyType.*)` on fields; `@Transient()` to exclude fields; `@Backlink()` for relations
  - Generated files: `objectbox.g.dart`, `objectbox-model.json`
  - Config: `objectbox-model.json` — persisted entity model in JSON format
- **Entity Definition Style**:
  - Plain Dart classes annotated with `@Entity()`. The class name becomes the entity (box) name. No explicit table name — ObjectBox uses the class name directly.
  - Example:
    ```dart
    @Entity()
    class User {
      @Id()
      int id = 0;

      String name;
      String email;

      User({required this.name, required this.email});
    }
    ```
- **Extraction Approach**:
  1. Detect `objectbox` in `pubspec.yaml`.
  2. **Primary**: Parse `objectbox-model.json` — it contains a canonical `entities` array with `name`, `id`, and `properties` for each entity.
  3. **Secondary**: Find Dart classes annotated with `@Entity()` — class name is the entity name.
  4. Extract fields; `@Id()` marks the primary key field. `@Property()` can override the stored property name.
  5. `@Transient()` fields are excluded from storage.
- **Key Challenges**:
  - `objectbox-model.json` is the authoritative model file but may be gitignored in some projects.
  - Relations (`ToOne<T>`, `ToMany<T>`) reference other entities by type — resolve type names.
- **Analysis Tools**: JSON parser for `objectbox-model.json`; `package:analyzer` for annotation parsing.
- **Complexity**: Low (`objectbox-model.json` is authoritative and machine-readable)

---

## 4. Hive

- **Name**: Hive
- **Type**: NoSQL / Key-Value / Lightweight Object Store
- **Supported Databases**: Hive (embedded, custom binary format)
- **Detection Signals**:
  - `pubspec.yaml` dependencies: `hive`, `hive_flutter`; dev: `hive_generator`, `build_runner`
  - Import paths: `import 'package:hive/hive.dart'`, `import 'package:hive_flutter/hive_flutter.dart'`
  - Annotations: `@HiveType(typeId: N)` on class; `@HiveField(N)` on fields
  - Generated files: `*.g.dart` containing `TypeAdapter` implementations (e.g., `UserAdapter`)
  - Call patterns: `Hive.openBox<User>('users')`, `Hive.box('boxName')`, `Hive.openLazyBox('name')`
  - Box names as string literals in `openBox` / `box` calls
- **Entity Definition Style**:
  - Dart classes annotated with `@HiveType(typeId: N)`. Box names (analogous to collection names) appear as string literals in `Hive.openBox('name')` calls.
  - Example:
    ```dart
    @HiveType(typeId: 0)
    class User extends HiveObject {
      @HiveField(0)
      late String name;

      @HiveField(1)
      late String email;
    }
    // Usage:
    final box = await Hive.openBox<User>('users');
    ```
- **Extraction Approach**:
  1. Detect `hive` in `pubspec.yaml`.
  2. Find classes annotated with `@HiveType(typeId: N)` — these are stored entity types.
  3. Extract `typeId` values; each unique `typeId` corresponds to a distinct entity type.
  4. Scan for `Hive.openBox('literal')` and `Hive.openBox<Type>('literal')` call expressions — extract box name string literals.
  5. Correlate `Type` parameter in `openBox<Type>` with `@HiveType` classes.
  6. Fields annotated with `@HiveField(N)` are stored properties.
- **Key Challenges**:
  - Box names are purely runtime strings — no static annotation links class to box name.
  - Multiple boxes may hold the same type; one box may hold multiple types (dynamic box).
  - `Hive.box('name')` (without type param) is untyped — entity type unknown statically.
- **Analysis Tools**: `package:analyzer`; tree-sitter Dart grammar; `go/ast`-equivalent for Dart.
- **Complexity**: Medium

---

## 5. Isar

- **Name**: Isar
- **Type**: NoSQL / Embedded Document Store
- **Supported Databases**: Isar (embedded, high-performance)
- **Detection Signals**:
  - `pubspec.yaml` dependencies: `isar`, `isar_flutter_libs`; dev: `isar_generator`, `build_runner`
  - Import paths: `import 'package:isar/isar.dart'`
  - Annotations: `@collection` on class (Isar v3+); `@Collection()` (Isar v2); `@Id` on primary key field; `@Index(...)` on indexed fields; `@Ignore` to exclude fields; `@embedded` for embedded objects
  - Generated files: `*.g.dart` with `IsarCollection` implementations
  - Call patterns: `Isar.open(schemas: [UserSchema, ...])` — schema list is a strong signal
- **Entity Definition Style**:
  - Dart classes annotated with `@collection`. The class name is the collection name. Collection name can be overridden via `@Collection(accessor: 'customName')`.
  - Example:
    ```dart
    @collection
    class User {
      Id id = Isar.autoIncrement;
      late String name;
      late String email;

      @Index(type: IndexType.value)
      late String username;
    }
    ```
- **Extraction Approach**:
  1. Detect `isar` in `pubspec.yaml`.
  2. Find classes annotated with `@collection` or `@Collection()`.
  3. Class name is the collection name (camelCase, as-is in Isar v3).
  4. Check for `@Collection(accessor: 'name')` — use the accessor value if present.
  5. Scan `Isar.open(schemas: [UserSchema, PostSchema])` — `*Schema` constant names directly reveal entity names (strip `Schema` suffix).
  6. Fields with `@Ignore` are excluded; `@embedded` classes are sub-entities.
- **Key Challenges**:
  - Isar v2 vs. v3 have different annotation names (`@Collection()` vs. `@collection`).
  - `@embedded` objects are not top-level collections but are important sub-entity signals.
  - Generated `*Schema` constants in `*.g.dart` are the most reliable extraction target but may be gitignored.
- **Analysis Tools**: `package:analyzer`; tree-sitter Dart grammar; annotation parsing.
- **Complexity**: Low to Medium

---

## 6. Floor

- **Name**: Floor
- **Type**: Relational ORM (Room-inspired)
- **Supported Databases**: SQLite (via sqflite)
- **Detection Signals**:
  - `pubspec.yaml` dependencies: `floor`; dev: `floor_generator`, `build_runner`
  - Import paths: `import 'package:floor/floor.dart'`
  - Annotations: `@entity` or `@Entity(tableName: 'name')` on class; `@primaryKey` / `@PrimaryKey(autoGenerate: true)` on field; `@ColumnInfo(name: 'col')` on field; `@dao` on abstract class; `@database` on abstract class with `@Database(version: N, entities: [...])`
  - Generated files: `*.g.dart` with database implementation
  - DAO annotations: `@Query('SELECT ...')`, `@insert`, `@update`, `@delete`
- **Entity Definition Style**:
  - Dart classes annotated with `@entity` (Room-style). Table name from `@Entity(tableName: 'name')` or defaults to snake_case of class name.
  - Example:
    ```dart
    @Entity(tableName: 'users')
    class User {
      @PrimaryKey(autoGenerate: true)
      final int? id;

      @ColumnInfo(name: 'full_name')
      final String name;

      const User({this.id, required this.name});
    }

    @Database(version: 1, entities: [User, Post])
    abstract class AppDatabase extends FloorDatabase { ... }
    ```
- **Extraction Approach**:
  1. Detect `floor` in `pubspec.yaml`.
  2. Find classes annotated with `@entity` or `@Entity(...)`.
  3. Check `@Entity(tableName: 'literal')` — use the literal value as table name.
  4. If absent, apply Floor's default: snake_case of class name.
  5. Extract column names from `@ColumnInfo(name: 'col')` annotations; fall back to field names (snake_case).
  6. Find `@Database(entities: [User, Post, ...])` annotations — enumerate all entity classes.
  7. Parse DAO `@Query` annotations for SQL strings — extract additional table references.
- **Key Challenges**:
  - Floor mirrors Android Room's pattern very closely — knowledge of Room translates directly.
  - `@ForeignKey` annotations reference other entity classes — resolve cross-entity relationships.
  - Migrations defined as `Migration(from, to, (db) => db.execute(...))` — parse SQL in execute calls.
- **Analysis Tools**: `package:analyzer`; tree-sitter Dart grammar; SQL parser for `@Query` strings.
- **Complexity**: Low

---

## 7. Firebase Cloud Firestore (FlutterFire)

- **Name**: Firebase Cloud Firestore (FlutterFire)
- **Type**: NoSQL (Document Store)
- **Supported Databases**: Google Cloud Firestore
- **Detection Signals**:
  - `pubspec.yaml` dependency: `cloud_firestore`
  - Import paths: `import 'package:cloud_firestore/cloud_firestore.dart'`
  - Call patterns: `FirebaseFirestore.instance.collection('name')`, `.doc('id')`, `.collectionGroup('name')`
  - String literals in `.collection('name')` calls
  - `@Collection('path')` annotation (if using `firebase_dart_utilities` or custom wrappers)
  - Typed converters: `withConverter<User>(fromFirestore: ..., toFirestore: ...)` — type argument is entity class
- **Entity Definition Style**:
  - No Dart-level schema annotation for Firestore. Collections named via string literals. Documents represented by plain Dart classes (often with `fromJson`/`toJson` or `fromFirestore`/`toFirestore` methods).
  - Example:
    ```dart
    final usersCollection = FirebaseFirestore.instance.collection('users');
    final snapshot = await usersCollection.withConverter<User>(
      fromFirestore: (snap, _) => User.fromJson(snap.data()!),
      toFirestore: (user, _) => user.toJson(),
    ).get();
    ```
- **Extraction Approach**:
  1. Detect `cloud_firestore` in `pubspec.yaml`.
  2. Scan for `.collection('literal')` call expressions — extract string argument as collection name.
  3. Scan for `.collectionGroup('literal')` — extract collection group name.
  4. Extract nested subcollection paths: `doc.collection('subcollection_name')`.
  5. Find `withConverter<TypeName>(...)` calls — `TypeName` is the Dart entity class for that collection.
  6. Scan for classes with `fromFirestore` factory constructors or `toFirestore` methods as entity signals.
- **Key Challenges**:
  - Subcollection paths (`users/{uid}/posts`) may be built dynamically.
  - No single registration point for all collections — must scan entire codebase.
  - Collection names in constants or variables require constant propagation.
  - FirebaseFirestore typed wrappers (`CollectionReference<User>`) provide type info — parse generic type arguments.
- **Analysis Tools**: `package:analyzer`; tree-sitter Dart grammar; regex for string literal extraction.
- **Complexity**: Medium

---

## 8. Firebase Realtime Database

- **Name**: Firebase Realtime Database (FlutterFire)
- **Type**: NoSQL (JSON Tree / Key-Value)
- **Supported Databases**: Firebase Realtime Database
- **Detection Signals**:
  - `pubspec.yaml` dependency: `firebase_database`
  - Import paths: `import 'package:firebase_database/firebase_database.dart'`
  - Call patterns: `FirebaseDatabase.instance.ref('path')`, `db.ref().child('name')`, `.set(...)`, `.push()`, `.onValue`
  - String literals in `.ref('path')` and `.child('name')` calls
- **Entity Definition Style**:
  - Hierarchical JSON tree. "Entities" are path segments in the reference tree. No Dart class annotations; data models are plain Dart classes with `fromJson`/`toJson`.
  - Example:
    ```dart
    final userRef = FirebaseDatabase.instance.ref('users');
    final postRef = FirebaseDatabase.instance.ref('users/$uid/posts');
    ```
- **Extraction Approach**:
  1. Detect `firebase_database` in `pubspec.yaml`.
  2. Scan for `.ref('literal')` and `.child('literal')` call expressions.
  3. Extract all string path literals — split on `/` to get individual path segments.
  4. Top-level path segments (`users`, `posts`) are primary entity names.
  5. Parameterized segments (e.g., `$uid`, `${userId}`) indicate dynamic keys — strip and treat surrounding segments as entity names.
- **Key Challenges**:
  - All-dynamic paths (no literal segments) cannot be extracted statically.
  - Path structure is nested; distinguishing entity types from record IDs in the path requires heuristics.
  - String interpolation in paths (`'users/$uid'`) — extract literal prefix up to interpolation point.
- **Analysis Tools**: `package:analyzer`; tree-sitter Dart grammar; regex for string literal and interpolation parsing.
- **Complexity**: High

---

## 9. Realm Dart

- **Name**: Realm Dart (Atlas Device SDK for Dart)
- **Type**: NoSQL / Object Store
- **Supported Databases**: Realm (embedded), MongoDB Atlas (sync)
- **Detection Signals**:
  - `pubspec.yaml` dependencies: `realm`, `realm_dart`; dev: `realm` (generator built-in)
  - Import paths: `import 'package:realm/realm.dart'`
  - Annotations: `@RealmModel()` on a private class (generator pattern); generated public class extends `_$ClassName`; `@PrimaryKey()` on key field; `@Indexed()` on indexed field; `@Ignored()` to exclude; `@MapTo('name')` to rename property
  - Generated files: `*.realm.dart` (generated by `dart run realm generate`)
  - Call patterns: `Realm(Configuration.local([User.schema, Post.schema]))` — schema list
  - `RealmObject` base class in generated files
- **Entity Definition Style**:
  - Private Dart class annotated with `@RealmModel()`. Code generator creates a public `RealmObject` subclass. The class name (without leading `_`) is the Realm class name.
  - Example:
    ```dart
    // Source (user-written):
    part 'user.realm.dart';

    @RealmModel()
    class _User {
      @PrimaryKey()
      late ObjectId id;
      late String name;
      late String email;
    }
    // Generated: class User extends _$User implements RealmObject { ... }
    ```
- **Extraction Approach**:
  1. Detect `realm` in `pubspec.yaml`.
  2. Find classes annotated with `@RealmModel()` — strip the leading `_` from the class name to get the Realm class/entity name.
  3. Check `@MapTo('name')` on class to get the schema name override.
  4. Extract fields; `@PrimaryKey()` marks the primary key; `@Ignored()` fields are excluded.
  5. Scan `Realm(Configuration.local([User.schema, ...]))` or `Configuration.flexibleSync(user, [User.schema, ...])` — `*.schema` references enumerate active entities.
  6. Parse `*.realm.dart` generated files as a secondary source.
- **Key Challenges**:
  - The `@RealmModel()` / `_PrivateClass` → generated public class pattern is unusual — must strip the `_` prefix.
  - Embedded objects (annotated with `@RealmModel()` + `@embedded`) are sub-entities, not top-level collections.
  - Atlas Sync adds MongoDB collection names — may differ from Realm class names.
- **Analysis Tools**: `package:analyzer`; tree-sitter Dart grammar.
- **Complexity**: Medium

---

## 10. Sembast

- **Name**: Sembast (Simple Embedded Application Store)
- **Type**: NoSQL / Semi-Structured Document Store
- **Supported Databases**: Sembast (embedded, file-based JSON)
- **Detection Signals**:
  - `pubspec.yaml` dependency: `sembast`, `sembast_web` (web), `sembast_sqflite` (SQLite backend)
  - Import paths: `import 'package:sembast/sembast.dart'`
  - Call patterns: `StoreRef<int, Map<String, dynamic>>.main()`, `StoreRef.main()`, `intMapStoreFactory.store('name')`, `stringMapStoreFactory.store('name')`, `StoreRef<K, V>('store_name')`
  - String literals in `store('name')` and `StoreRef<K,V>('name')` constructors
- **Entity Definition Style**:
  - Stores (analogous to collections/tables) named via string literals. No Dart class annotations; records are plain `Map<String, dynamic>` or typed via custom codec.
  - Example:
    ```dart
    final userStore = intMapStoreFactory.store('users');
    final postStore = stringMapStoreFactory.store('posts');
    ```
- **Extraction Approach**:
  1. Detect `sembast` in `pubspec.yaml`.
  2. Scan for `StoreRef('literal')`, `intMapStoreFactory.store('literal')`, `stringMapStoreFactory.store('literal')` call expressions.
  3. Extract the string literal argument as the store (entity) name.
  4. `StoreRef.main()` is the default unnamed store — flag as an unnamed entity.
  5. Look for `const` declarations of store references — common pattern for centralizing store names.
- **Key Challenges**:
  - Store names may be defined as `const` strings in a dedicated file — resolve constant references.
  - Sembast has no schema; entity shape is inferred from inserted maps.
  - Low signal strength compared to annotated ORMs.
- **Analysis Tools**: `package:analyzer`; tree-sitter Dart grammar.
- **Complexity**: Medium

---

## 11. SharedPreferences

- **Name**: SharedPreferences
- **Type**: Key-Value Store (simple persistence)
- **Supported Databases**: Platform key-value storage (Android SharedPreferences, iOS NSUserDefaults, web localStorage)
- **Detection Signals**:
  - `pubspec.yaml` dependency: `shared_preferences`
  - Import paths: `import 'package:shared_preferences/shared_preferences.dart'`
  - Call patterns: `prefs.getString('key')`, `prefs.setString('key', ...)`, `prefs.getBool('key')`, `prefs.setInt('key', ...)`
  - String literals used as preference keys
- **Entity Definition Style**:
  - No schema or class annotations. "Entities" are individual key strings. Commonly, keys are grouped by a prefix convention (e.g., `"user_name"`, `"user_email"`) implying a logical entity.
- **Extraction Approach**:
  1. Detect `shared_preferences` in `pubspec.yaml`.
  2. Extract string literal arguments to `prefs.get*`/`prefs.set*` calls.
  3. Apply prefix extraction heuristic: extract the segment before the first `_` as a logical entity group.
  4. Also scan for `const String` declarations used as preference keys — common pattern.
- **Key Challenges**:
  - SharedPreferences is not a database — keys represent individual settings, not structured entities. Very low confidence as a data entity signal.
  - Key naming is ad-hoc; prefix heuristics produce noisy results.
  - Recommend marking these as `type: "key_value_preference"` rather than database entities.
- **Analysis Tools**: `package:analyzer`; regex for string literal extraction.
- **Complexity**: Low (extraction is easy) but signal value is low

---

## 12. Supabase Flutter Client

- **Name**: Supabase Flutter Client
- **Type**: BaaS Client (REST + Realtime + GraphQL over PostgreSQL)
- **Supported Databases**: PostgreSQL (via Supabase)
- **Detection Signals**:
  - `pubspec.yaml` dependency: `supabase_flutter`, `supabase`
  - Import paths: `import 'package:supabase_flutter/supabase_flutter.dart'`
  - Call patterns: `supabase.from('table_name')`, `supabase.from('table').select(...)`, `.from('table').insert(...)`, `.from('table').upsert(...)`
  - String literals in `.from('table')` calls
  - RPC calls: `supabase.rpc('function_name')` — PostgreSQL function names
  - Realtime: `supabase.channel('name').on(RealtimeChannel, SupabaseEventTypes.all, table: 'name', ...)`
- **Entity Definition Style**:
  - No Dart class annotations for schema. Table names appear as string literals in `.from('table')` PostgREST-style queries. Dart classes used for deserialization are plain classes with `fromJson`.
  - Example:
    ```dart
    final response = await supabase
        .from('users')
        .select('id, name, email')
        .eq('id', userId);
    ```
- **Extraction Approach**:
  1. Detect `supabase_flutter` or `supabase` in `pubspec.yaml`.
  2. Scan for `.from('literal')` call expressions — extract the string argument as the PostgreSQL table name.
  3. Scan for `.rpc('literal')` — PostgreSQL function names (may indicate stored procedure-backed entities).
  4. Scan Realtime subscription calls: `.on(..., table: 'literal', ...)` — extract `table` named argument.
  5. Check if Supabase schema files or migrations are present in the repo (Supabase uses `supabase/migrations/` directory with SQL files) — parse those for `CREATE TABLE`.
  6. `supabase/` directory with `*.sql` migration files is a strong additional signal.
- **Key Challenges**:
  - Table names in `.from(...)` may be variables, especially in generic repository patterns.
  - Supabase migration files in `supabase/migrations/` are the most authoritative source — often present in Flutter repos using Supabase CLI.
- **Analysis Tools**: `package:analyzer`; tree-sitter Dart grammar; SQL parser for migration files.
- **Complexity**: Medium

---

## 13. Drift Migrations

- **Name**: Drift Migrations
- **Type**: Migration Tool (part of Drift)
- **Supported Databases**: SQLite
- **Detection Signals**:
  - Same as Drift (§1): `drift` in `pubspec.yaml`
  - `MigrationStrategy` class usage in the database class `migration` getter
  - `Migrator` API calls: `m.createTable(users)`, `m.addColumn(users, users.email)`, `m.renameTable(...)`
  - `@DriftDatabase` `schemaVersion` field
  - Schema snapshot files: `drift_schemas/drift_schema_v{N}.json` (generated by `drift_dev schema dump`)
- **Entity Definition Style**:
  - Migrations defined in Dart code using the `Migrator` API or raw SQL. Schema versions tracked by `schemaVersion` in the database class. Schema snapshots are JSON files.
  - Example:
    ```dart
    @DriftDatabase(tables: [Users, Posts])
    class AppDatabase extends _$AppDatabase {
      @override
      int get schemaVersion => 2;

      @override
      MigrationStrategy get migration => MigrationStrategy(
        onUpgrade: (m, from, to) async {
          if (from < 2) {
            await m.addColumn(users, users.email);
          }
        },
      );
    }
    ```
- **Extraction Approach**:
  1. Detect Drift (see §1) and locate `MigrationStrategy` usage.
  2. Parse `drift_schemas/drift_schema_v{N}.json` files — these contain complete schema snapshots in JSON format; highest confidence.
  3. Parse `Migrator` API calls in `onUpgrade` — `m.createTable(tableVariable)` reveals new tables; `m.renameTable(...)` reveals renames.
  4. Extract `schemaVersion` value to determine current schema version.
- **Key Challenges**:
  - Schema JSON files (`drift_schema_v*.json`) are the authoritative source but may not be committed.
  - `Migrator` API uses Dart variables (table references), not string names — resolve to table class names.
- **Analysis Tools**: JSON parser for schema files; `package:analyzer` for Dart migration code.
- **Complexity**: Low (JSON schema files) to Medium (Dart migration code)

---

## 14. Raw SQL in sqflite

*(See also §2 — this entry focuses specifically on the static analysis of raw SQL patterns as a distinct extraction target.)*

- **Name**: Raw SQL in sqflite / dart:ffi SQLite bindings
- **Type**: Raw SQL
- **Supported Databases**: SQLite
- **Detection Signals**:
  - `pubspec.yaml` dependency: `sqflite`, `sqlite3`, `sqlite3_flutter_libs`
  - Import paths: `import 'package:sqflite/sqflite.dart'`, `import 'package:sqlite3/sqlite3.dart'`
  - String literals containing `CREATE TABLE`, `INSERT INTO`, `SELECT`, etc.
  - Triple-quoted SQL strings: `'''CREATE TABLE users (...)'''`
  - SQL constants: `const String createUsersTable = 'CREATE TABLE users (...)'`
- **Entity Definition Style**:
  - SQL DDL strings embedded in Dart source. Tables defined by `CREATE TABLE` statements in string literals.
- **Extraction Approach**:
  1. Scan all Dart files for string literals (including triple-quoted) containing SQL keywords.
  2. Regex filter for `CREATE TABLE` patterns: `CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)`.
  3. Parse full `CREATE TABLE` statements to extract column definitions.
  4. Resolve `const` SQL string references — look for concatenation of partial SQL.
  5. Scan `assets/` directory for `.sql` files that may be loaded via `rootBundle.loadString(...)`.
- **Key Challenges**:
  - SQL may be stored in asset files rather than Dart strings — check `pubspec.yaml` `flutter.assets` for `.sql` entries.
  - Multiline string concatenation may split `CREATE TABLE` across multiple literals.
  - Dynamic SQL construction via `StringBuffer` or interpolation is not statically extractable.
- **Analysis Tools**: `package:analyzer`; regex; SQL parser; asset file scanning.
- **Complexity**: High

---

## 15. Freezed + json_serializable (Entity Signal)

- **Name**: Freezed + json_serializable
- **Type**: Code Generation / Immutable Data Classes (Entity Signal Heuristic)
- **Supported Databases**: N/A (serialization layer, not a storage framework)
- **Detection Signals**:
  - `pubspec.yaml` dependencies: `freezed_annotation`, `json_annotation`; dev: `freezed`, `json_serializable`, `build_runner`
  - Import paths: `import 'package:freezed_annotation/freezed_annotation.dart'`
  - Annotations: `@freezed` on class; `@JsonSerializable()` on class or factory constructor; `@JsonKey(name: 'col')` on fields
  - Generated files: `*.freezed.dart`, `*.g.dart`
  - `part 'filename.freezed.dart'` and `part 'filename.g.dart'` directives
  - Class naming conventions: `*Model`, `*Entity`, `*Dto`, `*Record`, `*Response`
  - Directory conventions: `models/`, `entities/`, `data/models/`, `domain/entities/`
- **Entity Definition Style**:
  - Immutable Dart classes with `@freezed` and `@JsonSerializable`. Not storage-specific, but often directly map to database rows or API response/request bodies that mirror storage schema.
  - Example:
    ```dart
    @freezed
    class User with _$User {
      const factory User({
        @JsonKey(name: 'id') required int id,
        @JsonKey(name: 'full_name') required String name,
        required String email,
      }) = _User;

      factory User.fromJson(Map<String, dynamic> json) => _$UserFromJson(json);
    }
    ```
- **Extraction Approach**:
  1. Detect `freezed_annotation` and/or `json_annotation` in `pubspec.yaml`.
  2. Find classes with `@freezed` annotation or `@JsonSerializable()`.
  3. Apply heuristic filters (in order of confidence):
     a. Class in `models/`, `entities/`, `domain/entities/` directory — high confidence.
     b. Class name ends with `Model`, `Entity`, `Record` — medium-high confidence.
     c. Class name ends with `Dto`, `Request`, `Response` — low confidence (likely API DTO).
  4. Extract `@JsonKey(name: 'field')` values as serialized field names.
  5. Cross-reference with detected storage frameworks — Freezed classes referenced by ORM models are high-confidence DB entities.
- **Key Challenges**:
  - Heavy false positive risk: Freezed classes are used pervasively for API DTOs, state objects, config models, etc.
  - Without cross-referencing with a storage framework, these are ambiguous signals.
  - Confidence scoring is essential; standalone Freezed detection should have low base confidence.
- **Analysis Tools**: `package:analyzer`; tree-sitter Dart grammar; directory and naming heuristics.
- **Complexity**: Medium (extraction is easy; disambiguation is hard)

---

## 16. Protobuf (protobuf Dart)

- **Name**: Protocol Buffers (Dart / protobuf)
- **Type**: Schema Definition / Serialization
- **Supported Databases**: N/A (defines data entities independent of storage backend)
- **Detection Signals**:
  - `pubspec.yaml` dependency: `protobuf`; dev: `protoc_plugin` (`protoc-gen-dart`)
  - `.proto` source files in the repository (typically `proto/`, `lib/src/proto/`, `protos/`)
  - Generated Dart files: `*.pb.dart`, `*.pbenum.dart`, `*.pbgrpc.dart`, `*.pbjson.dart`
  - File header in generated files: `// Generated code. Do not modify.` followed by `//  source: *.proto`
  - Import paths in generated files: `import 'package:protobuf/protobuf.dart'`
  - Class patterns: extends `GeneratedMessage` in generated files
- **Entity Definition Style**:
  - `message` definitions in `.proto` files. Generated Dart classes extend `GeneratedMessage`.
  - Example:
    ```proto
    message User {
      int64 id = 1;
      string name = 2;
      string email = 3;
    }
    ```
  - Generated:
    ```dart
    class User extends $pb.GeneratedMessage {
      static final $pb.BuilderInfo _i = $pb.BuilderInfo(
          const $core.bool.fromEnvironment('protobuf.omit_message_names')
              ? '' : 'User', ...);
      ...
    }
    ```
- **Extraction Approach**:
  1. Detect `protobuf` in `pubspec.yaml` or find `.proto` files in the repo.
  2. **Primary**: Parse `.proto` files — extract all `message` declarations as named entities.
  3. Nested `message` types are sub-entities.
  4. `enum` types are supporting entities.
  5. **Secondary**: Parse `*.pb.dart` generated files — find classes extending `GeneratedMessage`; the `BuilderInfo` constructor first argument (when not empty string) is the proto message name.
  6. `*.pbenum.dart` files contain enum entities.
- **Key Challenges**:
  - Not all proto messages are stored entities — some are RPC envelopes; apply naming heuristics (`Request`, `Response`, `Event` suffixes suggest non-storage).
  - `.proto` files may be in a separate monorepo, git submodule, or generated from a schema registry.
  - `google.protobuf.Timestamp`, `google.protobuf.Any`, and well-known types are not user-defined entities — filter these.
- **Analysis Tools**: Proto file parser; tree-sitter proto grammar; `package:analyzer` for `*.pb.dart` fallback.
- **Complexity**: Low (`.proto` files are highly structured)

---

## 17. OpenAPI-Generated Models

- **Name**: OpenAPI / Swagger Generated Dart Code
- **Type**: Code-Generated Models
- **Supported Databases**: N/A (API spec → Dart types; may mirror storage entities)
- **Detection Signals**:
  - Config/spec files: `openapi.yaml`, `openapi.json`, `swagger.yaml`, `swagger.json` (anywhere in repo)
  - `pubspec.yaml` dev dependencies: `openapi_generator`, `swagger_dart_code_generator`, `dio_generator`
  - Config file: `openapi-generator-config.yaml`, `.openapi-generator-ignore`
  - Generated files: `*.swagger.dart`, `lib/src/generated/*.dart`, `lib/api/`
  - Generated file header: `// GENERATED CODE - DO NOT MODIFY BY HAND`
  - Class patterns: generated classes with `@JsonSerializable()` and `fromJson`/`toJson` factory methods; swagger-generated classes using `built_value`
- **Entity Definition Style**:
  - Dart classes generated from OpenAPI `components/schemas`. One class per schema object. Fields derived from schema properties; `@JsonKey` annotations map JSON names.
- **Extraction Approach**:
  1. Find OpenAPI spec files (`openapi.yaml`, `swagger.yaml`).
  2. Parse spec YAML/JSON — extract keys under `components.schemas` (OpenAPI 3.x) or `definitions` (Swagger 2.x) as entity names.
  3. Filter entity names: exclude those ending in `Request`, `Response`, `Error`, `Exception`, `Input`, `Output` as likely API-only types.
  4. Parse generated Dart files for class definitions with `// GENERATED CODE` headers.
  5. Cross-reference with detected storage frameworks to identify which OpenAPI schemas correspond to stored entities.
- **Key Challenges**:
  - OpenAPI schemas represent both request/response bodies and resource entities — disambiguation is heuristic.
  - Generated code may be in `lib/generated/` or similar; generated files can be voluminous.
  - Multiple OpenAPI spec files may exist in a monorepo.
- **Analysis Tools**: YAML/JSON parser; `package:analyzer`; OpenAPI spec parser.
- **Complexity**: Low (spec files are structured) to Medium (entity vs. DTO disambiguation is heuristic)

---

## Repository Detection Plan

The following outlines a recommended automated static analysis pipeline for a Dart/Flutter repository.

### Phase 1: Dependency Scanning

1. Parse `pubspec.yaml` (and `pubspec.lock` for resolved versions).
2. Build a **framework fingerprint**: map detected package names to frameworks (see Detection Signals for each entry above).
3. Check both `dependencies` and `dev_dependencies` — code generators live in `dev_dependencies`.

**Key package-to-framework mapping:**

| Package (pubspec.yaml) | Framework |
|---|---|
| `drift`, `drift_flutter`, `moor`, `moor_flutter` | Drift |
| `sqflite`, `sqflite_common_ffi` | sqflite |
| `objectbox`, `objectbox_flutter_libs` | ObjectBox |
| `hive`, `hive_flutter` | Hive |
| `isar`, `isar_flutter_libs` | Isar |
| `floor` | Floor |
| `cloud_firestore` | Firebase Firestore |
| `firebase_database` | Firebase Realtime DB |
| `realm`, `realm_dart` | Realm |
| `sembast`, `sembast_web` | Sembast |
| `shared_preferences` | SharedPreferences |
| `supabase_flutter`, `supabase` | Supabase |
| `protobuf` | Protobuf |
| `freezed_annotation`, `json_annotation` | Freezed / json_serializable (heuristic) |

### Phase 2: File Discovery

Based on detected frameworks, run targeted file discovery:

| Framework | Primary File Targets |
|---|---|
| Drift | All `*.dart` files for `Table` subclasses; `*.drift` files; `drift_schemas/*.json` |
| sqflite | All `*.dart` — scan for `db.execute(...)` SQL strings; `assets/**/*.sql` |
| ObjectBox | `objectbox-model.json`; all `*.dart` for `@Entity()` annotations |
| Hive | All `*.dart` for `@HiveType()` annotations and `openBox(...)` calls |
| Isar | All `*.dart` for `@collection` / `@Collection()` annotations |
| Floor | All `*.dart` for `@entity` annotations and `@Database` annotation |
| Firestore | All `*.dart` — scan for `.collection('...')` calls |
| Realtime DB | All `*.dart` — scan for `.ref('...')` and `.child('...')` calls |
| Realm | All `*.dart` for `@RealmModel()` annotations; `*.realm.dart` |
| Sembast | All `*.dart` — scan for store factory calls |
| Supabase | All `*.dart` for `.from('...')` calls; `supabase/migrations/**/*.sql` |
| Protobuf | `**/*.proto`; `**/*.pb.dart` |
| Freezed | All `*.dart` in `models/`, `entities/` directories |

### Phase 3: Entity Extraction

For each detected framework, apply the extraction approach described above. Output a normalized entity record:

```json
{
  "name": "users",
  "source_type": "table|collection|box|store|object|message|key_prefix",
  "framework": "Drift",
  "source_file": "lib/database/tables/users.dart",
  "source_line": 5,
  "fields": [
    {"name": "id", "type": "integer", "is_primary_key": true},
    {"name": "name", "type": "text"},
    {"name": "email", "type": "text"}
  ],
  "confidence": 0.92
}
```

### Phase 4: Deduplication and Merging

1. Deduplicate entities with the same name across frameworks (e.g., a Floor `@Entity` and a sqflite `CREATE TABLE` both defining `users`).
2. Merge field lists from complementary sources (e.g., Drift table class + Drift migration JSON schema).
3. Flag conflicts (e.g., differing field counts for the same entity name from different sources).

### Phase 5: Confidence Scoring

| Signal | Confidence Delta |
|---|---|
| `objectbox-model.json` entity entry | +0.95 (authoritative model file) |
| `drift_schemas/drift_schema_v*.json` entity | +0.95 (authoritative schema snapshot) |
| SQL `CREATE TABLE` in migration file | +0.90 |
| Drift `Table` subclass with `tableName` override | +0.88 |
| Floor `@Entity(tableName: '...')` annotation | +0.88 |
| Isar `@collection` class | +0.85 |
| ObjectBox `@Entity()` class | +0.85 |
| Realm `@RealmModel()` class | +0.85 |
| Hive `@HiveType()` class + `openBox('literal')` | +0.80 |
| Drift `Table` subclass (default name) | +0.80 |
| Floor `@entity` class (default name) | +0.80 |
| Firestore `.collection('literal')` call | +0.75 |
| Supabase `.from('literal')` call | +0.75 |
| Sembast `store('literal')` call | +0.70 |
| Freezed class in `models/` or `entities/` dir | +0.55 |
| Freezed class with `*Model` / `*Entity` name | +0.50 |
| SharedPreferences key prefix | +0.20 |
| Dynamic collection/table name (variable) | -0.25 |
| Freezed class with `*Request` / `*Response` name | -0.30 |

### Phase 6: Special Handling for Asset SQL Files

1. Parse `pubspec.yaml` for `flutter.assets` entries.
2. If `.sql` files are listed in assets, scan those files for `CREATE TABLE` statements.
3. These are high-confidence entity definitions, typically used with sqflite.

### Phase 7: Output

Produce a final entity manifest grouped by storage backend:

```
Storage Backend  | Entity Name | Framework    | Confidence | Source File
-----------------+-------------+--------------+------------+------------------------------
SQLite           | users       | Drift        | 0.92       | lib/database/tables/users.dart
SQLite           | posts       | Drift        | 0.92       | lib/database/tables/posts.dart
Firestore        | users       | Firestore    | 0.75       | lib/repos/user_repository.dart
Firestore        | posts       | Firestore    | 0.75       | lib/repos/post_repository.dart
ObjectBox        | CachedUser  | ObjectBox    | 0.95       | objectbox-model.json
```

### Recommended Tooling Stack

- **Dart AST parsing**: `package:analyzer` (official Dart analyzer); `package:dart_style` for formatting
- **Tree-sitter**: `tree-sitter-dart` grammar for language-agnostic parsing
- **SQL parsing**: regex for `CREATE TABLE` extraction; `sqlite3` Dart package for validation
- **YAML parsing**: `package:yaml` (official Dart)
- **JSON parsing**: `dart:convert` or `package:json_serializable`
- **Proto parsing**: `protoc` with JSON output, or a custom proto parser
- **File globbing**: `package:glob` or `dart:io` `Directory.list()` with recursive walk
- **Annotation detection**: `package:analyzer` element visitor pattern for traversing Dart AST annotation nodes
