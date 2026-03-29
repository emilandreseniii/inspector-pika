# Swift: Data Entity Storage Methods

A catalog of frameworks, libraries, and approaches for data entity storage in Swift, oriented toward automated static analysis of repositories to extract database tables, document collections, and similar data entities.

---

## Frameworks and Approaches

---

### 1. Core Data

- **Name**: Core Data
- **Type**: Object Graph / Relational ORM (Apple-native)
- **Supported Databases**: SQLite (default persistent store), In-Memory, Binary Store, XML Store (macOS only)
- **Detection Signals**:
  - Dependencies: None (system framework); `import CoreData` in source files
  - Project files: `.xcdatamodeld` bundle directory (contains versioned `.xcdatamodel` subdirectories, each with a `contents` XML file); `.xccurrentversion` plist inside the bundle identifies the active model version
  - Class patterns: `NSManagedObject` subclasses; `@NSManaged` property annotations; `NSPersistentContainer`, `NSManagedObjectContext`, `NSFetchRequest` usage
  - Generated files: `<ModelName>+CoreDataClass.swift`, `<ModelName>+CoreDataProperties.swift` (Xcode code generation)
  - Info.plist or project settings referencing `.xcdatamodeld`
- **Entity Definition Style**: Entities are defined in the `.xcdatamodeld` XML file (the Xcode Data Model Editor). Each `<entity>` element has a `name` attribute and child `<attribute>` and `<relationship>` elements. NSManagedObject subclasses are generated or hand-written and carry `@NSManaged` properties.
- **Extraction Approach**:
  1. Recursively search the repository for files matching `*.xcdatamodel/contents` (inside `.xcdatamodeld` bundles).
  2. Read the `.xccurrentversion` plist (XML format) at the bundle root; extract the `_XCCurrentVersionName` key value to identify the active model version directory.
  3. Parse the active `contents` file as XML. The root element is `<model>`. Extract all `<entity name="..." ...>` elements — each `name` value is a data entity.
  4. Within each `<entity>`, extract `<attribute name="..." attributeType="..."/>` and `<relationship name="..." destinationEntity="..."/>` child elements for a full schema.
  5. Cross-reference with Swift source files: find `class <Name>: NSManagedObject` declarations to confirm entity names and spot hand-written entities not yet in the model file.
  6. Search for `NSFetchRequest<EntityName>()` or `NSFetchRequest(entityName: "...")` for runtime entity name strings that may reveal entities missed by XML parsing.
- **Key Challenges**:
  - `.xcdatamodeld` bundles contain multiple versioned subdirectories; only the version referenced by `.xccurrentversion` is active. Older versions should be noted but flagged as historical.
  - Abstract entities appear in the XML (`isAbstract="YES"`) but map to no direct table when using single-table inheritance; flag these separately.
  - Lightweight migration may produce derived models not present as explicit files.
  - Mapping models (`.xcmappingmodel`) can rename entities between versions; these renames are not reflected in the current model XML alone.
  - The XML schema changed subtly across Xcode versions; handle both older and newer attribute sets.
- **Analysis Tools**: Standard XML parsers (Python `xml.etree`, `lxml`); plist parser for `.xccurrentversion`; SwiftSyntax or sourcekitten for cross-referencing Swift class declarations.
- **Complexity**: Low (XML is machine-readable and well-structured)

---

### 2. SwiftData

- **Name**: SwiftData
- **Type**: Object Graph / Relational ORM (Apple-native, Swift-first successor to Core Data)
- **Supported Databases**: SQLite (underlying store managed by framework)
- **Detection Signals**:
  - Dependencies: None (system framework, iOS 17+ / macOS 14+); `import SwiftData` in source files
  - Macro annotations: `@Model` on class declarations; `@Attribute`, `@Attribute(.unique)`, `@Relationship`, `@Transient` on properties
  - Container setup: `ModelContainer(for: ...)`, `ModelConfiguration`, `.modelContainer(for:)` SwiftUI modifier
  - Schema versioning: `VersionedSchema`, `SchemaMigrationPlan` protocol conformances (Swift 5.9+)
  - No external schema files — schema is entirely inline in Swift source
- **Entity Definition Style**: A Swift class annotated with `@Model` becomes a persistent entity. The class name is the entity name. Stored properties (excluding `@Transient`) become attributes. `@Relationship` defines associations with optional delete rules.
  ```swift
  @Model
  class Invoice {
      @Attribute(.unique) var number: String
      var amount: Decimal
      @Relationship(deleteRule: .cascade) var lineItems: [LineItem]
  }
  ```
- **Extraction Approach**:
  1. Search all `.swift` files for the `@Model` macro preceding a class declaration. Regex: `@Model\b` followed (within a few lines) by `(public\s+|internal\s+|final\s+|open\s+)*class\s+(\w+)` — capture the class name.
  2. Within each `@Model` class body (between matching braces), enumerate `var` stored properties excluding those annotated `@Transient`.
  3. For `@Attribute` properties, note constraints (`.unique`, `.externalStorage`, etc.).
  4. For `@Relationship` properties, extract the associated type to map entity associations.
  5. Search for `ModelContainer(for: [<Type>.self, ...])` or `.modelContainer(for: [<Type>.self])` — these enumerate all registered model types and serve as a cross-check.
  6. Search for `VersionedSchema` conformances and `models` static property for schema version inventories.
