# Scala: Data Entity Storage Methods

A comprehensive catalog of data entity storage frameworks, libraries, and approaches in Scala for use in automated static analysis to extract data entities (database tables, document collections, etc.).

---

## Table of Contents

1. [Slick (Functional Relational Mapping)](#1-slick-functional-relational-mapping)
2. [Quill (Compile-Time Query Generation)](#2-quill-compile-time-query-generation)
3. [Doobie (Raw SQL with Type Mapping)](#3-doobie-raw-sql-with-type-mapping)
4. [Anorm](#4-anorm)
5. [Hibernate / JPA with Scala](#5-hibernate--jpa-with-scala)
6. [ScalikeJDBC](#6-scalikejdbc)
7. [Skinny ORM](#7-skinny-orm)
8. [Play Framework Ebean](#8-play-framework-ebean)
9. [Akka Persistence (Journal / Snapshot Entities)](#9-akka-persistence-journal--snapshot-entities)
10. [Spark DataFrame Schemas (StructType)](#10-spark-dataframe-schemas-structtype)
11. [Cats Effect + Doobie Patterns](#11-cats-effect--doobie-patterns)
12. [ZIO + Quill Patterns](#12-zio--quill-patterns)
13. [sbt-evolutions Migration Files](#13-sbt-evolutions-migration-files)
14. [Flyway with Scala](#14-flyway-with-scala)
15. [ReactiveMongo](#15-reactivemongo)
16. [Phantom (Cassandra)](#16-phantom-cassandra)
17. [Elastic4s (Elasticsearch)](#17-elastic4s-elasticsearch)
18. [Raw JDBC in Scala](#18-raw-jdbc-in-scala)
19. [Protobuf / Avro Schemas](#19-protobuf--avro-schemas)
20. [Case Classes as Entity Signals](#20-case-classes-as-entity-signals)
21. [Magnum (Scala 3 ORM)](#21-magnum-scala-3-orm)
22. [Typo (Scala 3 type-safe SQL)](#22-typo-scala-3-type-safe-sql)
23. [MongoDB Scala Driver](#23-mongodb-scala-driver)
24. [DynamoDB (AWS SDK v2 with Scala)](#24-dynamodb-aws-sdk-v2-with-scala)
25. [Redis (Jedis / Lettuce / redis4cats)](#25-redis-jedis--lettuce--redis4cats)

---

## 1. Slick (Functional Relational Mapping)

- **Name**: Slick (Scala Language Integrated Connection Kit)
- **Type**: Relational ORM / Query DSL
- **Supported Databases**: PostgreSQL, MySQL, MariaDB, SQLite, H2, Derby, Oracle, SQL Server, DB2

### Detection Signals
- **Build file** (`build.sbt` / `pom.xml`):
  ```
  "com.typesafe.slick" %% "slick" % "..."
  "com.typesafe.slick" %% "slick-hikaricp" % "..."
  "com.typesafe.slick" %% "slick-codegen" % "..."
  ```
- **Import patterns**:
  ```scala
  import slick.jdbc.PostgresProfile.api._
  import slick.jdbc.MySQLProfile.api._
  import slick.jdbc.JdbcProfile
  import slick.lifted.{ProvenShape, Tag, TableQuery}
  ```
- **Class pattern**: classes extending `Table[T]` with a `TableQuery` companion val

### Entity Definition Style
```scala
case class User(id: Long, name: String, email: String)

class UsersTable(tag: Tag) extends Table[User](tag, "users") {
  def id    = column[Long]("id", O.PrimaryKey, O.AutoInc)
  def name  = column[String]("name")
  def email = column[String]("email")

  def * = (id, name, email).mapTo[User]
}

val Users = TableQuery[UsersTable]
```

### Extraction Approach
1. Detect `com.typesafe.slick` dependency in `build.sbt`.
2. Scan all `.scala` files for `import slick.jdbc.*Profile.api._`.
3. Collect all classes extending `Table[T]`:
   - The second constructor argument is the table name string (e.g., `"users"`).
   - The `Tag` parameter is always first — skip it.
4. Extract column definitions from `def column[T]("name", ...)` method calls inside the `Table` class body.
5. Identify the case class type parameter `T` from `Table[T]` for the entity shape.
6. Find `val X = TableQuery[UsersTable]` declarations — these are the queryable table references.
7. For Slick Codegen projects, look for generated `Tables.scala` or `Tables.scala.html` artifacts under `target/` — these may be the only table definitions.

### Key Challenges
- **Profile import wildcard**: The Slick profile API is imported via a wildcard (`api._`), making it critical to identify which profile is in use for database-type context.
- **Lifted embedding vs. Plain SQL**: Some Slick projects mix `sql"..."` interpolator strings alongside `Table` definitions — scan both.
- **Codegen**: Auto-generated `Tables.scala` contains all table definitions in one large file; must handle this as the authoritative source when present.
- **Multi-database profiles**: `JdbcProfile` abstracted projects require checking the concrete profile binding.

### Analysis Tools
- **Scala compiler presentation compiler** or **Metals LSP** for accurate PSI; **Scalameta** (`scalameta/scalameta`) for AST parsing without a full compiler; regex for initial discovery.

### Complexity
**Low-Medium** — Table class pattern is consistent and explicit.

---

## 2. Quill (Compile-Time Query Generation)

- **Name**: Quill (getquill)
- **Type**: Compile-Time Query DSL
- **Supported Databases**: PostgreSQL, MySQL, SQLite, H2, Oracle, SQL Server, Cassandra, DynamoDB, MongoDB, Spark

### Detection Signals
- **Build dependencies** (`build.sbt`):
  ```
  "io.getquill" %% "quill-jdbc" % "..."
  "io.getquill" %% "quill-jdbc-zio" % "..."
  "io.getquill" %% "quill-async-postgres" % "..."
  "io.getquill" %% "quill-cassandra" % "..."
  "io.getquill" %% "quill-doobie" % "..."
  "io.getquill" %% "quill-spark" % "..."
  ```
- **Import patterns**:
  ```scala
  import io.getquill._
  import io.getquill.context.jdbc.JdbcContext
  import io.getquill.PostgresJdbcContext
  ```
- **DSL patterns**: `ctx.run(query[T])`, `ctx.run(quote { query[T] })`, `@Table`, `@Column` annotations

### Entity Definition Style
```scala
case class User(id: Long, name: String, email: String)

// With naming convention (table name inferred from class name)
val ctx = new PostgresJdbcContext(SnakeCase, "ctx")
import ctx._

// With explicit naming
@Table("tbl_users")
case class User(
  id: Long,
  @Column("full_name") name: String,
  email: String
)

// Query (generates SQL at compile time)
ctx.run(query[User])
```

### Extraction Approach
1. Detect `io.getquill` dependency.
2. Collect all case classes appearing in `query[T]` type arguments:
   - In `ctx.run(query[User])` → `User` is the entity.
   - In `ctx.run(quote { query[User].filter(...) })` → same.
3. Check for `@Table("name")` annotation on case classes — this overrides the default table name.
4. Default table name derivation follows the Quill naming strategy configured in the context:
   - `SnakeCase`: `UserProfile` → `user_profile`
   - `UpperCase`: `User` → `USER`
   - `Literal`: `User` → `User`
   - `PluralizedSnakeCase`: `User` → `users`
5. Check context instantiation (e.g., `new PostgresJdbcContext(SnakeCase, "ctx")`) to determine the naming strategy.
6. `@Column("name")` overrides individual field names.
7. For Quill 4.x (Scala 3): `inline def` queries and compile-time macros are used — scan for `inline ctx.run(...)` patterns.

### Key Challenges
- Table name is determined by naming strategy + class name — must identify the strategy in use.
- Quill macros execute at compile time; no runtime entity registry exists.
- `EntityQuery[T]` type is the key to identifying entities — also check `querySchema[T]("table_name", ...)` for explicit table naming.
- `querySchema` calls are the most reliable explicit table name source: `querySchema[User]("tbl_users", _.name -> "full_name")`.

### Analysis Tools
- **Scalameta** for AST parsing; annotation detection; naming strategy identification.

### Complexity
**Medium** — naming strategy adds indirection; `querySchema` is the most reliable signal.

---

## 3. Doobie (Raw SQL with Type Mapping)

- **Name**: Doobie
- **Type**: Raw SQL / Functional DB Access
- **Supported Databases**: PostgreSQL, MySQL, H2, SQLite (any JDBC database via HikariCP/JDBC)

### Detection Signals
- **Build dependencies** (`build.sbt`):
  ```
  "org.tpolecat" %% "doobie-core" % "..."
  "org.tpolecat" %% "doobie-postgres" % "..."
  "org.tpolecat" %% "doobie-hikari" % "..."
  "org.tpolecat" %% "doobie-quill" % "..."
  ```
- **Import patterns**:
  ```scala
  import doobie._
  import doobie.implicits._
  import doobie.postgres._
  import doobie.postgres.implicits._
  ```
- **DSL patterns**: `sql"..."` string interpolator, `fr"..."` (fragment), `.query[T]`, `.update`

### Entity Definition Style
```scala
case class User(id: Long, name: String, email: String)

// Doobie SQL string interpolator
def getUser(id: Long): ConnectionIO[Option[User]] =
  sql"SELECT id, name, email FROM users WHERE id = $id"
    .query[User]
    .option

def insertUser(user: User): ConnectionIO[Int] =
  sql"INSERT INTO users (name, email) VALUES (${user.name}, ${user.email})"
    .update.run
```

### Extraction Approach
1. Detect `org.tpolecat:doobie-core` dependency.
2. Scan all `.scala` files for `sql"..."` and `fr"..."` string interpolator usages.
3. Extract the SQL content from each interpolated string — interpolated `$variable` portions should be treated as placeholders.
4. Apply SQL parsing to the extracted strings:
   - `FROM <table>`, `JOIN <table>` → referenced tables.
   - `INSERT INTO <table>` → write entity.
   - `UPDATE <table>` → write entity.
   - `CREATE TABLE <table>` → DDL entity definition.
5. Identify case classes used in `.query[T]` — extract type `T` as the entity shape.
6. `Read[T]` and `Write[T]` type class derivations confirm `T` as a Doobie-mapped type.

### Key Challenges
- Multi-line `sql"..."` strings are common — must handle multi-line string literals.
- `fr"..."` fragments are composed programmatically; the full SQL is assembled at runtime.
- Parametric queries with `Fragment.const(tableName)` make table names dynamic.
- `sql""` inside loops or helper functions requires dataflow tracing for dynamic table names.

### Analysis Tools
- **Scalameta** for string interpolator extraction; **JSqlParser** for SQL parsing; regex as fallback.

### Complexity
**Medium-High** — relies on SQL string analysis; fragments add composition complexity.

---

## 4. Anorm

- **Name**: Anorm (Play Framework SQL library)
- **Type**: Raw SQL / Row Mapper
- **Supported Databases**: PostgreSQL, MySQL, H2, SQLite (any JDBC database)

### Detection Signals
- **Build dependencies** (`build.sbt`):
  ```
  "org.playframework.anorm" %% "anorm" % "..."
  "com.typesafe.play" %% "anorm" % "..." (older versions)
  ```
- **Import patterns**:
  ```scala
  import anorm._
  import anorm.SqlParser._
  import anorm.~
  ```
- **DSL patterns**: `SQL(...)`, `SQL"""..."""`, `{...}.as(...)`, `RowParser`, `SqlParser.get[T]("column")`

### Entity Definition Style
```scala
case class User(id: Long, name: String, email: String)

val userParser: RowParser[User] = {
  SqlParser.get[Long]("id") ~
  SqlParser.get[String]("name") ~
  SqlParser.get[String]("email") map {
    case id ~ name ~ email => User(id, name, email)
  }
}

def getUsers()(implicit conn: Connection): List[User] =
  SQL("SELECT id, name, email FROM users").as(userParser.*)
```

### Extraction Approach
1. Detect `anorm` dependency.
2. Scan for `SQL("...")` and `SQL"""..."""` patterns — extract SQL strings.
3. Parse SQL for table names (`FROM <table>`, `INSERT INTO <table>`, etc.).
4. Identify `RowParser[T]` definitions — the type `T` reveals the entity shape.
5. `SqlParser.get[T]("column_name")` calls enumerate column names explicitly.
6. `Macro.namedParser[T]` automatically derives a parser from case class `T` — detect these for entity discovery.

### Key Challenges
- SQL strings may be multiline string literals or concatenated strings.
- `RowParser` composition via `~` and `map` requires following the combinator chain to determine entity type.
- `Macro.namedParser[T]` and `Macro.parser[T]` are powerful signals — the type argument is the entity.

### Analysis Tools
- **Scalameta** for AST; SQL parsing for string literals.

### Complexity
**Medium**

---

## 5. Hibernate / JPA with Scala

- **Name**: Hibernate ORM / JPA with Scala
- **Type**: Relational ORM
- **Supported Databases**: PostgreSQL, MySQL, MariaDB, Oracle, SQL Server, H2

### Detection Signals
- **Build dependencies** (`build.sbt`):
  ```
  "org.hibernate.orm" % "hibernate-core" % "..."
  "jakarta.persistence" % "jakarta.persistence-api" % "..."
  "javax.persistence" % "javax.persistence-api" % "..."
  ```
- **Import patterns**:
  ```scala
  import javax.persistence._
  import jakarta.persistence._
  import org.hibernate.annotations._
  ```
- **Annotation patterns**: `@Entity`, `@Table`, `@Column`, `@Id`, `@GeneratedValue`

### Entity Definition Style
```scala
import javax.persistence._

@Entity
@Table(name = "products")
class Product {
  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  var id: Long = _

  @Column(name = "product_name")
  var name: String = _

  var price: java.math.BigDecimal = _
}
```

### Extraction Approach
1. Detect Hibernate/JPA dependency.
2. Collect all classes annotated with `@Entity` (from `javax.persistence` or `jakarta.persistence`).
3. Extract `@Table(name = "...")` for table name; default to class name.
4. Enumerate fields with `@Column(name = "...")`.
5. Note `@MappedSuperclass` for inherited fields.
6. Check `persistence.xml` for entity scan configuration.

### Key Challenges
- Scala classes with JPA require mutable `var` fields and no-arg constructors — unusual for idiomatic Scala.
- This pattern is rare in modern Scala but may appear in legacy Play/Spring Scala apps.
- Disambiguate `@Entity` from Quill's `@Table` and DataStax's `@Entity` by import package.

### Analysis Tools
- **Scalameta**; XML parser for `persistence.xml`.

### Complexity
**Low** (annotation pattern is explicit, but rarely used in Scala)

---

## 6. ScalikeJDBC

- **Name**: ScalikeJDBC
- **Type**: Query Builder / SQL Mapper
- **Supported Databases**: PostgreSQL, MySQL, H2, SQLite, Oracle, SQL Server (any JDBC database)

### Detection Signals
- **Build dependencies** (`build.sbt`):
  ```
  "org.scalikejdbc" %% "scalikejdbc" % "..."
  "org.scalikejdbc" %% "scalikejdbc-syntax-support-macro" % "..."
  "org.scalikejdbc" %% "scalikejdbc-play-initializer" % "..."
  ```
- **Import patterns**:
  ```scala
  import scalikejdbc._
  import scalikejdbc.SQLInterpolation._
  ```
- **DSL patterns**: `sql"..."`, `withSQL { ... }`, `SQLSyntaxSupport[T]`, `autoConstruct(rs, alias)`

### Entity Definition Style
```scala
case class User(id: Long, name: String, email: String)

object User extends SQLSyntaxSupport[User] {
  override val tableName = "users"
  override val columns   = Seq("id", "name", "email")

  def apply(rs: WrappedResultSet, u: ResultName[User]): User =
    autoConstruct(rs, u)
}

// Query
val users: List[User] = DB readOnly { implicit session =>
  withSQL {
    select.from(User as u).where.eq(u.id, 1)
  }.map(User(_, u)).list.apply()
}
```

### Extraction Approach
1. Detect `org.scalikejdbc` dependency.
2. Find companion objects extending `SQLSyntaxSupport[T]`:
   - Extract `override val tableName = "..."` — this is the authoritative table name.
   - Extract `override val columns = Seq(...)` for column names.
   - The type parameter `T` links to the case class.
3. For raw `sql"..."` patterns, apply SQL string parsing.
4. `SQLSyntaxSupport` is the most reliable signal — prioritize it.

### Key Challenges
- `tableName` may be overridden conditionally (rare but possible).
- `autoConstruct(rs, alias)` implies all `columns` entries are valid column names.
- Some projects use ScalikeJDBC with `sql"..."` exclusively, without `SQLSyntaxSupport`.

### Analysis Tools
- **Scalameta**; SQL string parsing.

### Complexity
**Low-Medium**

---

## 7. Skinny ORM

- **Name**: Skinny ORM (Skinny Framework)
- **Type**: Relational ORM
- **Supported Databases**: PostgreSQL, MySQL, H2, SQLite, Oracle, SQL Server

### Detection Signals
- **Build dependencies** (`build.sbt`):
  ```
  "org.skinny-framework" %% "skinny-orm" % "..."
  "org.skinny-framework" %% "skinny-framework" % "..."
  ```
- **Import patterns**:
  ```scala
  import skinny.orm._
  import skinny.orm.feature._
  ```
- **Class pattern**: objects extending `SkinnyCRUDMapper[T]`, `SkinnyMapper[T]`, `SkinnyNoIdMapper[T]`

### Entity Definition Style
```scala
case class User(id: Long, name: String, email: String)

object User extends SkinnyCRUDMapper[User] {
  override lazy val tableName = "users"
  override lazy val defaultAlias = createAlias("u")
  override def extract(rs: WrappedResultSet, n: ResultName[User]): User =
    autoConstruct(rs, n)
}
```

### Extraction Approach
1. Detect `org.skinny-framework:skinny-orm` dependency.
2. Find objects/classes extending `SkinnyCRUDMapper[T]`, `SkinnyMapper[T]`, `SkinnyNoIdCRUDMapper[T]`:
   - Extract `override lazy val tableName = "..."`.
   - Extract type `T` for the entity case class.
3. Default `tableName` is derived from the object name (snake_case plural) if not overridden.

### Key Challenges
- `tableName` overriding is `lazy val` — must specifically parse lazy val overrides.
- Skinny ORM builds on ScalikeJDBC; both may be present.

### Analysis Tools
- **Scalameta**.

### Complexity
**Low**

---

## 8. Play Framework Ebean

- **Name**: Play Framework with Ebean ORM
- **Type**: Relational ORM (Play integration)
- **Supported Databases**: PostgreSQL, MySQL, Oracle, SQL Server, H2

### Detection Signals
- **Build dependencies** (`build.sbt`):
  ```
  "com.typesafe.play" %% "play-ebean" % "..."
  "io.ebean" % "ebean" % "..."
  ```
- **sbt plugin** (`project/plugins.sbt`):
  ```
  addSbtPlugin("com.typesafe.play" % "sbt-plugin" % "...")
  addSbtPlugin("io.ebean" % "sbt-ebean" % "...")
  ```
- **Import patterns**:
  ```scala
  import io.ebean._
  import javax.persistence._
  ```
- **Annotation patterns**: `@Entity`, `@Table`, `@Column`, `@Id`

### Entity Definition Style
```scala
import javax.persistence._
import io.ebean.Model

@Entity
@Table(name = "users")
class User extends Model {
  @Id
  var id: Long = _
  var name: String = _
  @Column(name = "email_address")
  var email: String = _
}
```

### Extraction Approach
1. Detect `play-ebean` or `sbt-ebean` in build/plugin files.
2. Same JPA annotation extraction as §5 — collect `@Entity` classes.
3. Extract `@Table(name = "...")` or default to class name.
4. Inspect `conf/evolutions/` SQL files (Play evolutions, §13) as supplementary schema source.

### Key Challenges
- Requires mutable Scala classes (violates functional Scala idioms) — often found in older Play apps.
- `Model` superclass from Ebean must be detected to distinguish from Quill's `@Table` or plain `@Entity`.

### Analysis Tools
- **Scalameta**; sbt plugin file scanning.

### Complexity
**Low-Medium**

---

## 9. Akka Persistence (Journal / Snapshot Entities)

- **Name**: Akka Persistence / Pekko Persistence
- **Type**: Event Sourcing / CQRS (persistence layer)
- **Supported Databases**: PostgreSQL (via akka-persistence-jdbc), Cassandra (via akka-persistence-cassandra), DynamoDB, in-memory (test)

### Detection Signals
- **Build dependencies** (`build.sbt`):
  ```
  "com.typesafe.akka" %% "akka-persistence" % "..."
  "com.typesafe.akka" %% "akka-persistence-typed" % "..."
  "com.lightbend.akka" %% "akka-persistence-jdbc" % "..."
  "com.typesafe.akka" %% "akka-persistence-cassandra" % "..."
  "org.apache.pekko" %% "pekko-persistence" % "..."
  ```
- **Import patterns**:
  ```scala
  import akka.persistence._
  import akka.persistence.typed.scaladsl.EventSourcedBehavior
  import akka.persistence.journal.AsyncWriteJournal
  ```
- **Class patterns**: classes extending `PersistentActor`, `EventSourcedBehavior`, behaviors using `Effect.persist(...)`

### Entity Definition Style
Akka Persistence does not define tables directly — the persistence plugin manages journal/snapshot tables. Entities are **actors with persistent state**:
```scala
case class UserState(name: String, email: String)
sealed trait UserEvent
case class UserCreated(name: String, email: String) extends UserEvent
case class UserUpdated(name: String) extends UserEvent

object UserActor {
  def apply(userId: String): Behavior[UserCommand] =
    EventSourcedBehavior(
      persistenceId = PersistenceId.ofUniqueId(userId),
      emptyState = UserState("", ""),
      commandHandler = ...,
      eventHandler = ...
    )
}
```

The journal plugin creates tables like `event_journal`, `snapshot`, `event_tag` in the underlying database.

### Extraction Approach
1. Detect `akka-persistence` dependency.
2. Identify the configured journal plugin from `application.conf`:
   - `akka.persistence.journal.plugin = "jdbc-journal"` → akka-persistence-jdbc (PostgreSQL/MySQL)
   - `akka.persistence.journal.plugin = "cassandra-journal"` → Cassandra
3. For `akka-persistence-jdbc`, the schema tables are fixed: `event_journal`, `event_tag`, `snapshot` — document these as infrastructure tables.
4. Collect `PersistentActor`/`EventSourcedBehavior` actor types — these represent **aggregate root entities** (logical, not DB tables).
5. Event and state case classes represent the domain model — catalog these separately.
6. Akka Projections / Read Side: scan for `R2dbcSession`, `SlickSession` queries to find read-model table names.

### Key Challenges
- Journal and snapshot tables are created by the persistence plugin — not in application code.
- The logical entity (actor aggregate) differs from the physical storage (journal rows).
- Read-side projections (CQRS) may maintain separate read-model tables — scan projection handlers.
- `persistenceId` strings often embed entity type and ID: `"User|123"` — extract the prefix as entity type.

### Analysis Tools
- **Scalameta**; HOCON (`application.conf`) parser for plugin configuration.

### Complexity
**High** — requires understanding event sourcing patterns; physical tables are framework-managed.

---

## 10. Spark DataFrame Schemas (StructType)

- **Name**: Apache Spark (Scala API)
- **Type**: Big Data / Distributed Processing Schema Definitions
- **Supported Databases**: Hive, Delta Lake, Parquet, ORC, JDBC (any), Kafka, Avro, JSON, CSV, Iceberg

### Detection Signals
- **Build dependencies** (`build.sbt`):
  ```
  "org.apache.spark" %% "spark-core" % "..."
  "org.apache.spark" %% "spark-sql" % "..."
  "org.apache.spark" %% "spark-mllib" % "..."
  "io.delta" %% "delta-core" % "..."
  "org.apache.spark" %% "spark-avro" % "..."
  ```
- **Import patterns**:
  ```scala
  import org.apache.spark.sql.{DataFrame, Dataset, SparkSession}
  import org.apache.spark.sql.types._
  import org.apache.spark.sql.functions._
  ```
- **Schema patterns**: `StructType(...)`, `case class` with `Encoder[T]`, `spark.read.table(...)`, `.createOrReplaceTempView(...)`

### Entity Definition Style
```scala
// 1. Explicit StructType schema definition
val userSchema = StructType(Seq(
  StructField("id", LongType, nullable = false),
  StructField("name", StringType, nullable = true),
  StructField("email", StringType, nullable = true),
  StructField("created_at", TimestampType, nullable = true)
))

// 2. Case class as Dataset schema (Encoder derived automatically)
case class User(id: Long, name: String, email: String)
val users: Dataset[User] = spark.read.parquet("s3://bucket/users").as[User]

// 3. Spark SQL / Hive table references
spark.sql("SELECT * FROM users WHERE id = 1")
val df = spark.read.table("users")
df.createOrReplaceTempView("temp_users")
df.write.saveAsTable("output_users")
```

### Extraction Approach
1. Detect `org.apache.spark:spark-sql` dependency.
2. **StructType definitions**: scan for `StructType(Seq(StructField("name", Type, nullable), ...))` — extract field names and types.
3. **Case class Encoders**: collect case classes used in `.as[T]` type arguments — these are the typed Dataset schemas.
4. **Table references** (Hive/Spark SQL):
   - `spark.read.table("name")` → table entity.
   - `df.write.saveAsTable("name")` → output table entity.
   - `spark.sql("...")` → SQL string parsing for table names.
   - `.createOrReplaceTempView("name")` → temporary view (not persisted).
5. **Delta Lake**: `.format("delta").load("path")` and `.option("path", ...)` identify Delta tables; also scan `DeltaTable.forPath(...)` and `DeltaTable.forName(...)`.
6. **JDBC**: `.format("jdbc").option("dbtable", "schema.table")` → explicit table name.

### Key Challenges
- `createOrReplaceTempView` creates ephemeral views, not persistent tables — exclude these.
- `StructType` instances may be defined inline or as values referenced elsewhere.
- Complex ETL pipelines may reference dozens of tables in `spark.sql(...)` strings.
- Catalog and database qualifications (`catalog.db.table`) must be handled.
- Schema inference (`spark.read.parquet(...)` without explicit schema) provides no column information.

### Analysis Tools
- **Scalameta** for AST; SQL parser for `spark.sql(...)` strings; path analysis for Delta/Parquet.

### Complexity
**High** — multiple schema definition styles; table references scattered across transformation chains.

---

## 11. Cats Effect + Doobie Patterns

- **Name**: Cats Effect + Doobie (functional IO)
- **Type**: Raw SQL / Functional DB Access (with Cats IO)
- **Supported Databases**: Same as Doobie (§3)

### Detection Signals
- **Build dependencies**:
  ```
  "org.typelevel" %% "cats-effect" % "..."
  "org.tpolecat" %% "doobie-core" % "..."
  "org.tpolecat" %% "doobie-hikari" % "..."
  ```
- **Import patterns**:
  ```scala
  import cats.effect.IO
  import cats.effect.IOApp
  import doobie.implicits._
  import doobie.hikari.HikariTransactor
  ```
- **Patterns**: `Transactor[IO]`, `xa.trans`, `ConnectionIO[A]`

### Entity Definition Style
Same as Doobie §3 — case classes mapped via `sql"..."` interpolators:
```scala
case class User(id: Long, name: String, email: String)

def getUser(id: Long): IO[Option[User]] =
  sql"SELECT id, name, email FROM users WHERE id = $id"
    .query[User]
    .option
    .transact(xa)
```

### Extraction Approach
1. Detect both `cats-effect` and `doobie-core` dependencies simultaneously.
2. Apply Doobie extraction approach (§3) — the Cats Effect layer adds IO wrapping but does not change entity definitions.
3. `.transact(xa)` calls are good markers for Doobie queries — use them to locate `sql"..."` interpolators.

### Key Challenges
- Same as Doobie (§3) plus: `Resource[IO, HikariTransactor[IO]]` setup in `IOApp` may configure the database connection — check for database URL.

### Analysis Tools
- **Scalameta**; SQL string parsing.

### Complexity
**Medium-High** (same as Doobie)

---

## 12. ZIO + Quill Patterns

- **Name**: ZIO + Quill (ZIO functional effect system)
- **Type**: Compile-Time Query DSL with ZIO effects
- **Supported Databases**: PostgreSQL, MySQL, H2, Oracle, SQL Server (via Quill JDBC), plus Quill's NoSQL backends

### Detection Signals
- **Build dependencies**:
  ```
  "dev.zio" %% "zio" % "..."
  "io.getquill" %% "quill-jdbc-zio" % "..."
  "io.getquill" %% "quill-zio" % "..."
  ```
- **Import patterns**:
  ```scala
  import zio._
  import zio.ZIO
  import io.getquill._
  import io.getquill.jdbczio.Quill
  ```
- **Patterns**: `Quill.Postgres[SnakeCase]`, `ZIO.serviceWithZIO[Quill.Postgres[...]]`, `run(query[T])`

### Entity Definition Style
```scala
case class User(id: Long, name: String, email: String)

val userLayer = Quill.Postgres.fromNamingStrategy(SnakeCase)

val getUsers: ZIO[Quill.Postgres[SnakeCase], SQLException, List[User]] =
  ZIO.serviceWithZIO[Quill.Postgres[SnakeCase]] { ctx =>
    import ctx._
    run(query[User])
  }
```

### Extraction Approach
1. Detect `quill-jdbc-zio` or `quill-zio` dependency.
2. Apply Quill extraction approach (§2) — the ZIO layer is an effect wrapper only.
3. `Quill.Postgres[NamingStrategy]` or `Quill.MySQL[NamingStrategy]` environment types reveal the naming strategy.
4. `run(query[T])` and `run(quote { query[T] })` are the entity discovery signals.

### Key Challenges
- Same as Quill (§2).
- ZIO environment type parameters may make type argument extraction more complex.

### Analysis Tools
- **Scalameta**; naming strategy detection.

### Complexity
**Medium**

---

## 13. sbt-evolutions Migration Files

- **Name**: Play Framework Evolutions (sbt-evolutions)
- **Type**: Migration Tool
- **Supported Databases**: PostgreSQL, MySQL, H2, SQLite (any JDBC database)

### Detection Signals
- **sbt plugin** (`project/plugins.sbt`):
  ```
  addSbtPlugin("com.typesafe.play" % "sbt-plugin" % "...")
  ```
- **File patterns**:
  - `conf/evolutions/<database_name>/<N>.sql` (e.g., `conf/evolutions/default/1.sql`)
  - `conf/evolutions/default/*.sql`
- **File structure**: each evolution file contains `# --- !Ups` and `# --- !Downs` sections

### Entity Definition Style
```sql
# --- !Ups

CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

# --- !Downs

DROP TABLE users;
```

### Extraction Approach
1. Detect Play Framework plugin or `conf/evolutions/` directory.
2. Glob for `conf/evolutions/**/*.sql`.
3. For each file:
   - Split on `# --- !Ups` and `# --- !Downs` markers.
   - Parse the `!Ups` section for DDL: `CREATE TABLE`, `ALTER TABLE`, `DROP TABLE`.
4. Process files in numeric order (1.sql, 2.sql, ...) to reconstruct final schema state.
5. The `<database_name>` directory name identifies the logical database connection.

### Key Challenges
- Database name (subdirectory) identifies the connection — map to `db.<name>` in `application.conf`.
- Multiple databases may have separate evolution directories.
- `# --- !Downs` sections contain rollback DDL — do not include in forward schema analysis.

### Analysis Tools
- SQL parser; file glob; numeric ordering logic.

### Complexity
**Low** — straightforward file structure.

---

## 14. Flyway with Scala

- **Name**: Flyway (used in Scala projects)
- **Type**: Migration Tool
- **Supported Databases**: PostgreSQL, MySQL, MariaDB, Oracle, SQL Server, H2, SQLite

### Detection Signals
- **Build dependencies** (`build.sbt`):
  ```
  "org.flywaydb" % "flyway-core" % "..."
  "org.flywaydb" % "flyway-database-postgresql" % "..."
  ```
- **sbt plugin** (`project/plugins.sbt`):
  ```
  addSbtPlugin("io.github.davidmweber" % "flyway-sbt" % "...")
  ```
- **File patterns**: Same as Kotlin §15 — `src/main/resources/db/migration/V*.sql`

### Entity Definition Style
Same SQL DDL migration files as described in Kotlin §15.

### Extraction Approach
Same as Kotlin §15 — apply SQL DDL parsing to versioned migration files in order.

### Key Challenges
- Same as Kotlin §15.
- In Scala projects, Flyway may be invoked programmatically in `IOApp` or in a ZIO layer startup.
- Check `FlywayConfig` in HOCON `application.conf` for custom migration locations.

### Analysis Tools
- SQL parser; file glob; version ordering.

### Complexity
**Medium**

---

## 15. ReactiveMongo

- **Name**: ReactiveMongo
- **Type**: NoSQL (Document — async MongoDB driver)
- **Supported Databases**: MongoDB

### Detection Signals
- **Build dependencies** (`build.sbt`):
  ```
  "org.reactivemongo" %% "reactivemongo" % "..."
  "org.reactivemongo" %% "play2-reactivemongo" % "..."
  "org.reactivemongo" %% "reactivemongo-bson-api" % "..."
  ```
- **Import patterns**:
  ```scala
  import reactivemongo.api._
  import reactivemongo.api.bson._
  import reactivemongo.api.collections.bson.BSONCollection
  import reactivemongo.play.json._
  ```
- **Patterns**: `db.collection[BSONCollection]("name")`, `BSONDocumentReader[T]`, `BSONDocumentWriter[T]`

### Entity Definition Style
```scala
case class User(id: BSONObjectID, name: String, email: String)

implicit val userReader: BSONDocumentReader[User] = Macros.reader[User]
implicit val userWriter: BSONDocumentWriter[User] = Macros.writer[User]

val usersCollection: Future[BSONCollection] =
  db.collection[BSONCollection]("users")
```

### Extraction Approach
1. Detect `org.reactivemongo` dependency.
2. Scan for `.collection[BSONCollection]("name")` calls — extract the collection name string.
3. Identify case classes used with `Macros.reader[T]`, `Macros.writer[T]`, or `Macros.handler[T]` — type `T` is the document schema.
4. Also detect `BSONDocumentReader[T]` and `BSONDocumentWriter[T]` implicit derivations.
5. `@Key("fieldName")` annotation overrides BSON field names.

### Key Challenges
- Collection names are string literals in `.collection(...)` calls — may be stored in variables or config.
- `Macros.reader[T]`/`Macros.writer[T]` are the strongest signals for entity shapes.
- Play2 ReactiveMongo uses JSON format readers/writers — scan for `Format[T]`, `OFormat[T]`.

### Analysis Tools
- **Scalameta** for method call and generic type extraction.

### Complexity
**Medium**

---

## 16. Phantom (Cassandra)

- **Name**: Phantom (Cassandra Scala DSL)
- **Type**: NoSQL (Wide-Column)
- **Supported Databases**: Apache Cassandra

### Detection Signals
- **Build dependencies** (`build.sbt`):
  ```
  "com.outworkers" %% "phantom-dsl" % "..."
  "com.outworkers" %% "phantom-connectors" % "..."
  ```
- **Import patterns**:
  ```scala
  import com.outworkers.phantom.dsl._
  import com.outworkers.phantom.CassandraTable
  ```
- **Class pattern**: classes extending `CassandraTable[T, R]`, tables registering in a `Database` object

### Entity Definition Style
```scala
case class User(id: UUID, name: String, email: String)

abstract class Users extends CassandraTable[Users, User] {
  object id    extends UUIDColumn with PartitionKey
  object name  extends StringColumn
  object email extends StringColumn

  def fromRow(row: Row): User = User(id(row), name(row), email(row))
}

abstract class MyDatabase(override val connector: CassandraConnection)
  extends Database[MyDatabase](connector) {
  object users extends Users with Connector
}
```

### Extraction Approach
1. Detect `com.outworkers:phantom-dsl` dependency.
2. Find classes extending `CassandraTable[T, R]`:
   - `T` = table class (self-reference), `R` = row type (entity case class).
3. Extract the table name from `override val tableName = "..."` or default to the class name (lowercased).
4. Enumerate `object column extends <ColumnType>` definitions inside the table class.
5. Note `with PartitionKey`, `with ClusteringOrder`, `with PrimaryKey` traits for key structure.
6. Find `Database` subclasses — the `object` members of table type list all registered tables.

### Key Challenges
- Phantom uses object-per-column style (Scala objects as column descriptors) — requires traversing nested object members.
- `tableName` defaults to the class name; check for explicit overrides.
- Phantom 2.x vs. older versions differ slightly in API.

### Analysis Tools
- **Scalameta**.

### Complexity
**Medium**

---

## 17. Elastic4s (Elasticsearch)

- **Name**: Elastic4s
- **Type**: NoSQL (Search / Document)
- **Supported Databases**: Elasticsearch, OpenSearch

### Detection Signals
- **Build dependencies** (`build.sbt`):
  ```
  "com.sksamuel.elastic4s" %% "elastic4s-core" % "..."
  "com.sksamuel.elastic4s" %% "elastic4s-client-esjava" % "..."
  "com.sksamuel.elastic4s" %% "elastic4s-http" % "..."
  "com.sksamuel.elastic4s" %% "elastic4s-json4s" % "..."
  "com.sksamuel.elastic4s" %% "elastic4s-circe" % "..."
  ```
- **Import patterns**:
  ```scala
  import com.sksamuel.elastic4s.ElasticClient
  import com.sksamuel.elastic4s.ElasticDsl._
  import com.sksamuel.elastic4s.requests.indexes.IndexRequest
  ```
- **DSL patterns**: `indexInto("name")`, `search("name")`, `createIndex("name")`, `mapping("name")`

### Entity Definition Style
```scala
case class User(id: String, name: String, email: String)

// Index and search operations
client.execute { indexInto("users").id(user.id).doc(user) }
client.execute { search("users").query(matchQuery("name", "Alice")) }

// Index creation with mapping
client.execute {
  createIndex("users").mapping(
    properties(
      textField("name"),
      keywordField("email")
    )
  )
}
```

### Extraction Approach
1. Detect `com.sksamuel.elastic4s` dependency.
2. Scan for `indexInto("name")`, `search("name")`, `deleteIndex("name")`, `createIndex("name")` calls — extract the index name string argument.
3. `createIndex("name").mapping(...)` is the most structured definition — parse `properties(...)` for field names.
4. Identify case classes used in `.doc(obj)` calls for entity shapes.
5. `ElasticDsl._` wildcard import activates all DSL methods — all methods above are from this import.

### Key Challenges
- Index names are string literals at call sites — may be constants or config-driven.
- `ElasticDsl` methods are imported implicitly; without the import, these methods look like free functions.
- Dynamic index names (date-rolling indices, e.g., `s"logs-${today}"`) cannot be statically resolved.

### Analysis Tools
- **Scalameta** for method call extraction.

### Complexity
**Medium**

---

## 18. Raw JDBC in Scala

- **Name**: Raw JDBC in Scala
- **Type**: Raw SQL
- **Supported Databases**: Any JDBC-compatible database

### Detection Signals
- **Build dependencies**: Any JDBC driver:
  ```
  "org.postgresql" % "postgresql" % "..."
  "mysql" % "mysql-connector-java" % "..."
  "com.h2database" % "h2" % "..."
  "org.xerial" % "sqlite-jdbc" % "..."
  ```
- **Import patterns**:
  ```scala
  import java.sql.{Connection, DriverManager, PreparedStatement, ResultSet}
  ```

### Entity Definition Style
No formal entity definition — SQL strings embedded in code:
```scala
val stmt = conn.prepareStatement("SELECT id, name, email FROM users WHERE id = ?")
stmt.setLong(1, userId)
val rs = stmt.executeQuery()
```

### Extraction Approach
Same as Kotlin §14 — scan SQL strings in `prepareStatement(...)`, `executeQuery(...)`, `createStatement().execute(...)`. Apply SQL parsing. Also scan `src/main/resources/**/*.sql`.

### Key Challenges
- Same as Kotlin §14.
- Scala string interpolation (`s"..."`) may embed table names in SQL fragments — interpolated portions require placeholder substitution before parsing.

### Analysis Tools
- **Scalameta** for string literal extraction; **JSqlParser** for SQL parsing.

### Complexity
**High**

---

## 19. Protobuf / Avro Schemas

- **Name**: Protocol Buffers / Apache Avro (schema definitions)
- **Type**: Schema File (serialization schemas used as entity signals)
- **Supported Databases**: N/A (Kafka, Confluent Schema Registry, gRPC services — often paired with DB storage)

### Detection Signals
- **Build dependencies** (`build.sbt`):
  ```
  "com.thesamet.scalapb" %% "scalapb-runtime" % "..."
  "org.apache.avro" % "avro" % "..."
  "com.sksamuel.avro4s" %% "avro4s-core" % "..."
  "io.confluent" % "kafka-avro-serializer" % "..."
  ```
- **sbt plugins** (`project/plugins.sbt`):
  ```
  addSbtPlugin("com.thesamet" % "sbt-protoc" % "...")
  ```
- **File patterns**:
  - `src/main/protobuf/**/*.proto` — Protocol Buffer schemas
  - `src/main/avro/**/*.avsc` — Avro JSON schemas
  - `src/main/avro/**/*.avdl` — Avro IDL schemas

### Entity Definition Style
```protobuf
// user.proto
syntax = "proto3";
message User {
  int64 id = 1;
  string name = 2;
  string email = 3;
}
```

```json
// user.avsc (Avro)
{
  "type": "record",
  "name": "User",
  "namespace": "com.example",
  "fields": [
    {"name": "id", "type": "long"},
    {"name": "name", "type": "string"},
    {"name": "email", "type": "string"}
  ]
}
```

### Extraction Approach
1. Detect `sbt-protoc`, `scalapb`, or `avro` dependencies.
2. **Protobuf**: Glob for `**/*.proto`; parse `message <Name> { ... }` blocks — extract message names and fields.
3. **Avro JSON** (`*.avsc`): Parse JSON; collect `"type": "record"` objects — extract `"name"` and `"fields"`.
4. **Avro IDL** (`*.avdl`): Parse `record <Name> { ... }` blocks.
5. **avro4s**: Scan for `AvroSchema[T]` or `SchemaFor[T]` type class usages — `T` is a case class entity.
6. These are candidate entity signals — cross-reference with Kafka topic names and storage framework usage to confirm DB persistence.

### Key Challenges
- Proto/Avro schemas are primarily used for serialization (Kafka, gRPC) — not all messages are stored in databases.
- `oneof`, `repeated`, nested messages complicate field extraction.
- Generated Scala code from `sbt-protoc` should not be confused with hand-written entities.

### Analysis Tools
- JSON/YAML parser for `.avsc`; custom parser or regex for `.proto`; **Scalameta** for `avro4s` type class detection.

### Complexity
**Low** (schema file parsing), **Medium** (confirming DB persistence)

---

## 20. Case Classes as Entity Signals

- **Name**: Scala case classes (general entity signal)
- **Type**: Entity Signal (not a storage framework)
- **Supported Databases**: N/A

### Detection Signals
- Any `case class` definition (all `.scala` files).
- Strengthened by co-presence of:
  - `@JsonProperty` annotations (Jackson)
  - `circe` codec derivation (`import io.circe.generic.auto._`, `@JsonCodec`)
  - `play-json` Format derivation (`Json.format[T]`)
  - `spray-json` `DefaultJsonProtocol`
  - `upickle` `ReadWriter[T]` derivations

### Entity Definition Style
```scala
// With circe codec
import io.circe.generic.JsonCodec

@JsonCodec
case class User(
  id: Long,
  name: String,
  email: String
)

// With Jackson
import com.fasterxml.jackson.annotation.JsonProperty

case class User(
  id: Long,
  @JsonProperty("full_name") name: String,
  email: String
)
```

### Extraction Approach
1. Collect all `case class` definitions across the codebase.
2. **Filter by co-located serialization signals**:
   - `@JsonCodec`, `import io.circe.generic.auto._`, `implicit val encoder = deriveEncoder[T]`
   - `Json.format[User]` (Play JSON)
   - `jsonFormat3(User.apply)` (spray-json)
   - `@JsonProperty` on constructor parameters
3. These are **candidate entities** — must cross-reference with storage framework call sites.
4. Apply persistence signal heuristics:
   - Passed to `getCollection<T>()` (KMongo) → MongoDB document.
   - Mapped in `.query[T]` (Doobie) → DB row.
   - Used in `query[T]` (Quill) → DB row.
   - Stored via Firestore `.set(obj)` → Firestore document.
5. Case classes that only appear in API controllers/routes without storage calls are likely DTOs, not DB entities.

### Key Challenges
- Most case classes in a Scala app are **not** DB entities — false positive rate is high without cross-referencing.
- Serialization annotations do not imply DB persistence.
- Some case classes serve dual roles (API model + DB entity).

### Analysis Tools
- **Scalameta**; cross-reference with storage framework patterns.

### Complexity
**Low** to detect, **Medium-High** to confirm as entity.

---

## 21. Magnum (Scala 3 ORM)

- **Name**: Magnum
- **Type**: Relational ORM (Scala 3)
- **Supported Databases**: PostgreSQL, MySQL, SQLite, H2

### Detection Signals
- **Build dependencies** (`build.sbt`):
  ```
  "com.augustnagro" %% "magnum" % "..."
  ```
- **Import patterns**:
  ```scala
  import com.augustnagro.magnum.*
  ```
- **Annotation patterns**: `@Table`, `@Id`, `@SqlName`, `@Transient`

### Entity Definition Style
```scala
import com.augustnagro.magnum.*

@Table(PostgresDbType, SqlNameMapper.CamelToSnakeCase)
case class User(
  @Id id: Long,
  name: String,
  email: String
) derives DbCodec
```

### Extraction Approach
1. Detect `com.augustnagro:magnum` dependency.
2. Collect case classes annotated with `@Table(...)` and deriving `DbCodec`.
3. Extract database type from `@Table` first argument (e.g., `PostgresDbType`).
4. Extract naming mapper from second argument — determines table name derivation.
5. `@Id` marks primary keys; `@SqlName("name")` overrides column names.

### Key Challenges
- Scala 3 `derives` clause is required — scan for `derives DbCodec`.
- Naming mapper transforms class name to table name — must implement mapper logic.

### Analysis Tools
- **Scalameta** (Scala 3 AST); annotation parsing.

### Complexity
**Low**

---

## 22. Typo (Scala 3 type-safe SQL)

- **Name**: Typo
- **Type**: Code Generator / Type-Safe SQL (Scala 3)
- **Supported Databases**: PostgreSQL

### Detection Signals
- **Build dependencies** (`build.sbt`):
  ```
  "com.olvind.typo" %% "typo" % "..."
  "com.olvind.typo" %% "typo-doobie" % "..."
  "com.olvind.typo" %% "typo-anorm" % "..."
  ```
- **sbt plugin** (`project/plugins.sbt`):
  ```
  addSbtPlugin("com.olvind.typo" % "sbt-typo" % "...")
  ```
- **File patterns**: Generated code in `typo-generated/` or configured output directory

### Entity Definition Style
Typo introspects a live PostgreSQL database and generates Scala 3 code — no manual entity definitions. Generated files contain:
```scala
// Generated by Typo
case class UsersRow(id: UsersId, name: String, email: String)
object UsersRow { ... }
```

### Extraction Approach
1. Detect `com.olvind.typo` dependency or sbt plugin.
2. Locate generated source directory (configurable in `build.sbt` via `typoGenerateFiles` setting).
3. Glob for generated `*Row.scala` files — each corresponds to a database table.
4. Parse `case class <Name>Row(...)` definitions — the prefix is the table name (transformed from the DB table name).
5. Alternatively, introspect the source database directly (not static analysis — requires DB access).

### Key Challenges
- Generated code may be excluded from source control — check `typo-generated/` in `.gitignore`.
- Typo configuration in `build.sbt` reveals the schemas and tables selected for generation.

### Analysis Tools
- **Scalameta** for generated file parsing; sbt config parsing.

### Complexity
**Low** (if generated files are committed), **High** (if not committed — requires DB access)

---

## 23. MongoDB Scala Driver

- **Name**: MongoDB Scala Driver (official)
- **Type**: NoSQL (Document)
- **Supported Databases**: MongoDB

### Detection Signals
- **Build dependencies** (`build.sbt`):
  ```
  "org.mongodb.scala" %% "mongo-scala-driver" % "..."
  "org.mongodb" % "mongodb-driver-sync" % "..."
  "org.mongodb" % "mongodb-driver-reactivestreams" % "..."
  ```
- **Import patterns**:
  ```scala
  import org.mongodb.scala._
  import org.mongodb.scala.model._
  import org.mongodb.scala.bson.codecs.Macros
  ```
- **Patterns**: `db.getCollection[T]("name")`, `MongoCollection[T]`, `Macros.createCodecProvider[T]`

### Entity Definition Style
```scala
case class User(_id: ObjectId, name: String, email: String)

val codecRegistry = fromRegistries(
  fromProviders(Macros.createCodecProvider[User]()),
  DEFAULT_CODEC_REGISTRY
)

val usersCol: MongoCollection[User] =
  db.withCodecRegistry(codecRegistry).getCollection[User]("users")
```

### Extraction Approach
1. Detect `org.mongodb.scala` dependency.
2. Scan for `getCollection[T]("name")` — extract type `T` (entity class) and name string (collection name).
3. `Macros.createCodecProvider[T]()` — extract `T` as a document entity.
4. `BsonDocument` usage indicates schema-less (no typed entity).

### Key Challenges
- Same challenges as KMongo (§18 in Kotlin doc) — collection names at call sites.
- `CodecRegistry` setup is verbose but contains the entity-to-collection mapping.

### Analysis Tools
- **Scalameta**.

### Complexity
**Medium**

---

## 24. DynamoDB (AWS SDK v2 with Scala)

- **Name**: AWS DynamoDB SDK v2 (Java SDK used from Scala)
- **Type**: NoSQL (Key-Value / Document)
- **Supported Databases**: AWS DynamoDB

### Detection Signals
- **Build dependencies** (`build.sbt`):
  ```
  "software.amazon.awssdk" % "dynamodb" % "..."
  "software.amazon.awssdk" % "dynamodb-enhanced" % "..."
  "net.katsstuff" %% "ackcord-core" % "..." (uncommon alternative)
  ```
- **Import patterns**:
  ```scala
  import software.amazon.awssdk.services.dynamodb.DynamoDbClient
  import software.amazon.awssdk.enhanced.dynamodb.DynamoDbEnhancedClient
  import software.amazon.awssdk.enhanced.dynamodb.mapper.annotations._
  ```
- **Annotation patterns**: `@DynamoDbBean`, `@DynamoDbPartitionKey`, `@DynamoDbSortKey`

### Entity Definition Style
Same as Kotlin §20 — Java SDK used from Scala. Case classes typically not directly mappable with `@DynamoDbBean` (requires mutable Java beans); often uses `DynamoDbTable` with explicit item mapping via `Item.fromMap(...)`.

### Extraction Approach
1. Detect `software.amazon.awssdk:dynamodb` dependency.
2. Scan for `.table("name")` builder calls on `DynamoDbClient` and `DynamoDbEnhancedClient`.
3. Scan for `@DynamoDbBean` on Java-style bean classes.
4. For functional Scala wrappers (e.g., `scanamo`):
   ```
   "org.scanamo" %% "scanamo" % "..."
   ```
   - Scan for `Table[T]("name")` (Scanamo's typed table definition — `T` is the entity type).

### Key Challenges
- Raw DynamoDB SDK is schema-less — table names in builder calls are most reliable.
- **Scanamo** (popular Scala DynamoDB library) provides `Table[T]("name")` — a strong entity signal.

### Analysis Tools
- **Scalameta**.

### Complexity
**Medium**

---

## 25. Redis (Jedis / Lettuce / redis4cats)

- **Name**: Redis clients in Scala (Jedis, Lettuce, redis4cats)
- **Type**: NoSQL (Key-Value / Cache)
- **Supported Databases**: Redis

### Detection Signals
- **Build dependencies** (`build.sbt`):
  ```
  "redis.clients" % "jedis" % "..."
  "io.lettuce" % "lettuce-core" % "..."
  "dev.profunktor" %% "redis4cats-effects" % "..."
  "dev.profunktor" %% "redis4cats-streams" % "..."
  "org.springframework.data" % "spring-data-redis" % "..."
  ```
- **Import patterns**:
  ```scala
  import redis.clients.jedis.Jedis
  import dev.profunktor.redis4cats.RedisCommands
  import dev.profunktor.redis4cats.Redis
  ```

### Entity Definition Style
Redis is schema-less. No formal entity definitions exist outside Spring Data Redis `@RedisHash` (same as Kotlin §24). Key patterns are implicit in code:
```scala
val userKey = s"user:${userId}"
redis.set(userKey, Json.toJson(user).toString)

// Or with redis4cats
Redis[IO].utf8("redis://localhost").use { cmd =>
  cmd.set(s"user:$id", encode(user))
}
```

### Extraction Approach
1. Detect Redis dependency.
2. For Spring Data Redis: scan `@RedisHash("name")` annotations — same as Kotlin §24.
3. For raw clients: extract string key patterns from `.set(key, ...)`, `.get(key)`, `.hset(hash, field, value)` calls.
4. Look for key prefix constants or conventions (e.g., `val USER_KEY_PREFIX = "user:"`).
5. Key patterns are the closest approximation to "entity names" — document them as logical entity signals.

### Key Challenges
- Redis is fully schema-less — no formal entity model.
- Key naming is an application convention, not a framework contract.
- Hash structures (`.hset`) can model entity-like objects but are not formally defined.

### Analysis Tools
- **Scalameta** for string key extraction.

### Complexity
**Low** (Spring Data Redis), **High** (raw Redis clients)

---

## Repository Detection Plan

This section describes a systematic, automated approach for detecting which data entity frameworks are in use within a Scala repository and extracting entity/table definitions.

### Step 1: Identify Build System and Dependencies

1. **Locate build files**:
   - `build.sbt` (primary — all modern Scala projects)
   - `project/Build.scala` (older multi-project builds)
   - `project/plugins.sbt` (sbt plugins)
   - `pom.xml` (Maven-based Scala projects — less common)
2. **Parse dependencies** from `build.sbt` using pattern matching on `"org" %% "artifact" % "version"` lines.
3. **Map dependencies to frameworks** using the detection signals table below.

#### Quick-Reference Dependency → Framework Map

| Dependency Artifact | Framework |
|---|---|
| `com.typesafe.slick:slick` | Slick |
| `io.getquill:quill-jdbc` | Quill |
| `org.tpolecat:doobie-core` | Doobie |
| `org.playframework.anorm:anorm` | Anorm |
| `org.hibernate.orm:hibernate-core` | Hibernate/JPA |
| `org.scalikejdbc:scalikejdbc` | ScalikeJDBC |
| `org.skinny-framework:skinny-orm` | Skinny ORM |
| `com.typesafe.play:play-ebean` | Play Ebean |
| `com.typesafe.akka:akka-persistence` | Akka Persistence |
| `org.apache.spark:spark-sql` | Spark |
| `org.typelevel:cats-effect` + `doobie-core` | Cats Effect + Doobie |
| `dev.zio:zio` + `quill-jdbc-zio` | ZIO + Quill |
| `org.flywaydb:flyway-core` | Flyway |
| `org.reactivemongo:reactivemongo` | ReactiveMongo |
| `com.outworkers:phantom-dsl` | Phantom (Cassandra) |
| `com.sksamuel.elastic4s:elastic4s-core` | Elastic4s |
| `com.thesamet.scalapb:scalapb-runtime` | Protobuf/ScalaPB |
| `org.apache.avro:avro` | Avro |
| `com.augustnagro:magnum` | Magnum |
| `com.olvind.typo:typo` | Typo |
| `org.mongodb.scala:mongo-scala-driver` | MongoDB Scala Driver |
| `software.amazon.awssdk:dynamodb` | DynamoDB |
| `org.scanamo:scanamo` | Scanamo (DynamoDB) |
| `dev.profunktor:redis4cats-effects` | redis4cats |
| `com.sksamuel.avro4s:avro4s-core` | avro4s |

### Step 2: File Discovery by Framework

Run targeted file searches based on detected frameworks:

| Framework | Files to Scan |
|---|---|
| Slick | All `*.scala` files |
| Quill | All `*.scala` files |
| Doobie / Anorm | All `*.scala` files |
| ScalikeJDBC / Skinny | All `*.scala` files |
| Hibernate/JPA | All `*.scala` + `src/**/resources/**/*.xml` |
| Akka Persistence | All `*.scala` + `src/**/resources/application.conf` |
| Spark | All `*.scala` files |
| Play Evolutions | `conf/evolutions/**/*.sql` |
| Flyway | `src/**/resources/db/migration/V*.sql` |
| Liquibase | `src/**/resources/db/changelog/**/*.{xml,yaml,json,sql}` |
| ReactiveMongo | All `*.scala` files |
| Phantom | All `*.scala` files |
| Elastic4s | All `*.scala` files |
| Protobuf | `src/main/protobuf/**/*.proto` |
| Avro | `src/main/avro/**/*.{avsc,avdl}` |
| Magnum | All `*.scala` files |
| Typo | Generated source directory (`typo-generated/**/*.scala`) |
| Raw JDBC | All `*.scala` + `src/**/resources/**/*.sql` |

### Step 3: Framework-Specific Entity Extraction Priority

Apply extraction approaches in order of structural signal strength:

1. **Highest confidence** (explicit DDL/schema files):
   - Play Evolutions (`conf/evolutions/**/*.sql`)
   - Flyway (`V*.sql`)
   - Liquibase changelogs
   - SQLDelight `*.sq` files
   - Protobuf `*.proto` files
   - Avro `*.avsc` / `*.avdl` files

2. **High confidence** (class/object structure with explicit table names):
   - Slick `Table[T](tag, "tableName")` classes
   - ScalikeJDBC `SQLSyntaxSupport[T]` with `override val tableName`
   - Skinny `SkinnyCRUDMapper[T]` with `override lazy val tableName`
   - Phantom `CassandraTable[T, R]` with `override val tableName`
   - Magnum `@Table(...)` on case classes with `derives DbCodec`
   - Hibernate/JPA `@Entity` + `@Table(name = "...")`

3. **High confidence** (annotation-based, explicit):
   - JPA `@Entity` + `@Table(name = "...")` (Play Ebean, Hibernate)
   - Spring Data `@Document(collection = "...")`

4. **Medium confidence** (naming strategy + class name):
   - Quill `query[T]` with identified naming strategy
   - Skinny / ScalikeJDBC default `tableName` derivation
   - ReactiveMongo `getCollection[T]("name")`
   - MongoDB Scala Driver `getCollection[T]("name")`
   - Elastic4s `indexInto("name")`, `search("name")`

5. **Lower confidence** (SQL string analysis):
   - Doobie `sql"..."` interpolators
   - Anorm `SQL("...")` strings
   - Raw JDBC `prepareStatement("...")`
   - Spark `spark.sql("...")`

6. **Signal only** (requires cross-referencing):
   - Scala `case class` definitions with serialization annotations
   - Akka Persistence aggregate types
   - Avro/Protobuf message types (may not be persisted to DB)

### Step 4: Naming Strategy Resolution (Quill / ScalikeJDBC)

For frameworks using naming strategies to derive table names:

1. Identify the naming strategy from context instantiation:
   - Quill: `new PostgresJdbcContext(SnakeCase, ...)` → `SnakeCase`
   - ScalikeJDBC: configured via `scalikejdbc.config.DBs.setup()`
2. Apply the strategy to map class name → table name:
   - `SnakeCase`: `UserProfile` → `user_profile`
   - `UpperCase`: `User` → `USER`
   - `Literal`: `User` → `User`
   - `PluralizedSnakeCase`: `User` → `users`
3. `@Table("override")` / `querySchema[T]("override")` takes precedence over naming strategy.

### Step 5: Conflict Resolution and Deduplication

- Migration tools and ORM frameworks may both describe the same table — merge into one entity record.
- Akka Persistence logical entities (actor aggregates) differ from physical journal tables — record both.
- Spark `createOrReplaceTempView` creates transient views — exclude from persistent entity list.
- Protobuf/Avro messages may be used for Kafka serialization only — flag as "unconfirmed persistence" unless co-located with DB access code.

### Step 6: Confidence Scoring

| Signal Type | Confidence |
|---|---|
| SQL DDL in evolution/migration file (`CREATE TABLE`) | 95% |
| Slick `Table[T](tag, "name")` class | 95% |
| ScalikeJDBC `override val tableName = "..."` | 95% |
| Skinny `override lazy val tableName = "..."` | 95% |
| Magnum `@Table(...)` + `derives DbCodec` | 95% |
| Hibernate `@Entity` + `@Table(name = "...")` | 95% |
| Quill `querySchema[T]("tableName")` | 90% |
| Phantom `CassandraTable[T, R]` | 90% |
| ReactiveMongo `getCollection[T]("name")` | 85% |
| Elastic4s `createIndex("name")` with mapping | 85% |
| Quill `query[T]` + naming strategy inference | 80% |
| Doobie `sql"..."` SQL string parsing | 70% |
| Anorm `SQL("...")` string parsing | 70% |
| Spark `spark.read.table("name")` | 75% |
| Spark `StructType` explicit schema | 80% |
| Raw JDBC SQL string parsing | 60% |
| Case class + circe codec (candidate only) | 35% |
| Akka Persistence aggregate class (logical only) | 50% |

### Step 7: Output Schema

For each detected entity, output:
```json
{
  "name": "users",
  "sourceClass": "com.example.model.User",
  "framework": "Slick",
  "database_type": "relational",
  "detection_confidence": 0.95,
  "columns": [
    { "name": "id", "type": "Long", "primaryKey": true },
    { "name": "email", "type": "String", "nullable": false }
  ],
  "source_files": ["src/main/scala/com/example/model/User.scala"],
  "migration_files": ["conf/evolutions/default/1.sql"]
}
```

### Step 8: Scala-Specific Considerations

1. **Scala 2 vs. Scala 3**: Check `scalaVersion` in `build.sbt`. Scala 3 projects may use `derives` clauses (Magnum, Doobie), `inline def` (Quill 4.x), and `given`/`using` implicits.
2. **Multi-module sbt projects**: Traverse `project/` subdirectories and aggregate `build.sbt` files; each module may use different frameworks.
3. **Cross-built projects** (`crossScalaVersions`): Entity definitions are the same across versions — extract once.
4. **Effect library detection**: Identify whether the project uses Cats Effect (`cats-effect`), ZIO (`dev.zio:zio`), or Monix — this affects which DB library variant is in use (e.g., `doobie` vs. `doobie-hikari` vs. `quill-jdbc-zio`).
5. **Play Framework projects**: Detect `sbt-plugin` for Play; automatically check for Evolutions, Anorm, Play JSON formats.
6. **Akka / Pekko projects**: Detect persistence plugins via `application.conf` — the journal plugin determines the underlying storage.
