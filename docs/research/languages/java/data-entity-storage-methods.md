# Java Data Entity Storage Methods

Catalog of every significant data entity storage framework, library, and approach used in Java projects. The goal is to support automated static analysis of Java repositories to extract a list of data entities (database tables, document collections, schema objects, etc.).

---

## Table of Contents

1. [JPA / Hibernate (Annotation-Based)](#1-jpa--hibernate-annotation-based)
2. [JPA / Hibernate (XML-Based Mapping)](#2-jpa--hibernate-xml-based-mapping)
3. [Spring Data JPA](#3-spring-data-jpa)
4. [EclipseLink / OpenJPA](#4-eclipselink--openjpa)
5. [MyBatis](#5-mybatis)
6. [iBatis (MyBatis Predecessor)](#6-ibatis-mybatis-predecessor)
7. [jOOQ](#7-jooq)
8. [JDBI / Jdbi3](#8-jdbi--jdbi3)
9. [Spring JDBC Template](#9-spring-jdbc-template)
10. [JDBC Raw](#10-jdbc-raw)
11. [Ebean ORM](#11-ebean-orm)
12. [ActiveJDBC](#12-activejdbc)
13. [Querydsl](#13-querydsl)
14. [Flyway](#14-flyway)
15. [Liquibase](#15-liquibase)
16. [Embedded SQL Strings](#16-embedded-sql-strings)
17. [Stored Procedures and Views in SQL Files](#17-stored-procedures-and-views-in-sql-files)
18. [Spring Data MongoDB](#18-spring-data-mongodb)
19. [Spring Data Redis](#19-spring-data-redis)
20. [Spring Data Elasticsearch](#20-spring-data-elasticsearch)
21. [Spring Data Cassandra](#21-spring-data-cassandra)
22. [R2DBC](#22-r2dbc)
23. [GraphQL Schema Files](#23-graphql-schema-files)
24. [Protobuf (.proto)](#24-protobuf-proto)
25. [Avro (.avsc)](#25-avro-avsc)
26. [OpenAPI Specifications](#26-openapi-specifications)
27. [DTO Classes as Entity Signals](#27-dto-classes-as-entity-signals)
28. [Validation Annotations as Entity Signals](#28-validation-annotations-as-entity-signals)
29. [Repository Detection Plan](#29-repository-detection-plan)

---

## 1. JPA / Hibernate (Annotation-Based)

- **Name**: JPA / Hibernate (Annotation-Based)
- **Type**: Relational ORM
- **Supported Databases**: PostgreSQL, MySQL, MariaDB, Oracle, SQL Server, H2, HSQLDB, Derby, DB2, and any JDBC-compliant database
- **Detection Signals**:
  - Maven dependencies: `org.hibernate:hibernate-core`, `org.hibernate.orm:hibernate-core`, `javax.persistence:javax.persistence-api`, `jakarta.persistence:jakarta.persistence-api`
  - Gradle dependencies: same artifact names
  - Import patterns: `import javax.persistence.*`, `import jakarta.persistence.*`, `import org.hibernate.annotations.*`
  - Annotation presence: `@Entity`, `@Table`, `@MappedSuperclass`, `@Embeddable`
  - Config files: `persistence.xml` in `META-INF/`, `hibernate.cfg.xml`, `application.properties` with `spring.jpa.*` or `hibernate.*` keys
- **Entity Definition Style**: Entities are plain Java classes (POJOs) annotated with `@Entity`. The table name defaults to the class name or is overridden with `@Table(name="...")`. Fields (or getter methods) carry `@Column`, `@Id`, `@GeneratedValue`, `@JoinColumn`, `@OneToMany`, `@ManyToOne`, `@ManyToMany`, `@OneToOne`, `@Embedded`, `@ElementCollection`. Superclasses annotated `@MappedSuperclass` contribute fields to subclasses. `@Embeddable` classes are value types embedded into entity tables.
- **Extraction Approach**:
  1. Scan all `.java` files in the project source tree.
  2. Parse each file into an AST (JavaParser, Spoon, or tree-sitter java grammar).
  3. Identify classes annotated with `@Entity`, `@Table`, `@MappedSuperclass`, or `@Embeddable`.
  4. For each `@Entity` class, extract the table name from `@Table(name="...")` or default to the unqualified class name.
  5. Walk the class's field declarations and method declarations for persistence annotations (`@Column`, `@Id`, `@JoinColumn`, `@ManyToOne`, etc.) to enumerate columns/relationships.
  6. Follow the inheritance hierarchy: if the class `extends` another class, check whether that superclass carries `@MappedSuperclass` or `@Entity`, and merge its fields.
  7. Resolve `@Embeddable` references to inline embedded column sets.
  8. Collect `@SecondaryTable` and `@SecondaryTables` annotations for entities mapped across multiple tables.
- **Key Challenges**:
  - Annotations can be on fields OR getter methods — both locations must be checked.
  - Deep inheritance chains (`@MappedSuperclass` stacked multiple levels) require recursive resolution.
  - `@InheritanceType` (SINGLE_TABLE, JOINED, TABLE_PER_CLASS) determines actual table structure; JOINED creates one table per concrete subclass, TABLE_PER_CLASS creates fully separate tables.
  - `@AttributeOverride` can rename or relocate columns inherited from superclasses.
  - Lombok-generated fields (`@Data`, `@Getter`, `@Setter`) may not appear in source — need to account for Lombok processing.
  - `@Embedded` / `@Embeddable` inlines another class's columns into the same table.
  - `columnDefinition` in `@Column` may contain DDL fragments useful for type inference.
- **Analysis Tools**: JavaParser (recommended for Java source AST), Spoon (full metamodel with type resolution), tree-sitter with java grammar (fast but lower-level), Lombok-aware processors
- **Complexity**: Medium

---

## 2. JPA / Hibernate (XML-Based Mapping)

- **Name**: JPA / Hibernate (XML-Based Mapping)
- **Type**: Relational ORM
- **Supported Databases**: Same as Hibernate annotation-based; any JDBC-compliant database
- **Detection Signals**:
  - File names/patterns: `*.hbm.xml` anywhere in the project, `META-INF/orm.xml`, `META-INF/hibernate.cfg.xml`
  - XML root elements: `<hibernate-mapping>`, `<entity-mappings>` (JPA orm.xml)
  - Maven dependencies: same as JPA/Hibernate above
  - Config references: `hibernate.cfg.xml` `<mapping resource="...hbm.xml"/>` entries
- **Entity Definition Style**: Classes and their column mappings are described entirely in XML. `hbm.xml` uses `<class name="..." table="...">`, `<property name="..." column="...">`, `<many-to-one>`, `<bag>`, `<set>`, etc. JPA `orm.xml` uses `<entity class="...">`, `<table name="..."/>`, `<attributes>`, `<basic>`, `<id>`, `<many-to-one>`, etc.
- **Extraction Approach**:
  1. Locate all `*.hbm.xml` files and `orm.xml` files via recursive file scan.
  2. Parse each XML file with a standard XML parser (DOM or SAX).
  3. For `hbm.xml`: extract `<class name="..." table="...">` for entity-to-table mapping; recurse into `<subclass>`, `<joined-subclass>`, `<union-subclass>` for inheritance; extract `<property>`, `<many-to-one>`, `<one-to-many>`, `<many-to-many>`, `<component>` for column/relationship details.
  4. For `orm.xml`: extract `<entity>`, `<mapped-superclass>`, `<embeddable>` elements; read child `<table>` for table names; read `<attributes>` children for column mappings.
  5. Cross-reference class names to Java source files to resolve field types if needed.
- **Key Challenges**:
  - Inheritance in `hbm.xml` uses `<subclass>` (single table), `<joined-subclass>` (joined), `<union-subclass>` (table per class) — each has different table implications.
  - `<component>` elements (embedded value types) map multiple properties to the same table row.
  - Files may be split across many resources directories or inside JARs (framework modules).
  - Mixing XML and annotation-based configuration is common in legacy projects — both sources must be merged.
- **Analysis Tools**: Java DOM/SAX/StAX parsers, JAXB for orm.xml, Python's `lxml` or `xml.etree` if analyzing externally
- **Complexity**: Low

---

## 3. Spring Data JPA

- **Name**: Spring Data JPA
- **Type**: Relational ORM (Repository Abstraction over JPA)
- **Supported Databases**: Same as JPA/Hibernate; any JDBC-compliant database
- **Detection Signals**:
  - Maven dependencies: `org.springframework.data:spring-data-jpa`, `org.springframework.boot:spring-boot-starter-data-jpa`
  - Import patterns: `import org.springframework.data.jpa.repository.*`, `import org.springframework.data.repository.*`
  - Interface declarations extending `JpaRepository<EntityType, IdType>`, `CrudRepository`, `PagingAndSortingRepository`, `Repository`
  - Annotations: `@Repository`, `@Query` on repository methods
  - Config: `spring.datasource.*`, `spring.jpa.*` in `application.properties` or `application.yml`
- **Entity Definition Style**: Same `@Entity`-annotated POJOs as standard JPA/Hibernate. Spring Data adds strongly-typed repository interfaces that declare the entity type and ID type as generic parameters: `public interface UserRepository extends JpaRepository<User, Long>`. Custom queries use `@Query("SELECT u FROM User u WHERE ...")` with JPQL or native SQL.
- **Extraction Approach**:
  1. Perform all steps from the JPA/Hibernate annotation-based approach to find `@Entity` classes.
  2. Additionally scan for interfaces that extend `JpaRepository`, `CrudRepository`, `PagingAndSortingRepository`, `Repository`, or `QuerydslPredicateExecutor`.
  3. For each repository interface, extract the first generic type parameter — this is the entity class. Record the mapping `RepositoryName -> EntityClass`.
  4. Extract `@Query` annotation values and parse any SQL/JPQL for table/entity name references.
  5. Check for `@RepositoryRestResource` which may expose the entity over REST and indicates it is a primary domain object.
  6. Check `Projections` (interfaces returned by repository methods) for additional field shape signals.
- **Key Challenges**:
  - Generic type resolution requires understanding Java generics — raw type erasure makes runtime analysis harder; static AST analysis must follow generic bounds.
  - Custom repository implementations (classes implementing `UserRepositoryCustom`) may bypass typed generics.
  - `@Query(nativeQuery = true)` uses SQL table names, not JPA entity names — must parse SQL separately.
  - `QueryByExampleExecutor` and `Specification` usage generates dynamic queries with no static entity name references beyond the entity class itself.
- **Analysis Tools**: JavaParser with symbol resolution, Spoon, tree-sitter java grammar
- **Complexity**: Medium

---

## 4. EclipseLink / OpenJPA

- **Name**: EclipseLink / OpenJPA
- **Type**: Relational ORM
- **Supported Databases**: Any JDBC-compliant database (PostgreSQL, MySQL, Oracle, SQL Server, etc.)
- **Detection Signals**:
  - Maven dependencies: `org.eclipse.persistence:eclipselink`, `org.apache.openjpa:openjpa`
  - Import patterns: `import org.eclipse.persistence.annotations.*`, `import org.apache.openjpa.persistence.*`
  - Config: `persistence.xml` with `provider` set to `org.eclipse.persistence.jpa.PersistenceProvider` or `org.apache.openjpa.persistence.PersistenceProviderImpl`
- **Entity Definition Style**: Identical to the JPA annotation standard (`@Entity`, `@Table`, `@Column`, `@Id`, etc.). Both EclipseLink and OpenJPA implement the JPA specification. EclipseLink adds proprietary annotations like `@Customizer`, `@ReadOnly`, `@Partitioning`, `@Cache`. OpenJPA adds `@Persistent`, `@Externalizer`.
- **Extraction Approach**: Same as JPA/Hibernate annotation-based approach. Additionally scan for provider-specific annotations:
  - EclipseLink: `@Struct`, `@Array`, `@Transformation`, `@VariableOneToOne`
  - OpenJPA: `@Persistent`, `@Strategy` (custom mapping strategies)
  - These indicate mapped entities not expressible with standard JPA annotations.
- **Key Challenges**:
  - EclipseLink `@Struct` maps to database object types, not standard tables.
  - EclipseLink `@AdditionalCriteria` applies global filters that affect query results but not table structure.
  - OpenJPA `@Externalizer` / `@Factory` pairs can transform field values in ways that obscure the real stored type.
- **Analysis Tools**: JavaParser, Spoon, tree-sitter java grammar
- **Complexity**: Medium (same as Hibernate, plus provider-specific annotation scanning)

---

## 5. MyBatis

- **Name**: MyBatis
- **Type**: SQL Mapper / Query Builder
- **Supported Databases**: Any JDBC-compliant database (PostgreSQL, MySQL, Oracle, SQL Server, SQLite, etc.)
- **Detection Signals**:
  - Maven dependencies: `org.mybatis:mybatis`, `org.mybatis.spring.boot:mybatis-spring-boot-starter`, `org.mybatis.spring:mybatis-spring`
  - File patterns: `*Mapper.xml` files in `src/main/resources/mapper/` or similar directories
  - Import patterns: `import org.apache.ibatis.annotations.*`, `import org.mybatis.spring.annotation.*`
  - Annotations: `@Mapper`, `@Select`, `@Insert`, `@Update`, `@Delete`, `@Results`, `@Result`, `@ResultMap`
  - Config files: `mybatis-config.xml`, `mybatis.configuration.*` in `application.properties`
- **Entity Definition Style**: Entities are plain POJOs (no ORM annotations required). The mapping between SQL result sets and POJOs is declared in XML mapper files via `<resultMap>` elements, or in Java via `@Results` / `@Result` annotation clusters on mapper interface methods. SQL statements (`<select>`, `<insert>`, `<update>`, `<delete>`) reference table names directly in SQL.
- **Extraction Approach**:
  1. Locate all `*Mapper.xml` files (typically under `resources/mapper/`, `resources/mappers/`, or paths configured in `mybatis.mapper-locations`).
  2. Parse each XML mapper file: extract `<resultMap id="..." type="...">` — the `type` attribute is the target POJO class. Extract child `<result property="..." column="...">` for column mappings.
  3. Parse `<select>`, `<insert>`, `<update>`, `<delete>` statement bodies for SQL. Use a SQL parser (sqlglot, JSQLParser) to extract table names from `FROM`, `JOIN`, `INTO`, `UPDATE` clauses.
  4. For annotation-based mappers, scan Java interfaces annotated `@Mapper`: extract `@Results`/`@Result` clusters for column mappings, and parse SQL strings in `@Select`, `@Insert`, `@Update`, `@Delete` for table names.
  5. Check `mybatis-config.xml` for `<typeAliases>` that map short names to fully qualified class names.
  6. Cross-reference POJO type names with source files to confirm entity classes.
- **Key Challenges**:
  - `<include refid="...">` in SQL fragments means SQL is assembled from reusable parts — must resolve all `<sql id="...">` blocks before parsing complete SQL.
  - Dynamic SQL (`<if>`, `<choose>`, `<foreach>`) means table names may not be statically resolvable in all code paths.
  - TypeAliases (registered in config or via `@Alias`) create indirection between XML type references and Java classes.
  - Provider classes (`@SelectProvider`, `@InsertProvider`) generate SQL dynamically at runtime — static analysis cannot reliably extract SQL.
  - Parameterized table names (sharding patterns) are unresolvable statically.
- **Analysis Tools**: Java DOM/SAX parser for XML mappers, JavaParser / tree-sitter for annotation-based mappers, sqlglot or JSQLParser for SQL parsing
- **Complexity**: Medium-High

---

## 6. iBatis (MyBatis Predecessor)

- **Name**: iBatis
- **Type**: SQL Mapper
- **Supported Databases**: Any JDBC-compliant database
- **Detection Signals**:
  - Maven dependencies: `ibatis:ibatis-2`, `com.ibatis:ibatis-sqlmap`, `ibatis-common`
  - File patterns: `*SqlMap.xml`, `sqlmap-config.xml`, `SqlMapConfig.xml`
  - Import patterns: `import com.ibatis.sqlmap.client.*`, `import com.ibatis.common.*`
  - XML root element: `<sqlMap>` (vs MyBatis `<mapper>`)
- **Entity Definition Style**: Similar to MyBatis — POJOs with SQL defined in XML `<sqlMap>` files. Uses `<resultMap>`, `<select>`, `<insert>`, `<update>`, `<delete>` elements but with iBatis-era syntax. No annotation-based mapping (predates Java annotation adoption).
- **Extraction Approach**:
  1. Locate `sqlmap-config.xml` / `SqlMapConfig.xml` to find all referenced `<sqlMap resource="...">` files.
  2. Parse each `<sqlMap>` XML file: extract `<resultMap id="..." class="...">` for POJO mappings, `<result property="..." column="...">` for column details.
  3. Parse SQL in `<select>`, `<insert>`, `<update>`, `<delete>` statement bodies using a SQL parser for table name extraction.
  4. Check `<typeAlias>` entries in the config file for class name resolution.
- **Key Challenges**:
  - Legacy codebase patterns — may coexist with MyBatis in partially migrated projects.
  - `<dynamic>` tag (predecessor to MyBatis `<if>`) creates conditionally assembled SQL.
  - No annotation fallback — all mapping information is in XML.
- **Analysis Tools**: Java DOM parser for XML, sqlglot or JSQLParser for SQL
- **Complexity**: Low-Medium

---

## 7. jOOQ

- **Name**: jOOQ (Java Object Oriented Querying)
- **Type**: Query Builder / Type-Safe SQL DSL
- **Supported Databases**: PostgreSQL, MySQL, MariaDB, Oracle, SQL Server, SQLite, H2, HSQLDB, Derby, DB2, Informix, and others
- **Detection Signals**:
  - Maven dependencies: `org.jooq:jooq`, `org.jooq:jooq-codegen`, `org.jooq:jooq-meta`
  - Gradle plugins: `nu.studer.jooq` plugin
  - File patterns: generated `Tables.java`, `Keys.java`, `Indexes.java` in a configured target package; `*.jooq.xml` generator config; `jooq-codegen-*.xml`
  - Import patterns: `import org.jooq.*`, `import org.jooq.impl.*`, `import org.jooq.DSLContext`
  - Class patterns: generated classes extending `TableImpl<R>`, `TableRecord<R>`, `UpdatableRecord<R>`
  - Config in `pom.xml`: `<plugin><groupId>org.jooq</groupId><artifactId>jooq-codegen-maven</artifactId>` with a `<generator>` section specifying target package and database
- **Entity Definition Style**: jOOQ generates Java classes directly from the live database schema (or from Flyway/Liquibase migrations run first). The source of truth is the database, not Java annotations. Generated artifacts include:
  - `Tables.java` — a class with static references to each table: `public static final User USER = User.USER;`
  - Per-table classes (e.g., `User.java`) extending `TableImpl<UserRecord>` with `TableField<UserRecord, Type>` constants for every column
  - Per-table `Record` classes (e.g., `UserRecord.java`) extending `TableRecord` or `UpdatableRecord`
  - POJOs (optional) — plain Java classes with getters/setters for each column
  - DAO classes (optional) — one DAO per table with CRUD methods
- **Extraction Approach**:
  1. Check `pom.xml` / `build.gradle` for jOOQ codegen plugin configuration. Extract the target package name and input schema/catalog filter.
  2. Locate generated `Tables.java` in the target package directory. Parse it for `public static final TableName TABLE_NAME = ...` constants — each represents a table.
  3. For each per-table class (e.g., `public class User extends TableImpl<UserRecord>`), parse the class for `public final TableField<UserRecord, Type> FIELD_NAME = ...` declarations — these are the columns.
  4. Alternatively, parse the jOOQ generator XML config (`jooq-codegen-*.xml`) for `<inputSchema>`, `<includes>`, `<excludes>` patterns to understand which tables are in scope.
  5. If the project uses jOOQ with Flyway/Liquibase, combine with migration file analysis (see sections 14 and 15) as the authoritative table list.
  6. If the generated code is not committed (generated at build time only), rely on the migration files.
- **Key Challenges**:
  - Generated code may not be committed to the repository — codegen runs at build time. In this case the generator config and migration files are the only static artifacts.
  - Multi-schema projects generate nested packages per schema — must scan all generated sub-packages.
  - `jOOQ Pro` (commercial) supports more databases and has slightly different generated class shapes.
  - Runtime schema (DSL.using(...).meta()) bypasses code generation entirely — completely dynamic, unanalyzable statically.
  - `@GeneratedAnnotation` on generated classes can be used to distinguish generated from hand-written code.
- **Analysis Tools**: JavaParser for generated source, XML parser for codegen config, file glob for locating generated package
- **Complexity**: Medium (generated code is highly structured but may not be present in repo)

---

## 8. JDBI / Jdbi3

- **Name**: JDBI / Jdbi3
- **Type**: SQL Convenience Layer / Lightweight SQL Mapper
- **Supported Databases**: Any JDBC-compliant database (PostgreSQL, MySQL, Oracle, SQL Server, H2, SQLite, etc.)
- **Detection Signals**:
  - Maven dependencies: `org.jdbi:jdbi3-core`, `org.jdbi:jdbi3-sqlobject`, `org.jdbi:jdbi3-spring5`, `org.skife.jdbi:jdbi` (JDBI 2.x)
  - Import patterns: `import org.jdbi.v3.*`, `import org.jdbi.v3.sqlobject.*`, `import org.skife.jdbi.v2.*`
  - Annotations: `@SqlQuery`, `@SqlUpdate`, `@SqlBatch`, `@RegisterRowMapper`, `@RegisterBeanMapper`, `@UseRowMapper`, `@ColumnName`, `@Bind`
  - Interface declarations annotated with `@RegisterBeanMapper` or containing `@SqlQuery` methods
- **Entity Definition Style**: No ORM entity annotations. Entities are plain POJOs or beans. SQL is written as string literals in `@SqlQuery("SELECT ...")`, `@SqlUpdate("INSERT INTO ...")` etc. on interface methods (SQL Object API), or as inline strings in fluent handle API calls (`handle.createQuery("SELECT ...")...`). Row mapping is handled via `@RegisterBeanMapper(MyBean.class)`, custom `RowMapper<T>` implementations, or `@MapTo`.
- **Extraction Approach**:
  1. Scan for interfaces containing `@SqlQuery`, `@SqlUpdate`, `@SqlBatch` method annotations — these are SQL Object DAO interfaces.
  2. Extract SQL string literals from those annotations and parse with a SQL parser for table name extraction.
  3. Scan for `@RegisterBeanMapper(SomeClass.class)` to identify POJO types used as result row containers.
  4. Scan for fluent API usage: `handle.createQuery(...)`, `handle.createUpdate(...)`, `jdbi.withHandle(...)` — extract string literal SQL arguments.
  5. Scan for `RowMapper<T>` implementations — the generic type `T` indicates the entity class being mapped.
  6. Correlate POJO class names found via row mappers back to their field declarations for column-level detail.
- **Key Challenges**:
  - SQL is frequently constructed from string concatenation or formatted strings — not always extractable as literals.
  - Fluent API calls are deep within method bodies and harder to locate than annotations.
  - `@SqlLocator` / `@UseClasspathSqlLocator` externalizes SQL to classpath resources (`.sql` files) — must locate and parse those files too.
  - No compile-time binding between SQL and result types (unlike jOOQ) — the relationship is implicit.
- **Analysis Tools**: JavaParser / tree-sitter for annotation and fluent call extraction, sqlglot or JSQLParser for SQL parsing
- **Complexity**: Medium

---

## 9. Spring JDBC Template

- **Name**: Spring JDBC Template
- **Type**: Raw SQL / JDBC Convenience Wrapper
- **Supported Databases**: Any JDBC-compliant database
- **Detection Signals**:
  - Maven dependencies: `org.springframework:spring-jdbc`, `org.springframework.boot:spring-boot-starter-jdbc`
  - Import patterns: `import org.springframework.jdbc.core.JdbcTemplate`, `import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate`
  - Class field declarations: `private JdbcTemplate jdbcTemplate` or `@Autowired JdbcTemplate jdbcTemplate`
  - Method calls: `.query(...)`, `.queryForObject(...)`, `.queryForList(...)`, `.update(...)`, `.batchUpdate(...)`
- **Entity Definition Style**: No entity class annotations. SQL is written as string literals passed directly to `JdbcTemplate` methods. Result mapping is handled via `RowMapper<T>` implementations, `BeanPropertyRowMapper<T>`, `ColumnMapRowMapper`, or lambda row mappers. `NamedParameterJdbcTemplate` allows `:param`-style named parameters.
- **Extraction Approach**:
  1. Scan Java source for classes that inject or instantiate `JdbcTemplate` or `NamedParameterJdbcTemplate`.
  2. Extract string literal arguments passed to `.query(sql, ...)`, `.queryForObject(sql, ...)`, `.update(sql, ...)`, `.batchUpdate(sql, ...)`, etc.
  3. Parse each extracted SQL string with a SQL parser (sqlglot, JSQLParser) to identify table names.
  4. Identify `RowMapper<T>` implementations and `BeanPropertyRowMapper<T>` usages to find the mapped POJO types.
  5. For `@Sql` or `@SqlScript` annotated test classes, also extract SQL file references.
- **Key Challenges**:
  - SQL strings are often assembled via concatenation, `String.format()`, `StringBuilder`, or external constants — static extraction is unreliable.
  - SQL stored in constants (static final fields) requires constant folding across compilation units.
  - `SimpleJdbcInsert` and `SimpleJdbcCall` use a different API: `new SimpleJdbcInsert(dataSource).withTableName("users")` — scan for `.withTableName(...)` calls.
  - `StoredProcedure` subclasses use `setSql(...)` or constructor arguments — scan for those.
- **Analysis Tools**: JavaParser / tree-sitter for method call and string literal extraction, sqlglot or JSQLParser for SQL parsing
- **Complexity**: High (SQL is usually in scattered string literals)

---

## 10. JDBC Raw

- **Name**: JDBC Raw (java.sql)
- **Type**: Raw SQL / Direct Database Access
- **Supported Databases**: Any JDBC-compliant database
- **Detection Signals**:
  - Import patterns: `import java.sql.Connection`, `import java.sql.PreparedStatement`, `import java.sql.Statement`, `import java.sql.ResultSet`
  - Method calls: `connection.prepareStatement(...)`, `statement.executeQuery(...)`, `statement.executeUpdate(...)`, `connection.createStatement()`
  - No third-party dependency required (part of the JDK)
- **Entity Definition Style**: No entity abstraction at all. SQL is written as raw string literals passed to `prepareStatement()` or `createStatement()`. Result columns are accessed by index (`rs.getString(1)`) or name (`rs.getString("email")`). There is no automatic mapping to POJOs unless hand-coded.
- **Extraction Approach**:
  1. Scan for `import java.sql.*` or `java.sql.PreparedStatement` / `java.sql.Connection` usage.
  2. Locate all string literals passed to `prepareStatement(...)`, `executeQuery(...)`, `executeUpdate(...)`, `execute(...)`.
  3. Parse each SQL string with a SQL parser for table name extraction.
  4. Scan for `.getString("columnName")`, `.getInt("columnName")`, `.getLong("columnName")` etc. on `ResultSet` objects to enumerate the columns being read.
  5. Look for hand-written result-to-object mapping code (local variable assignments from `rs.get*`) to infer the logical entity structure.
- **Key Challenges**:
  - Maximum SQL fragmentation — SQL may be assembled from dozens of concatenated parts across multiple method calls.
  - No type binding whatsoever — column names come from string literals in `rs.getString("name")` which are scattered and fragile.
  - Connection pools (HikariCP, c3p0, DBCP) wrap `java.sql.Connection` — the usage pattern is the same but detection via imports is less reliable.
  - Test code often uses embedded H2 with schema scripts — those scripts are authoritative for test tables.
- **Analysis Tools**: JavaParser / tree-sitter for string literal and method call extraction, sqlglot or JSQLParser for SQL parsing
- **Complexity**: High

---

## 11. Ebean ORM

- **Name**: Ebean ORM
- **Type**: Relational ORM
- **Supported Databases**: PostgreSQL, MySQL, MariaDB, Oracle, SQL Server, H2, SQLite, DB2
- **Detection Signals**:
  - Maven dependencies: `io.ebean:ebean`, `io.ebean:ebean-agent`, `io.ebean:ebean-spring-txn`
  - Gradle plugins: `io.ebean` plugin
  - Import patterns: `import io.ebean.*`, `import io.ebean.annotation.*`
  - Annotations: `@Entity`, `@Table` (same as JPA — Ebean uses JPA annotations), `@DbName`, `@DbDefault`, `@DbArray`, `@DbJson`, `@DbJsonB`, `@Index`, `@History`
  - Config: `ebean.properties`, `application.properties` with `datasource.*` or `ebean.*` keys; `ebean.xml`
  - Superclass patterns: entities often extend `Model` or `BaseModel`
- **Entity Definition Style**: Entities are JPA-annotated classes (`@Entity`, `@Table`, `@Column`, `@Id`) that optionally extend Ebean's `Model` base class (which provides `.save()`, `.delete()`, `.find()` convenience methods). Ebean uses bytecode enhancement (via the Ebean agent) to intercept field access for lazy loading and change tracking. Query DSL is fluent: `new QCustomer().name.startsWith("Rob").findList()` — Q-type query beans are generated from entity classes.
- **Extraction Approach**:
  1. Scan for `@Entity` annotated classes (same as JPA approach).
  2. Additionally check for classes extending `io.ebean.Model` or `io.ebean.bean.EntityBean` (the enhanced marker interface).
  3. Extract `@Table(name="...")` for explicit table names; default to class name.
  4. Scan for generated Q-type classes (e.g., `QCustomer`) in the same package or a configured query bean package — these confirm which entities exist.
  5. Check `ebean.xml` or `ebean.properties` for entity package scanning configuration.
- **Key Challenges**:
  - Bytecode enhancement means runtime class files differ from source — focus on source only.
  - Q-type query beans are generated and may not be committed.
  - `@History` tables create shadow audit tables with a `_history` suffix — these are real tables but not declared as separate entities.
  - `@DbPartition` indicates partitioned tables.
  - Ebean supports `@ManyToMany` through a join table not represented as an entity — must infer join tables from relationship annotations.
- **Analysis Tools**: JavaParser, Spoon, tree-sitter java grammar
- **Complexity**: Medium

---

## 12. ActiveJDBC

- **Name**: ActiveJDBC
- **Type**: Relational ORM (Active Record Pattern)
- **Supported Databases**: PostgreSQL, MySQL, Oracle, SQL Server, H2, SQLite, DB2
- **Detection Signals**:
  - Maven dependencies: `org.javalite:activejdbc`, `org.javalite:javalite-common`
  - Import patterns: `import org.javalite.activejdbc.*`, `import org.javalite.activejdbc.Model`
  - Class declarations: classes extending `org.javalite.activejdbc.Model`
  - Annotations (optional): `@Table("tablename")` on model classes, `@BelongsTo`, `@HasMany`, `@HasAndBelongsToMany`
- **Entity Definition Style**: Models are Java classes that extend `Model`. The table name is inferred by convention — pluralized, snake_cased class name (e.g., class `Person` maps to table `people`, class `OrderItem` maps to `order_items`). Override with `@Table("custom_name")`. No field annotations for columns — columns are discovered at runtime from the database metadata (`INFORMATION_SCHEMA`). Relationships use class-level annotations: `@BelongsTo(parent=Company.class, foreignKeyName="company_id")`.
- **Extraction Approach**:
  1. Scan for classes extending `org.javalite.activejdbc.Model`.
  2. For each such class, check for `@Table("...")` annotation — use that as the table name.
  3. If no `@Table`, apply the ActiveJDBC naming convention: convert the class name from CamelCase to snake_case and pluralize (e.g., `OrderItem` -> `order_items`). This is English-language pluralization.
  4. Scan for relationship annotations (`@BelongsTo`, `@HasMany`, `@HasAndBelongsToMany`) to discover join tables and foreign key relationships.
  5. Note: Column-level information is not available without database introspection — ActiveJDBC discovers columns dynamically.
- **Key Challenges**:
  - Automated English pluralization is non-trivial and error-prone for irregular nouns (e.g., `Person` -> `people`, not `persons`). Must implement or use the same Inflector library that ActiveJDBC uses.
  - No field declarations for columns in source — cannot enumerate columns from static analysis alone.
  - `@Table` may also be inherited — must check superclasses.
  - `@DbName("secondary")` routes a model to a non-default database connection — indicates multi-database projects.
- **Analysis Tools**: JavaParser / tree-sitter for class hierarchy and annotation scanning; custom pluralization logic matching ActiveJDBC's `Inflector`
- **Complexity**: Medium

---

## 13. Querydsl

- **Name**: Querydsl
- **Type**: Type-Safe Query DSL (used as a layer over JPA, JDO, MongoDB, SQL, etc.)
- **Supported Databases**: Depends on backend: JPA (any JDBC), MongoDB, Lucene, SQL (any JDBC)
- **Detection Signals**:
  - Maven dependencies: `com.querydsl:querydsl-jpa`, `com.querydsl:querydsl-sql`, `com.querydsl:querydsl-mongodb`, `com.querydsl:querydsl-apt`
  - Gradle dependencies: same artifact names
  - Import patterns: `import com.querydsl.jpa.impl.*`, `import com.querydsl.sql.*`, `import com.querydsl.core.*`
  - Annotations: `@QueryEntity`, `@QueryProjection`, `@QueryInit`, `@QueryType`
  - Generated class patterns: Q-prefixed classes (e.g., `QUser`, `QOrder`) with static field references
  - APT (annotation processor) plugin configured in build file
- **Entity Definition Style**: Querydsl itself does not define entities — it generates Q-type query classes from existing entity definitions (JPA `@Entity` classes, SQL schema via the SQL module, MongoDB documents, etc.). The Q-types provide a strongly-typed DSL for building queries. `QUser.user.name.eq("Alice")` instead of string-based JPQL or SQL.
- **Extraction Approach**:
  1. Querydsl is a query layer — the actual entity definitions come from the underlying framework (JPA, MongoDB, SQL).
  2. Apply extraction for the underlying framework first.
  3. Additionally: scan for Q-type classes (classes prefixed with `Q` that extend `EntityPathBase<T>`, `RelationalPathBase<T>`, etc.) — these confirm which entities exist and provide typed column path information.
  4. For `querydsl-sql` (schema-first mode): Q-types are generated from a database snapshot and contain column type information — parse these as an alternative to or supplement of migration files.
  5. `@QueryProjection` on DTO constructors indicates data projections — these are not tables but are useful for understanding the data model.
- **Key Challenges**:
  - Generated Q-types may not be committed to the repository.
  - `querydsl-sql` Q-types contain actual SQL table and column names — more reliable than JPA entity class names.
  - Multi-module projects may generate Q-types in a separate module.
- **Analysis Tools**: JavaParser for Q-type class scanning
- **Complexity**: Low (Querydsl itself adds little complexity — complexity comes from the underlying framework)

---

## 14. Flyway

- **Name**: Flyway
- **Type**: Database Migration Tool / Schema File
- **Supported Databases**: PostgreSQL, MySQL, MariaDB, Oracle, SQL Server, SQLite, H2, HSQLDB, Derby, DB2, CockroachDB, Snowflake, and others
- **Detection Signals**:
  - Maven dependencies: `org.flywaydb:flyway-core`, `org.flywaydb:flyway-maven-plugin`, `org.flywaydb:flyway-gradle-plugin`
  - File patterns: `V__*.sql` (versioned), `U__*.sql` (undo), `R__*.sql` (repeatable) in `src/main/resources/db/migration/` or configured `flyway.locations`
  - Config: `flyway.conf`, `flyway.url` in `application.properties`, `flyway.locations` property
  - Java-based migrations: classes implementing `BaseJavaMigration` or `JavaMigration` in the configured migration package
- **Entity Definition Style**: Plain SQL DDL files. Each migration file is a versioned SQL script containing `CREATE TABLE`, `ALTER TABLE`, `DROP TABLE`, `CREATE INDEX`, `CREATE VIEW`, `CREATE SEQUENCE` statements. Files are executed in version order. The schema at any point is the cumulative result of all applied migrations.
- **Extraction Approach**:
  1. Locate migration files: find all files matching `V*__*.sql`, `U*__*.sql`, `R*__*.sql` in the configured locations (default: `classpath:db/migration`, typically `src/main/resources/db/migration/`).
  2. Sort files by version number in ascending order.
  3. Parse each SQL file sequentially using a SQL parser (sqlglot, JSQLParser, ANTLR SQL grammar).
  4. Track state: apply `CREATE TABLE` to add tables, `DROP TABLE` to remove them, `ALTER TABLE ADD COLUMN` to add columns, `ALTER TABLE DROP COLUMN` to remove them, `RENAME TABLE` / `ALTER TABLE RENAME TO` to rename.
  5. After processing all migrations, the remaining table set is the current schema.
  6. Extract `CREATE VIEW` statements separately — views are not tables but may represent logical entities.
  7. For Java-based migrations (`BaseJavaMigration` subclasses), extract SQL strings from method bodies where possible; otherwise flag as requiring runtime analysis.
  8. Check `flyway.schemas` / `flyway.defaultSchema` for schema scoping.
- **Key Challenges**:
  - Multi-database migrations with `@@` placeholders or conditional SQL (`-- flyway:dialect`) require dialect-aware parsing.
  - Flyway placeholders (`${tableName}`) in SQL make static names unresolvable.
  - Undo migrations (`U__*.sql`) and their relationship to versioned migrations require careful state management.
  - Repeatable migrations (`R__*.sql`) are always re-run if changed — treat as CREATE OR REPLACE.
  - Java-based migrations bypass SQL parsing entirely.
  - Out-of-order migrations (Flyway `outOfOrder=true`) complicate sequential processing.
- **Analysis Tools**: sqlglot (Python, excellent SQL dialect support), JSQLParser (Java, good DDL support), ANTLR SQL grammars
- **Complexity**: Low-Medium (SQL is structured; main challenge is incremental state tracking)

---

## 15. Liquibase

- **Name**: Liquibase
- **Type**: Database Migration Tool / Schema File
- **Supported Databases**: PostgreSQL, MySQL, MariaDB, Oracle, SQL Server, SQLite, H2, HSQLDB, Derby, DB2, CockroachDB, Snowflake, and others
- **Detection Signals**:
  - Maven dependencies: `org.liquibase:liquibase-core`, `org.liquibase:liquibase-maven-plugin`
  - File patterns: `db.changelog-master.xml`, `db.changelog-master.yaml`, `db.changelog-master.json`, `liquibase.properties`, `changelog*.xml`, `changelog*.yaml`
  - Config: `liquibase.change-log` in `application.properties`, `liquibase.properties` file
  - Root XML element: `<databaseChangeLog>` with Liquibase namespace
- **Entity Definition Style**: A changelog file references changesets in XML, YAML, JSON, or formatted SQL. Each changeset contains Liquibase change types: `createTable`, `addColumn`, `dropTable`, `dropColumn`, `renameTable`, `renameColumn`, `createView`, `createIndex`, `addForeignKeyConstraint`, `addPrimaryKey`, `createSequence`, etc. The root changelog typically includes sub-changelogs via `<include file="..."/>` or `<includeAll path="..."/>`.
- **Extraction Approach**:
  1. Locate the root changelog file (configured in `liquibase.properties` or `application.properties`).
  2. Recursively resolve `<include file="..."/>` and `<includeAll path="..."/>` references to build the full ordered changeset list.
  3. Process changesets in order, tracking table state:
     - `createTable`: add table with all `<column>` child elements
     - `addColumn`: add columns to existing table
     - `dropColumn`: remove column
     - `dropTable`: remove table
     - `renameTable`: rename table key
     - `renameColumn`: rename column within table
     - `modifyDataType`: update column type
     - `createView`: record view name and definition
  4. For YAML changelogs: parse YAML and apply the same state machine.
  5. For SQL changelogs (formatted SQL with `--liquibase formatted sql` header): extract `--changeset` blocks and parse SQL within each.
  6. For JSON changelogs: parse JSON structure, same logic.
  7. Check `context` attribute on changesets — context-specific changesets may only apply in certain environments.
- **Key Challenges**:
  - `includeAll` with a path includes all changelog files in a directory — must enumerate them all.
  - `preconditions` on changesets may conditionally prevent their application.
  - `context` filtering means some changesets are environment-specific (test data tables, etc.).
  - `rollback` blocks within changesets define undo operations — do not confuse with forward changes.
  - `customChange` changesets execute arbitrary Java code — unanalyzable statically.
  - `runAlways="true"` and `runOnChange="true"` changesets behave differently from standard one-time changesets.
  - Multi-database `dbms` attribute on changesets creates dialect-specific schema differences.
- **Analysis Tools**: Python `lxml` / `xml.etree` for XML, PyYAML for YAML, Python `json` for JSON, sqlglot for SQL changelogs
- **Complexity**: Medium (structured format; challenge is the stateful incremental processing and include resolution)

---

## 16. Embedded SQL Strings

- **Name**: Embedded SQL Strings
- **Type**: Raw SQL (Embedded in Java Source)
- **Supported Databases**: Any (database-agnostic at the source level)
- **Detection Signals**:
  - Annotations: `@Query("SELECT ...")` (Spring Data), `@NamedQuery(name="...", query="...")` (JPA), `@NamedNativeQuery`, `@SqlResultSetMapping`
  - String patterns in Java source: string literals containing `SELECT`, `INSERT INTO`, `UPDATE`, `DELETE FROM`, `CREATE TABLE` (case-insensitive)
  - Class-level annotations: `@NamedQueries({@NamedQuery(...)})`, `@NamedNativeQueries({@NamedNativeQuery(...)})`
- **Entity Definition Style**: SQL queries embedded as string literals in Java annotations or variable assignments. `@NamedQuery` and `@NamedNativeQuery` are defined on entity classes and reference the entity or table directly. `@Query` on Spring Data repository methods can use JPQL or native SQL.
- **Extraction Approach**:
  1. Scan for `@NamedQuery(query="...")` and `@NamedNativeQuery(query="...")` on entity classes — extract and parse the query string.
  2. Scan for `@Query("...")` on repository methods — check `nativeQuery=true` for SQL vs. JPQL.
  3. For JPQL queries: parse for entity name references (FROM clause uses entity class names, not table names) and cross-reference to `@Entity` class registry.
  4. For native SQL queries: use a SQL parser to extract table names.
  5. Scan all string literals in Java source that match SQL patterns (heuristic: contains `SELECT`, `FROM`, `WHERE`, `INSERT INTO`, `UPDATE`). This catches ad-hoc SQL not in annotations.
  6. Attempt constant folding for SQL built from concatenated constants.
- **Key Challenges**:
  - JPQL uses entity names (class names or `@Entity(name="...")` value), not table names — requires entity-name-to-table-name registry.
  - Multi-line SQL split across concatenated string literals is hard to reassemble statically.
  - `@SqlResultSetMapping` defines custom result mappings that may span multiple entities/tables.
  - Text blocks (Java 15+) make multi-line SQL more readable but require text block parsing.
- **Analysis Tools**: JavaParser / tree-sitter for annotation and string literal extraction, sqlglot or JSQLParser for SQL, custom JPQL parser or regex for entity name extraction
- **Complexity**: Medium-High

---

## 17. Stored Procedures and Views in SQL Files

- **Name**: Stored Procedures / Views / Functions in SQL Files
- **Type**: Schema File / Raw SQL
- **Supported Databases**: PostgreSQL, MySQL, Oracle, SQL Server, and any database supporting stored routines
- **Detection Signals**:
  - File patterns: `*.sql` files not following Flyway/Liquibase naming conventions — in `src/main/resources/sql/`, `src/main/resources/db/`, `src/main/resources/procedures/`, `src/main/resources/views/`
  - SQL keywords: `CREATE OR REPLACE PROCEDURE`, `CREATE OR REPLACE FUNCTION`, `CREATE OR REPLACE VIEW`, `CREATE TRIGGER`
  - Referenced by: `SimpleJdbcCall`, `StoredProcedure` subclasses, `JdbcTemplate.execute("CALL ...")`
- **Entity Definition Style**: Standalone SQL DDL files containing `CREATE TABLE`, `CREATE VIEW`, `CREATE PROCEDURE`, `CREATE FUNCTION`, `CREATE TRIGGER` statements. May be executed once at schema setup time (not versioned like Flyway/Liquibase migrations). Views may represent virtual entities (query results presented as tables). Procedures/functions may access multiple tables.
- **Extraction Approach**:
  1. Glob for `*.sql` files not covered by Flyway/Liquibase patterns.
  2. Parse each with a SQL parser; extract:
     - `CREATE TABLE` / `CREATE TABLE IF NOT EXISTS` — table name and column list
     - `CREATE VIEW` — view name and the underlying SELECT (parse SELECT for source table names)
     - `CREATE PROCEDURE` / `CREATE FUNCTION` — routine name and body (parse body for DML table references)
     - `CREATE TRIGGER` — trigger name and target table
  3. For views: record both the view name (as a logical entity) and its source tables (as dependencies).
  4. For procedures: record tables accessed (read or written) as a dependency graph.
  5. Schema initialization scripts often contain full `CREATE TABLE` statements for the baseline schema — treat these as authoritative.
- **Key Challenges**:
  - PL/pgSQL, T-SQL, PL/SQL procedure bodies contain control flow, cursors, dynamic SQL — standard SQL parsers may fail on procedure bodies.
  - Dynamic SQL within procedures (`EXECUTE format('SELECT * FROM %I', table_name)`) is unresolvable.
  - Views can be layered (views on views) — dependency resolution is recursive.
  - Files may be dialect-specific (Oracle `CREATE OR REPLACE` vs. standard SQL) — dialect-aware parsing required.
- **Analysis Tools**: sqlglot (Python, strong multi-dialect support), JSQLParser (Java), database-specific parsers for PL/SQL / T-SQL
- **Complexity**: Medium-High

---

## 18. Spring Data MongoDB

- **Name**: Spring Data MongoDB
- **Type**: NoSQL Document Store
- **Supported Databases**: MongoDB
- **Detection Signals**:
  - Maven dependencies: `org.springframework.data:spring-data-mongodb`, `org.springframework.boot:spring-boot-starter-data-mongodb`
  - Import patterns: `import org.springframework.data.mongodb.core.mapping.*`, `import org.springframework.data.mongodb.repository.*`
  - Annotations: `@Document`, `@Field`, `@Id`, `@Indexed`, `@CompoundIndex`, `@TextIndexed`, `@DBRef`, `@DocumentReference`
  - Config: `spring.data.mongodb.uri`, `spring.data.mongodb.database` in `application.properties`
  - Interface declarations extending `MongoRepository<EntityType, IdType>`, `ReactiveMongoRepository`
- **Entity Definition Style**: Entities are Java classes annotated with `@Document(collection="...")`. The collection name defaults to the class name in camelCase. Fields are annotated with `@Field("fieldName")` to override the default (camelCase field name). `@Id` marks the document identifier. Embedded documents (nested objects) do not require their own `@Document`. `@DBRef` / `@DocumentReference` for cross-document references.
- **Extraction Approach**:
  1. Scan for classes annotated with `@Document`.
  2. Extract `collection` attribute from `@Document(collection="...")` — default to camelCase class name.
  3. Walk class fields: extract `@Field("name")` for overridden field names, `@Id` for identifier, `@DBRef` / `@DocumentReference` for referenced collections.
  4. Scan for interfaces extending `MongoRepository<T, ID>` or `ReactiveMongoRepository<T, ID>` — first generic parameter confirms entity class.
  5. Scan for `MongoTemplate.find(query, EntityClass.class)` / `mongoTemplate.save(entity)` calls to discover classes used as documents even without `@Document`.
  6. Check `@CompoundIndex` and `@Indexed` for secondary index information (not collections, but useful context).
- **Key Challenges**:
  - Schema-less nature means fields are not strictly defined — `@Field` annotations may be sparse or absent.
  - Polymorphic documents (Spring Data `_class` discriminator field) mean one collection may store multiple Java types.
  - Dynamic collection names: `mongoTemplate.find(query, clazz, "dynamicCollectionName")` is unresolvable statically.
  - `@TypeAlias` changes the `_class` discriminator value stored in MongoDB.
- **Analysis Tools**: JavaParser / tree-sitter for annotation scanning
- **Complexity**: Medium

---

## 19. Spring Data Redis

- **Name**: Spring Data Redis
- **Type**: NoSQL Key-Value Store
- **Supported Databases**: Redis
- **Detection Signals**:
  - Maven dependencies: `org.springframework.data:spring-data-redis`, `org.springframework.boot:spring-boot-starter-data-redis`
  - Import patterns: `import org.springframework.data.redis.core.*`, `import org.springframework.data.redis.repository.*`
  - Annotations: `@RedisHash`, `@Indexed`, `@TimeToLive`, `@Id`, `@Reference`
  - Interface declarations extending `RedisRepository<EntityType, IdType>`, `CrudRepository` (Redis-backed)
  - Config: `spring.redis.host`, `spring.redis.port` in `application.properties`
- **Entity Definition Style**: Entities are Java classes annotated with `@RedisHash("keyPrefix")`. Each instance is stored as a Redis Hash under a key like `keyPrefix:<id>`. The `value` attribute of `@RedisHash` defines the key prefix (defaults to the fully qualified class name). Fields annotated `@Indexed` create secondary indexes as Redis Sets. `@TimeToLive` sets TTL in seconds.
- **Extraction Approach**:
  1. Scan for classes annotated with `@RedisHash`.
  2. Extract the `value` attribute from `@RedisHash(value="...")` — this is the Redis key prefix / logical entity name.
  3. Walk class fields for `@Indexed` (secondary index fields), `@TimeToLive` (expiry field), `@Id` (primary key).
  4. Scan for interfaces extending `RedisRepository<T, ID>` — first generic type confirms entity class.
  5. Scan for `RedisTemplate<K, V>` usages — the value type `V` may indicate entity classes; check `.opsForHash()`, `.opsForValue()` patterns.
- **Key Challenges**:
  - `RedisTemplate` usage is untyped — extracting entity semantics requires following the value type generic parameter.
  - Custom serializers (`Jackson2JsonRedisSerializer`, `GenericJackson2JsonRedisSerializer`) may store complex objects without `@RedisHash`.
  - `@RedisHash` without a value attribute falls back to class name — must handle both cases.
  - Non-repository Redis usage (caching via `@Cacheable`, pub/sub, Lua scripts) does not define entities in the same sense.
- **Analysis Tools**: JavaParser / tree-sitter for annotation scanning
- **Complexity**: Low-Medium

---

## 20. Spring Data Elasticsearch

- **Name**: Spring Data Elasticsearch
- **Type**: NoSQL Search Engine / Document Store
- **Supported Databases**: Elasticsearch, OpenSearch
- **Detection Signals**:
  - Maven dependencies: `org.springframework.data:spring-data-elasticsearch`, `org.springframework.boot:spring-boot-starter-data-elasticsearch`
  - Import patterns: `import org.springframework.data.elasticsearch.annotations.*`, `import org.springframework.data.elasticsearch.repository.*`
  - Annotations: `@Document`, `@Field`, `@Id`, `@MultiField`, `@InnerField`, `@Mapping`, `@Setting`
  - Interface declarations extending `ElasticsearchRepository<T, ID>`, `ReactiveElasticsearchRepository`
  - JSON mapping files: `*-mapping.json`, `*-settings.json` in resources
  - Config: `spring.elasticsearch.uris` in `application.properties`
- **Entity Definition Style**: Entities are Java classes annotated with `@Document(indexName="...")`. The `indexName` is the Elasticsearch index name. Fields carry rich type annotations: `@Field(type=FieldType.Text, analyzer="standard")`, `@Field(type=FieldType.Keyword)`, `@Field(type=FieldType.Date)`, etc. `@MultiField` allows a field to have multiple Elasticsearch representations (e.g., full-text and keyword). External JSON index mapping files can supplement or replace annotation-based mapping.
- **Extraction Approach**:
  1. Scan for classes annotated with `@Document`.
  2. Extract `indexName` attribute from `@Document(indexName="...")` — this is the Elasticsearch index name.
  3. Walk class fields for `@Field` annotations — extract `type`, `name`, `analyzer` attributes for field mapping detail.
  4. Check `@Mapping(mappingPath="...")` annotations — these reference external JSON mapping files; locate and parse those JSON files for field structure.
  5. Scan for `@Setting(settingPath="...")` references to settings JSON files.
  6. Scan for interfaces extending `ElasticsearchRepository<T, ID>` — first generic type confirms entity class.
  7. Scan for `ElasticsearchRestTemplate` / `ElasticsearchOperations` method calls (`.save()`, `.search()`) and their entity class arguments.
- **Key Challenges**:
  - `indexName` may use SpEL expressions (`"#{@environment.getProperty('index.name')}"`) — not statically resolvable.
  - Dynamic index names (time-based rolling indexes, multi-tenant indexes) bypass static analysis.
  - JSON mapping files may define fields not present in the Java class (e.g., runtime fields, copy_to targets).
  - `@MultiField` creates sub-fields under the same field name that are distinct in Elasticsearch but share one Java field.
- **Analysis Tools**: JavaParser / tree-sitter for Java annotation scanning, Python `json` module for JSON mapping files
- **Complexity**: Medium

---

## 21. Spring Data Cassandra

- **Name**: Spring Data Cassandra
- **Type**: NoSQL Wide-Column Store
- **Supported Databases**: Apache Cassandra, DataStax Astra (cloud Cassandra)
- **Detection Signals**:
  - Maven dependencies: `org.springframework.data:spring-data-cassandra`, `org.springframework.boot:spring-boot-starter-data-cassandra`
  - Import patterns: `import org.springframework.data.cassandra.core.mapping.*`, `import org.springframework.data.cassandra.repository.*`
  - Annotations: `@Table`, `@PrimaryKey`, `@PrimaryKeyColumn`, `@Column`, `@UserDefinedType`, `@CassandraType`, `@Indexed`, `@PrimaryKeyClass`
  - Interface declarations extending `CassandraRepository<T, ID>`, `ReactiveCassandraRepository`
  - Config: `spring.data.cassandra.keyspace-name`, `spring.data.cassandra.contact-points` in `application.properties`
- **Entity Definition Style**: Entities are Java classes annotated with `@Table("table_name")`. The Cassandra keyspace is configured externally. `@PrimaryKey` marks a single-column primary key; `@PrimaryKeyClass` with `@PrimaryKeyColumn` supports composite partition/clustering keys as a separate class. Regular columns use `@Column("column_name")`. User-defined types (UDTs) are annotated with `@UserDefinedType`.
- **Extraction Approach**:
  1. Scan for classes annotated with `@Table` (Cassandra variant — `org.springframework.data.cassandra.core.mapping.Table`).
  2. Extract the table name from `@Table("name")` — default to class name in snake_case.
  3. Walk class fields: extract `@Column("name")` for column names, `@PrimaryKey` / `@PrimaryKeyColumn` for key structure.
  4. Scan for classes annotated with `@PrimaryKeyClass` — these define composite keys; their fields carry `@PrimaryKeyColumn(type=PrimaryKeyType.PARTITIONED)` or `CLUSTERED`.
  5. Scan for `@UserDefinedType` classes — these are Cassandra UDTs embedded in table columns.
  6. Scan for interfaces extending `CassandraRepository<T, ID>` — first generic type confirms entity class.
  7. Extract keyspace from `spring.data.cassandra.keyspace-name` in properties for full qualified name.
- **Key Challenges**:
  - Cassandra's data model (partition keys, clustering keys) requires understanding key type annotations beyond just `@Id`.
  - UDTs (`@UserDefinedType`) are nested types that form part of a table's column definition.
  - `@Indexed` creates secondary indexes — note that Cassandra's secondary indexes have significant performance implications (not equivalent to RDBMS indexes).
  - Multi-keyspace configurations require tracking which entity belongs to which keyspace.
- **Analysis Tools**: JavaParser / tree-sitter for annotation scanning
- **Complexity**: Medium

---

## 22. R2DBC

- **Name**: R2DBC (Reactive Relational Database Connectivity)
- **Type**: Reactive Relational ORM / Raw Reactive SQL
- **Supported Databases**: PostgreSQL, MySQL, MariaDB, Oracle, SQL Server, H2 (via r2dbc drivers)
- **Detection Signals**:
  - Maven dependencies: `org.springframework.data:spring-data-r2dbc`, `org.springframework.boot:spring-boot-starter-data-r2dbc`, `io.r2dbc:r2dbc-spi`, `io.r2dbc:r2dbc-postgresql`, `io.r2dbc:r2dbc-mysql`
  - Import patterns: `import org.springframework.data.r2dbc.core.*`, `import org.springframework.data.relational.core.mapping.*`, `import io.r2dbc.spi.*`
  - Annotations: `@Table`, `@Column`, `@Id`, `@Transient`, `@Version` (from `spring-data-relational`)
  - Interface declarations extending `R2dbcRepository<T, ID>`, `ReactiveCrudRepository`
  - Config: `spring.r2dbc.url`, `spring.r2dbc.username` in `application.properties`
- **Entity Definition Style**: Similar to Spring Data JPA in annotation style but uses Spring Data Relational annotations (`org.springframework.data.relational.core.mapping.Table`, not `javax.persistence.Table`). Classes annotated `@Table("table_name")` with `@Id` and `@Column("col_name")` fields. No lazy loading or session context (reactive, stateless). Relationships are not automatically joined — foreign keys are modeled as plain ID fields with an `@MappedCollection` or `AggregateReference`.
- **Extraction Approach**:
  1. Scan for classes annotated with `@Table` from the `org.springframework.data.relational.core.mapping` package (distinct from JPA `@Table`).
  2. Extract table name from `@Table("name")` or default to snake_case class name.
  3. Walk fields for `@Column("name")` — default to snake_case field name. Note `@Transient` fields are not persisted.
  4. Scan for interfaces extending `R2dbcRepository<T, ID>` or `ReactiveCrudRepository<T, ID>` — first generic type confirms entity class.
  5. Scan for `R2dbcEntityTemplate.select(query, EntityClass.class)` and `DatabaseClient.sql("...").fetch()` calls.
  6. Extract SQL strings from `DatabaseClient.sql("SELECT ...")` calls and parse with a SQL parser.
- **Key Challenges**:
  - `@Table` from Spring Data Relational vs. `@Table` from JPA are different annotations with similar names — package name disambiguation is critical.
  - `DatabaseClient` raw SQL usage has the same extraction challenges as `JdbcTemplate`.
  - Reactive streams make call-graph analysis harder (operators chain, not explicit calls).
  - `@MappedCollection` for one-to-many relationships creates implicit join table structures.
- **Analysis Tools**: JavaParser / tree-sitter (with package-aware annotation disambiguation), sqlglot or JSQLParser for embedded SQL
- **Complexity**: Medium

---

## 23. GraphQL Schema Files

- **Name**: GraphQL Schema Files
- **Type**: API Schema / Logical Entity Definition
- **Supported Databases**: Database-agnostic (GraphQL is a query language for APIs, not a database)
- **Detection Signals**:
  - File extensions: `*.graphqls`, `*.graphql`, `*.gql`
  - Common locations: `src/main/resources/graphql/`, `src/main/resources/schema/`
  - Maven dependencies: `com.graphql-java:graphql-java`, `com.graphql-java-kickstart:graphql-spring-boot-starter`, `org.springframework.boot:spring-graphql`, `com.netflix.graphql.dgs:graphql-dgs-spring-boot-starter`
  - Java annotations: `@QueryMapping`, `@MutationMapping`, `@SchemaMapping` (Spring for GraphQL), `@DgsQuery`, `@DgsComponent` (Netflix DGS)
- **Entity Definition Style**: GraphQL schemas define `type`, `input`, `interface`, `union`, `enum`, and `scalar` declarations in the GraphQL Schema Definition Language (SDL). `type` declarations represent graph nodes (logical entities). `input` types are mutation argument types. The GraphQL schema does not map 1:1 to database tables — a single `type` may aggregate data from multiple tables or microservices, and a single table may back multiple `type` fields.
- **Extraction Approach**:
  1. Locate all `*.graphqls`, `*.graphql`, `*.gql` files in the project.
  2. Parse each file using a GraphQL SDL parser (graphql-java's `SchemaParser`, or graphql-core-3 in Python).
  3. Extract `type` declarations (excluding `Query`, `Mutation`, `Subscription` root types) — these are the domain entity types.
  4. For each `type`, extract its fields and their types (scalar, enum, or reference to another type).
  5. Extract `input` types — these often mirror entity types and indicate mutation payloads.
  6. Record `interface` and `union` declarations for polymorphic type hierarchies.
  7. Cross-reference to Java `@QueryMapping` / `@DgsQuery` resolver methods to find the backing data fetch logic.
- **Key Challenges**:
  - GraphQL types are API contracts, not necessarily 1:1 with database tables.
  - Schema stitching and federation (Apollo Federation `@key`, `@extends`) fragment the schema across services.
  - `@external` fields in federated schemas reference entities owned by other services.
  - Schema-first vs. code-first: code-first approaches (using `@GraphQLQuery` annotations or DGS `@DgsData`) generate the schema at runtime from Java annotations — the `.graphqls` files may not exist; instead parse Java annotations.
- **Analysis Tools**: graphql-java `SchemaParser` (Java), graphql-core-3 (Python), tree-sitter graphql grammar
- **Complexity**: Low (parsing) / Medium (semantic mapping to database entities)

---

## 24. Protobuf (.proto)

- **Name**: Protocol Buffers (Protobuf)
- **Type**: Schema File / Serialization Format
- **Supported Databases**: Database-agnostic (serialization format, not a database driver)
- **Detection Signals**:
  - File extensions: `*.proto`
  - Common locations: `src/main/proto/`, `proto/`, `src/main/resources/proto/`
  - Maven dependencies: `com.google.protobuf:protobuf-java`, `io.grpc:grpc-java`, `com.google.protobuf:protobuf-java-util`
  - Maven plugin: `org.xolstice.maven.plugins:protobuf-maven-plugin`
  - Generated Java files: classes extending `com.google.protobuf.GeneratedMessageV3`
- **Entity Definition Style**: `.proto` files define `message` types (analogous to structs/entities) and `service` definitions (RPC endpoints). Messages contain typed fields identified by field numbers. `proto3` syntax is most common. Enums are defined with `enum`. Nested messages are common. Protobuf messages represent data transfer objects and may closely mirror database entities, especially in gRPC services with persistence backends.
- **Extraction Approach**:
  1. Locate all `*.proto` files in the project.
  2. Parse each with a proto parser (protobuf's `protoc` compiler output, tree-sitter proto grammar, or `python-protobuf`).
  3. Extract `message` declarations — each is a potential logical entity. Record the message name and its fields (field number, type, name).
  4. Extract `service` and `rpc` declarations to understand which messages are request/response types vs. domain entities.
  5. Identify `google.protobuf.Timestamp`, `google.protobuf.Struct`, `google.protobuf.Any` usages as field types.
  6. Cross-reference message names to Java entity classes or `@Entity` names — if a `UserProto` message corresponds to a `User` entity, the fields provide column/field signal.
  7. Check `option java_package` and `option java_outer_classname` for the generated Java package structure.
- **Key Challenges**:
  - Protobuf messages are serialization contracts — they may not correspond 1:1 to database tables (they may be aggregated, partial, or versioned views of entities).
  - `oneof` fields represent mutually exclusive fields — not all fields are always present.
  - `map<K, V>` fields are stored as repeated message types internally.
  - Protobuf does not express relationships between messages (no foreign key concept) — relationships must be inferred from field names and types.
- **Analysis Tools**: tree-sitter with proto grammar, `protoc` with JSON output, `betterproto` (Python)
- **Complexity**: Low (well-structured files) / Medium (mapping to actual database entities)

---

## 25. Avro (.avsc)

- **Name**: Apache Avro
- **Type**: Schema File / Serialization Format
- **Supported Databases**: Database-agnostic; commonly used with Apache Kafka, Confluent Schema Registry, Hadoop, Spark
- **Detection Signals**:
  - File extensions: `*.avsc` (Avro Schema), `*.avro` (binary Avro data files)
  - Common locations: `src/main/avro/`, `src/main/resources/avro/`, `avro/schemas/`
  - Maven dependencies: `org.apache.avro:avro`, `org.apache.avro:avro-maven-plugin`, `io.confluent:kafka-avro-serializer`
  - Generated Java files: classes extending `org.apache.avro.specific.SpecificRecord`
  - Config: Confluent Schema Registry URL in `application.properties`: `spring.kafka.properties.schema.registry.url`
- **Entity Definition Style**: Avro schemas are JSON files defining `record` types (the primary entity type), `enum`, `array`, `map`, `union`, and `fixed` types. A `record` has a `name`, optional `namespace`, `doc`, and a list of `fields` (each with `name`, `type`, optional `default`, `doc`). Schemas can reference other schemas via their full name (namespace + name). Avro records typically represent Kafka message payloads or data lake records.
- **Extraction Approach**:
  1. Locate all `*.avsc` files in the project.
  2. Parse each as JSON (Avro schemas are valid JSON).
  3. Extract the top-level `record` definitions: `name`, `namespace`, `fields` array.
  4. For each field, extract `name` and `type` (handle unions like `["null", "string"]` for nullable fields).
  5. Resolve `$ref`-style name references to other schema files.
  6. Check the Confluent Schema Registry configuration — if present, schemas may be stored in the registry rather than files; the local `.avsc` files represent what was registered.
  7. Cross-reference Avro `record` names to Kafka topic names (often the topic is the entity name + version suffix).
- **Key Challenges**:
  - Schema evolution: Avro supports reader/writer schema compatibility. Multiple versions of a schema may exist in the repo.
  - Embedded schemas: Avro allows defining nested record types inline within another schema's field definition.
  - `union` types (especially `["null", "X"]`) are the Avro pattern for nullable fields — must unwrap to get the real type.
  - Schema registry may hold canonical schemas not committed to the repo.
- **Analysis Tools**: Python `json` parser (Avro `.avsc` files are plain JSON), Apache Avro Python library
- **Complexity**: Low

---

## 26. OpenAPI Specifications

- **Name**: OpenAPI / Swagger Specifications
- **Type**: API Schema / Logical Entity Definition
- **Supported Databases**: Database-agnostic
- **Detection Signals**:
  - File extensions: `*.yaml`, `*.yml`, `*.json` with OpenAPI content
  - Common locations: `src/main/resources/swagger/`, `src/main/resources/openapi/`, `api/`, `docs/`, root `openapi.yaml`
  - File content signals: `openapi: "3.0.x"` or `swagger: "2.0"` at root
  - Maven dependencies: `io.springfox:springfox-swagger2`, `org.springdoc:springdoc-openapi-ui`, `io.swagger.core.v3:swagger-annotations`
  - Annotations: `@ApiModel`, `@ApiModelProperty` (Swagger 2), `@Schema`, `@Operation`, `@Parameter` (OpenAPI 3)
- **Entity Definition Style**: OpenAPI specs define `schemas` (in `components/schemas` for OpenAPI 3, or `definitions` for Swagger 2). Each schema is a JSON Schema-compatible object definition with `properties`, `required`, `type`, `$ref`. Schemas represent request/response bodies, which often mirror database entities. `allOf`, `oneOf`, `anyOf` express inheritance and polymorphism.
- **Extraction Approach**:
  1. Locate OpenAPI spec files by content signature (`openapi:` or `swagger:` key at YAML/JSON root).
  2. Parse YAML/JSON: extract all `components/schemas` (OpenAPI 3) or `definitions` (Swagger 2) entries.
  3. For each schema, extract `properties` — each property has a name and type (including nested `$ref` to other schemas).
  4. Track `required` arrays for non-nullable field identification.
  5. Resolve `$ref` pointers to other schema objects (may be in the same file or external files).
  6. Process `allOf` as inheritance: merge parent schema properties into the child.
  7. For code-first projects (Springdoc, SpringFox): scan Java classes annotated with `@Schema(name="...")` or `@ApiModel(value="...")` — these are the schema definitions and may directly mirror entity classes.
- **Key Challenges**:
  - OpenAPI schemas are API contracts — they often represent DTO shapes, not exact database tables.
  - Large specs with `$ref` chains across multiple files require recursive resolver logic.
  - `discriminator` for polymorphic schemas adds complexity to type mapping.
  - Code-first frameworks generate the spec at runtime from Java annotations — the spec file may not be committed.
- **Analysis Tools**: `pyyaml` / `ruamel.yaml` (Python) for YAML, `jsonschema` for validation, `openapi-spec-validator`, `swagger-parser`
- **Complexity**: Low-Medium

---

## 27. DTO Classes as Entity Signals

- **Name**: DTO Classes (Data Transfer Objects) as Entity Signals
- **Type**: Structural Signal (not a persistence framework itself)
- **Supported Databases**: Any (DTOs are persistence-agnostic)
- **Detection Signals**:
  - Class naming conventions: classes suffixed with `DTO`, `Dto`, `Request`, `Response`, `Payload`, `Model`, `View`, `Vo`, `Bo`, `Form`
  - Jackson annotations: `@JsonProperty("field_name")`, `@JsonAlias({"alt1", "alt2"})`, `@JsonIgnore`, `@JsonInclude`, `@JsonDeserialize`, `@JsonSerialize`
  - `@JsonPropertyOrder` at class level — typically on serialized entity representations
  - `@JsonNaming` — applies naming strategy (e.g., `SnakeCaseStrategy`) to all fields
  - Lombok annotations on DTO classes: `@Data`, `@Value`, `@Builder`, `@AllArgsConstructor`
  - Record types (Java 16+): `public record UserDto(String name, String email) {}` — often DTOs
  - Explicit serialization: classes used as `ObjectMapper.writeValueAsString(dto)` or `objectMapper.readValue(json, SomeDto.class)`
- **Entity Definition Style**: DTOs are Java classes representing the shape of data exchanged at API or service boundaries. They often mirror or project from database entities. `@JsonProperty("snake_case_name")` on a field indicates the serialized JSON field name, which may match an API response field or a database column name. DTOs paired with `@Entity` classes in the same package hierarchy provide strong signals about which fields are exposed.
- **Extraction Approach**:
  1. Scan for classes with naming suffixes: `DTO`, `Dto`, `Request`, `Response`, `Payload`, `Model`, `View`, `Vo`, `Bo`, `Form`.
  2. Scan for classes with `@JsonProperty` annotations on fields — extract property names as logical field names.
  3. Correlate DTO class names to `@Entity` class names: `UserDto` likely corresponds to the `User` entity; `CreateUserRequest` likely maps to `User` insert operations.
  4. For each DTO field with `@JsonProperty("name")`, record the mapping Java field name -> JSON/API field name.
  5. Flag classes with `@JsonNaming` — apply the naming strategy to all unannotated fields to compute serialized names.
  6. Java records: extract component names directly (they become the JSON field names by default via Jackson).
  7. Treat Jackson `@JsonSubTypes` as a polymorphism signal — the `name` attributes are discriminator values for subtype selection.
- **Key Challenges**:
  - DTOs often represent projections (subset of entity fields) or aggregations (fields from multiple entities) — they are not 1:1 with tables.
  - `@JsonIgnore` hides fields that are present in the entity but not in the DTO.
  - Mixed use: the same class may serve as both a JPA entity and a Jackson-serializable DTO — detect both roles.
  - `@JsonProperty` may be on fields or getter methods — check both locations.
  - Lombok `@Builder` and `@Value` classes generate immutable DTOs with all-args constructors — fields come from source.
- **Analysis Tools**: JavaParser / tree-sitter for annotation scanning and class structure analysis
- **Complexity**: Low-Medium (as a supplemental signal alongside ORM analysis)

---

## 28. Validation Annotations as Entity Signals

- **Name**: Bean Validation / Validation Annotations as Entity Signals
- **Type**: Structural Signal (supplemental — not a persistence framework)
- **Supported Databases**: Any (validation is framework-agnostic)
- **Detection Signals**:
  - Import patterns: `import javax.validation.constraints.*`, `import jakarta.validation.constraints.*`, `import org.hibernate.validator.constraints.*`
  - Annotations: `@NotNull`, `@NotEmpty`, `@NotBlank`, `@Size`, `@Min`, `@Max`, `@Email`, `@Pattern`, `@Positive`, `@Negative`, `@DecimalMin`, `@DecimalMax`, `@Digits`, `@Future`, `@Past`, `@AssertTrue`, `@AssertFalse`
  - Hibernate Validator extras: `@Length`, `@Range`, `@CreditCardNumber`, `@URL`, `@UniqueElements`
  - Custom validators: classes implementing `ConstraintValidator<A, T>` with `@Constraint` annotation
  - Typically found on: `@Entity` fields (database-level constraints), DTO fields (API-level validation), `@RequestBody` parameters
- **Entity Definition Style**: Validation annotations express constraints on field values. On `@Entity` classes, `@NotNull` implies a NOT NULL database column, `@Size(max=255)` implies `VARCHAR(255)`, `@Column(unique=true)` combined with `@Email` implies a unique email column. These annotations provide supplemental type and constraint information beyond `@Column` alone.
- **Extraction Approach**:
  1. During entity field extraction (from JPA, Spring Data, etc.), also collect validation annotations on each field.
  2. Map validation annotations to schema constraints:
     - `@NotNull` -> NOT NULL constraint
     - `@Size(max=N)` -> VARCHAR(N) or equivalent length constraint
     - `@Min(value=N)` / `@Max(value=N)` -> CHECK constraint or numeric precision
     - `@Email` -> text field with email format expectation
     - `@Pattern(regexp="...")` -> character pattern constraint
  3. On DTO classes that lack `@Entity`, the presence of validation annotations confirms the class represents a structured data shape (useful for API entity identification).
  4. `@Valid` or `@Validated` on controller method parameters confirms the annotated parameter class is a structured input entity.
  5. Cross-reference validation groups (`groups=CreateGroup.class`) to understand which constraints apply to which operation context.
- **Key Challenges**:
  - Validation constraints on DTOs reflect API rules, not necessarily database constraints — over-reliance on DTOs can give misleading column constraints.
  - Custom validators (`@Constraint(validatedBy=...)`) provide no static schema information.
  - `@Valid` cascading on nested objects requires recursive field extraction.
  - `@GroupSequence` and validation group ordering are complex to interpret statically.
- **Analysis Tools**: JavaParser / tree-sitter for annotation collection alongside entity field scanning
- **Complexity**: Low (used as a supplemental annotation pass, not a primary extraction method)

---

## 29. Repository Detection Plan

Given a Java repository, use the following multi-stage plan to determine which data entity storage approaches are in use before running the appropriate extraction strategy.

### Stage 1: Build File Analysis

Parse `pom.xml` (Maven) and/or `build.gradle` / `build.gradle.kts` (Gradle) for dependency declarations.

**Maven**: XPath or XML parsing of `<dependency>` blocks under `<dependencies>` and `<dependencyManagement>`. Also check `<plugin>` blocks for code generation plugins.

**Gradle**: Regex or AST parsing of `implementation(...)`, `runtimeOnly(...)`, `annotationProcessor(...)`, `testImplementation(...)` declarations.

| Detected Dependency | Frameworks Indicated |
|---|---|
| `org.hibernate:hibernate-core` or `org.hibernate.orm:hibernate-core` | JPA/Hibernate annotation or XML-based |
| `javax.persistence:javax.persistence-api` or `jakarta.persistence:jakarta.persistence-api` | JPA (any provider) |
| `org.springframework.data:spring-data-jpa` or `spring-boot-starter-data-jpa` | Spring Data JPA |
| `org.eclipse.persistence:eclipselink` | EclipseLink |
| `org.apache.openjpa:openjpa` | OpenJPA |
| `org.mybatis:mybatis` or `mybatis-spring-boot-starter` | MyBatis |
| `ibatis:ibatis-2` or `com.ibatis:ibatis-sqlmap` | iBatis |
| `org.jooq:jooq` | jOOQ |
| `org.jdbi:jdbi3-core` or `org.skife.jdbi:jdbi` | JDBI / Jdbi3 |
| `org.springframework:spring-jdbc` or `spring-boot-starter-jdbc` | Spring JDBC Template |
| `io.ebean:ebean` | Ebean ORM |
| `org.javalite:activejdbc` | ActiveJDBC |
| `com.querydsl:querydsl-jpa` or `querydsl-sql` | Querydsl |
| `org.flywaydb:flyway-core` | Flyway migrations |
| `org.liquibase:liquibase-core` | Liquibase migrations |
| `org.springframework.data:spring-data-mongodb` or `spring-boot-starter-data-mongodb` | Spring Data MongoDB |
| `org.springframework.data:spring-data-redis` or `spring-boot-starter-data-redis` | Spring Data Redis |
| `org.springframework.data:spring-data-elasticsearch` or `spring-boot-starter-data-elasticsearch` | Spring Data Elasticsearch |
| `org.springframework.data:spring-data-cassandra` or `spring-boot-starter-data-cassandra` | Spring Data Cassandra |
| `org.springframework.data:spring-data-r2dbc` or `spring-boot-starter-data-r2dbc` | R2DBC |
| `com.graphql-java:graphql-java` or `graphql-spring-boot-starter` or `spring-graphql` | GraphQL |
| `com.netflix.graphql.dgs:graphql-dgs-spring-boot-starter` | GraphQL (Netflix DGS) |
| `com.google.protobuf:protobuf-java` or `grpc-java` | Protobuf / gRPC |
| `org.apache.avro:avro` or `kafka-avro-serializer` | Avro schemas |
| `io.springfox:springfox-swagger2` or `org.springdoc:springdoc-openapi-ui` | OpenAPI (code-first) |
| `com.fasterxml.jackson.core:jackson-databind` | Jackson DTOs (ubiquitous — treat as supplemental signal only) |

### Stage 2: File Extension and Path Scan

Scan the repository file tree for files with these extensions or path patterns:

| File Pattern | Framework Indicated |
|---|---|
| `src/main/resources/db/migration/V*.sql` | Flyway |
| `src/main/resources/db/migration/*.sql` (any) | Flyway |
| `src/main/resources/db/changelog*.xml` or `db.changelog*.yaml` | Liquibase |
| `META-INF/persistence.xml` | JPA (any provider) |
| `hibernate.cfg.xml` | Hibernate |
| `META-INF/orm.xml` | JPA XML mapping |
| `**/*.hbm.xml` | Hibernate XML mapping |
| `**/sqlmap-config.xml` or `**/*SqlMap.xml` | iBatis |
| `**/*Mapper.xml` or `src/main/resources/mapper/**` | MyBatis |
| `mybatis-config.xml` | MyBatis |
| `**/*.graphqls` or `**/*.graphql` or `**/*.gql` | GraphQL SDL schema |
| `**/*.proto` (in `src/main/proto/` or similar) | Protobuf |
| `**/*.avsc` | Avro |
| `openapi.yaml`, `openapi.json`, `swagger.yaml`, any YAML/JSON with `openapi:` key | OpenAPI |
| `ebean.xml` or `ebean.properties` | Ebean ORM |
| `jooq-codegen-*.xml` or `*.jooq.xml` | jOOQ codegen config |
| `liquibase.properties` | Liquibase |
| `flyway.conf` | Flyway |

### Stage 3: Annotation and Import Grep

Perform fast text searches across `src/main/java/**/*.java`:

| Pattern to Search | Framework Indicated |
|---|---|
| `@Entity` (with `import javax.persistence` or `import jakarta.persistence`) | JPA/Hibernate/Spring Data JPA/EclipseLink/OpenJPA |
| `@Entity` (with `import io.ebean`) | Ebean ORM |
| `@Document` (with `import org.springframework.data.mongodb`) | Spring Data MongoDB |
| `@Document` (with `import org.springframework.data.elasticsearch`) | Spring Data Elasticsearch |
| `@Table` (with `import org.springframework.data.cassandra`) | Spring Data Cassandra |
| `@Table` (with `import org.springframework.data.relational`) | R2DBC / Spring Data JDBC |
| `@RedisHash` | Spring Data Redis |
| `@Mapper` or `@Select` (with `import org.apache.ibatis`) | MyBatis |
| `extends JpaRepository` or `extends CrudRepository` | Spring Data JPA |
| `extends MongoRepository` | Spring Data MongoDB |
| `extends RedisRepository` | Spring Data Redis |
| `extends CassandraRepository` | Spring Data Cassandra |
| `extends R2dbcRepository` | R2DBC |
| `import org.jooq` | jOOQ |
| `import org.jdbi.v3` or `import org.skife.jdbi` | JDBI |
| `JdbcTemplate` or `NamedParameterJdbcTemplate` | Spring JDBC Template |
| `import java.sql.PreparedStatement` | JDBC Raw |
| `extends org.javalite.activejdbc.Model` | ActiveJDBC |
| `import io.ebean` | Ebean ORM |
| `@SqlQuery` or `@SqlUpdate` | JDBI SQL Object |
| `@MappedSuperclass` or `@Embeddable` | JPA complex inheritance/embedding |
| `@QueryMapping` or `@DgsQuery` | Spring for GraphQL / Netflix DGS |
| `import com.google.protobuf` or `extends GeneratedMessageV3` | Protobuf |
| `extends SpecificRecord` | Avro (generated) |
| `@JsonProperty` (dense presence) | Jackson DTOs as entity signals |

### Stage 4: Directory Structure Heuristics

| Directory / Path | Suggests |
|---|---|
| `src/main/resources/db/migration/` | Flyway |
| `src/main/resources/db/changelog/` | Liquibase |
| `src/main/resources/mapper/` or `src/main/resources/mybatis/` | MyBatis |
| `src/main/proto/` | Protobuf |
| `src/main/avro/` | Avro |
| `src/main/resources/graphql/` | GraphQL |
| `src/main/resources/openapi/` or `src/main/resources/swagger/` | OpenAPI |
| Package named `*.domain.*` or `*.entity.*` or `*.model.*` | Likely contains entity classes |
| Package named `*.repository.*` or `*.dao.*` or `*.mapper.*` | Likely contains data access layer |
| Package named `*.dto.*` or `*.request.*` or `*.response.*` | Likely contains DTO classes |
| Generated source dir: `target/generated-sources/` or `build/generated/` | Check for jOOQ / Querydsl / Protobuf / Avro generated code |

### Stage 5: Detection Priority and Combination Strategy

Multiple frameworks co-existing in the same project is common. Use this priority ordering for the authoritative table list:

1. **Migration files (Flyway / Liquibase)** — highest authority for relational schema; if present, these define the ground truth for table names and columns.
2. **JPA / Hibernate / Spring Data JPA annotations** — second authority for relational; cross-validate with migrations if both are present.
3. **jOOQ generated classes** — if committed, these reflect the exact schema the codegen ran against.
4. **MyBatis / iBatis mapper XML** — extract table names from SQL in resultMap and statement SQL bodies.
5. **Spring JDBC Template / JDBC Raw / JDBI** — extract from SQL string literals; treat as supplemental (fragile).
6. **NoSQL framework annotations** (`@Document`, `@RedisHash`, `@Table` Cassandra) — orthogonal to relational; maintain separate entity lists per database type.
7. **GraphQL / Protobuf / Avro / OpenAPI schemas** — logical entities; cross-reference to persistence-layer entities to map API types to storage.
8. **DTO classes / validation annotations** — lowest authority; use as supplemental signals to fill gaps or confirm field names.

### Stage 6: Output Schema

For each detected entity, produce a record with:

```
{
  "name": "table_or_collection_name",
  "logical_name": "JavaClassName",
  "type": "relational_table | document_collection | redis_hash | elasticsearch_index | cassandra_table | graphql_type | protobuf_message | avro_record | view | api_schema",
  "database": "postgresql | mysql | mongodb | redis | elasticsearch | cassandra | ...",
  "source_framework": "JPA/Hibernate | Spring Data JPA | MyBatis | jOOQ | Flyway | ...",
  "source_file": "path/to/Entity.java or V001__create_users.sql",
  "fields": [
    {
      "name": "column_or_field_name",
      "java_name": "javaFieldName",
      "type": "String | Long | ...",
      "constraints": ["NOT NULL", "UNIQUE", "PRIMARY KEY"],
      "annotations": ["@Column", "@NotNull", "@JsonProperty"]
    }
  ],
  "relationships": [
    {
      "type": "ManyToOne | OneToMany | OneToOne | ManyToMany",
      "target_entity": "OtherEntity",
      "join_column": "other_entity_id"
    }
  ]
}
```