- **Key Challenges**:
  - `@Model` is a Swift peer/member macro; the synthesized persistence boilerplate is invisible at source level. Source-level parsing yields entity and property names but not the full compiler-expanded schema.
  - Inheritance from other `@Model` classes is allowed and affects schema; subclass entities inherit parent properties.
  - `@Attribute(.externalStorage)` stores large data outside the main SQLite file.
  - No explicit migration DSL visible in source for pre-`VersionedSchema` usage.
- **Analysis Tools**: SwiftSyntax (recommended for macro-aware parsing), sourcekitten, tree-sitter-swift.
- **Complexity**: Low-Medium (source-only, no schema file; requires Swift AST parsing for reliable brace matching)

---

### 3. Realm Swift (MongoDB Atlas Device SDK)

- **Name**: Realm Swift / MongoDB Atlas Device SDK for Swift
- **Type**: Object Database / Mobile ORM
- **Supported Databases**: Realm (embedded object store, `.realm` files); optionally synced with MongoDB Atlas via Device Sync
- **Detection Signals**:
  - Package.swift: `"RealmSwift"` or `"Realm"` in `.package` dependencies; product names `"RealmSwift"`, `"Realm"`; URL containing `realm/realm-swift`
  - Podfile: `pod 'RealmSwift'`, `pod 'Realm'`
  - Cartfile: `github "realm/realm-swift"`
  - Imports: `import RealmSwift`, `import Realm`
  - Class patterns: `class <Name>: Object`, `class <Name>: EmbeddedObject`, `class <Name>: Projection<...>`
  - Property annotations: `@Persisted`, `@Persisted(primaryKey: true)`, `@Persisted(indexed: true)`
  - Legacy (pre-10.x): `@objc dynamic var`, `override class func primaryKey() -> String?`
  - Schema migration: `Realm.Configuration(schemaVersion:, migrationBlock:)`
- **Entity Definition Style**: Swift classes inherit from `Object` (top-level persistent entities, each maps to a Realm collection) or `EmbeddedObject` (nested, no independent existence). Properties are annotated with `@Persisted`. The class name is the Realm object type name.
  ```swift
  class Order: Object {
      @Persisted(primaryKey: true) var id: ObjectId
      @Persisted var status: String
      @Persisted var items: List<OrderItem>
  }
  class OrderItem: EmbeddedObject {
      @Persisted var sku: String
      @Persisted var quantity: Int
  }
  ```
- **Extraction Approach**:
  1. Detect Realm dependency via Package.swift, Podfile, or Cartfile.
  2. Search all `.swift` files for classes inheriting from `Object` or `EmbeddedObject`: regex `class\s+(\w+)\s*:\s*(Object|EmbeddedObject|RealmSwift\.Object|RealmSwift\.EmbeddedObject)`.
  3. Within each class body, extract `@Persisted` properties for field names and types.
  4. Identify `@Persisted(primaryKey: true)` fields.
  5. For legacy codebases, also match `@objc dynamic var` properties inside `Object` subclasses.
  6. Distinguish `EmbeddedObject` subclasses (nested documents) from `Object` subclasses (top-level collections).
  7. Check for `List<T>`, `MutableSet<T>`, `Map<String, T>` property types — these represent to-many relationships.
- **Key Challenges**:
  - `EmbeddedObject` subclasses are not independent collections — label them as embedded rather than top-level entities.
  - `Projection<T>` types are read-only views, not storage entities; exclude from entity list.
  - `LinkingObjects<T>` properties are computed back-links, not stored fields.
  - Dynamic Realm objects (using the schema-less API) cannot be detected statically.
  - Atlas Device Sync adds `_id` primary key requirements and may add server-side schemas not visible in local Swift source.
- **Analysis Tools**: SwiftSyntax, sourcekitten, tree-sitter-swift; regex is often sufficient for class inheritance patterns.
- **Complexity**: Low-Medium

---

### 4. SQLite.swift

- **Name**: SQLite.swift
- **Type**: Type-Safe SQLite DSL / Query Builder
- **Supported Databases**: SQLite
- **Detection Signals**:
  - Package.swift: `"SQLite.swift"` or URL `https://github.com/stephencelis/SQLite.swift`; product `"SQLite"`
  - Podfile: `pod 'SQLite.swift'`
  - Imports: `import SQLite`
  - Type patterns: `Table("...")`, `Expression<T>("...")`, `Connection(...)`, `db.run(table.create { ... })`
