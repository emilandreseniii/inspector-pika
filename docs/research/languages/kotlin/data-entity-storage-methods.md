# Kotlin: Data Entity Storage Methods

A comprehensive catalog of data entity storage frameworks, libraries, and approaches in Kotlin for use in automated static analysis to extract data entities (database tables, document collections, etc.).

---

## Table of Contents

1. [Exposed (DSL Table Objects)](#1-exposed-dsl-table-objects)
2. [Exposed (DAO Entity Classes)](#2-exposed-dao-entity-classes)
3. [Ktorm](#3-ktorm)
4. [Room (Android)](#4-room-android)
5. [Ebean ORM (Kotlin)](#5-ebean-orm-kotlin)
6. [Hibernate / JPA with Kotlin](#6-hibernate--jpa-with-kotlin)
7. [Spring Data JPA in Kotlin](#7-spring-data-jpa-in-kotlin)
8. [Spring Data MongoDB in Kotlin](#8-spring-data-mongodb-in-kotlin)
9. [SQLDelight](#9-sqldelight)
10. [Realm (Android / KMP)](#10-realm-android--kmp)
11. [kotlin-jdsl](#11-kotlin-jdsl)
12. [JDBI with Kotlin](#12-jdbi-with-kotlin)
13. [Ktor with Database Plugins](#13-ktor-with-database-plugins)
14. [Raw JDBC in Kotlin](#14-raw-jdbc-in-kotlin)
15. [Flyway (Kotlin Projects)](#15-flyway-kotlin-projects)
16. [Liquibase (Kotlin Projects)](#16-liquibase-kotlin-projects)
17. [Prisma with Kotlin Client](#17-prisma-with-kotlin-client)
18. [MongoDB KMongo](#18-mongodb-kmongo)
19. [Firebase / Firestore Android SDK](#19-firebase--firestore-android-sdk)
20. [DynamoDB with Kotlin (AWS SDK v2)](#20-dynamodb-with-kotlin-aws-sdk-v2)
21. [Ktor + Exposed Patterns](#21-ktor--exposed-patterns)
22. [kotlinx.serialization as Entity Signals](#22-kotlinxserialization-as-entity-signals)
23. [Cassandra (DataStax Driver / Kotlin)](#23-cassandra-datastax-driver--kotlin)
24. [Redis (Lettuce / Jedis in Kotlin)](#24-redis-lettuce--jedis-in-kotlin)
25. [Elasticsearch (Kotlin ES Client)](#25-elasticsearch-kotlin-es-client)

---

## 1. Exposed (DSL Table Objects)

- **Name**: JetBrains Exposed — DSL API
- **Type**: Relational ORM / Query DSL
- **Supported Databases**: PostgreSQL, MySQL, MariaDB, SQLite, H2, Oracle, SQL Server

### Detection Signals
- **Build file dependencies** (`build.gradle.kts` / `build.gradle`):
  ```
  org.jetbrains.exposed:exposed-core
  org.jetbrains.exposed:exposed-dao
  org.jetbrains.exposed:exposed-jdbc
  org.jetbrains.exposed:exposed-kotlin-datetime
  ```
- **Import patterns**:
  ```kotlin
  import org.jetbrains.exposed.sql.Table
  import org.jetbrains.exposed.sql.*
  ```
- **DSL patterns**: classes or objects extending `Table`, `IntIdTable`, `LongIdTable`, `UUIDTable`

### Entity Definition Style
Tables are defined as Kotlin `object` declarations (singletons) extending `Table` or a typed ID variant:
```kotlin
object Users : IntIdTable("users") {
    val name = varchar("name", 255)
    val email = varchar("email", 255).uniqueIndex()
    val createdAt = datetime("created_at")
}

object Orders : LongIdTable("orders") {
    val userId = reference("user_id", Users)
    val total = decimal("total", 10, 2)
}
```

### Extraction Approach
1. Scan all `.kt` files for `import org.jetbrains.exposed.sql.Table` or `org.jetbrains.exposed.sql.*`.
2. Parse class/object declarations; collect those that extend `Table`, `IntIdTable`, `LongIdTable`, `UUIDTable`, `IdTable<*>`, or any supertype resolving to these.
3. For each matched object/class:
   - Extract the **table name** from the constructor string argument (first positional arg to the superclass call), e.g. `IntIdTable("users")` → `users`. If omitted, Exposed defaults to the class name lowercased/snake-cased.
   - Extract **column definitions** by scanning `val` property assignments to `varchar(...)`, `integer(...)`, `text(...)`, `datetime(...)`, `reference(...)`, etc.
4. Collect foreign key references from `reference(...)` and `optReference(...)` calls to link entity relationships.

### Key Challenges
- Table name may be omitted (defaults to class name); implement fallback name derivation logic.
- Inheritance chains: a shared base `object` may define common columns — walk the supertype hierarchy.
- Companion objects or nested objects may contain sub-table definitions.
- Tables defined inside function bodies or lambdas (test fixtures) should be distinguished from production tables.

### Analysis Tools
- **Kotlin compiler PSI / FIR** (via `kotlin-compiler-embeddable`) for accurate AST parsing
- **kotlinx-ast** (lightweight AST without full compiler)
- Regex as a fast pre-filter before AST parsing

### Complexity
**Low** — DSL is explicit and structurally regular.

---

## 2. Exposed (DAO Entity Classes)

- **Name**: JetBrains Exposed — DAO API
- **Type**: Relational ORM
- **Supported Databases**: PostgreSQL, MySQL, MariaDB, SQLite, H2, Oracle, SQL Server

### Detection Signals
- Same build dependencies as DSL (see §1).
- **Import patterns**:
  ```kotlin
  import org.jetbrains.exposed.dao.IntEntity
  import org.jetbrains.exposed.dao.IntEntityClass
  import org.jetbrains.exposed.dao.id.IntIdTable
  ```
- **Class pattern**: classes extending `IntEntity`, `LongEntity`, `UUIDEntity`, or `Entity<*>`, paired with a companion `EntityClass`.

### Entity Definition Style
```kotlin
class User(id: EntityID<Int>) : IntEntity(id) {
    companion object : IntEntityClass<User>(Users)
    var name by Users.name
    var email by Users.email
}
```
The backing Table object (e.g. `Users`) is always required and links back to §1.

### Extraction Approach
1. Find all classes extending `IntEntity`, `LongEntity`, `UUIDEntity`, or `Entity<*>`.
2. Identify the companion object's `IntEntityClass<T>(TableObject)` — the `TableObject` argument names the backing Table.
3. Cross-reference to the Table object (§1) to get the table name and columns.
4. Entity property names are derived from `by TableObject.columnName` delegations.

### Key Challenges
- DAO and DSL are always used together; avoid double-counting the same table.
- Generic `Entity<*>` subtypes may obscure the ID type.

### Analysis Tools
- Same as §1.

### Complexity
**Low-Medium** — requires cross-referencing DAO class with Table object.

---

## 3. Ktorm

- **Name**: Ktorm
- **Type**: Relational ORM / Query DSL
- **Supported Databases**: PostgreSQL, MySQL, SQLite, Oracle, SQL Server

### Detection Signals
- **Build dependencies**:
  ```
  org.ktorm:ktorm-core
  org.ktorm:ktorm-support-postgresql
  org.ktorm:ktorm-support-mysql
  org.ktorm:ktorm-jackson
  ```
- **Import patterns**:
  ```kotlin
  import org.ktorm.schema.Table
  import org.ktorm.schema.*
  import org.ktorm.entity.Entity
  ```

### Entity Definition Style
```kotlin
object Employees : Table<Employee>("t_employee") {
    val id = int("id").primaryKey().bindTo { it.id }
    val name = varchar("name").bindTo { it.name }
    val departmentId = int("department_id").bindTo { it.departmentId }
}

interface Employee : Entity<Employee> {
    companion object : Entity.Factory<Employee>()
    val id: Int
    var name: String
}
```

### Extraction Approach
1. Detect `org.ktorm.schema.Table` imports or supertype.
2. Collect `object` declarations extending `Table<T>`.
3. Extract table name from the constructor string argument.
4. Enumerate column definitions: `int(...)`, `varchar(...)`, `long(...)`, `datetime(...)`, etc., noting `.primaryKey()` and `.bindTo { ... }` chains.
5. Identify the entity interface (`Entity<T>`) bound to the table via the generic parameter.

### Key Challenges
- Entity interfaces (not classes) — interface members define the entity shape.
- Sequence API extensions may define queries but not new tables.

### Analysis Tools
- Kotlin PSI or kotlinx-ast.

### Complexity
**Low**

---

## 4. Room (Android)

- **Name**: Androidx Room
- **Type**: Relational ORM (Android)
- **Supported Databases**: SQLite (Android)

### Detection Signals
- **Build dependencies** (`build.gradle` / `build.gradle.kts`):
  ```
  androidx.room:room-runtime
  androidx.room:room-ktx
  androidx.room:room-compiler (kapt/ksp)
  com.google.devtools.ksp (with room-compiler)
  ```
- **Import patterns**:
  ```kotlin
  import androidx.room.Entity
  import androidx.room.PrimaryKey
  import androidx.room.ColumnInfo
  import androidx.room.Database
  import androidx.room.Dao
  ```
- **Annotation patterns**: `@Entity`, `@Database`, `@Dao`

### Entity Definition Style
```kotlin
@Entity(tableName = "users")
data class User(
    @PrimaryKey(autoGenerate = true) val id: Int = 0,
    @ColumnInfo(name = "full_name") val name: String,
    val email: String
)

@Database(entities = [User::class, Order::class], version = 1)
abstract class AppDatabase : RoomDatabase()
```

### Extraction Approach
1. Find all `.kt` files with `import androidx.room.*` or `import androidx.room.Entity`.
2. Collect all classes annotated with `@Entity`:
   - Extract `tableName` attribute from the annotation; if absent, default to the class name.
   - Parse constructor parameters and properties for `@ColumnInfo(name = ...)` (explicit column name) or use field name.
   - Note `@PrimaryKey`, `@ForeignKey`, `@Index` annotations.
3. Find `@Database` annotations and collect the `entities = [...]` array to enumerate all registered entities and validate completeness.
4. Cross-reference `@Dao` interface query methods for additional table/column usage signals.

### Key Challenges
- `@Entity` `tableName` defaults to class name (not snake_case — exact class name).
- Embedded fields via `@Embedded` annotation expand inline columns.
- `@Relation` annotations imply joins between entities but don't create new tables.
- Generated code (Room processor output) should not be scanned — focus on source files.

### Analysis Tools
- Kotlin PSI or kotlinx-ast; annotation-focused parsing.

### Complexity
**Low** — highly explicit annotation-based definitions.

---

## 5. Ebean ORM (Kotlin)

- **Name**: Ebean ORM
- **Type**: Relational ORM
- **Supported Databases**: PostgreSQL, MySQL, MariaDB, Oracle, SQL Server, SQLite, H2

### Detection Signals
- **Build dependencies**:
  ```
  io.ebean:ebean
  io.ebean:ebean-kotlin
  io.ebean:kotlin-querybean-generator
  io.ebean:ebean-annotation
  ```
- **Import patterns**:
  ```kotlin
  import io.ebean.annotation.DbJson
  import io.ebean.Model
  import javax.persistence.Entity
  import javax.persistence.Table
  ```
- **Annotation patterns**: `@Entity`, `@Table`, `@Column`, `@Id`, `@ManyToOne`, `@OneToMany`

### Entity Definition Style
```kotlin
@Entity
@Table(name = "customer")
class Customer : Model() {
    @Id
    var id: Long = 0
    var name: String = ""
    @Column(name = "email_address")
    var email: String = ""
}
```

### Extraction Approach
1. Detect `io.ebean` imports or `Model` supertype.
2. Collect classes annotated with `@Entity` (from `javax.persistence` or `jakarta.persistence`).
3. Extract table name from `@Table(name = "...")` or default to class name.
4. Enumerate fields with `@Column(name = "...")` annotations; fall back to field name.
5. Note `@ManyToOne`, `@OneToMany`, `@ManyToMany`, `@OneToOne` for relationship mapping.

### Key Challenges
- Ebean uses `javax.persistence` annotations (same as JPA/Hibernate) — disambiguate by detecting `io.ebean` imports/dependencies.
- Kotlin open classes required for Ebean enhancement.

### Analysis Tools
- Kotlin PSI; JPA annotation pattern matching.

### Complexity
**Low-Medium**

---

## 6. Hibernate / JPA with Kotlin

- **Name**: Hibernate ORM / JPA
- **Type**: Relational ORM
- **Supported Databases**: PostgreSQL, MySQL, MariaDB, Oracle, SQL Server, H2, SQLite, DB2

### Detection Signals
- **Build dependencies**:
  ```
  org.hibernate:hibernate-core
  org.hibernate.orm:hibernate-core (6.x)
  jakarta.persistence:jakarta.persistence-api
  javax.persistence:javax.persistence-api
  org.springframework.boot:spring-boot-starter-data-jpa
  ```
- **Import patterns**:
  ```kotlin
  import javax.persistence.*
  import jakarta.persistence.*
  import org.hibernate.annotations.*
  ```
- **Annotation patterns**: `@Entity`, `@Table`, `@Column`, `@Id`, `@GeneratedValue`, `@ManyToOne`, `@OneToMany`

### Entity Definition Style
```kotlin
@Entity
@Table(name = "products")
data class Product(
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    val id: Long = 0,
    @Column(name = "product_name", nullable = false)
    val name: String,
    val price: BigDecimal
)
```

### Extraction Approach
1. Detect `javax.persistence` or `jakarta.persistence` imports.
2. Collect all classes (including `data class`) annotated with `@Entity`.
3. Extract table name from `@Table(name = "...")` or use class name.
4. Parse all fields/constructor parameters for `@Column(name = "...")` overrides.
5. Note `@Transient` fields (excluded from persistence).
6. Check `@Embeddable` / `@Embedded` for inline column expansion.
7. Inspect `persistence.xml` or Spring `application.properties`/`application.yml` for entity scan packages.

### Key Challenges
- Kotlin `data class` with JPA requires `kotlin-jpa` plugin (no-arg constructor) — presence confirms intent.
- `@MappedSuperclass` fields are inherited — must walk supertype chain.
- XML mapping files (`orm.xml`, `hibernate.cfg.xml`) can override or supplement annotations.
- Lazy-loaded proxies require `open` classes in Kotlin (`kotlin-allopen` plugin).

### Analysis Tools
- Kotlin PSI; XML parsers for `orm.xml`.

### Complexity
**Medium**

---

## 7. Spring Data JPA in Kotlin

- **Name**: Spring Data JPA
- **Type**: Relational ORM (Spring abstraction over JPA/Hibernate)
- **Supported Databases**: PostgreSQL, MySQL, MariaDB, Oracle, SQL Server, H2

### Detection Signals
- **Build dependencies**:
  ```
  org.springframework.boot:spring-boot-starter-data-jpa
  org.springframework.data:spring-data-jpa
  ```
- **Import patterns**:
  ```kotlin
  import org.springframework.data.jpa.repository.JpaRepository
  import org.springframework.data.repository.CrudRepository
  import javax.persistence.Entity
  import jakarta.persistence.Entity
  ```
- **Annotation patterns**: `@Entity`, `@Table`, `@Repository`, `@Query`
- **Repository interfaces**: `JpaRepository<T, ID>`, `CrudRepository<T, ID>`, `PagingAndSortingRepository<T, ID>`

### Entity Definition Style
Same as Hibernate/JPA (§6). Spring Data JPA adds `@Repository` interfaces:
```kotlin
@Repository
interface UserRepository : JpaRepository<User, Long> {
    fun findByEmail(email: String): User?
    @Query("SELECT u FROM User u WHERE u.active = true")
    fun findAllActive(): List<User>
}
```

### Extraction Approach
1. Same entity extraction as §6.
2. Additionally scan for `JpaRepository<T, ID>` or `CrudRepository<T, ID>` interface definitions — extract `T` type argument to enumerate entity types.
3. Cross-reference `@Query` JPQL/HQL strings for table/entity name references.
4. Check `application.properties` / `application.yml` for:
   - `spring.jpa.hibernate.ddl-auto`
   - `spring.datasource.*` for database type

### Key Challenges
- JPQL uses entity class names (not table names) — map class name → table name.
- Projection interfaces and DTOs may superficially resemble entities.

### Analysis Tools
- Kotlin PSI; YAML/properties parsers for Spring config.

### Complexity
**Medium**

---

## 8. Spring Data MongoDB in Kotlin

- **Name**: Spring Data MongoDB
- **Type**: NoSQL (Document)
- **Supported Databases**: MongoDB

### Detection Signals
- **Build dependencies**:
  ```
  org.springframework.boot:spring-boot-starter-data-mongodb
  org.springframework.data:spring-data-mongodb
  ```
- **Import patterns**:
  ```kotlin
  import org.springframework.data.mongodb.core.mapping.Document
  import org.springframework.data.mongodb.core.mapping.Field
  import org.springframework.data.annotation.Id
  import org.springframework.data.mongodb.repository.MongoRepository
  ```
- **Annotation patterns**: `@Document`, `@Field`, `@Indexed`, `@CompoundIndex`

### Entity Definition Style
```kotlin
@Document(collection = "users")
data class User(
    @Id val id: String? = null,
    @Field("full_name") val name: String,
    val email: String,
    val roles: List<String> = emptyList()
)
```

### Extraction Approach
1. Detect `org.springframework.data.mongodb` imports.
2. Collect classes annotated with `@Document`:
   - Extract `collection` attribute; if absent, default to class name (camelCase).
3. Parse `@Field` annotations for explicit field names.
4. Find `MongoRepository<T, ID>` interfaces — extract entity type `T`.
5. Check `application.properties`/`application.yml` for `spring.data.mongodb.database`.

### Key Challenges
- Embedded documents (nested data classes) don't get their own collections — must distinguish root vs. embedded documents.
- `@DBRef` fields reference other collections.

### Analysis Tools
- Kotlin PSI; YAML/properties parsers.

### Complexity
**Low-Medium**

---

## 9. SQLDelight

- **Name**: SQLDelight
- **Type**: Schema File / Code Generator (SQL-first)
- **Supported Databases**: SQLite, PostgreSQL, MySQL, HSQL, SQLite (KMP)

### Detection Signals
- **Build dependencies**:
  ```
  app.cash.sqldelight:android-driver
  app.cash.sqldelight:native-driver
  app.cash.sqldelight:jdbc-driver
  app.cash.sqldelight:gradle-plugin (app.cash.sqldelight in plugins block)
  com.squareup.sqldelight:android-driver (older versions)
  ```
- **File patterns**: `*.sq` files (SQLDelight schema), `*.sqm` (migration) files
- **Gradle plugin block**: `id("app.cash.sqldelight")`

### Entity Definition Style
Tables are defined in `.sq` files using SQL DDL directly:
```sql
-- src/main/sqldelight/com/example/db/User.sq
CREATE TABLE user (
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL DEFAULT 0
);
```
SQLDelight generates Kotlin data classes from these definitions.

### Extraction Approach
1. Locate `.sq` and `.sqm` files by glob (`**/*.sq`, `**/*.sqm`).
2. Parse `CREATE TABLE <name> (...)` statements:
   - Table name is the identifier after `CREATE TABLE`.
   - Column names and types are inside the parentheses.
3. Parse `CREATE VIEW`, `CREATE INDEX` for supplementary schema objects.
4. For migrations (`.sqm`), look for `ALTER TABLE`, `CREATE TABLE`, `DROP TABLE` to track schema evolution.
5. No Kotlin AST parsing required for table names — SQL files are the source of truth.

### Key Challenges
- Multi-database setups (KMP) may have separate `.sq` files per platform.
- SQLDelight dialect varies slightly from standard SQL — custom types like `TEXT AS EmailAddress`.
- `*.sqm` migration files may rename/modify tables.

### Analysis Tools
- SQL parser (e.g., `JSqlParser`, custom regex for DDL patterns); file glob for `.sq`/`.sqm` discovery.

### Complexity
**Low** — SQL DDL is the canonical source.

---

## 10. Realm (Android / KMP)

- **Name**: Realm Kotlin SDK
- **Type**: NoSQL (Embedded Object Database)
- **Supported Databases**: Realm (proprietary)

### Detection Signals
- **Build dependencies**:
  ```
  io.realm.kotlin:library-base
  io.realm.kotlin:library-sync
  io.realm:realm-android (legacy Java SDK)
  ```
- **Gradle plugin**: `id("io.realm.kotlin")`
- **Import patterns**:
  ```kotlin
  import io.realm.kotlin.types.RealmObject
  import io.realm.kotlin.types.EmbeddedRealmObject
  import io.realm.kotlin.ext.realmListOf
  ```
- **Class pattern**: classes extending `RealmObject` or `EmbeddedRealmObject`

### Entity Definition Style
```kotlin
class User : RealmObject {
    @PrimaryKey
    var id: String = ObjectId().toString()
    var name: String = ""
    var email: String = ""
    var orders: RealmList<Order> = realmListOf()
}

class Order : EmbeddedRealmObject {
    var total: Double = 0.0
    var createdAt: RealmInstant = RealmInstant.now()
}
```

### Extraction Approach
1. Detect `io.realm.kotlin` imports or `RealmObject`/`EmbeddedRealmObject` supertypes.
2. Collect all classes extending `RealmObject` (top-level collections) vs. `EmbeddedRealmObject` (embedded, no separate collection).
3. Extract class name as the collection/object type name.
4. Enumerate all `var` properties (Realm schema = all non-ignored mutable properties).
5. Note `@PrimaryKey`, `@Ignore`, `@Index` annotations.
6. Find `RealmConfiguration.Builder(...).schema(...)` or `SyncConfiguration` calls that list the schema classes.

### Key Challenges
- `EmbeddedRealmObject` instances live inside parent objects — they are not independent collections.
- Legacy `io.realm:realm-android` uses different class hierarchies (`RealmModel`, `@RealmClass`).
- Realm schema is determined at runtime from the class list passed to `RealmConfiguration`.

### Analysis Tools
- Kotlin PSI for class hierarchy analysis.

### Complexity
**Low-Medium**

---

## 11. kotlin-jdsl

- **Name**: Kotlin JDSL (JPA Domain Specific Language)
- **Type**: Query DSL (over JPA/Hibernate)
- **Supported Databases**: Same as underlying JPA provider (PostgreSQL, MySQL, etc.)

### Detection Signals
- **Build dependencies**:
  ```
  com.linecorp.kotlin-jdsl:jpql-dsl
  com.linecorp.kotlin-jdsl:jpql-render
  com.linecorp.kotlin-jdsl:spring-data-jpa-support
  com.linecorp.kotlin-jdsl:hibernate-support
  ```
- **Import patterns**:
  ```kotlin
  import com.linecorp.kotlinjdsl.querymodel.jpql.entity.Entities
  import com.linecorp.kotlinjdsl.dsl.jpql.jpql
  ```

### Entity Definition Style
JDSL does not define entities itself — it queries existing JPA entities (§6, §7). Entity definitions are standard JPA `@Entity` classes. JDSL is a query-building DSL layer.

### Extraction Approach
1. Detect `com.linecorp.kotlin-jdsl` dependencies.
2. Entity extraction follows standard JPA/Hibernate rules (§6).
3. Optionally, scan `jpql { ... }` blocks for entity class references to validate entity inventory.

### Key Challenges
- No new entity definition format — purely query layer.

### Analysis Tools
- Kotlin PSI for JPA entity scanning.

### Complexity
**Low** (entity detection deferred to JPA layer)

---

## 12. JDBI with Kotlin

- **Name**: JDBI3 with Kotlin extension
- **Type**: Query Builder / SQL Mapper
- **Supported Databases**: PostgreSQL, MySQL, SQLite, H2, Oracle, SQL Server (any JDBC database)

### Detection Signals
- **Build dependencies**:
  ```
  org.jdbi:jdbi3-core
  org.jdbi:jdbi3-kotlin
  org.jdbi:jdbi3-kotlin-sqlobject
  org.jdbi:jdbi3-postgres
  ```
- **Import patterns**:
  ```kotlin
  import org.jdbi.v3.core.Jdbi
  import org.jdbi.v3.sqlobject.statement.SqlQuery
  import org.jdbi.v3.sqlobject.statement.SqlUpdate
  import org.jdbi.v3.kotlin.KotlinPlugin
  ```
- **Annotation patterns**: `@SqlQuery`, `@SqlUpdate`, `@SqlBatch`, `@RegisterKotlinMapper`

### Entity Definition Style
JDBI maps results to plain Kotlin data classes or POKOs — no special annotations required:
```kotlin
data class User(val id: Long, val name: String, val email: String)

@JdbiRepository
interface UserRepository {
    @SqlQuery("SELECT * FROM users WHERE id = :id")
    fun findById(id: Long): User?

    @SqlUpdate("INSERT INTO users (name, email) VALUES (:name, :email)")
    fun insert(name: String, email: String): Int
}
```

### Extraction Approach
1. Detect `org.jdbi:jdbi3-kotlin` dependency.
2. Scan `@SqlQuery`, `@SqlUpdate`, `@SqlBatch` annotation string values for SQL statements.
3. Parse SQL strings for `FROM <table>`, `JOIN <table>`, `INSERT INTO <table>`, `UPDATE <table>`, `DELETE FROM <table>`.
4. Map data classes used as result types in `@SqlQuery` methods — these are the entity shapes.
5. `@RegisterKotlinMapper` annotations explicitly bind a class to a query result.

### Key Challenges
- SQL strings may be dynamically constructed or loaded from external files.
- No formal entity annotation — entity shape is inferred from SQL result mapping.
- Same data class may be reused as a DTO for multiple tables.

### Analysis Tools
- Kotlin PSI; SQL string parsing via JSqlParser or regex.

### Complexity
**Medium** — requires SQL string extraction and parsing.

---

## 13. Ktor with Database Plugins

- **Name**: Ktor (with Exposed, HikariCP, etc.)
- **Type**: Web Framework (database access via plugins)
- **Supported Databases**: Any (delegates to underlying library)

### Detection Signals
- **Build dependencies**:
  ```
  io.ktor:ktor-server-core
  io.ktor:ktor-server-netty (or other engine)
  com.zaxxer:HikariCP
  ```
- **Import patterns**:
  ```kotlin
  import io.ktor.server.application.*
  import io.ktor.server.routing.*
  ```
- Ktor itself has no entity framework — entity detection follows whichever DB library is co-present (Exposed, Ktorm, JDBI, etc.).

### Entity Definition Style
Ktor does not define entities. It acts as a routing/application layer. Database entities are defined by the co-used persistence library.

### Extraction Approach
1. Detect Ktor dependency to confirm it's a Ktor project.
2. Identify co-present database libraries (Exposed, Ktorm, JDBI, etc.) and apply their respective extraction approaches.
3. Ktor `install(Database)` plugin calls in `Application.module()` can identify the database type and connection.

### Key Challenges
- Ktor apps frequently use Exposed — see §1/§2.
- Multiple database connections (multi-tenancy) may be configured.

### Analysis Tools
- Kotlin PSI; dependency manifest scanning.

### Complexity
**Low** (deferred to co-present DB library)

---

## 14. Raw JDBC in Kotlin

- **Name**: Raw JDBC
- **Type**: Raw SQL
- **Supported Databases**: Any JDBC-compatible database

### Detection Signals
- **Build dependencies**: Any JDBC driver:
  ```
  org.postgresql:postgresql
  mysql:mysql-connector-java
  com.h2database:h2
  org.xerial:sqlite-jdbc
  com.microsoft.sqlserver:mssql-jdbc
  ```
- **Import patterns**:
  ```kotlin
  import java.sql.Connection
  import java.sql.DriverManager
  import java.sql.PreparedStatement
  import java.sql.ResultSet
  ```

### Entity Definition Style
No formal entity definition. SQL strings embedded in code:
```kotlin
val stmt = conn.prepareStatement("SELECT id, name, email FROM users WHERE id = ?")
val rs = stmt.executeQuery()
```

### Extraction Approach
1. Detect JDBC driver dependencies and `java.sql.*` imports.
2. Scan string literals passed to `prepareStatement(...)`, `executeQuery(...)`, `executeUpdate(...)`.
3. Apply SQL parsing to extract table names from `FROM`, `JOIN`, `INSERT INTO`, `UPDATE`, `CREATE TABLE` clauses.
4. Map extracted table names to their usage context.
5. Supplement with `CREATE TABLE` DDL strings if present.

### Key Challenges
- SQL strings may be multi-line, dynamically assembled, or loaded from resources.
- String concatenation obfuscates table names.
- Resource files (`.sql` files in classpath) may contain DDL — also scan `src/main/resources/**/*.sql`.

### Analysis Tools
- Kotlin PSI for string literal extraction; JSqlParser for SQL parsing; file glob for `.sql` resource files.

### Complexity
**High** — no structural markers; relies on SQL string analysis.

---

## 15. Flyway (Kotlin Projects)

- **Name**: Flyway
- **Type**: Migration Tool
- **Supported Databases**: PostgreSQL, MySQL, MariaDB, Oracle, SQL Server, H2, SQLite, and others

### Detection Signals
- **Build dependencies**:
  ```
  org.flywaydb:flyway-core
  org.flywaydb:flyway-database-postgresql
  org.springframework.boot:spring-boot-starter-data-jpa (often co-present)
  ```
- **File patterns**:
  - `src/main/resources/db/migration/V*.sql` (versioned migrations)
  - `src/main/resources/db/migration/R*.sql` (repeatable migrations)
  - `src/main/resources/db/migration/U*.sql` (undo migrations)
  - `src/main/resources/db/migration/**/*.sql`
- **Config**: `flyway.locations` in `application.properties` / `application.yml`

### Entity Definition Style
SQL DDL migration files:
```sql
-- V1__create_users.sql
CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
```

### Extraction Approach
1. Detect `org.flywaydb:flyway-core` dependency.
2. Glob for `V*.sql`, `R*.sql` files under `db/migration` (and any custom location from config).
3. Parse all migration files as SQL:
   - `CREATE TABLE <name>` → new entity.
   - `ALTER TABLE <name> ADD COLUMN` → column addition.
   - `DROP TABLE <name>` → entity removal.
   - `RENAME TABLE <old> TO <new>` → entity rename.
4. Reconstruct the **final schema state** by applying migrations in version order.
5. Also check `V*__*.kt` Java-based migrations (Flyway Java callbacks) for programmatic DDL.

### Key Challenges
- Schema must be reconstructed by replaying migrations in order — intermediate states may be misleading.
- Custom migration locations override the default path.
- Flyway Teams (commercial) supports `.sql` in packages; locations may use `classpath:` prefix.

### Analysis Tools
- SQL parser (JSqlParser); file system glob; migration version ordering logic.

### Complexity
**Medium** — SQL parsing is straightforward, but state reconstruction requires ordered processing.

---

## 16. Liquibase (Kotlin Projects)

- **Name**: Liquibase
- **Type**: Migration Tool
- **Supported Databases**: PostgreSQL, MySQL, MariaDB, Oracle, SQL Server, H2, SQLite, MongoDB, and others

### Detection Signals
- **Build dependencies**:
  ```
  org.liquibase:liquibase-core
  ```
- **File patterns**:
  - `src/main/resources/db/changelog/db.changelog-master.xml`
  - `src/main/resources/db/changelog/**/*.xml`
  - `src/main/resources/db/changelog/**/*.yaml`
  - `src/main/resources/db/changelog/**/*.json`
  - `src/main/resources/db/changelog/**/*.sql`

### Entity Definition Style
XML, YAML, JSON, or SQL changelogs:
```xml
<changeSet id="1" author="dev">
    <createTable tableName="users">
        <column name="id" type="BIGINT" autoIncrement="true">
            <constraints primaryKey="true"/>
        </column>
        <column name="name" type="VARCHAR(255)"/>
        <column name="email" type="VARCHAR(255)"/>
    </createTable>
</changeSet>
```

### Extraction Approach
1. Detect `org.liquibase:liquibase-core` dependency.
2. Find the master changelog file (usually `db.changelog-master.xml`); follow `<include>` and `<includeAll>` directives.
3. Parse all changesets:
   - `<createTable tableName="...">` → entity.
   - `<addColumn tableName="...">` → column addition.
   - `<dropTable tableName="...">` → entity removal.
   - `<renameTable oldTableName="..." newTableName="...">` → rename.
4. For YAML/JSON changelogs, parse equivalent keys (`createTable`, `tableName`).
5. For SQL changelogs, apply SQL DDL parsing (same as Flyway §15).

### Key Challenges
- Complex `<include>` hierarchies require recursive file traversal.
- Context and label conditions on changesets may exclude certain DDL in some environments.
- `preconditions` blocks may make some changesets conditional.

### Analysis Tools
- XML/YAML/JSON parsers; SQL parser; recursive changelog traversal logic.

### Complexity
**Medium**

---

## 17. Prisma with Kotlin Client

- **Name**: Prisma (with Kotlin client via prisma-client-go-style or custom codegen)
- **Type**: Schema File / ORM (polyglot)
- **Supported Databases**: PostgreSQL, MySQL, MariaDB, SQLite, MongoDB, SQL Server, CockroachDB

### Detection Signals
- **File patterns**: `prisma/schema.prisma`, `schema.prisma`
- **Build dependencies** (Kotlin side): custom codegen plugins; no standard Kotlin artifact
- **Config**: `generator` block in `schema.prisma` targeting a Kotlin client

### Entity Definition Style
```prisma
model User {
  id        Int      @id @default(autoincrement())
  name      String
  email     String   @unique
  createdAt DateTime @default(now())
  orders    Order[]
}
```

### Extraction Approach
1. Glob for `prisma/schema.prisma` or `**/schema.prisma`.
2. Parse `model <Name> { ... }` blocks — each `model` is a table/collection.
3. Extract field names and types from inside the block.
4. Note `@map("table_name")` (field-level) and `@@map("table_name")` (model-level) for custom names.
5. Check `datasource` block for database type.

### Key Challenges
- Prisma's official Kotlin client support is limited — verify actual usage.
- `@@map` overrides the table name from the model name.
- `enum` definitions and `type` composites are supplementary schema objects.

### Analysis Tools
- Custom Prisma schema parser or regex on `.prisma` files.

### Complexity
**Low** — Prisma schema is a well-structured, easy-to-parse DSL.

---

## 18. MongoDB KMongo

- **Name**: KMongo
- **Type**: NoSQL (Document)
- **Supported Databases**: MongoDB

### Detection Signals
- **Build dependencies**:
  ```
  org.litote.kmongo:kmongo
  org.litote.kmongo:kmongo-coroutine
  org.litote.kmongo:kmongo-serialization
  org.litote.kmongo:kmongo-id
  ```
- **Import patterns**:
  ```kotlin
  import org.litote.kmongo.*
  import org.litote.kmongo.coroutine.*
  import com.mongodb.client.MongoCollection
  ```

### Entity Definition Style
Plain Kotlin data classes mapped to MongoDB collections:
```kotlin
data class User(
    val _id: Id<User> = newId(),
    val name: String,
    val email: String
)

// Collection access
val users: MongoCollection<User> = database.getCollection<User>()
```

### Extraction Approach
1. Detect `org.litote.kmongo` dependency.
2. Scan for `getCollection<T>()` calls — extract generic type `T` as the entity class.
3. Also check `getCollection("collectionName", T::class.java)` for explicit collection names.
4. Collect data classes that appear as generic parameters in collection access calls.
5. `@BsonId`, `@BsonProperty` annotations provide field name overrides.

### Key Challenges
- Collection names default to the class name (camelCase or lowercased depending on config).
- Classes used as KMongo documents may also be used in non-MongoDB contexts.
- Embedded documents (nested data classes) do not have their own collections.

### Analysis Tools
- Kotlin PSI for generic type argument extraction.

### Complexity
**Medium** — requires data flow analysis for `getCollection<T>()` calls.

---

## 19. Firebase / Firestore Android SDK

- **Name**: Firebase Firestore (Android / KMP)
- **Type**: NoSQL (Document / Cloud)
- **Supported Databases**: Google Firestore

### Detection Signals
- **Build dependencies**:
  ```
  com.google.firebase:firebase-firestore
  com.google.firebase:firebase-firestore-ktx
  dev.gitlive:firebase-firestore (KMP)
  ```
- **Import patterns**:
  ```kotlin
  import com.google.firebase.firestore.FirebaseFirestore
  import com.google.firebase.firestore.ktx.firestore
  import com.google.firebase.firestore.ktx.toObject
  import com.google.firebase.firestore.DocumentSnapshot
  ```

### Entity Definition Style
```kotlin
data class User(
    val name: String = "",
    val email: String = ""
)

// Firestore collection access
val db = Firebase.firestore
val usersRef = db.collection("users")
val user = snapshot.toObject<User>()
```

### Extraction Approach
1. Detect Firebase Firestore dependencies.
2. Scan for `.collection("name")` calls on `FirebaseFirestore` instances — extract the collection name string.
3. Identify data classes used with `.toObject<T>()`, `.set(obj)` — these are the entity shapes.
4. `@DocumentId` annotation on a field marks the Firestore document ID.

### Key Challenges
- Collection names are string literals at call sites — may be variables or constants.
- Subcollections (`.document("id").collection("subcollection")`) are accessed dynamically.
- No schema enforcement — fields are inferred from the data class only.

### Analysis Tools
- Kotlin PSI for string literal and generic type extraction.

### Complexity
**Medium-High** — collection names are scattered across call sites.

---

## 20. DynamoDB with Kotlin (AWS SDK v2)

- **Name**: AWS DynamoDB SDK v2 (Kotlin / Java)
- **Type**: NoSQL (Key-Value / Document)
- **Supported Databases**: AWS DynamoDB

### Detection Signals
- **Build dependencies**:
  ```
  software.amazon.awssdk:dynamodb
  software.amazon.awssdk:dynamodb-enhanced
  aws.sdk.kotlin:dynamodb (Kotlin SDK)
  ```
- **Import patterns**:
  ```kotlin
  import software.amazon.awssdk.services.dynamodb.DynamoDbClient
  import software.amazon.awssdk.enhanced.dynamodb.mapper.annotations.DynamoDbBean
  import software.amazon.awssdk.enhanced.dynamodb.mapper.annotations.DynamoDbPartitionKey
  import aws.sdk.kotlin.services.dynamodb.*
  ```
- **Annotation patterns**: `@DynamoDbBean`, `@DynamoDbPartitionKey`, `@DynamoDbSortKey`, `@DynamoDbAttribute`

### Entity Definition Style
```kotlin
@DynamoDbBean
data class User(
    @get:DynamoDbPartitionKey
    var id: String = "",
    var name: String = "",
    var email: String = ""
)

// Table registration
val table = enhancedClient.table("users", TableSchema.fromBean(User::class.java))
```

### Extraction Approach
1. Detect `software.amazon.awssdk:dynamodb-enhanced` or `aws.sdk.kotlin:dynamodb` dependency.
2. Collect classes annotated with `@DynamoDbBean`.
3. Scan for `enhancedClient.table("tableName", TableSchema.fromBean(X::class.java))` calls — extract table name and entity class.
4. Also scan `DynamoDbTable` references and `TableSchema.fromImmutableClass(...)` patterns.
5. For low-level SDK usage, scan `DynamoDbClient.putItem(...)`, `.getItem(...)` for `tableName(...)` builder calls.

### Key Challenges
- Table names may be externalized to configuration (environment variables, application config).
- Low-level SDK uses maps, not typed beans — no entity class to extract.
- DynamoDB's schema-less nature means column-level extraction is unreliable.

### Analysis Tools
- Kotlin PSI for annotation and method call analysis.

### Complexity
**Medium**

---

## 21. Ktor + Exposed Patterns

- **Name**: Ktor + Exposed (common pattern)
- **Type**: Relational ORM within a Ktor web application
- **Supported Databases**: PostgreSQL, MySQL, SQLite, H2

### Detection Signals
- **Build dependencies**: Both Ktor and Exposed present simultaneously:
  ```
  io.ktor:ktor-server-core
  org.jetbrains.exposed:exposed-core
  org.jetbrains.exposed:exposed-jdbc
  com.zaxxer:HikariCP
  ```
- **Structural pattern**: `Database.connect(...)` inside a Ktor `Application` module; `transaction { }` blocks inside route handlers.

### Entity Definition Style
Standard Exposed DSL/DAO (§1, §2), but organized around Ktor routing:
```kotlin
fun Application.configureDatabases() {
    Database.connect(HikariDataSource(config))
    transaction { SchemaUtils.create(Users, Orders) }
}
```

### Extraction Approach
1. Detect co-presence of Ktor + Exposed dependencies.
2. Apply Exposed DSL/DAO extraction (§1, §2) on all `.kt` files.
3. Note `SchemaUtils.create(...)` calls — the arguments list all managed Table objects.

### Key Challenges
- `SchemaUtils.create(...)` is a reliable cross-reference signal — collect all Table objects listed there.

### Analysis Tools
- Kotlin PSI.

### Complexity
**Low** (deferred to Exposed extraction)

---

## 22. kotlinx.serialization as Entity Signals

- **Name**: kotlinx.serialization (entity signal)
- **Type**: Serialization Library (entity signal, not a storage framework)
- **Supported Databases**: N/A (signal for data class usage patterns)

### Detection Signals
- **Build dependencies**:
  ```
  org.jetbrains.kotlinx:kotlinx-serialization-json
  org.jetbrains.kotlinx:kotlinx-serialization-core
  ```
- **Gradle plugin**: `kotlin("plugin.serialization")`
- **Import patterns**:
  ```kotlin
  import kotlinx.serialization.Serializable
  import kotlinx.serialization.SerialName
  ```
- **Annotation pattern**: `@Serializable` on data classes

### Entity Definition Style
```kotlin
@Serializable
data class User(
    val id: String,
    @SerialName("full_name") val name: String,
    val email: String
)
```

### Extraction Approach
1. Detect `kotlinx-serialization` dependency and plugin.
2. Collect all classes annotated with `@Serializable`.
3. These are **candidate entities** — validate by cross-referencing with database access patterns (they may just be API request/response models).
4. `@SerialName("...")` provides the serialized field name (useful for MongoDB document field mapping).
5. Combine with storage framework detection to confirm which `@Serializable` classes are persisted.

### Key Challenges
- `@Serializable` is used for API DTOs, Kafka messages, and cached objects — not just DB entities.
- Must cross-reference with actual storage framework call sites to confirm persistence usage.

### Analysis Tools
- Kotlin PSI; cross-reference with storage framework patterns.

### Complexity
**Low** to detect, **Medium** to confirm as entity (requires cross-referencing).

---

## 23. Cassandra (DataStax Driver / Kotlin)

- **Name**: DataStax Java/Kotlin Cassandra Driver
- **Type**: NoSQL (Wide-Column)
- **Supported Databases**: Apache Cassandra, DataStax Astra

### Detection Signals
- **Build dependencies**:
  ```
  com.datastax.oss:java-driver-core
  com.datastax.oss:java-driver-mapper-runtime
  com.datastax.oss:java-driver-query-builder
  com.datastax.cassandra:cassandra-driver-core (legacy 3.x)
  ```
- **Import patterns**:
  ```kotlin
  import com.datastax.oss.driver.api.mapper.annotations.Entity
  import com.datastax.oss.driver.api.mapper.annotations.Table
  import com.datastax.oss.driver.api.mapper.annotations.PartitionKey
  import com.datastax.oss.driver.api.mapper.annotations.ClusteringColumn
  ```

### Entity Definition Style
```kotlin
@Entity
@CqlName("users")
data class User(
    @PartitionKey val id: UUID,
    val name: String,
    val email: String
)
```

### Extraction Approach
1. Detect `com.datastax.oss:java-driver-mapper-runtime` dependency.
2. Collect classes annotated with `@Entity` (DataStax mapper).
3. Extract table name from `@CqlName("...")` or `@Table(name = "...")` or default to class name (lowercased).
4. Enumerate fields with `@PartitionKey`, `@ClusteringColumn`, `@CqlName` annotations.
5. Alternatively, scan CQL schema files (`*.cql`) for `CREATE TABLE` statements.

### Key Challenges
- DataStax `@Entity` conflicts with JPA `@Entity` — disambiguate by import package.
- CQL schema files may be stored separately (not in code).

### Analysis Tools
- Kotlin PSI; CQL file parsing.

### Complexity
**Medium**

---

## 24. Redis (Lettuce / Jedis in Kotlin)

- **Name**: Lettuce / Jedis (Redis clients)
- **Type**: NoSQL (Key-Value / Cache)
- **Supported Databases**: Redis

### Detection Signals
- **Build dependencies**:
  ```
  io.lettuce:lettuce-core
  redis.clients:jedis
  org.springframework.boot:spring-boot-starter-data-redis
  org.springframework.data:spring-data-redis
  ```
- **Import patterns**:
  ```kotlin
  import org.springframework.data.redis.core.RedisTemplate
  import org.springframework.data.redis.core.RedisHash
  import org.springframework.data.annotation.Id
  ```
- **Spring Data Redis annotation**: `@RedisHash`

### Entity Definition Style
```kotlin
@RedisHash("users")
data class User(
    @Id val id: String,
    val name: String,
    val email: String
)
```

### Extraction Approach
1. Detect Redis dependency.
2. For Spring Data Redis: collect classes annotated with `@RedisHash` — extract the hash key name.
3. For raw Lettuce/Jedis: scan for key string patterns in `.set(...)`, `.hset(...)`, `.zadd(...)` calls — these are not structured entity definitions.

### Key Challenges
- Redis is schema-less — only `@RedisHash` (Spring Data) provides structured entity signals.
- Raw Redis key patterns are implicit and spread across application code.

### Analysis Tools
- Kotlin PSI; Spring annotation scanning.

### Complexity
**Low** (Spring Data Redis), **High** (raw Lettuce/Jedis)

---

## 25. Elasticsearch (Kotlin ES Client)

- **Name**: Elasticsearch Java/Kotlin Client
- **Type**: NoSQL (Search / Document)
- **Supported Databases**: Elasticsearch, OpenSearch

### Detection Signals
- **Build dependencies**:
  ```
  co.elastic.clients:elasticsearch-java
  org.elasticsearch.client:elasticsearch-rest-high-level-client (legacy)
  org.springframework.boot:spring-boot-starter-data-elasticsearch
  org.springframework.data:spring-data-elasticsearch
  ```
- **Import patterns**:
  ```kotlin
  import org.springframework.data.elasticsearch.annotations.Document
  import org.springframework.data.elasticsearch.annotations.Field
  import co.elastic.clients.elasticsearch.ElasticsearchClient
  ```

### Entity Definition Style
```kotlin
@Document(indexName = "users")
data class User(
    @Id val id: String,
    @Field(name = "full_name") val name: String,
    val email: String
)
```

### Extraction Approach
1. Detect Elasticsearch dependency.
2. For Spring Data Elasticsearch: collect classes with `@Document(indexName = "...")`.
3. Extract index name from the annotation or default to class name lowercased.
4. For raw ES client: scan `IndexRequest.of { index("name") }` or `.index("name")` calls.

### Key Challenges
- `@Document` conflicts with Spring Data MongoDB's `@Document` — disambiguate by import package.
- Index names may be externalized to configuration.

### Analysis Tools
- Kotlin PSI; Spring annotation scanning.

### Complexity
**Low** (Spring Data ES), **Medium** (raw client)

---

## Repository Detection Plan

This section describes a systematic, automated approach for detecting which data entity frameworks are in use within a Kotlin repository and extracting entity/table definitions.

### Step 1: Identify Build System and Dependencies

1. **Locate build files**:
   - `build.gradle.kts` (Kotlin DSL — preferred in modern Kotlin projects)
   - `build.gradle` (Groovy DSL)
   - `pom.xml` (Maven)
   - `settings.gradle.kts` / `settings.gradle` (multi-module project roots)
2. **Parse dependencies** from `dependencies { }` blocks and `<dependencies>` XML elements.
3. **Map dependencies to frameworks** using the detection signals table below.

#### Quick-Reference Dependency → Framework Map

| Dependency Artifact | Framework |
|---|---|
| `org.jetbrains.exposed:exposed-core` | Exposed DSL/DAO |
| `org.ktorm:ktorm-core` | Ktorm |
| `androidx.room:room-runtime` | Room |
| `io.ebean:ebean` | Ebean |
| `org.hibernate:hibernate-core` | Hibernate/JPA |
| `org.springframework.boot:spring-boot-starter-data-jpa` | Spring Data JPA |
| `org.springframework.boot:spring-boot-starter-data-mongodb` | Spring Data MongoDB |
| `app.cash.sqldelight:gradle-plugin` | SQLDelight |
| `io.realm.kotlin:library-base` | Realm |
| `com.linecorp.kotlin-jdsl:jpql-dsl` | kotlin-jdsl |
| `org.jdbi:jdbi3-kotlin` | JDBI |
| `org.flywaydb:flyway-core` | Flyway |
| `org.liquibase:liquibase-core` | Liquibase |
| `org.litote.kmongo:kmongo` | KMongo |
| `com.google.firebase:firebase-firestore` | Firestore |
| `software.amazon.awssdk:dynamodb-enhanced` | DynamoDB Enhanced |
| `org.jetbrains.kotlinx:kotlinx-serialization-json` | kotlinx.serialization (signal) |
| `io.lettuce:lettuce-core` | Redis (Lettuce) |
| `co.elastic.clients:elasticsearch-java` | Elasticsearch |
| `com.datastax.oss:java-driver-core` | Cassandra |

### Step 2: File Discovery by Framework

Run targeted file searches based on detected frameworks:

| Framework | Files to Scan |
|---|---|
| Exposed | All `*.kt` files |
| Ktorm | All `*.kt` files |
| Room | All `*.kt` files in Android source sets |
| Hibernate/JPA/Spring Data JPA | All `*.kt` + `src/**/resources/**/*.xml` |
| Spring Data MongoDB | All `*.kt` |
| SQLDelight | `**/*.sq`, `**/*.sqm` |
| Realm | All `*.kt` files |
| JDBI | All `*.kt` files |
| Flyway | `src/**/resources/db/migration/V*.sql` |
| Liquibase | `src/**/resources/db/changelog/**/*.{xml,yaml,json,sql}` |
| KMongo | All `*.kt` files |
| Firestore | All `*.kt` files |
| DynamoDB | All `*.kt` files |
| Raw JDBC | All `*.kt` + `src/**/resources/**/*.sql` |

### Step 3: AST / Pattern-Based Entity Extraction

For each detected framework, apply the corresponding **Extraction Approach** from the sections above. Priority order (most to least structural signal):

1. **Highest confidence** (explicit DDL/schema files): SQLDelight (`.sq`), Flyway (`V*.sql`), Liquibase changelogs, Prisma (`schema.prisma`)
2. **High confidence** (annotation-based): Room (`@Entity`), Hibernate/JPA (`@Entity`), Spring Data JPA/MongoDB (`@Entity`/`@Document`), DynamoDB (`@DynamoDbBean`), Cassandra (`@Entity`)
3. **Medium confidence** (DSL-based): Exposed (`Table` subtypes), Ktorm (`Table<T>` subtypes), Realm (`RealmObject` subtypes)
4. **Lower confidence** (call-site inference): KMongo (`getCollection<T>()`), Firestore (`.collection("name")`), JDBI (SQL string analysis), raw JDBC (SQL string analysis)
5. **Signal only** (requires cross-referencing): `kotlinx.serialization` (`@Serializable`), raw Redis

### Step 4: Conflict Resolution and Deduplication

- A single entity class may be detected by multiple frameworks (e.g., a JPA `@Entity` class also used by Spring Data JPA, JDBI, and kotlin-jdsl). Deduplicate by canonical class identity.
- Migration tools (Flyway/Liquibase) and ORM frameworks may both describe the same table — merge into a single entity record with multiple source signals.
- `@Embeddable` / embedded documents should be marked as non-root entities (no independent collection/table).

### Step 5: Confidence Scoring

Assign each detected entity a confidence level:

| Signal Type | Confidence |
|---|---|
| SQL DDL in migration file (`CREATE TABLE`) | 95% |
| `@Entity` + `@Table(name=...)` annotation | 95% |
| Exposed `object X : Table("name")` | 95% |
| Room `@Entity(tableName = "name")` | 95% |
| SQLDelight `CREATE TABLE` in `.sq` file | 95% |
| `@Document(collection="name")` Spring Data | 90% |
| Ktorm `object X : Table<T>("name")` | 90% |
| DynamoDB `@DynamoDbBean` + `.table("name",...)` | 85% |
| KMongo `getCollection<T>("name")` | 80% |
| JDBI SQL string parsing | 70% |
| `@Serializable` data class (candidate only) | 40% |
| Raw JDBC SQL string parsing | 60% |

### Step 6: Output Schema

For each detected entity, output:
```json
{
  "name": "users",
  "sourceClass": "com.example.model.User",
  "framework": "Spring Data JPA",
  "database_type": "relational",
  "detection_confidence": 0.95,
  "columns": [
    { "name": "id", "type": "BIGINT", "primaryKey": true },
    { "name": "email", "type": "VARCHAR(255)", "nullable": false }
  ],
  "source_files": ["src/main/kotlin/com/example/model/User.kt"],
  "migration_files": ["src/main/resources/db/migration/V1__create_users.sql"]
}
```
