# C# (.NET) Data Entity Storage Methods

A comprehensive catalog of data entity storage frameworks, libraries, and approaches used in C# (.NET) projects. Intended to support automated static analysis of C# repositories for extracting data entities (database tables, document collections, etc.).

---

## Table of Contents

1. [Entity Framework Core (Code-First)](#1-entity-framework-core-code-first)
2. [EF Core – OnModelCreating / Fluent API](#2-ef-core--onmodelcreating--fluent-api)
3. [EF Core – Data Annotations](#3-ef-core--data-annotations)
4. [EF Core Migrations (Snapshot & Migration Files)](#4-ef-core-migrations-snapshot--migration-files)
5. [EF Core – Database-First (Scaffolded Models)](#5-ef-core--database-first-scaffolded-models)
6. [Entity Framework 6 (Classic EF)](#6-entity-framework-6-classic-ef)
7. [Dapper](#7-dapper)
8. [NHibernate](#8-nhibernate)
9. [LLBLGen Pro](#9-llblgen-pro)
10. [LINQ to SQL (DataContext)](#10-linq-to-sql-datacontext)
11. [ServiceStack OrmLite](#11-servicestack-ormlite)
12. [PetaPoco](#12-petapoco)
13. [Massive](#13-massive)
14. [Simple.Data](#14-simpledata)
15. [Raw ADO.NET](#15-raw-adonet)
16. [MongoDB.Driver](#16-mongodbdriver)
17. [MongoDB with MongoDbContext Pattern](#17-mongodb-with-mongodbcontext-pattern)
18. [Redis (StackExchange.Redis)](#18-redis-stackexchangeredis)
19. [Elasticsearch – NEST / Elastic.Clients.Elasticsearch](#19-elasticsearch--nest--elasticclientselasticsearch)
20. [Apache Cassandra (DataStax Driver)](#20-apache-cassandra-datastax-driver)
21. [Azure Cosmos DB SDK](#21-azure-cosmos-db-sdk)
22. [Azure Table Storage](#22-azure-table-storage)
23. [AWS DynamoDB (AWSSDK.DynamoDBv2)](#23-aws-dynamodb-awssdkdynamodbv2)
24. [Marten (Document DB on PostgreSQL)](#24-marten-document-db-on-postgresql)
25. [RavenDB Client](#25-ravendb-client)
26. [DbUp (SQL Migration Files)](#26-dbup-sql-migration-files)
27. [FluentMigrator](#27-fluentmigrator)
28. [RoundhousE](#28-roundhouse)
29. [Stored Procedures and Views (SQL Files)](#29-stored-procedures-and-views-sql-files)
30. [GraphQL Schema Files](#30-graphql-schema-files)
31. [Protobuf (.proto Files)](#31-protobuf-proto-files)
32. [OpenAPI / Swagger Specs](#32-openapi--swagger-specs)
33. [Record Types and DTOs as Entity Signals](#33-record-types-and-dtos-as-entity-signals)
34. [AutoMapper Profiles as Entity Signals](#34-automapper-profiles-as-entity-signals)
35. [Repository Detection Plan](#35-repository-detection-plan)

---

## 1. Entity Framework Core (Code-First)

- **Name**: Entity Framework Core (Code-First via DbContext)
- **Type**: Relational ORM
- **Supported Databases**: SQL Server, PostgreSQL (Npgsql), MySQL (Pomelo/Oracle), SQLite, Oracle, Cosmos DB (limited), In-Memory (testing)
- **Detection Signals**:
  - NuGet packages: `Microsoft.EntityFrameworkCore`, `Microsoft.EntityFrameworkCore.SqlServer`, `Microsoft.EntityFrameworkCore.Sqlite`, `Npgsql.EntityFrameworkCore.PostgreSQL`, `Pomelo.EntityFrameworkCore.MySql`, `Oracle.EntityFrameworkCore`
  - Namespaces: `using Microsoft.EntityFrameworkCore;`
  - Class pattern: `class XyzContext : DbContext` or `: IdentityDbContext<T>`
  - Properties: `public DbSet<EntityName> EntityName { get; set; }` inside a `DbContext` subclass
  - Config: connection strings in `appsettings.json` under `"ConnectionStrings"`, `DbContextOptions` in `Program.cs`/`Startup.cs`
- **Entity Definition Style**: POCO classes with no required base class; registered via `DbSet<T>` properties on the `DbContext`; table name defaults to the `DbSet` property name or class name (pluralization via `IPluralizationService`)
- **Extraction Approach**:
  1. Locate all `.cs` files containing a class that inherits from `DbContext` (or `IdentityDbContext`, `PooledDbContext`, etc.) — search for `: DbContext`, `: IdentityDbContext`, `: PooledDbContextFactory`.
  2. Parse the class body for all `DbSet<T>` properties. The generic type argument `T` is the entity class name; the property name is the default table name.
  3. For each entity type `T`, locate the class definition in the codebase.
  4. Record class name (logical entity name) and any `[Table("actual_name")]` annotation to get the physical table name.
  5. Record all public properties — these map to columns unless explicitly ignored.
  6. Cross-reference `OnModelCreating` (see section 2) for Fluent API overrides.
  7. Walk base classes for inherited properties (TPH/TPT/TPC scenarios).
- **Key Challenges**:
  - **TPH (Table-Per-Hierarchy)**: single table for an entire inheritance tree; only the root entity is in `DbSet`; derived types map to the same table. Requires walking the inheritance hierarchy.
  - **TPT (Table-Per-Type)**: each type in hierarchy maps to its own table. Look for `.ToTable()` on derived types in `OnModelCreating`.
  - **TPC (Table-Per-Concrete-Type)**: EF Core 7+; each concrete class has its own table with all columns.
  - **Owned Entities**: `OwnsOne`/`OwnsMany` — owned type columns are embedded in the owner's table; not a separate `DbSet`.
  - **Shadow Properties**: properties defined only in `OnModelCreating` via `modelBuilder.Entity<T>().Property<string>("PropertyName")` — not visible in the POCO class.
  - **Value Objects / Owned Types**: may not have explicit `DbSet`.
  - **Dynamic `DbSet`**: `context.Set<T>()` called at runtime — not statically discoverable.
  - **Multi-tenancy**: same POCO may map to different tables via table-per-tenant strategies.
- **Analysis Tools**: Roslyn (`Microsoft.CodeAnalysis.CSharp`) for semantic/syntactic analysis; tree-sitter C# grammar for lightweight parsing; `dotnet-script` for dynamic loading (risky in static analysis)
- **Complexity**: Medium

---

## 2. EF Core – OnModelCreating / Fluent API

- **Name**: EF Core Fluent API (OnModelCreating)
- **Type**: Relational ORM (configuration layer)
- **Supported Databases**: Same as EF Core
- **Detection Signals**:
  - Method override: `protected override void OnModelCreating(ModelBuilder modelBuilder)`
  - Patterns: `modelBuilder.Entity<T>()`, `modelBuilder.Entity<T>().ToTable("name")`, `modelBuilder.Entity<T>().HasKey(...)`, `IEntityTypeConfiguration<T>` implementations
  - Separate configuration files: classes implementing `IEntityTypeConfiguration<T>` with `modelBuilder.ApplyConfiguration(...)` or `modelBuilder.ApplyConfigurationsFromAssembly(...)`
- **Entity Definition Style**: No attributes needed on POCOs; all mapping configured programmatically in `OnModelCreating` or `IEntityTypeConfiguration<T>` classes
- **Extraction Approach**:
  1. Find all `OnModelCreating` method bodies in `DbContext` subclasses.
  2. Parse invocations of `modelBuilder.Entity<T>()` — collect all `T` type arguments as entity names.
  3. Parse `.ToTable("tableName")` calls to extract physical table name overrides.
  4. Parse `.ToTable("tableName", "schemaName")` for schema-qualified names.
  5. Find all classes implementing `IEntityTypeConfiguration<T>` — collect `T` as entity names; look for `builder.ToTable(...)` inside `Configure(EntityTypeBuilder<T> builder)` methods.
  6. Check for `modelBuilder.ApplyConfigurationsFromAssembly(...)` — means configuration classes are spread across the assembly; glob for all `IEntityTypeConfiguration<T>` implementations.
  7. Look for `modelBuilder.Ignore<T>()` — these classes are explicitly excluded.
  8. Look for `OwnsOne`/`OwnsMany` — nested owned types embedded in a parent table.
- **Key Challenges**:
  - `ApplyConfigurationsFromAssembly` means config classes may be in any file — must scan entire project.
  - Chained Fluent API calls can span many lines; requires AST traversal, not regex.
  - `.HasDiscriminator()` reveals TPH setups.
  - Dynamic string table names (e.g., built from tenant ID) are not statically resolvable.
- **Analysis Tools**: Roslyn for method invocation analysis; tree-sitter for quick pattern matching
- **Complexity**: High

---

## 3. EF Core – Data Annotations

- **Name**: EF Core Data Annotations
- **Type**: Relational ORM (annotation-based configuration)
- **Supported Databases**: Same as EF Core
- **Detection Signals**:
  - Namespace: `using System.ComponentModel.DataAnnotations;`, `using System.ComponentModel.DataAnnotations.Schema;`
  - Attributes on classes: `[Table("TableName")]`, `[Table("TableName", Schema = "dbo")]`
  - Attributes on properties: `[Key]`, `[Column("column_name")]`, `[Column("column_name", TypeName = "varchar(100)")]`, `[NotMapped]`, `[ForeignKey("...")]`, `[Index(...)]` (EF Core 5+), `[DatabaseGenerated(...)]`
  - `[Keyless]` on entity classes (EF Core 5+)
- **Entity Definition Style**: Attributes directly on POCO class and property declarations
- **Extraction Approach**:
  1. Scan all `.cs` files for class declarations decorated with `[Table(...)]` or any `[Key]`/`[Column]` attributes on their properties.
  2. For each class with `[Table("name")]`, record the physical table name.
  3. For classes without `[Table]` that appear as `DbSet<T>` generics, default table name = `DbSet` property name or class name (EF pluralization).
  4. Enumerate all public properties not marked `[NotMapped]` or `virtual` navigation-only — these are column candidates.
  5. For `[Column("name")]`, record the column alias.
  6. Detect `[Key]` to identify primary key columns.
  7. Detect `[ForeignKey]` and navigation properties to identify relationships.
- **Key Challenges**:
  - Inherited attributes (base class has `[Table]`, derived does not).
  - `[NotMapped]` can be on class or property — both must be handled.
  - `[ComplexType]` (EF 6) vs owned entities (EF Core) — different semantics.
  - Attributes from both `System.ComponentModel.DataAnnotations.Schema` and `Microsoft.EntityFrameworkCore` namespaces may coexist.
- **Analysis Tools**: Roslyn `AttributeSyntax` traversal; tree-sitter attribute node matching
- **Complexity**: Low

---

## 4. EF Core Migrations (Snapshot & Migration Files)

- **Name**: EF Core Migrations
- **Type**: Migration Tool / Schema Source of Truth
- **Supported Databases**: Same as EF Core
- **Detection Signals**:
  - Folder: `Migrations/` directory in the project (conventional location)
  - File: `*ModelSnapshot.cs` — contains `BuildModel(ModelBuilder modelBuilder)` with the full schema
  - File: `YYYYMMDDHHMMSS_MigrationName.cs` — individual migration files with `Up(MigrationBuilder migrationBuilder)` and `Down(...)` methods
  - Class base: `: Migration` (from `Microsoft.EntityFrameworkCore.Migrations`)
  - NuGet: `Microsoft.EntityFrameworkCore.Design`, `Microsoft.EntityFrameworkCore.Tools`
  - CLI artefacts: `efpt.config.json` (EF Power Tools), `scaffold-dbcontext` output markers
- **Entity Definition Style**: Auto-generated C# code representing the full model state and incremental schema changes
- **Extraction Approach**:
  1. Locate the `*ModelSnapshot.cs` file — this is the authoritative current schema.
  2. Parse `BuildModel(ModelBuilder modelBuilder)` — extract `modelBuilder.Entity<T>(b => { b.ToTable("name"); b.Property<type>("col"); ... })` calls.
  3. For each entity block, extract: entity type name, table name (`.ToTable`), schema (`.ToTable("t","schema")`), columns (`.Property<T>("name")`), primary keys (`.HasKey`), indexes (`.HasIndex`).
  4. Alternatively, parse individual migration files to reconstruct schema history — look for `migrationBuilder.CreateTable(name: "TableName", columns: ...)` in `Up()` methods.
  5. `CreateTable` lambda yields column names and types directly.
  6. `RenameTable`, `DropTable`, `AddColumn`, `DropColumn`, `RenameColumn` track incremental changes.
- **Key Challenges**:
  - Snapshot may be out of sync with actual migrations (developer error).
  - Multiple `DbContext` classes = multiple snapshot files in different folders.
  - `migrationBuilder.Sql("CREATE TABLE ...")` — raw SQL migrations are not structured.
  - EF Core 6+ compile-time model snapshots may use source generators.
- **Analysis Tools**: Roslyn; tree-sitter; direct string/regex on well-structured migration output
- **Complexity**: Medium

---

## 5. EF Core – Database-First (Scaffolded Models)

- **Name**: EF Core Database-First / Scaffolded Models
- **Type**: Relational ORM (reverse-engineered)
- **Supported Databases**: Same as EF Core
- **Detection Signals**:
  - Comment header in generated files: `// <auto-generated />` or `// This code was generated by...`
  - File name pattern: scaffolded `DbContext` often named `*Context.cs` with large `OnModelCreating`
  - All entity classes in same folder with matching `[Table]` annotations and Fluent API in context
  - NuGet: `Microsoft.EntityFrameworkCore.Design`, provider-specific scaffold packages
  - `dotnet ef dbcontext scaffold` command evidence in scripts/CI
- **Entity Definition Style**: Auto-generated POCOs with `[Table]`, `[Column]`, `[Key]` annotations plus Fluent API — same as code-first but generated from DB schema
- **Extraction Approach**: Same as EF Core Code-First (sections 1–3); the scaffolded output is syntactically identical to hand-written code-first models
- **Key Challenges**:
  - Generated files may be regenerated on each run, overwriting manual customizations.
  - Partial classes used to extend generated code — need to merge both halves.
  - View scaffolding produces `[Keyless]` entities that are not tables.
- **Analysis Tools**: Roslyn; tree-sitter
- **Complexity**: Low (structurally same as code-first)

---

## 6. Entity Framework 6 (Classic EF)

- **Name**: Entity Framework 6
- **Type**: Relational ORM
- **Supported Databases**: SQL Server, MySQL (MySql.Data.EntityFramework), PostgreSQL (EntityFramework6.Npgsql), Oracle (Oracle.ManagedDataAccess.EntityFramework), SQLite
- **Detection Signals**:
  - NuGet packages: `EntityFramework` (version 6.x), `EntityFramework.SqlServerCompact`, `MySql.Data.EntityFramework`, `Oracle.ManagedDataAccess.EntityFramework`
  - Namespace: `using System.Data.Entity;`
  - Class base: `: DbContext` (from `System.Data.Entity`)
  - `DbSet<T>` properties (same as EF Core)
  - `App.config` or `Web.config` connection strings (not `appsettings.json`)
  - `<entityFramework>` XML section in `App.config`/`Web.config`
  - EDMX files: `*.edmx` — XML-based entity model (Model-First/Database-First)
  - `*.tt` T4 templates generating entity classes from EDMX
- **Entity Definition Style**:
  - **Code-First**: same `DbSet<T>` + `OnModelCreating` pattern as EF Core
  - **Model-First / Database-First**: EDMX XML files with `<EntityType>`, `<EntityContainer>`, `<EntitySet>` elements
- **Extraction Approach**:
  1. **Code-First path**: Same as EF Core (sections 1–3) but with `System.Data.Entity` namespace.
  2. **EDMX path**: Parse `*.edmx` files (XML). Look for:
     - `<edmx:Edmx>` root → `<edmx:Runtime>` → `<edmx:ConceptualModels>` → `<Schema>` → `<EntityType Name="...">` and `<EntityContainer>` → `<EntitySet Name="..." EntityType="...">`.
     - `<Property Name="..." Type="..." Nullable="..." />` inside `<EntityType>` for columns.
     - `<StorageModels>` → `<EntityType>` for the physical table mapping.
  3. **T4 templates** (`*.tt`): skip — they generate code; focus on the EDMX.
  4. Check `App.config`/`Web.config` `<connectionStrings>` for database names.
- **Key Challenges**:
  - EDMX has three layers (Conceptual/Storage/Mapping); need to reconcile all three for physical table names.
  - `ComplexType` in EF 6 maps columns into the owning entity's table.
  - T4-generated code may differ from what the EDMX describes if templates were customized.
- **Analysis Tools**: Roslyn (code-first); XmlDocument/XPath or `System.Xml.Linq` patterns for EDMX; tree-sitter
- **Complexity**: Medium (code-first) / High (EDMX)

---

## 7. Dapper

- **Name**: Dapper
- **Type**: Micro-ORM / Raw SQL with POCO mapping
- **Supported Databases**: Any ADO.NET provider (SQL Server, PostgreSQL, MySQL, SQLite, Oracle, etc.)
- **Detection Signals**:
  - NuGet packages: `Dapper`, `Dapper.Contrib`, `Dapper.FluentMap`, `Dapper.Extensions`, `DapperExtensions`, `Dapper.SimpleCRUD`
  - Namespace: `using Dapper;`
  - API calls: `connection.Query<T>(...)`, `connection.QueryAsync<T>(...)`, `connection.Execute(...)`, `connection.QueryFirst<T>(...)`, `connection.QuerySingle<T>(...)`, `connection.QueryMultiple(...)`
  - Dapper.Contrib attributes: `[Table("name")]`, `[Key]`, `[ExplicitKey]`, `[Computed]`, `[Write(false)]` from `Dapper.Contrib.Extensions`
- **Entity Definition Style**: Plain POCO classes; table name inferred from class name (or via `[Table]` attribute with Dapper.Contrib); SQL queries embedded in C# strings
- **Extraction Approach**:
  1. Find all `[Table("name")]` attributes from `Dapper.Contrib.Extensions` namespace — these are explicit entity-to-table mappings.
  2. Find all usages of `connection.Query<T>`, `QueryAsync<T>`, etc. — collect `T` type arguments as candidate entity classes. The SQL string in the first argument may contain the table name.
  3. Parse SQL string literals passed to Dapper calls — extract `FROM table_name`, `JOIN table_name`, `INSERT INTO table_name`, `UPDATE table_name` patterns using SQL regex.
  4. Find `SqlMapper.SetTypeMap(typeof(T), ...)` or `FluentMapper.Initialize(...)` for custom mappings.
  5. Enumerate POCOs that appear as Dapper generic type arguments — these are likely entity classes.
- **Key Challenges**:
  - Table names are embedded in SQL strings — requires SQL parsing or regex, not AST.
  - SQL strings may be in constants, resource files, or loaded from external files.
  - Stored procedure calls obscure the underlying table (`connection.Query<T>("sp_name", commandType: CommandType.StoredProcedure)`).
  - Dynamic SQL (string concatenation, `StringBuilder`) is not statically extractable.
  - Multi-mapping: `Query<T1, T2, TReturn>(...)` yields multiple entity types per call.
- **Analysis Tools**: Roslyn for generic type argument extraction; regex for SQL table name extraction; dedicated SQL parser (e.g., `TSql150Parser` from `Microsoft.SqlServer.TransactSql.ScriptDom`) for precise SQL analysis
- **Complexity**: High

---

## 8. NHibernate

- **Name**: NHibernate
- **Type**: Relational ORM
- **Supported Databases**: SQL Server, PostgreSQL, MySQL, Oracle, SQLite, Firebird, DB2
- **Detection Signals**:
  - NuGet packages: `NHibernate`, `FluentNHibernate`
  - Namespaces: `using NHibernate;`, `using NHibernate.Mapping.Attributes;`, `using FluentNHibernate.Mapping;`
  - XML mapping files: `*.hbm.xml` (naming convention: `EntityName.hbm.xml`)
  - Class patterns: `: ClassMap<T>` (FluentNHibernate), `: SubclassMap<T>`, `: ComponentMap<T>`
  - Attributes: `[Class]`, `[Table]`, `[Id]`, `[Property]`, `[ManyToOne]`, `[Bag]` from `NHibernate.Mapping.Attributes`
  - Config files: `hibernate.cfg.xml`, `NHibernate.cfg.xml`
- **Entity Definition Style**:
  - **XML Mapping**: `<class name="EntityName" table="table_name">` in `*.hbm.xml` files
  - **Fluent NHibernate**: `ClassMap<T>` subclasses with `Table("name")`, `Map(x => x.Prop)` calls
  - **Attribute Mapping**: `[Class(Table = "table_name")]` on POCO class
- **Extraction Approach**:
  1. **XML path**: Glob for `*.hbm.xml`. Parse XML — `<class name="..." table="...">` gives entity class and table name. `<property name="..." column="..."/>` gives columns. `<subclass>`, `<joined-subclass>` for inheritance.
  2. **FluentNHibernate path**: Find all classes inheriting `: ClassMap<T>`. Parse constructor body for `Table("name")` calls; default table name = `T` class name. Parse `Map(x => x.Prop).Column("col_name")` for column mappings.
  3. **Attribute path**: Find classes with `[Class]` or `[Class(Table="...")]` attributes. Parse properties with `[Property]`, `[Id]`, etc.
  4. Check `hibernate.cfg.xml` / `NHibernate.cfg.xml` for database dialect and connection string.
- **Key Challenges**:
  - Mix of XML and Fluent/Attribute mappings in the same project.
  - `<component>` elements (value objects) are embedded in the parent table — not separate entities.
  - `<subclass>` (TPH) vs `<joined-subclass>` (TPT) vs `<union-subclass>` (TPC) — different table implications.
  - Lazy loading proxies may obscure real entity types at analysis time.
  - `AbstractClassMap<T>` intermediary base classes used for DRY configuration.
- **Analysis Tools**: XPath/`System.Xml.Linq` for `.hbm.xml`; Roslyn for FluentNHibernate and attribute mapping
- **Complexity**: High

---

## 9. LLBLGen Pro

- **Name**: LLBLGen Pro
- **Type**: Relational ORM / Code Generator
- **Supported Databases**: SQL Server, PostgreSQL, MySQL, Oracle, Firebird, DB2
- **Detection Signals**:
  - NuGet packages: `SD.LLBLGen.Pro.ORMSupportClasses`, `SD.LLBLGen.Pro.DQE.*` (database-specific query engine)
  - Namespaces: `using SD.LLBLGen.Pro.ORMSupportClasses;`, `using SD.LLBLGen.Pro.QuerySpec;`
  - Designer file: `*.llblgenproj` — project file for the LLBLGen Pro designer
  - Generated code patterns: classes inheriting `EntityBase2`, fields named `<EntityName>Fields`, `EntityFactory` classes
  - Metadata classes: `<EntityName>Fields` enum-like static class with field descriptors
- **Entity Definition Style**: Generated POCO-like classes inheriting `EntityBase2`; schema defined in `*.llblgenproj` designer file (XML); table/column names in field metadata classes
- **Extraction Approach**:
  1. Parse `*.llblgenproj` file (XML format) — contains full schema: `<Entity name="..." tableName="...">` elements.
  2. Alternatively, scan generated code for classes inheriting `EntityBase2` — class names correspond to entities.
  3. Examine `<EntityName>Fields` metadata class for column names.
  4. Look for `EntityFactory` registrations.
- **Key Challenges**:
  - LLBLGen Pro is a designer-first tool; source of truth is the `.llblgenproj` file, not the generated code.
  - Generated code may be excluded from VCS — only the designer file may be present.
- **Analysis Tools**: XPath for `.llblgenproj`; Roslyn for generated code analysis
- **Complexity**: Medium

---

## 10. LINQ to SQL (DataContext)

- **Name**: LINQ to SQL
- **Type**: Relational ORM (legacy)
- **Supported Databases**: SQL Server only
- **Detection Signals**:
  - NuGet / assembly: `System.Data.Linq` (part of .NET Framework; `System.Data.Linq` NuGet for .NET Core)
  - Namespace: `using System.Data.Linq;`, `using System.Data.Linq.Mapping;`
  - Class base: `: DataContext`
  - Properties: `public Table<T> TableName` inside `DataContext` subclass
  - Attributes: `[Table(Name = "dbo.TableName")]` on entity class, `[Column(Name = "col", IsPrimaryKey = true)]` on properties
  - Designer files: `*.dbml` — XML schema file; `*.designer.cs` — generated code
- **Entity Definition Style**: POCOs with `[Table]` and `[Column]` attributes; or auto-generated from `*.dbml`
- **Extraction Approach**:
  1. **DBML path**: Parse `*.dbml` (XML). `<Table Name="dbo.TableName" Member="PropertyName">` → `<Type Name="EntityClass">` → `<Column Name="..." Member="..." IsPrimaryKey="..." />`.
  2. **Code path**: Find `DataContext` subclasses. Enumerate `Table<T>` properties — `T` is the entity. Find classes with `[Table(Name="...")]`.
  3. Combine both approaches for completeness.
- **Key Challenges**:
  - DBML and `*.designer.cs` may be out of sync.
  - LINQ to SQL is .NET Framework only (no .NET Core support without compatibility package).
  - Inheritance mapping via `[InheritanceMapping]` attribute on base class.
- **Analysis Tools**: XPath for DBML; Roslyn for C# code
- **Complexity**: Low

---

## 11. ServiceStack OrmLite

- **Name**: ServiceStack OrmLite
- **Type**: Micro-ORM
- **Supported Databases**: SQL Server, PostgreSQL, MySQL, SQLite, Oracle, Firebird
- **Detection Signals**:
  - NuGet packages: `ServiceStack.OrmLite`, `ServiceStack.OrmLite.SqlServer`, `ServiceStack.OrmLite.PostgreSQL`, `ServiceStack.OrmLite.MySql`, `ServiceStack.OrmLite.Sqlite`
  - Namespace: `using ServiceStack.OrmLite;`, `using ServiceStack.DataAnnotations;`
  - Attributes: `[Alias("table_name")]` (on class = table alias), `[Alias("col_name")]` (on property = column alias), `[PrimaryKey]`, `[AutoIncrement]`, `[Index]`, `[Ignore]`, `[References(typeof(OtherEntity))]`
  - API calls: `db.CreateTable<T>()`, `db.Select<T>()`, `db.Insert<T>()`, `db.Update<T>()`, `db.Delete<T>()`, `db.TableExists<T>()`
- **Entity Definition Style**: POCO classes; table name defaults to class name; `[Alias]` overrides; `[Alias]` on property overrides column name
- **Extraction Approach**:
  1. Find all classes with `[Alias("...")]` from `ServiceStack.DataAnnotations` — the attribute value is the table name; class name is the entity name.
  2. Find all type arguments `T` in `db.CreateTable<T>()`, `db.Select<T>()`, etc. — these are entity classes.
  3. Enumerate public properties of entity classes, noting `[Alias]` for column names and `[Ignore]` for excluded columns.
- **Key Challenges**:
  - Without `[Alias]`, table name = class name (case-sensitive or dialect-specific naming).
  - `OrmLiteConfig.DialectProvider.NamingStrategy` can globally alter table/column naming.
  - Inheritance is generally not supported — flat POCO model expected.
- **Analysis Tools**: Roslyn; tree-sitter
- **Complexity**: Low

---

## 12. PetaPoco

- **Name**: PetaPoco
- **Type**: Micro-ORM
- **Supported Databases**: SQL Server, MySQL, PostgreSQL, SQLite, Oracle (via provider)
- **Detection Signals**:
  - NuGet packages: `PetaPoco`, `PetaPoco.Compiled`, `AsyncPoco`
  - Namespace: `using PetaPoco;`
  - Attributes: `[TableName("table_name")]` on class, `[PrimaryKey("id")]` on class, `[Column("col_name")]` on property, `[Ignore]` on property, `[ResultColumn]` on property
  - API calls: `db.Fetch<T>(sql)`, `db.Query<T>(sql)`, `db.Insert(poco)`, `db.Update(poco)`, `db.Delete<T>()`
- **Entity Definition Style**: POCO with optional `[TableName]`/`[PrimaryKey]` class-level attributes; without attributes, table name = class name
- **Extraction Approach**:
  1. Find classes with `[TableName("name")]` — explicit table mapping.
  2. Find generic type arguments in `db.Fetch<T>`, `db.Query<T>`, etc. — `T` is an entity candidate.
  3. For classes without `[TableName]`, table name defaults to class name.
  4. Parse properties for `[Column]`, `[Ignore]`, `[ResultColumn]`.
  5. Extract SQL string literals in PetaPoco calls for additional table references.
- **Key Challenges**:
  - SQL strings may name tables not otherwise identifiable.
  - `Sql` builder object (`Sql.Builder.Append(...)`) makes SQL extraction harder than raw strings.
  - Multi-POCO mapping (`db.Fetch<T1, T2, TReturn>`) yields multiple types.
- **Analysis Tools**: Roslyn; regex for SQL string analysis
- **Complexity**: Medium

---

## 13. Massive

- **Name**: Massive
- **Type**: Dynamic Micro-ORM
- **Supported Databases**: SQL Server, PostgreSQL, MySQL (provider-specific forks)
- **Detection Signals**:
  - NuGet package: `Massive` (or embedded as a single `Massive.cs` file)
  - Class pattern: `class MyTable : DynamicModel` — subclass of `DynamicModel`
  - Constructor call: `base(tableName: "my_table", primaryKeyField: "id")`
- **Entity Definition Style**: Subclass of `DynamicModel` with table name passed as constructor argument; uses `dynamic` objects instead of typed POCOs
- **Extraction Approach**:
  1. Find all classes inheriting from `DynamicModel`.
  2. Parse constructor bodies for `base(tableName: "name", ...)` or positional string arguments — this is the table name.
  3. Note: no typed entity classes — `dynamic` is used; column names are not statically discoverable.
- **Key Challenges**:
  - `dynamic` returns mean no compile-time column structure is available.
  - Table name may be a runtime variable, not a literal string.
  - Often embedded as a single `.cs` file with no NuGet reference.
- **Analysis Tools**: Roslyn for constructor argument analysis
- **Complexity**: Medium

---

## 14. Simple.Data

- **Name**: Simple.Data
- **Type**: Dynamic Micro-ORM
- **Supported Databases**: SQL Server, MySQL, PostgreSQL, SQLite, MongoDB (adapter-based)
- **Detection Signals**:
  - NuGet packages: `Simple.Data.Core`, `Simple.Data.SqlServer`, `Simple.Data.Ado`
  - Namespace: `using Simple.Data;`
  - API pattern: `Database.Open()`, `db.TableName.FindAll(...)`, `db.TableName.Insert(...)` — table names used as dynamic member access
- **Entity Definition Style**: Fully dynamic — table names accessed as properties on the `Database` object (`db.Customers`, `db.Orders`); no entity class definitions required
- **Extraction Approach**:
  1. Find `Database.Open()` / `Database.OpenConnection()` calls.
  2. Track the result variable (e.g., `var db = Database.Open()`).
  3. Find all dynamic member accesses on that variable — `db.<MemberName>` — each `MemberName` is a table name candidate.
  4. Note: this requires data-flow analysis (tracking the `db` variable across methods/closures), which is non-trivial statically.
- **Key Challenges**:
  - Fully dynamic — no typed entities at all.
  - Member access on `dynamic` is invisible to Roslyn's semantic model.
  - `Database` object may be passed as a parameter; cross-method tracking needed.
- **Analysis Tools**: Roslyn syntactic analysis for member access patterns; manual heuristics
- **Complexity**: High

---

## 15. Raw ADO.NET

- **Name**: Raw ADO.NET
- **Type**: Raw SQL
- **Supported Databases**: Any ADO.NET provider (SQL Server via `System.Data.SqlClient`/`Microsoft.Data.SqlClient`, PostgreSQL via `Npgsql`, MySQL via `MySql.Data`, etc.)
- **Detection Signals**:
  - Namespaces: `using System.Data;`, `using System.Data.SqlClient;`, `using Microsoft.Data.SqlClient;`, `using Npgsql;`, `using MySql.Data.MySqlClient;`
  - Types: `SqlConnection`, `SqlCommand`, `SqlDataReader`, `SqlDataAdapter`, `NpgsqlConnection`, `MySqlConnection`, `OleDbConnection`, `OdbcConnection`, `DbConnection`, `IDbConnection`
  - Method calls: `new SqlCommand("SELECT ... FROM table_name", conn)`, `cmd.CommandText = "..."`, `new SqlDataAdapter("SELECT ...", conn)`
  - `CommandType.Text` vs `CommandType.StoredProcedure`
- **Entity Definition Style**: No entity classes required; SQL strings reference table names directly; result sets often mapped to `DataTable`, `DataSet`, or POCOs via manual column reads
- **Extraction Approach**:
  1. Find all `new SqlCommand(...)` / `new NpgsqlCommand(...)` etc. constructor calls and `cmd.CommandText = "..."` assignments.
  2. Extract SQL string literals (and concatenated strings where possible).
  3. Apply SQL parsing / regex to extract table names from `FROM`, `JOIN`, `INSERT INTO`, `UPDATE`, `DELETE FROM` clauses.
  4. Find `new SqlDataAdapter(sql, conn)` — similar extraction.
  5. Look for `cmd.CommandType = CommandType.StoredProcedure` + `cmd.CommandText = "sp_name"` to identify stored procedure usage.
  6. Track `DataTable` / `DataSet` usage to identify result shape (limited — no column type info).
- **Key Challenges**:
  - SQL may be assembled via string concatenation, `StringBuilder`, or string interpolation — partially unresolvable statically.
  - SQL stored in constants, resource files (`.resx`), embedded XML, or external `.sql` files.
  - `CommandType.StoredProcedure` hides actual table names behind procedure names.
  - Parameterized queries with `@tableName` (rare but possible) are not resolvable.
- **Analysis Tools**: Roslyn for string literal extraction; `Microsoft.SqlServer.TransactSql.ScriptDom` (T-SQL parser) or `SqlParser` libraries for SQL analysis; regex as fallback
- **Complexity**: High

---

## 16. MongoDB.Driver

- **Name**: MongoDB.Driver (official C# driver)
- **Type**: NoSQL (Document Database)
- **Supported Databases**: MongoDB
- **Detection Signals**:
  - NuGet packages: `MongoDB.Driver`, `MongoDB.Bson`
  - Namespaces: `using MongoDB.Driver;`, `using MongoDB.Bson;`, `using MongoDB.Bson.Serialization.Attributes;`
  - Types: `IMongoCollection<T>`, `MongoClient`, `IMongoDatabase`, `BsonDocument`
  - Attributes on classes/properties: `[BsonElement("field_name")]`, `[BsonId]`, `[BsonIgnore]`, `[BsonRepresentation(...)]`, `[BsonDiscriminator("type_name")]`, `[BsonKnownTypes(...)]`
  - Class-level attribute: `[BsonCollection("collection_name")]` (custom convention — not in official driver; see class map approach)
  - API calls: `database.GetCollection<T>("collection_name")`, `collection.Find<T>(...)`, `collection.InsertOne(...)`, `collection.ReplaceOne(...)`
- **Entity Definition Style**: POCO classes decorated with BSON attributes; collection name passed as string to `GetCollection<T>("name")`; no required base class
- **Extraction Approach**:
  1. Find all `database.GetCollection<T>("collection_name")` calls — `T` is the document class, the string is the collection name.
  2. Track `IMongoDatabase` variable and enumerate all `GetCollection<T>(...)` invocations on it.
  3. Find classes with `[BsonElement]`, `[BsonId]`, etc. on their properties — these are document classes.
  4. Check for `BsonClassMap.RegisterClassMap<T>(...)` calls — explicit registration names may override defaults.
  5. Check for custom `[BsonCollection("name")]` conventions (project-specific attribute pattern common in community code).
  6. Enumerate properties not marked `[BsonIgnore]` as document fields.
- **Key Challenges**:
  - Collection name is a runtime string, not tied to the class itself (unlike relational `[Table]`).
  - Same POCO may be stored in different collections.
  - `BsonDocument` (schema-less) queries have no static type — not extractable.
  - `[BsonDiscriminator]` + `[BsonKnownTypes]` for polymorphic documents.
  - `ConventionPack` can globally alter field naming — not statically discoverable without execution.
- **Analysis Tools**: Roslyn for generic type argument and string literal extraction; attribute scanning
- **Complexity**: High

---

## 17. MongoDB with MongoDbContext Pattern

- **Name**: MongoDB with MongoDbContext (community pattern / MongoFramework)
- **Type**: NoSQL (Document Database) / ORM-like wrapper
- **Supported Databases**: MongoDB
- **Detection Signals**:
  - NuGet packages: `MongoFramework`, `MongoDB.Driver` (dependency)
  - Class base: `: MongoDbContext` (MongoFramework) or custom `MongoContext` base class
  - Properties: `public IMongoCollection<T> CollectionName { get; }` or `public MongoDbSet<T> CollectionName { get; set; }`
  - Attribute: `[Table("collection_name")]` or custom `[MongoCollection("name")]` on entity class
- **Entity Definition Style**: Mirrors EF Core DbContext pattern — `DbSet<T>`-equivalent properties on a context class; entity classes may use `[Table]` or custom attributes
- **Extraction Approach**:
  1. Find classes inheriting from `MongoDbContext` (or similarly named base class).
  2. Enumerate `MongoDbSet<T>` or `IMongoCollection<T>` properties — `T` is entity type, property name is default collection name.
  3. Check entity classes for `[Table("name")]` or `[MongoCollection("name")]` overrides.
  4. Fall back to MongoDB.Driver extraction approach (section 16) for `GetCollection<T>()` calls.
- **Key Challenges**: Same as MongoDB.Driver plus the added complexity of identifying the custom `MongoDbContext` base class pattern, which varies by team convention.
- **Analysis Tools**: Roslyn
- **Complexity**: Medium

---

## 18. Redis (StackExchange.Redis)

- **Name**: StackExchange.Redis
- **Type**: NoSQL (Key-Value Store)
- **Supported Databases**: Redis
- **Detection Signals**:
  - NuGet packages: `StackExchange.Redis`, `Microsoft.Extensions.Caching.StackExchangeRedis`
  - Namespace: `using StackExchange.Redis;`
  - Types: `IDatabase`, `ConnectionMultiplexer`, `IServer`, `RedisKey`, `RedisValue`
  - API calls: `db.StringSet(key, value)`, `db.HashSet(key, ...)`, `db.SetAdd(...)`, `db.SortedSetAdd(...)`, `db.ListPush(...)`
  - Key patterns: string literals or constants used as Redis key prefixes (e.g., `"user:{id}"`, `"session:"`)
- **Entity Definition Style**: Schema-less key-value; no formal entity definitions; POCOs serialized (commonly JSON via `Newtonsoft.Json` or `System.Text.Json`) before storage
- **Extraction Approach**:
  1. Redis has no schema — extraction focuses on identifying which .NET types are serialized and stored.
  2. Find `db.StringSet(key, JsonConvert.SerializeObject(obj))` patterns — `obj` type is the stored entity.
  3. Find `JsonConvert.DeserializeObject<T>(db.StringGet(key))` or `JsonSerializer.Deserialize<T>(...)` — `T` is the stored type.
  4. Extract Redis key string literals/constants as logical "collection" names.
  5. Note: no structural table equivalent — key prefixes serve as pseudo-collection identifiers.
- **Key Challenges**:
  - Schema-less — no tables/collections in the traditional sense.
  - Key construction may be dynamic.
  - Data types (string, hash, list, set, sorted set, stream) affect interpretation.
- **Analysis Tools**: Roslyn for type argument extraction in deserialization calls
- **Complexity**: High (for meaningful entity extraction)

---

## 19. Elasticsearch – NEST / Elastic.Clients.Elasticsearch

- **Name**: NEST / Elastic.Clients.Elasticsearch
- **Type**: NoSQL (Search Engine / Document Store)
- **Supported Databases**: Elasticsearch, OpenSearch (with compatible client)
- **Detection Signals**:
  - NuGet packages: `NEST` (v7 and below), `Elastic.Clients.Elasticsearch` (v8+), `OpenSearch.Client`
  - Namespaces: `using Nest;`, `using Elastic.Clients.Elasticsearch;`
  - Attributes: `[ElasticsearchType(RelationName = "index_name")]` (NEST), `[PropertyName("field_name")]`, `[Ignore]`, `[Text]`, `[Keyword]`, `[Number]`, `[Date]`
  - API calls: `client.IndexDocument<T>(doc)`, `client.Search<T>(...)`, `client.Index(doc, i => i.Index("index_name"))`, `client.CreateIndex("index_name", ...)`
  - Index mapping in code: `client.Indices.Create("name", c => c.Map<T>(m => m.AutoMap()))`
- **Entity Definition Style**: POCO classes with NEST/Elastic attributes; index name set via `[ElasticsearchType]` or passed as string in API calls
- **Extraction Approach**:
  1. Find classes with `[ElasticsearchType(RelationName = "name")]` — `RelationName` is the index name.
  2. Find `client.IndexDocument<T>(...)`, `client.Search<T>(...)` — collect `T` as document types.
  3. Find `client.Indices.Create("index_name", ...)` or `client.Index(doc, i => i.Index("index_name"))` — extract index name strings.
  4. Find `client.Map<T>(...)` or `client.AutoMap<T>()` calls — `T` is the document type.
  5. Enumerate non-`[Ignore]` properties of document classes as fields.
- **Key Challenges**:
  - Index names often passed as runtime strings; no static binding to the class.
  - Same POCO may be stored in multiple indices (e.g., time-based rolling indices).
  - `AutoMap<T>()` infers mapping from reflection — not statically analyzable.
- **Analysis Tools**: Roslyn; attribute scanning
- **Complexity**: Medium

---

## 20. Apache Cassandra (DataStax Driver)

- **Name**: DataStax C# Driver for Apache Cassandra
- **Type**: NoSQL (Wide-Column Store)
- **Supported Databases**: Apache Cassandra, DataStax Astra
- **Detection Signals**:
  - NuGet packages: `CassandraCSharpDriver`, `Cassandra`
  - Namespace: `using Cassandra;`, `using Cassandra.Mapping;`, `using Cassandra.Mapping.Attributes;`
  - Attributes: `[Table("table_name")]` on class, `[Column("col_name")]` on property, `[PartitionKey]`, `[ClusteringKey]`, `[StaticColumn]`, `[Frozen]`, `[Ignore]`
  - API calls: `session.Execute(...)`, `new MappingConfiguration().Define<T>(new Map<T>().TableName("name"))`, `IMapper.Fetch<T>(...)`, `IMapper.Insert<T>(...)`
- **Entity Definition Style**: POCO classes with `[Table]`/`[Column]` attributes; or via fluent `Map<T>` configuration; or via CQL strings
- **Extraction Approach**:
  1. Find classes with `[Table("name")]` from Cassandra namespace — table name from attribute.
  2. Find `IMapper.Fetch<T>`, `IMapper.Insert<T>` — collect `T` as entity types.
  3. Find `new Map<T>().TableName("name")` in `MappingConfiguration` — Fluent table name.
  4. Find CQL `session.Execute("CREATE TABLE ...")` / `session.Execute("SELECT ... FROM table_name")` string literals — extract via regex.
  5. Enumerate properties with `[PartitionKey]`, `[ClusteringKey]`, `[Column]` for table structure.
- **Key Challenges**:
  - CQL schema may be defined externally (`.cql` files); must glob for those.
  - Keyspace prefixes in table names (`keyspace.table`).
  - Materialized views and secondary indexes are not entity tables.
- **Analysis Tools**: Roslyn; regex for CQL string extraction
- **Complexity**: Medium

---

## 21. Azure Cosmos DB SDK

- **Name**: Azure Cosmos DB SDK (v3)
- **Type**: NoSQL (Document/Multi-model Database)
- **Supported Databases**: Azure Cosmos DB (SQL API, Gremlin API, Table API, Cassandra API, MongoDB API)
- **Detection Signals**:
  - NuGet packages: `Microsoft.Azure.Cosmos`, `Microsoft.Azure.DocumentDB.Core` (v2, legacy)
  - Namespaces: `using Microsoft.Azure.Cosmos;`
  - Types: `CosmosClient`, `Container`, `Database`
  - API calls: `client.GetContainer("database_name", "container_name")`, `container.CreateItemAsync<T>(item)`, `container.GetItemQueryIterator<T>(query)`, `container.ReadItemAsync<T>(...)`
  - Attributes: `[JsonProperty("field_name")]` (Newtonsoft), `[JsonPropertyName("field_name")]` (System.Text.Json), no native Cosmos attribute for container name
  - EF Core Cosmos provider: `modelBuilder.Entity<T>().ToContainer("container_name")` — see section 2
- **Entity Definition Style**: POCOs serialized as JSON; container name passed as string to `GetContainer()`; partition key path defined at container creation or in code
- **Extraction Approach**:
  1. Find `client.GetContainer("db", "container")` calls — extract container name string.
  2. Track `Container` variable and find `CreateItemAsync<T>`, `GetItemQueryIterator<T>` — collect `T` as document types.
  3. Find `container.UpsertItemAsync<T>(...)` — additional entity type signals.
  4. For EF Core Cosmos provider, use `ToContainer("name")` parsing (section 2).
  5. Check `appsettings.json` for `"CosmosDb"` configuration section with container names.
  6. Enumerate public properties of `T` (excluding `[JsonIgnore]`) as document fields; note `id` and partition key properties.
- **Key Challenges**:
  - Container name is a runtime string — may be in configuration, not code.
  - Partition key path is critical for Cosmos but not always visible in entity classes.
  - Multiple document types may share one container (multi-model container pattern).
  - `BulkExecutor` / `TransactionalBatch` patterns.
- **Analysis Tools**: Roslyn; appsettings.json JSON parsing
- **Complexity**: High

---

## 22. Azure Table Storage

- **Name**: Azure Table Storage (Azure.Data.Tables SDK)
- **Type**: NoSQL (Key-Value / Wide-Column)
- **Supported Databases**: Azure Table Storage, Azure Cosmos DB Table API
- **Detection Signals**:
  - NuGet packages: `Azure.Data.Tables`, `Microsoft.Azure.Cosmos.Table` (legacy), `WindowsAzure.Storage` (legacy)
  - Namespaces: `using Azure.Data.Tables;`, `using Microsoft.Azure.Cosmos.Table;`, `using Microsoft.WindowsAzure.Storage.Table;`
  - Types: `TableClient`, `TableServiceClient`, `ITableEntity`, `TableEntity`
  - Class base: `: ITableEntity` or `: TableEntity`
  - API calls: `new TableClient(connectionString, "TableName")`, `tableServiceClient.GetTableClient("TableName")`, `tableClient.AddEntityAsync<T>(entity)`
- **Entity Definition Style**: Classes implementing `ITableEntity` with `PartitionKey` and `RowKey` properties; table name passed as string to `TableClient`
- **Extraction Approach**:
  1. Find `new TableClient(conn, "TableName")` / `tableServiceClient.GetTableClient("TableName")` — extract table name string literal.
  2. Find classes implementing `ITableEntity` or inheriting `TableEntity` — these are entity classes.
  3. Find `tableClient.AddEntityAsync<T>`, `tableClient.QueryAsync<T>` — collect `T` as entity types.
  4. Enumerate public properties of `T` (non-`PartitionKey`/`RowKey`) as "columns".
- **Key Challenges**:
  - Table name may be in configuration (`appsettings.json`) rather than code literals.
  - `TableEntity` (dictionary-based) is schema-less — no typed properties.
- **Analysis Tools**: Roslyn; appsettings.json parsing
- **Complexity**: Low

---

## 23. AWS DynamoDB (AWSSDK.DynamoDBv2)

- **Name**: AWS SDK for .NET – DynamoDB
- **Type**: NoSQL (Key-Value / Document)
- **Supported Databases**: Amazon DynamoDB
- **Detection Signals**:
  - NuGet packages: `AWSSDK.DynamoDBv2`, `Amazon.DynamoDBv2`
  - Namespaces: `using Amazon.DynamoDBv2;`, `using Amazon.DynamoDBv2.DataModel;`, `using Amazon.DynamoDBv2.DocumentModel;`
  - Attributes: `[DynamoDBTable("table_name")]` on class, `[DynamoDBHashKey]`, `[DynamoDBRangeKey]`, `[DynamoDBProperty("attr_name")]`, `[DynamoDBIgnore]`, `[DynamoDBGlobalSecondaryIndexHashKey]`
  - API calls: `context.SaveAsync<T>(item)`, `context.LoadAsync<T>(hashKey)`, `context.QueryAsync<T>(hashKey)`, `Table.LoadTable(client, "table_name")`, `client.PutItemAsync("table_name", item)`
- **Entity Definition Style**: POCO classes with `[DynamoDBTable]` and attribute annotations; `DynamoDBContext` for high-level object persistence
- **Extraction Approach**:
  1. Find classes with `[DynamoDBTable("name")]` — attribute value is the table name.
  2. Find `context.SaveAsync<T>`, `context.LoadAsync<T>`, `context.QueryAsync<T>` — collect `T` as entity types.
  3. Find `Table.LoadTable(client, "table_name")` — extract table name string.
  4. Find `client.PutItemAsync("table_name", ...)` / `client.GetItemAsync("table_name", ...)` — extract table name strings.
  5. Enumerate properties with `[DynamoDBHashKey]`, `[DynamoDBRangeKey]`, `[DynamoDBProperty]` for attribute mapping; skip `[DynamoDBIgnore]`.
- **Key Challenges**:
  - Table names often in configuration (AWS environment variables, `appsettings.json`).
  - Low-level API uses `Dictionary<string, AttributeValue>` — no typed entities.
  - GSI/LSI definitions are infrastructure-level and may not be in C# code at all.
- **Analysis Tools**: Roslyn; attribute scanning
- **Complexity**: Medium

---

## 24. Marten (Document DB on PostgreSQL)

- **Name**: Marten
- **Type**: NoSQL Document DB / Event Store (on top of PostgreSQL)
- **Supported Databases**: PostgreSQL
- **Detection Signals**:
  - NuGet packages: `Marten`, `Marten.CommandLine`
  - Namespaces: `using Marten;`, `using Marten.Schema;`
  - Attributes: `[DocumentAlias("collection_name")]` on document class, `[Identity]`, `[DuplicateField]`, `[Searchable]`
  - Config pattern: `services.AddMarten(options => { options.Schema.For<T>().DocumentAlias("name"); })` or `storeOptions.Schema.For<T>()`
  - API calls: `session.Store<T>(doc)`, `session.Query<T>()`, `session.LoadAsync<T>(id)`, `IDocumentSession`, `IQuerySession`
- **Entity Definition Style**: POCO classes stored as JSONB documents in PostgreSQL; collection name from `[DocumentAlias]` or class name (lowercased); auto-creates `mt_doc_<typename>` tables
- **Extraction Approach**:
  1. Find classes with `[DocumentAlias("name")]` — explicit collection/table alias.
  2. Find `storeOptions.Schema.For<T>()` in Marten configuration — collect `T` as document types; check for `.DocumentAlias("name")` chain call.
  3. Find `session.Store<T>`, `session.Query<T>`, `session.LoadAsync<T>` — collect `T` as document types.
  4. Default PostgreSQL table name: `mt_doc_<lowercase_classname>`.
  5. For Event Store: `session.Events.Append(...)` — stream aggregate types as entities.
- **Key Challenges**:
  - Marten auto-creates PostgreSQL tables named `mt_doc_<typename>` — naming convention must be known.
  - Event sourcing aggregates are additional entity-like types.
  - Schema customizations in `StoreOptions` lambda can be spread across startup code.
- **Analysis Tools**: Roslyn; attribute scanning
- **Complexity**: Medium

---

## 25. RavenDB Client

- **Name**: RavenDB .NET Client
- **Type**: NoSQL (Document Database)
- **Supported Databases**: RavenDB
- **Detection Signals**:
  - NuGet packages: `RavenDB.Client`
  - Namespaces: `using Raven.Client.Documents;`, `using Raven.Client.Documents.Session;`
  - Types: `IDocumentStore`, `IDocumentSession`, `IAsyncDocumentSession`
  - API calls: `session.Store<T>(entity)`, `session.Query<T>()`, `session.Load<T>(id)`, `session.Advanced.RawQuery<T>("from index/collection")`
  - Conventions: `store.Conventions.FindCollectionName = type => ...`
- **Entity Definition Style**: Plain POCOs; collection name defaults to class name (pluralized by convention); no required attributes
- **Extraction Approach**:
  1. Find `session.Store<T>`, `session.Query<T>`, `session.Load<T>` — collect `T` as document types.
  2. Check `store.Conventions.FindCollectionName` lambda for custom naming conventions.
  3. Default collection name = class name, pluralized (RavenDB convention).
  4. Find `store.Conventions.FindCollectionNameForType` overrides.
  5. Scan for `[RavenDB.*]` attributes (rare — RavenDB is convention-heavy, not attribute-heavy).
- **Key Challenges**:
  - Fully convention-based — no attributes to scan; collection names inferred from type names.
  - Custom convention lambdas are not statically analyzable.
  - RavenDB indexes (`AbstractIndexCreationTask<T>`) are additional query artifacts, not tables.
- **Analysis Tools**: Roslyn; generic type argument extraction
- **Complexity**: Medium

---

## 26. DbUp (SQL Migration Files)

- **Name**: DbUp
- **Type**: Migration Tool / SQL File Runner
- **Supported Databases**: SQL Server, PostgreSQL, MySQL, SQLite, Oracle, Firebird
- **Detection Signals**:
  - NuGet packages: `dbup`, `dbup-sqlserver`, `dbup-postgresql`, `dbup-mysql`, `dbup-sqlite`
  - Namespace: `using DbUp;`
  - API: `DeployChanges.To.SqlDatabase(...)`, `.WithScriptsEmbeddedInAssembly(...)`, `.WithScriptsFromFileSystem("path")`
  - SQL script files: `*.sql` in migration script folders (often named `Scripts/`, `Migrations/`, `SqlScripts/`, `Database/`)
  - File naming: `0001_CreateUsersTable.sql`, `V1__CreateTable.sql` (numbered/versioned)
- **Entity Definition Style**: Raw SQL `CREATE TABLE` statements in `.sql` files; no C# entity classes required
- **Extraction Approach**:
  1. Locate `.sql` files referenced by DbUp configuration (folder paths in `WithScriptsFromFileSystem` or embedded resource assemblies).
  2. Parse SQL files — find `CREATE TABLE table_name (...)` statements; extract table name and column list with types.
  3. Find `ALTER TABLE`, `CREATE INDEX`, `CREATE VIEW` for additional schema artifacts.
  4. Parse `CREATE PROCEDURE`, `CREATE FUNCTION` to identify stored procedures.
  5. Use SQL parser (`Microsoft.SqlServer.TransactSql.ScriptDom` for T-SQL, `PgQuery.NET` for PostgreSQL) for precise extraction.
- **Key Challenges**:
  - SQL dialect varies by database — T-SQL, PL/pgSQL, MySQL — each needs its own parser.
  - Migration scripts are incremental — must replay all scripts to get current schema (or find the latest `CREATE TABLE` + all `ALTER TABLE`).
  - `CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE TABLE` variants.
  - Schema names (`dbo.table_name`, `public.table_name`).
- **Analysis Tools**: T-SQL ScriptDom; regex for simple cases; ANTLR SQL grammar; PgQuery bindings
- **Complexity**: Medium

---

## 27. FluentMigrator

- **Name**: FluentMigrator
- **Type**: Migration Tool
- **Supported Databases**: SQL Server, PostgreSQL, MySQL, SQLite, Oracle, Firebird, DB2
- **Detection Signals**:
  - NuGet packages: `FluentMigrator`, `FluentMigrator.Runner`, `FluentMigrator.Runner.SqlServer`, etc.
  - Namespaces: `using FluentMigrator;`
  - Class pattern: `: Migration` (from `FluentMigrator`)
  - Attributes: `[Migration(20230101120000)]`, `[Migration(1)]` on migration classes
  - API calls: `Create.Table("table_name").WithColumn("col").AsString()...`, `Alter.Table("name").AddColumn(...)`, `Delete.Table("name")`
- **Entity Definition Style**: C# migration classes with Fluent API describing DDL operations; table names and columns are method arguments
- **Extraction Approach**:
  1. Find all classes with `[Migration(...)]` attribute inheriting from `Migration`.
  2. Parse `Up()` method bodies for:
     - `Create.Table("table_name")` → extract table name; chain `.WithColumn("col_name").As*()` for columns.
     - `Alter.Table("table_name").AddColumn("col_name")` → track schema changes.
     - `Delete.Table("table_name")` → table removal.
     - `Create.Index(...)`, `Create.ForeignKey(...)` for structural metadata.
  3. Sort migrations by version number (`[Migration(version)]`) to reconstruct schema history.
  4. `Down()` method provides rollback — not needed for current schema extraction.
- **Key Challenges**:
  - FluentMigrator is C# code — must parse C# AST, not SQL.
  - Method chaining for column definitions can be long and complex.
  - Incremental migrations must be replayed in order.
  - `Execute.Sql("CREATE TABLE ...")` raw SQL embedded in migration — falls back to SQL parsing.
- **Analysis Tools**: Roslyn for method invocation chain analysis
- **Complexity**: Medium

---

## 28. RoundhousE

- **Name**: RoundhousE
- **Type**: Migration Tool / SQL File Runner
- **Supported Databases**: SQL Server, PostgreSQL, MySQL, Oracle
- **Detection Signals**:
  - NuGet package: `roundhouse`, `roundhouse.sqlserver`
  - Configuration: `rh.exe` command-line tool configuration; `RoundhousEMigrate` MSBuild task
  - Folder conventions: `up/`, `down/`, `runFirstAfterUp/`, `functions/`, `views/`, `sprocs/`, `permissions/` directories containing `.sql` files
  - File naming: `0001_description.sql` (numbered scripts in `up/`)
- **Entity Definition Style**: Raw SQL files organized by convention directories; `up/` folder contains schema migration scripts
- **Extraction Approach**:
  1. Locate RoundhousE folder structure (glob for `up/*.sql`, `views/*.sql`, `sprocs/*.sql`).
  2. Parse `up/*.sql` files for `CREATE TABLE`, `ALTER TABLE` — same as DbUp approach.
  3. Parse `views/*.sql` for `CREATE VIEW` — views as query entities.
  4. Parse `sprocs/*.sql` for `CREATE PROCEDURE` — stored procedure signatures.
  5. Parse `functions/*.sql` for UDFs.
- **Key Challenges**: Same as DbUp (SQL dialect, incremental schema reconstruction).
- **Analysis Tools**: SQL parsers; regex
- **Complexity**: Medium

---

## 29. Stored Procedures and Views (SQL Files)

- **Name**: Standalone SQL Files (Stored Procedures, Views, Functions)
- **Type**: Raw SQL / Schema File
- **Supported Databases**: Any RDBMS (SQL Server, PostgreSQL, MySQL, Oracle, etc.)
- **Detection Signals**:
  - File extensions: `*.sql`, `*.prc`, `*.vw`, `*.fnc`
  - Folder names: `StoredProcedures/`, `Views/`, `Functions/`, `Schemas/`, `DDL/`, `Database/`
  - SQL keywords: `CREATE PROCEDURE`, `CREATE OR ALTER PROCEDURE`, `CREATE VIEW`, `CREATE TABLE`, `CREATE FUNCTION`, `CREATE TRIGGER`
  - SSDT project: `*.sqlproj` (SQL Server Data Tools project file containing `.sql` files organized by object type)
- **Entity Definition Style**: SQL DDL statements; no C# entities; SSDT projects organize SQL by object type
- **Extraction Approach**:
  1. Glob for all `*.sql` files in the repository.
  2. Parse for `CREATE TABLE <name>` — primary entity extraction.
  3. Parse for `CREATE VIEW <name> AS SELECT ... FROM <table>` — views may represent query entities.
  4. Parse for `CREATE PROCEDURE <name>` — map procedure names to underlying tables (requires `FROM`/`JOIN` extraction from procedure body).
  5. For SSDT (`*.sqlproj`): parse project file for referenced `.sql` files; SQL files organized in `Tables/`, `Views/`, `StoredProcedures/` folders.
  6. Apply T-SQL ScriptDom or regex for table name extraction.
- **Key Challenges**:
  - Cross-database queries (`linked_server.database.schema.table`).
  - Temporary tables (`#temp`, `##global_temp`) — not persistent entities.
  - Views that are entity-equivalent vs. reporting views.
  - CTEs, derived tables, TVFs in view/procedure bodies.
- **Analysis Tools**: `Microsoft.SqlServer.TransactSql.ScriptDom`; ANTLR SQL grammars; regex
- **Complexity**: Medium

---

## 30. GraphQL Schema Files

- **Name**: GraphQL Schema Definition Language (SDL)
- **Type**: Schema File / API Contract
- **Supported Databases**: N/A (API layer; backed by any data store)
- **Detection Signals**:
  - File extensions: `*.graphql`, `*.gql`
  - NuGet packages: `HotChocolate`, `GraphQL`, `Strawberry Shake` (client)
  - Namespaces: `using HotChocolate;`, `using GraphQL;`
  - Keywords in `.graphql` files: `type`, `input`, `enum`, `interface`, `union`, `schema`, `query`, `mutation`, `subscription`
  - HotChocolate annotations: `[GraphQLType]`, `[UseFiltering]`, `[UseSorting]` on C# classes
- **Entity Definition Style**: SDL `type TypeName { field: FieldType! }` declarations in `.graphql` files; or code-first with C# classes annotated with HotChocolate attributes
- **Extraction Approach**:
  1. Glob for `*.graphql` / `*.gql` files.
  2. Parse SDL — extract `type` declarations (excluding `Query`, `Mutation`, `Subscription`, `schema`) as entity/domain types.
  3. For each type: extract field names and types.
  4. `input` types represent mutation inputs (may correspond to entities).
  5. For code-first HotChocolate: find classes annotated with `[ExtendObjectType]`, `[ObjectType]`, `[QueryType]` — these define the GraphQL schema from C# classes.
- **Key Challenges**:
  - GraphQL types are API-layer representations — may or may not map 1:1 to database tables.
  - Resolvers may aggregate multiple tables into one GraphQL type.
  - Schema stitching / federation merges schemas from multiple services.
- **Analysis Tools**: GraphQL SDL parser (`GraphQL-Parser` NuGet or tree-sitter GraphQL grammar); Roslyn for code-first
- **Complexity**: Medium

---

## 31. Protobuf (.proto Files)

- **Name**: Protocol Buffers (Protobuf)
- **Type**: Schema File / Serialization Contract
- **Supported Databases**: N/A (serialization format; used with gRPC, message queues, event stores)
- **Detection Signals**:
  - File extension: `*.proto`
  - NuGet packages: `Google.Protobuf`, `Grpc.Tools`, `Grpc.Net.Client`, `Grpc.AspNetCore`
  - `.proto` keywords: `message`, `enum`, `service`, `rpc`, `syntax = "proto3";`
  - Generated C# files: `*.pb.cs` alongside `.proto` files
- **Entity Definition Style**: `message MessageName { FieldType field_name = field_number; }` declarations in `.proto` files
- **Extraction Approach**:
  1. Glob for `*.proto` files.
  2. Parse `message` declarations — message name = entity/type name; fields = data members.
  3. Identify `service` blocks with `rpc` methods — these indicate API operations on entities.
  4. `enum` types are value types, not entities.
  5. Map proto message names to potential database entities (heuristic — message names often mirror entity names).
- **Key Challenges**:
  - Protobuf messages are serialization contracts, not database schemas — require contextual judgment.
  - Nested message types (embedded vs. separate collection).
  - `oneof` fields for polymorphism.
- **Analysis Tools**: `protoc` AST; tree-sitter proto grammar; line-by-line regex for simple cases
- **Complexity**: Low

---

## 32. OpenAPI / Swagger Specs

- **Name**: OpenAPI / Swagger Specification
- **Type**: Schema File / API Contract
- **Supported Databases**: N/A (API contract layer)
- **Detection Signals**:
  - File names: `swagger.json`, `openapi.json`, `openapi.yaml`, `swagger.yaml`, `*.swagger.json`
  - Keys in JSON/YAML: `"openapi": "3.0.x"`, `"swagger": "2.0"`, `"components"`, `"definitions"`, `"paths"`
  - NuGet packages: `Swashbuckle.AspNetCore`, `NSwag.AspNetCore`, `Microsoft.AspNetCore.OpenApi`
  - Generated C# client/model code: classes with `[Newtonsoft.Json.JsonProperty]` from NSwag code gen
- **Entity Definition Style**: JSON/YAML `components.schemas` (OpenAPI 3) or `definitions` (Swagger 2) objects with `type: object` and `properties`
- **Extraction Approach**:
  1. Glob for `swagger.json`, `openapi.json`, `openapi.yaml`, `*.swagger.json`.
  2. Parse JSON/YAML — `components.schemas` (v3) or `definitions` (v2) keys are entity/model names.
  3. For each schema object: extract `properties` as field names; `$ref` indicates relationships.
  4. Filter out pagination wrappers, error models, and envelope types (heuristic by name or structure).
  5. For code-generated models: find classes with `[GeneratedCode]` attribute or in a `Generated/` folder.
- **Key Challenges**:
  - OpenAPI models are DTOs — may not directly correspond to database tables.
  - Polymorphism via `allOf`/`oneOf`/`anyOf` creates inheritance hierarchies.
  - Large specs may have hundreds of schemas — filtering relevant entity schemas requires heuristics.
- **Analysis Tools**: `System.Text.Json` / `Newtonsoft.Json` for JSON parsing; YamlDotNet for YAML; NSwag.Core for programmatic access
- **Complexity**: Medium

---

## 33. Record Types and DTOs as Entity Signals

- **Name**: C# Record Types and Data Transfer Objects (DTOs)
- **Type**: Entity Signal (Indirect)
- **Supported Databases**: N/A (language construct)
- **Detection Signals**:
  - `record` keyword: `public record UserDto(int Id, string Name);` (positional record) or `public record User { public int Id { get; init; } ... }`
  - Naming conventions: `*Dto`, `*ViewModel`, `*Model`, `*Entity`, `*Record`, `*Row`, `*Document` suffixes
  - Classes in folders named: `Models/`, `Entities/`, `Domain/`, `Data/`, `DTOs/`, `ViewModels/`
  - Interfaces: `IEntity`, `IAggregateRoot`, `IDocument` — classes implementing these are likely entities
- **Entity Definition Style**: Pure C# types; may or may not have persistence attributes; entity-ness inferred from naming and folder conventions
- **Extraction Approach**:
  1. Scan for `record` declarations — collect as candidate entities.
  2. Apply name-suffix heuristics: `*Entity`, `*Document`, `*Model`, `*Row`, `*Record` strongly suggest entity classes.
  3. Scan `Models/`, `Entities/`, `Domain/` folders — classes here are entity candidates.
  4. Find classes implementing `IEntity`, `IAggregateRoot`, `INotification`, `IDomainEvent` from DDD frameworks (MediatR, Ardalis.Specification, etc.).
  5. Cross-reference with ORM entity lists — DTOs and records that duplicate ORM entities confirm entity status.
  6. Records with `[Table]`, `[BsonElement]`, `[DynamoDBTable]` etc. are definitive entities.
- **Key Challenges**:
  - Naming conventions vary by team; false positives are common.
  - Records used as value objects, events, or commands — not database entities.
  - Positional records make property enumeration different from class-based POCOs.
- **Analysis Tools**: Roslyn `RecordDeclarationSyntax`; file system structure analysis; naming heuristics
- **Complexity**: Low (as a signal; filtering noise is harder)

---

## 34. AutoMapper Profiles as Entity Signals

- **Name**: AutoMapper Profiles
- **Type**: Entity Signal (Indirect)
- **Supported Databases**: N/A (mapping layer)
- **Detection Signals**:
  - NuGet packages: `AutoMapper`, `AutoMapper.Extensions.Microsoft.DependencyInjection`, `Mapster`
  - Namespaces: `using AutoMapper;`
  - Class base: `: Profile` (AutoMapper)
  - API calls in `Profile` constructor: `CreateMap<SourceType, DestinationType>()`, `CreateMap<Entity, EntityDto>().ReverseMap()`
  - Mapster: `TypeAdapterConfig<TSource, TDestination>.NewConfig()`
- **Entity Definition Style**: Mapping declarations reveal source and destination types; source types are often database entities, destination types are DTOs
- **Extraction Approach**:
  1. Find all classes inheriting from `Profile`.
  2. Parse constructor bodies for `CreateMap<TSource, TDestination>()` calls.
  3. Collect all `TSource` and `TDestination` type arguments.
  4. Heuristic: if `TSource` has `[Table]`/`[Column]`/`[BsonElement]` attributes (or appears in `DbSet<T>`), it is the entity; `TDestination` is the DTO.
  5. Conversely: if `TDestination` name ends with `Dto`/`ViewModel`/`Response`, `TSource` is likely the entity.
  6. Types appearing as `TSource` in `CreateMap<TSource, TDto>` are entity candidates even without explicit ORM attributes.
  7. Same analysis applies to Mapster `TypeAdapterConfig<TSource, TDest>.NewConfig()`.
- **Key Challenges**:
  - `CreateMap` direction convention (Entity → DTO) is not enforced — both orderings exist.
  - `ReverseMap()` means both types map to each other.
  - Intermediate mapping types (aggregates of multiple entities) — not direct table mappings.
  - Inline maps with `ForMember`, `ProjectTo` make type resolution harder.
- **Analysis Tools**: Roslyn for generic type argument extraction in method calls
- **Complexity**: Low (as a corroboration signal)

---

## 35. Repository Detection Plan

Given a C# repository, use the following systematic process to determine which data storage approaches are in use. Execute steps roughly in order — earlier steps narrow the search space for later ones.

### Step 1 — Inventory NuGet Package References

Parse all `.csproj`, `packages.config`, and `Directory.Packages.props` files in the repository.

```
Find: **/*.csproj, **/packages.config, **/Directory.Packages.props
```

Extract `<PackageReference Include="..." />` and `<package id="..." />` elements.

Match against this detection table:

| Package Name Pattern | Approach |
|---|---|
| `Microsoft.EntityFrameworkCore*` | EF Core (any flavor) |
| `EntityFramework` (6.x) | EF 6 |
| `Npgsql.EntityFrameworkCore.*` | EF Core + PostgreSQL |
| `Pomelo.EntityFrameworkCore.*` | EF Core + MySQL |
| `Dapper`, `Dapper.*` | Dapper |
| `NHibernate`, `FluentNHibernate` | NHibernate |
| `SD.LLBLGen.Pro.*` | LLBLGen Pro |
| `System.Data.Linq` | LINQ to SQL |
| `ServiceStack.OrmLite*` | ServiceStack OrmLite |
| `PetaPoco*`, `AsyncPoco` | PetaPoco |
| `Massive` | Massive |
| `Simple.Data*` | Simple.Data |
| `MongoDB.Driver`, `MongoDB.Bson` | MongoDB |
| `MongoFramework` | MongoDB MongoDbContext |
| `StackExchange.Redis` | Redis |
| `NEST`, `Elastic.Clients.Elasticsearch` | Elasticsearch |
| `CassandraCSharpDriver`, `Cassandra` | Cassandra |
| `Microsoft.Azure.Cosmos` | Azure Cosmos DB |
| `Azure.Data.Tables`, `Microsoft.Azure.Cosmos.Table` | Azure Table Storage |
| `AWSSDK.DynamoDBv2` | DynamoDB |
| `Marten*` | Marten |
| `RavenDB.Client` | RavenDB |
| `dbup*`, `DbUp*` | DbUp |
| `FluentMigrator*` | FluentMigrator |
| `roundhouse*` | RoundhousE |
| `AutoMapper*`, `Mapster` | AutoMapper profiles (indirect) |

### Step 2 — Scan for DbContext Subclasses (EF Core / EF 6)

```
Search all *.cs files for: `: DbContext`, `: IdentityDbContext`, `: PooledDbContextFactory`
Namespace hint: using Microsoft.EntityFrameworkCore or using System.Data.Entity
```

For each found `DbContext`:
- List all `DbSet<T>` properties → entity types.
- Check for `OnModelCreating` override → Fluent API configuration.
- Check for `IEntityTypeConfiguration<T>` classes in the same assembly.

### Step 3 — Scan for Migration Folders (EF Core / EF 6)

```
Glob: **/Migrations/*ModelSnapshot.cs
Glob: **/Migrations/*.cs (containing ": Migration")
Glob: **/*.edmx (EF 6 model-first)
```

If `*ModelSnapshot.cs` found → parse `BuildModel` for authoritative EF Core schema.

### Step 4 — Scan for SQL Migration Script Folders

```
Glob: **/Scripts/**/*.sql
Glob: **/Migrations/**/*.sql
Glob: **/Database/**/*.sql
Glob: **/SqlScripts/**/*.sql
Glob: **/up/*.sql (RoundhousE convention)
Glob: **/*.sqlproj (SSDT)
```

Parse SQL files for `CREATE TABLE`, `CREATE VIEW`, `CREATE PROCEDURE`.

### Step 5 — Scan for NHibernate Mapping Files

```
Glob: **/*.hbm.xml
Search *.cs for: ": ClassMap<"
Search *.cs for: "[Class(", "[NHibernate.Mapping.Attributes"
```

### Step 6 — Scan for LINQ to SQL / DBML

```
Glob: **/*.dbml
Search *.cs for: ": DataContext", "Table<"
```

### Step 7 — Scan for NoSQL Client Usage

Search all `*.cs` files for these namespace/type patterns:

```csharp
using MongoDB.Driver;         // MongoDB
using StackExchange.Redis;    // Redis
using Nest;                   // Elasticsearch v7
using Elastic.Clients.*;      // Elasticsearch v8
using Cassandra;              // Cassandra
using Microsoft.Azure.Cosmos; // Cosmos DB
using Azure.Data.Tables;      // Table Storage
using Amazon.DynamoDBv2;      // DynamoDB
using Marten;                 // Marten
using Raven.Client;           // RavenDB
```

### Step 8 — Scan for Schema/Contract Files

```
Glob: **/*.graphql, **/*.gql     → GraphQL schema
Glob: **/*.proto                 → Protobuf
Glob: **/swagger.json            → OpenAPI
Glob: **/openapi.json            → OpenAPI
Glob: **/openapi.yaml            → OpenAPI
Glob: **/swagger.yaml            → OpenAPI
```

### Step 9 — Scan appsettings.json for Connection String Hints

```
Glob: **/appsettings*.json, **/appsettings*.xml
Parse: ConnectionStrings section → database type from connection string format
  - "Server=...;Database=..." → SQL Server
  - "Host=...;Database=..." → PostgreSQL
  - "mongodb://" or "mongodb+srv://" → MongoDB
  - "AccountEndpoint=...cosmos..." → Cosmos DB
  - ":6379" → Redis
  - "cassandra" in URL → Cassandra
  - "dynamodb" in endpoint → DynamoDB
```

### Step 10 — Scan for Raw ADO.NET Usage

If no ORM packages detected, or as a supplement:

```
Search *.cs for: SqlConnection, NpgsqlConnection, MySqlConnection, OleDbConnection
Search *.cs for: new SqlCommand(, cmd.CommandText =
```

Extract SQL string literals from command text assignments and constructor arguments.

### Step 11 — Scan for DTO / Record Entity Signals

As a fallback / corroboration:

```
Search *.cs for: "record " declarations
Search folder names: Models/, Entities/, Domain/, Data/
Apply name-suffix heuristics: *Entity, *Document, *Model
Cross-reference with AutoMapper CreateMap<T, *Dto> sources
```

### Step 12 — Build Entity Inventory

For each detected approach, apply the corresponding extraction method from sections 1–34 and merge results into a unified entity list:

| Entity Name | Physical Table/Collection Name | Source Approach | Source File | Schema |
|---|---|---|---|---|
| `User` | `Users` | EF Core DbSet | `AppDbContext.cs` | SQL Server |
| `Order` | `Orders` | EF Core Fluent API | `OrderConfiguration.cs` | SQL Server |
| `Session` | `user_sessions` | Dapper SQL string | `SessionRepository.cs` | PostgreSQL |
| `EventLog` | `event_logs` | FluentMigrator | `Migration_0005.cs` | MySQL |
| `Product` | `products` | MongoDB GetCollection | `ProductRepository.cs` | MongoDB |

### Priority Order for Conflicting Information

When the same logical entity appears in multiple sources, trust in this order:

1. EF Core Migration Snapshot (`*ModelSnapshot.cs`) — most reliable for current schema
2. FluentMigrator / DbUp SQL files — explicit DDL
3. EF Core `DbContext` + Fluent API / Data Annotations — design-time truth
4. EDMX / `.hbm.xml` / `.dbml` — legacy but explicit
5. ORM attribute scanning (`[Table]`, `[BsonElement]`, etc.)
6. Generic type argument extraction (Dapper, MongoDB, etc.)
7. SQL string literal parsing
8. DTO / record / naming convention heuristics (lowest confidence)

---

*Document version: 2026-03-27. Covers .NET 6/7/8/9 and .NET Framework 4.x ecosystem.*