- **Entity Definition Style**: Tables are defined as `let tableName = Table("table_name")`. Columns are defined as `Expression<Type>` values at file scope or within a type. Schema is created via `db.run(table.create { t in t.column(...) })`. There is no model class — it is a pure DSL.
  ```swift
  let users = Table("users")
  let userId = Expression<Int64>("id")
  let userName = Expression<String>("name")
  db.run(users.create { t in
      t.column(userId, primaryKey: true)
      t.column(userName)
  })
  ```
- **Extraction Approach**:
  1. Detect `import SQLite` in source files.
  2. Search for `Table\s*\(\s*"([^"]+)"\s*\)` — extract the string literal as the table name.
  3. Search for `Expression<[^>]+>\s*\(\s*"([^"]+)"\s*\)` — extract column name strings.
  4. Search for `.create\s*\{` blocks chained on table variables to associate column definitions with a table.
  5. Also scan for raw SQL strings passed to `db.execute(...)` or `db.run(...)` containing `CREATE TABLE` for tables defined via raw SQL.
  6. Correlate `Expression<Type>` declarations with adjacent `Table` declarations to build a column list per table.
- **Key Challenges**:
  - Table names may be stored in constants or variables rather than inline string literals — requires dataflow analysis to resolve.
  - Dynamic table names constructed at runtime are not statically extractable.
  - No central schema registry — tables are defined ad hoc anywhere in the codebase.
  - Multiple files may reference the same table; deduplication is necessary.
- **Analysis Tools**: SwiftSyntax, sourcekitten, or regex for string literal extraction.
- **Complexity**: Medium (no schema file; requires scanning all source for `Table(...)` calls)

---

### 5. GRDB.swift

- **Name**: GRDB.swift
- **Type**: SQLite Toolkit (Raw SQL + Record Abstraction + Migration DSL)
- **Supported Databases**: SQLite
- **Detection Signals**:
  - Package.swift: `"GRDB.swift"` or product `"GRDB"`; URL `https://github.com/groue/GRDB.swift`
  - Podfile: `pod 'GRDB.swift'`
  - Imports: `import GRDB`
  - Type patterns: structs/classes conforming to `TableRecord`, `FetchableRecord`, `PersistableRecord`, `MutablePersistableRecord`, or subclassing `Record`
  - Static table name property: `static var databaseTableName: String` or `static let databaseTableName: String`
  - Migration patterns: `DatabaseMigrator` usage; `migrator.registerMigration("...") { db in db.create(table: "name") { t in ... } }`
- **Entity Definition Style**: Two styles coexist. (1) Record types: Swift structs or classes with a `databaseTableName` static property and protocol conformances. (2) Schema definition via `DatabaseMigrator` with `db.create(table: "name")` imperative DSL calls.
  ```swift
  struct Player: FetchableRecord, PersistableRecord {
      static let databaseTableName = "players"
      var id: Int64
      var name: String
      var score: Int
  }
  ```
- **Extraction Approach**:
  1. Detect `import GRDB` in source files.
  2. Search for `static\s+(var|let)\s+databaseTableName\s*[=:][^=]+"([^"]+)"` — extract the string value as the table name.
  3. Search for `TableRecord` protocol conformances: `struct\s+\w+\s*:.*\bTableRecord\b` and `class\s+\w+\s*:.*\b(Record|TableRecord)\b`.
  4. Search for `db\.create\s*\(\s*table\s*:\s*"([^"]+)"` in migration closure bodies — extract table name strings.
  5. Search for `DatabaseMigrator` usage to enumerate all registered migrations and their order.
  6. Associate each record struct name with its `databaseTableName` to map Swift type to SQL table name.
  7. Note that GRDB's default naming convention (when `databaseTableName` is not set) lowercases the type name; apply this fallback when the property is absent.
- **Key Challenges**:
  - `databaseTableName` may be computed or inherited from a parent type; the default (lowercased type name) is used when not explicitly set.
  - Migrations are registered in closures and may be spread across multiple files.
  - Database views (also creatable with GRDB) may also conform to `FetchableRecord` — these are views, not tables.
  - Table names computed from variables or constants are not statically resolvable.
- **Analysis Tools**: SwiftSyntax, sourcekitten, regex for `databaseTableName` patterns.
- **Complexity**: Medium

---

### 6. FMDB

- **Name**: FMDB
- **Type**: Raw SQLite Wrapper (Objective-C, usable from Swift via bridging)
- **Supported Databases**: SQLite
- **Detection Signals**:
  - Package.swift: `"fmdb"` dependency (less common via SPM)
  - Podfile: `pod 'FMDB'`
  - Imports: `import FMDB` (Swift) or `#import <FMDB/FMDB.h>` in an Objective-C bridging header
  - Class patterns: `FMDatabase`, `FMDatabaseQueue`, `FMDatabasePool`, `FMResultSet`
  - SQL execution: `db.executeUpdate("CREATE TABLE ...", withArgumentsIn: [])`, `db.executeStatements("...")`, `db.executeQuery(...)`
- **Entity Definition Style**: Entirely raw SQL strings passed to `executeUpdate(...)`, `executeQuery(...)`, and `executeStatements(...)`. No Swift-level entity abstraction. Tables are defined by `CREATE TABLE` DDL strings embedded in source code.
- **Extraction Approach**:
  1. Detect FMDB dependency in Package.swift or Podfile.
  2. Search all `.swift` and `.m` files for `executeUpdate(` and `executeStatements(` calls.
  3. Extract string literal arguments; scan for `CREATE TABLE\s+(\w+)` DDL patterns.
  4. Also search for `.sql` files in the project (e.g., in a `Resources/` or `Database/` directory) that are loaded via `Bundle.main.path(forResource:ofType:)` or `Bundle.main.url(forResource:withExtension:)` and executed.
  5. Parse any found DDL with a SQL parser to extract table names and column definitions.
- **Key Challenges**:
  - SQL strings may be multi-line, concatenated with `+`, or loaded from external resource files.
  - Parameterized strings with `%@`/`%s` substitutions make table names dynamic.
  - No type-level entity representation — all schema structure is in raw strings.
  - Objective-C interop means some SQL may be in `.m` files rather than `.swift` files.
- **Analysis Tools**: Regex for `CREATE TABLE\s+(\w+)`; SQL DDL parser (sqlparse, sqlfluff) for column extraction from extracted SQL strings.
- **Complexity**: High (raw SQL extraction from string literals)

---

### 7. Fluent (Vapor ORM)

- **Name**: Fluent (with FluentKit, FluentPostgresDriver, FluentMySQLDriver, FluentSQLiteDriver, FluentMongoDriver)
- **Type**: Relational ORM / Migration Framework (server-side Swift)
- **Supported Databases**: PostgreSQL (FluentPostgresDriver), MySQL/MariaDB (FluentMySQLDriver), SQLite (FluentSQLiteDriver), MongoDB (FluentMongoDriver)
- **Detection Signals**:
  - Package.swift: `"fluent"`, `"fluent-kit"`, `"fluent-postgres-driver"`, `"fluent-mysql-driver"`, `"fluent-sqlite-driver"`, `"fluent-mongo-driver"` in `.package` dependencies
  - Imports: `import Fluent`, `import FluentKit`, `import FluentPostgresDriver`, etc.
  - Model protocol: `final class <Name>: Model`, `struct <Name>: Model`
  - Property wrappers: `@ID`, `@Field(key: "column_name")`, `@OptionalField(key:)`, `@Parent(key:)`, `@Children(for:)`, `@Siblings(through:from:to:)`, `@Timestamp(key:on:)`, `@Enum(key:)`
  - Static schema property: `static let schema = "table_name"` inside Model types
  - Migration types: `struct <Name>: Migration` with `prepare(on: Database)` and `revert(on: Database)` methods
- **Entity Definition Style**: Swift classes/structs conform to the `Model` protocol and declare `static let schema = "table_name"`. Fields are property-wrapper annotated. Migrations are separate conforming types that run a schema builder DSL.
  ```swift
  final class Galaxy: Model, Content {
      static let schema = "galaxies"
      @ID(key: .id) var id: UUID?
      @Field(key: "name") var name: String
      @Children(for: \.$galaxy) var stars: [Star]
  }
  struct CreateGalaxy: Migration {
      func prepare(on database: Database) async throws {
          try await database.schema("galaxies")
              .id()
              .field("name", .string, .required)
              .create()
      }
  }
  ```
- **Extraction Approach**:
  1. Detect Fluent dependencies in Package.swift.
  2. Search for `Model` protocol conformances: regex `(final\s+class|struct)\s+(\w+)\s*:\s*[^{]*\bModel\b`.
  3. Within each Model type, extract `static let schema = "..."` or `static var schema: String { "..." }` — the string is the canonical table/collection name.
  4. Extract `@Field(key: "...")`, `@OptionalField(key: "...")`, `@Parent(key: "...")`, `@Timestamp(key: "...")` property wrapper key arguments for column names.
  5. Search for `Migration` conformances: `struct\s+\w+\s*:\s*Migration`; within `prepare(on:)` methods, extract `database.schema("table_name")` calls.
  6. In migration `prepare` bodies, note `.field("name", .type)` calls to recover column names.
  7. Cross-reference migration files with model files to correlate models with their schema definitions.
- **Key Challenges**:
  - The `schema` property may reference a string constant defined elsewhere; trace to literal if possible.
  - Polymorphic models and union types in Fluent have complex schema mappings that require understanding Fluent internals.
  - MongoDB models via `FluentMongoDriver` use the same `schema` property as a collection name — semantics differ but extraction approach is identical.
  - Pivot/join tables for `Siblings` relationships are only defined in migration code, not as explicit Model types.
- **Analysis Tools**: SwiftSyntax (recommended), sourcekitten; regex for `static let schema` extraction.
- **Complexity**: Low-Medium (schema property is explicit and easy to locate)

---

### 8. Vapor (Raw Database Access — Without Fluent)

- **Name**: Vapor + PostgresKit / MySQLKit / SQLiteKit (without Fluent)
- **Type**: Raw SQL / Direct Driver Access (server-side Swift)
- **Supported Databases**: PostgreSQL (PostgresNIO, postgres-kit), MySQL (MySQLNIO, mysql-kit), SQLite (sqlite-kit)
- **Detection Signals**:
  - Package.swift: `"vapor"`, `"postgres-kit"`, `"mysql-kit"`, `"sqlite-kit"` without `"fluent"` in the dependency list
  - Imports: `import Vapor`, `import PostgresKit`, `import MySQLKit`, `import SQLiteKit`, `import SQLKit`
  - SQL patterns: `db.sql().raw(SQLQueryString("..."))`, `db.sql().raw("...")`, `db.execute(sql:)`, `SQLCreateTableBuilder` usage
- **Entity Definition Style**: No ORM layer. Entities are defined by raw SQL strings or via SQLKit's type-safe query builder expressions. Tables are referenced by name in SQL strings or builder calls.
- **Extraction Approach**:
  1. Detect Vapor without Fluent in Package.swift.
  2. Search for `SQLQueryString("...")` and `db.sql().raw("...")` calls; extract SQL string content.
  3. Search for `SQLCreateTableBuilder` or `.create(table: "...")` builder calls.
  4. Check for `.sql` migration files in a `Resources/` or `Migrations/` directory loaded by the application.
  5. Parse extracted SQL for `CREATE TABLE` DDL.
- **Key Challenges**: Same as FMDB — SQL embedded in strings is fragile to parse. SQLKit's type-safe builder is more reliable when used.
- **Analysis Tools**: Regex, sqlparse for extracted SQL strings.
- **Complexity**: High (raw SQL) / Medium (SQLKit builder calls)

---

### 9. Firebase / Firestore iOS SDK

- **Name**: Firebase iOS SDK (Cloud Firestore and Firebase Realtime Database)
- **Type**: NoSQL / Document Store
- **Supported Databases**: Cloud Firestore, Firebase Realtime Database
- **Detection Signals**:
  - Package.swift: `"firebase-ios-sdk"` with `FirebaseFirestore` or `FirebaseDatabase` product targets; URL `https://github.com/firebase/firebase-ios-sdk`
  - Podfile: `pod 'Firebase/Firestore'`, `pod 'Firebase/Database'`, `pod 'FirebaseFirestoreSwift'`
  - Imports: `import FirebaseFirestore`, `import FirebaseFirestoreSwift`, `import FirebaseDatabase`
  - Collection patterns: `Firestore.firestore().collection("...")`, `db.collection("...")`, `.document("...")`, chained sub-collection calls
  - Type patterns: structs/classes conforming to `Codable` with `@DocumentID` annotation (FirestoreSwift)
  - Realtime Database: `Database.database().reference().child("...")`
  - Config file: `GoogleService-Info.plist` in project (confirms Firebase usage)
- **Entity Definition Style**: Collections are referenced by string literals: `db.collection("users")`. Documents follow Codable Swift structs annotated with `@DocumentID`. No schema is enforced at the client level. Sub-collections are discovered via chained `.collection("...").document("...").collection("...")` calls.
- **Extraction Approach**:
  1. Detect Firebase dependency; confirm via `GoogleService-Info.plist`.
  2. Search for `.collection("...")` calls — extract string literal arguments as collection names.
  3. Search for `@DocumentID` annotated Codable struct properties — the enclosing struct is a document schema type.
  4. Search for `try document.data(as: MyModel.self)` — `MyModel` is a document type.
  5. For Realtime Database, search for `.child("...")` chains to reconstruct the data hierarchy.
  6. Check `firestore.rules` for collection names referenced in security rules.
  7. Check `firestore.indexes.json` for indexed collection names.
- **Key Challenges**:
  - Collection paths can be deeply nested — subcollections are also entities and must be discovered from chained calls.
  - String paths may be stored in constants or computed from variables.
  - Schema is not enforced by Firestore — document shape is only implied by Codable structs.
  - Dynamic or multi-tenant collection names (e.g., `"users/\(uid)/orders"`) are not statically resolvable.
- **Analysis Tools**: SwiftSyntax or regex for string literal extraction; JSON parser for `firestore.indexes.json`.
- **Complexity**: Medium

---

### 10. CloudKit

- **Name**: CloudKit
- **Type**: Cloud Object Store (Apple)
- **Supported Databases**: CloudKit (iCloud private, public, and shared databases)
- **Detection Signals**:
  - No Package.swift dependency (system framework)
  - Entitlements: `com.apple.developer.icloud-container-identifiers` in `.entitlements` files; `iCloud` capability in project settings
  - Imports: `import CloudKit`
  - Type patterns: `CKRecord(recordType: "RecordTypeName")`, `CKQuery(recordType: "RecordTypeName", predicate:)`, `CKRecord.RecordType` typed constants
  - Container setup: `CKContainer.default()`, `CKContainer(identifier: "iCloud.com.example.app")`
- **Entity Definition Style**: Record types are identified by string names passed to `CKRecord(recordType:)`. Fields are set dynamically as key-value pairs: `record["fieldName"] = value`. No compile-time schema is enforced.
- **Extraction Approach**:
  1. Detect `import CloudKit` in source files; check `.entitlements` for iCloud capability.
  2. Search for `CKRecord\s*\(\s*recordType\s*:\s*"([^"]+)"` — extract the string argument as a record type (entity) name.
  3. Search for `CKQuery\s*\(\s*recordType\s*:\s*"([^"]+)"` — confirms record type usage.
  4. Search for `CKRecord\.RecordType` typed let/var declarations: `let\s+\w+\s*:\s*CKRecord\.RecordType\s*=\s*"([^"]+)"`.
  5. Search for enum or struct patterns used to centralize record type constants.
  6. Collect `record["fieldName"]` subscript accesses to discover field names (scattered across codebase).
- **Key Challenges**:
  - Record types are plain strings with no compile-time enforcement; the definitive schema lives in the CloudKit Dashboard, not in source.
  - Field names are set dynamically via subscript and may be inconsistent across files.
  - System record types (`CKShare`, `CKAsset`, etc.) and system fields (`creationDate`, `modificationDate`, `recordName`) should be excluded.
  - CloudKit Dashboard export JSON is rarely committed to a repository.
- **Analysis Tools**: Regex for string literal extraction; SwiftSyntax for typed constant declarations.
- **Complexity**: Medium-High

---

### 11. UserDefaults

- **Name**: UserDefaults
- **Type**: Key-Value Store (flat, not relational)
- **Supported Databases**: On-device NSUserDefaults property list store (sandboxed per app/app group)
- **Detection Signals**:
  - No external dependency; part of Foundation
  - Patterns: `UserDefaults.standard.set(_, forKey: "keyName")`, `UserDefaults.standard.string(forKey: "keyName")`, `UserDefaults(suiteName: "group.identifier")`
  - SwiftUI property wrapper: `@AppStorage("keyName")`
  - Key centralization patterns: `extension UserDefaults.Keys { static let myKey = "myKey" }` or similar enum/struct key namespaces
- **Entity Definition Style**: Flat key-value pairs. Keys are string literals. No structured schema or relational model.
- **Extraction Approach**:
  1. Search for `forKey:\s*"([^"]+)"` in `UserDefaults` calls — extract key names.
  2. Search for `@AppStorage\s*\(\s*"([^"]+)"\s*\)` — extract key names.
  3. Group by suite name if `suiteName:` is used with a non-standard identifier.
  4. Report as a "key-value store" with a key inventory rather than as a DB entity list.
- **Key Challenges**: UserDefaults is not a structured database — entities in the traditional sense do not exist. Extraction produces a flat key list. Useful as a signal that the app stores small, simple preferences rather than structured data.
- **Analysis Tools**: Regex.
- **Complexity**: Low (but low value for entity extraction purposes)

---

### 12. Supabase Swift Client

- **Name**: Supabase Swift (`supabase-swift`)
- **Type**: PostgreSQL-backed BaaS Client (PostgREST / Realtime)
- **Supported Databases**: PostgreSQL (via Supabase hosted service)
- **Detection Signals**:
  - Package.swift: `"supabase-swift"` or URL `https://github.com/supabase/supabase-swift`; products `"Supabase"`, `"PostgREST"`, `"Realtime"`
  - Imports: `import Supabase`, `import PostgREST`
  - Patterns: `supabase.from("table_name")`, `.from("...")`, `.select(...)`, `.insert(...)`, `.update(...)`, `.delete()`, `.upsert(...)`
  - Codable model structs used as generic type parameters in `.execute()` calls
- **Entity Definition Style**: Tables are referenced by string literals in PostgREST API calls. Swift structs conforming to `Codable` represent the row schema. No DDL in Swift source.
  ```swift
  let response = try await supabase
      .from("orders")
      .select("id, status, customer_id")
      .eq("status", value: "pending")
      .execute()
  ```
- **Extraction Approach**:
  1. Detect `supabase-swift` in Package.swift.
  2. Search for `\.from\s*\(\s*"([^"]+)"\s*\)` — extract table name string.
  3. Identify `Codable` structs used as response types (`as [StructName].self` or `as StructName.self`) in Supabase query chains.
  4. Check for Supabase migration files or SQL schema files in the repository root or `supabase/migrations/` directory (Supabase CLI convention).
- **Key Challenges**: Table schema lives in the Supabase database; only table names and approximate row shapes are recoverable statically. The `supabase/migrations/` directory may contain SQL DDL if Supabase CLI is used — parse those files for a complete picture.
- **Analysis Tools**: SwiftSyntax, regex; SQL DDL parser for Supabase migration files.
- **Complexity**: Low-Medium

---

### 13. MongoDB Atlas Device SDK (Realm — Atlas Sync)

- **Name**: MongoDB Atlas Device SDK (formerly Realm with Atlas App Services sync)
- **Type**: Mobile Object Database with Cloud Sync
- **Supported Databases**: Realm local + MongoDB Atlas (cloud sync)
- **Detection Signals**:
  - Same as Realm Swift (see entry 3), plus:
  - `@Persisted var _id: ObjectId` or `@Persisted(primaryKey: true) var _id: ObjectId` (Atlas sync requires `_id` as the primary key name)
  - `App`, `User` (from RealmSwift), `MongoClient`, `MongoDatabase`, `MongoCollection<T>` usage
  - Sync configuration: `user.flexibleSyncConfiguration()`, `SyncConfiguration`, `Realm.Configuration(syncConfiguration:)`
- **Entity Definition Style**: Same as Realm Swift for local objects. Additionally, `MongoCollection<T>` typed collections reference Atlas MongoDB collections by name when accessed directly via the MongoDB client.
- **Extraction Approach**:
  1. Apply all Realm Swift extraction steps (see entry 3).
  2. Additionally, search for `MongoDatabase\s*\(\s*name\s*:\s*"([^"]+)"` and `mongoDatabase.collection\s*\(\s*withName\s*:\s*"([^"]+)"` for direct Atlas collection name references.
  3. Note that `Object` subclass names used with Device Sync correspond to MongoDB collection names in Atlas.
- **Key Challenges**: Flexible sync subscriptions (`.where { ... }` predicates) define which data syncs — not relevant to entity name extraction but creates additional code noise. Server-side schemas in Atlas may have collections not mirrored in local Swift `Object` subclasses.
- **Analysis Tools**: tree-sitter-swift, regex.
- **Complexity**: Medium

---

### 14. Raw SQLite C API Wrappers

- **Name**: Raw SQLite C API (via `SQLite3` module or `CSQLite`)
- **Type**: Raw SQL (C library via Swift bridging)
- **Supported Databases**: SQLite
- **Detection Signals**:
  - Package.swift: `systemLibrary` targets wrapping `libsqlite3`; `CSQLite` product names
  - Imports: `import SQLite3`, `import CSQLite`
  - C function call patterns: `sqlite3_open(path, &db)`, `sqlite3_exec(db, sqlString, ...)`, `sqlite3_prepare_v2(db, sqlString, ...)`, `sqlite3_prepare(db, sqlString, ...)`
  - SQL strings passed as C string arguments (second positional argument to `sqlite3_exec`, `sqlite3_prepare_v2`)
- **Entity Definition Style**: Pure SQL strings passed as C string arguments. No Swift-level entity abstraction.
- **Extraction Approach**:
  1. Detect `import SQLite3` or `import CSQLite` in source files.
  2. Search for `sqlite3_exec\s*\(` and `sqlite3_prepare_v2\s*\(` call sites.
  3. Extract the second argument (SQL string) — this is typically the second positional argument, often a string literal.
  4. Parse extracted SQL strings for `CREATE TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(\w+)` patterns.
  5. Also search for `sqlite3_exec(db, "CREATE TABLE ...` directly with inline DDL.
- **Key Challenges**:
  - C-style function calls with positional arguments are harder to parse reliably than named Swift parameters.
  - SQL strings are frequently stored in `let` constants or constructed via `String` formatting.
  - Multi-statement SQL strings (semicolon-separated) passed to `sqlite3_exec` require splitting before parsing.
- **Analysis Tools**: Regex for `sqlite3_exec` / `sqlite3_prepare_v2` patterns; sqlparse for extracted SQL strings.
- **Complexity**: High

---

### 15. Codable Structs as Entity Signals

- **Name**: Codable Structs (structural inference heuristic)
- **Type**: Data Shape Signal (not a storage framework)
- **Supported Databases**: Any (context-dependent)
- **Detection Signals**:
  - `struct <Name>: Codable`, `struct <Name>: Decodable`, `class <Name>: Codable`
  - `CodingKeys` enum nested within a Codable type (maps Swift property names to storage/JSON keys)
  - Type naming conventions: `*Entity`, `*Model`, `*DTO`, `*Row`, `*Record`, `*Schema`, `*Document`
  - Used alongside database library imports or network decoding calls
- **Entity Definition Style**: Swift structs with `Codable` conformance and an optional `CodingKeys` enum define a typed mapping to/from serialized data. When used with database libraries (Fluent, GRDB, Supabase, Firestore), these represent database row or document schemas. When used only with `URLSession`/`JSONDecoder`, they represent API response shapes.
- **Extraction Approach**:
  1. Search for `struct\s+\w+\s*:\s*.*\bCodable\b` and `struct\s+\w+\s*:\s*.*\bDecodable\b`.
  2. If a `CodingKeys` enum is present inside the type, use its raw string values as the canonical field names.
  3. Score each Codable struct against a confidence heuristic:
     - High confidence: used with `@DocumentID`, Supabase `.from()`, GRDB, or Fluent `@Field`
     - Medium confidence: type name matches `*Entity`, `*Row`, `*Record`, `*Document`; has `id: UUID`, `createdAt: Date` fields
     - Low confidence: used only with `JSONDecoder` on network responses
  4. Treat as an entity signal only when corroborated by storage framework usage in the same file or module.
- **Key Challenges**: `Codable` is used for network responses, file serialization, UserDefaults encoding, and database responses — not all instances are DB entities. Context disambiguation is required to avoid high false-positive rates.
- **Analysis Tools**: SwiftSyntax, sourcekitten.
- **Complexity**: Medium (requires heuristic scoring to reduce false positives)

---

## Repository Detection Plan

### Step 1: Classify the Repository Type

| Signal | Conclusion |
|--------|-----------|
| `Package.swift` contains `"vapor"` or `"fluent"` | Server-side Swift project |
| `*.xcodeproj` or `*.xcworkspace` present | iOS/macOS app |
| `Podfile` present | CocoaPods-managed iOS/macOS app |
| `Package.swift` only (no Xcode project) | SPM library or server-side Swift |
| `GoogleService-Info.plist` present | Firebase-enabled iOS/macOS app |

### Step 2: Identify Storage Technologies

1. Parse `Package.swift` for all `.package(url:...)` and `.product(name:...)` entries. Match against the dependency name list above.
2. Parse `Podfile` for `pod '...'` lines as an alternative dependency source.
3. Parse `Cartfile` for `github "..."` lines.
4. Search for `.xcdatamodeld` directories regardless of Package.swift (Core Data signal).
5. Search for `import CoreData`, `import SwiftData`, `import RealmSwift`, `import GRDB`, `import SQLite`, `import FMDB`, `import Fluent`, `import FirebaseFirestore`, `import CloudKit`, `import Supabase`, `import SQLite3` across all `.swift` files.
6. Check `.entitlements` files for `iCloud` container identifiers (CloudKit signal).
7. Check for `GoogleService-Info.plist` (Firebase signal).

### Step 3: Apply Framework-Specific Extraction

Execute the extraction approach for each detected framework. Priority order (highest structural signal to lowest):

1. Core Data `.xcdatamodeld` XML — highest confidence, machine-readable schema
2. Fluent `static let schema` properties + Migration DSL
3. SwiftData `@Model` annotations
4. Realm `Object` subclasses with `@Persisted` properties
5. GRDB `databaseTableName` + migration DSL
6. SQLite.swift `Table("...")` calls
7. Firebase `.collection("...")` calls and `@DocumentID` Codable structs
8. Supabase `.from("...")` calls
9. CloudKit `CKRecord(recordType: "...")` calls
10. Raw SQL `CREATE TABLE` extraction (FMDB, raw SQLite C API, Vapor raw)
11. Codable struct heuristics (lowest confidence, most false positives)

### Step 4: Deduplicate and Normalize

- Normalize entity names to a canonical form (strip quotes, lowercase for comparison).
- Cross-reference model class names with table/schema names (a `User` model with `schema = "users"` → use `"users"` as the canonical entity name).
- Tag each entity with its source framework and confidence level.
- Deduplicate across files (the same table may be referenced in many places).

### Step 5: Output Schema

Produce a structured list per entity:
```
entity_name | framework | source_file | source_line | confidence | columns (if extractable)
```

### Key Files to Always Check

| File / Pattern | Significance |
|---|---|
| `Package.swift` | Primary SPM dependency manifest |
| `Podfile` | CocoaPods dependency manifest |
| `Cartfile` | Carthage dependency manifest |
| `*.xcdatamodeld/*/contents` | Core Data schema XML (always check) |
| `*.xccurrentversion` | Identifies active Core Data model version |
| `Sources/**/*.swift` | All Swift source files |
| `*.entitlements` | CloudKit container identifiers |
| `GoogleService-Info.plist` | Firebase project config |
| `firestore.rules` | Firestore collection security rules |
| `firestore.indexes.json` | Firestore indexed collection names |
| `*.sql` | Raw SQL migration/schema files |
| `Sources/**/Migrations/` | Fluent migration files (by convention) |
| `supabase/migrations/*.sql` | Supabase CLI migration files |

### Confidence Levels

| Signal Type | Confidence |
|---|---|
| Core Data XML `<entity name="...">` | High |
| SwiftData `@Model` class annotation | High |
| Realm `class X: Object` | High |
| Fluent `static let schema = "..."` | High |
| GRDB `static var databaseTableName = "..."` | High |
| GRDB `db.create(table: "...")` in migration | High |
| SQLite.swift `Table("...")` literal | Medium-High |
| Firebase `.collection("...")` literal | Medium |
| Supabase `.from("...")` literal | Medium |
| CloudKit `CKRecord(recordType: "...")` literal | Medium |
| `CREATE TABLE` in `.sql` files | High |
| `CREATE TABLE` in raw SQL string literals | Medium |
| Codable struct with DB naming convention | Low |
