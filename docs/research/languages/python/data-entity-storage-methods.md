# Python Data Entity Storage Methods

A catalog of every significant data entity storage framework, library, and approach used in Python projects. Purpose: support automated static analysis of Python repositories to extract a list of data entities (database tables, document collections, key namespaces, indices, etc.) that the repository works with.

---

## Table of Contents

1. [SQLAlchemy ORM (Declarative)](#1-sqlalchemy-orm-declarative)
2. [SQLAlchemy ORM (Classical / Imperative)](#2-sqlalchemy-orm-classical--imperative)
3. [SQLAlchemy Core (Non-ORM)](#3-sqlalchemy-core-non-orm)
4. [Alembic Migrations](#4-alembic-migrations)
5. [Django ORM](#5-django-orm)
6. [Django Migrations](#6-django-migrations)
7. [Peewee ORM](#7-peewee-orm)
8. [Tortoise ORM](#8-tortoise-orm)
9. [SQLModel](#9-sqlmodel)
10. [Pony ORM](#10-pony-orm)
11. [Raw SQL — psycopg2 / psycopg3](#11-raw-sql--psycopg2--psycopg3)
12. [Raw SQL — PyMySQL / mysql-connector-python](#12-raw-sql--pymysql--mysql-connector-python)
13. [Raw SQL — sqlite3 (stdlib)](#13-raw-sql--sqlite3-stdlib)
14. [Raw SQL Migration Files (Flyway / Liquibase)](#14-raw-sql-migration-files-flyway--liquibase)
15. [Prisma Client Python](#15-prisma-client-python)
16. [MongoDB — MongoEngine](#16-mongodb--mongoengine)
17. [MongoDB — PyMongo](#17-mongodb--pymongo)
18. [MongoDB — Motor (async PyMongo)](#18-mongodb--motor-async-pymongo)
19. [MongoDB — Beanie (ODM)](#19-mongodb--beanie-odm)
20. [Redis — redis-py / aioredis](#20-redis--redis-py--aioredis)
21. [Elasticsearch — elasticsearch-py](#21-elasticsearch--elasticsearch-py)
22. [Elasticsearch — elasticsearch-dsl](#22-elasticsearch--elasticsearch-dsl)
23. [Cassandra — cassandra-driver](#23-cassandra--cassandra-driver)
24. [DynamoDB — boto3](#24-dynamodb--boto3)
25. [Google Cloud Datastore / Firestore](#25-google-cloud-datastore--firestore)
26. [Pydantic Models as Entity Signals](#26-pydantic-models-as-entity-signals)
27. [Python Dataclasses as Entity Signals](#27-python-dataclasses-as-entity-signals)
28. [attrs as Entity Signals](#28-attrs-as-entity-signals)
29. [Repository Detection Plan](#repository-detection-plan)

---

## 1. SQLAlchemy ORM (Declarative)

**Name**: SQLAlchemy ORM — Declarative Base
**Type**: Relational ORM
**Supported Databases**: PostgreSQL, MySQL/MariaDB, SQLite, Oracle, Microsoft SQL Server, CockroachDB, and any database with a DBAPI-compliant driver

**Detection Signals**:
- Dependencies: `sqlalchemy`, `SQLAlchemy` in `requirements.txt`, `pyproject.toml` (`[tool.poetry.dependencies]` or `[project.dependencies]`), `setup.py`, `setup.cfg`, `Pipfile`
- Imports: `from sqlalchemy.orm import DeclarativeBase`, `from sqlalchemy.ext.declarative import declarative_base`, `from sqlalchemy.orm import declarative_base`
- File patterns: files named `models.py`, `models/*.py`, `db/models.py`, `database/models.py`, `orm/*.py`
- Class-level patterns: classes inheriting from `Base` or a custom subclass of `DeclarativeBase`

**Entity Definition Style**:
Class-based. A shared `Base` is created once (`Base = declarative_base()` or `class Base(DeclarativeBase): pass`), then each table is a class inheriting from `Base` with a `__tablename__` attribute and `Column` field declarations.

```python
Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String, nullable=False)
```

In SQLAlchemy 2.0+ mapped-column style:

```python
class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str]
```

**Extraction Approach**:
1. Parse all `.py` files using Python's `ast` module or `tree-sitter-python`.
2. Identify `Base` creation: find assignments matching `declarative_base()` or class definitions inheriting from `DeclarativeBase`. Record the resulting name (commonly `Base`, but may vary).
3. Find all class definitions whose base class list includes the identified `Base` name(s).
4. For each such class, extract:
   - `__tablename__` — the table name (look for `Assign` nodes where the target name is `__tablename__`).
   - `__table_args__` — may contain schema qualifiers.
   - Column definitions to enumerate fields.
5. Handle multi-file projects: `Base` may be defined in `database.py` or `db.py` and imported everywhere. Resolve imports to find all subclasses across files.
6. Watch for abstract base classes (`__abstract__ = True`) — these define no table themselves but are inherited by real entities.

**Key Challenges**:
- `Base` object may have an arbitrary name or may be imported from a third-party base package.
- `__tablename__` can be computed dynamically (e.g., `__tablename__ = f"{prefix}_users"`); static analysis will yield the expression, not the value.
- Concrete Table Inheritance and Joined Table Inheritance produce multiple classes mapping to one or more tables — the relationship must be resolved.
- `__table_args__ = {"schema": "reporting"}` adds a schema qualifier to the table name.
- Mixins add columns to multiple entities; mixin classes themselves are not entities.
- `declared_attr` decorator used in mixins can define `__tablename__` dynamically.

**Analysis Tools**: `ast` (stdlib), `tree-sitter` + `tree-sitter-python`, `astroid` (for cross-file type inference), `libcst`
**Complexity**: Medium

---

## 2. SQLAlchemy ORM (Classical / Imperative)

**Name**: SQLAlchemy ORM — Classical Mapping
**Type**: Relational ORM
**Supported Databases**: Same as Declarative (PostgreSQL, MySQL, SQLite, Oracle, MSSQL, etc.)

**Detection Signals**:
- Same dependency signals as Declarative SQLAlchemy.
- Imports: `from sqlalchemy import Table, MetaData, mapper` (legacy), `from sqlalchemy.orm import registry`
- Code patterns: explicit `Table(...)` objects combined with `mapper_registry.map_imperatively(ClassName, table_object)` or the legacy `mapper(ClassName, table_object)`.

**Entity Definition Style**:
Tables are defined explicitly using `Table` objects attached to a `MetaData` instance. Plain Python classes (no special base) are then mapped to those tables using `mapper()` or `registry.map_imperatively()`.

```python
metadata = MetaData()

users_table = Table("users", metadata,
    Column("id", Integer, primary_key=True),
    Column("email", String),
)

class User:
    pass

mapper_registry.map_imperatively(User, users_table)
```

**Extraction Approach**:
1. Parse `.py` files with `ast`.
2. Find `Table(...)` constructor calls — the first positional argument (or `name=` keyword) is the table name. Second argument is the `MetaData` object.
3. Collect all `Table(...)` call nodes and extract name strings.
4. Optionally, find `map_imperatively(ClassName, table_var)` or `mapper(ClassName, table_var)` calls to associate Python class names with table names.
5. `MetaData` objects can be inspected at runtime; for static analysis, trace `Table` calls directly.

**Key Challenges**:
- Table names may be built from variables or f-strings.
- Same `MetaData` may be reused across multiple files; requires cross-file resolution.
- `extend_existing=True` can re-open an existing table definition, causing duplicate `Table(...)` calls for the same table.
- Legacy `mapper()` was removed in SQLAlchemy 2.0; both patterns may appear in the same repo during migration.

**Analysis Tools**: `ast`, `tree-sitter-python`, `libcst`
**Complexity**: Medium

---

## 3. SQLAlchemy Core (Non-ORM)

**Name**: SQLAlchemy Core
**Type**: Query Builder / Schema Definition
**Supported Databases**: Same as SQLAlchemy ORM

**Detection Signals**:
- Same `sqlalchemy` dependency.
- Imports: `from sqlalchemy import Table, MetaData, Column, select, insert, update, delete`
- No ORM classes inheriting from `Base`; instead, `Table` objects are used directly for queries.
- Patterns like `select(users_table).where(...)` rather than `session.query(User)`.

**Entity Definition Style**:
`Table` objects are defined against a `MetaData` instance — identical in form to Classical ORM, but no class mapping occurs. Queries operate directly on `Table` and `Column` objects.

**Extraction Approach**:
1. Parse `.py` files with `ast`.
2. Find `MetaData()` instantiations to identify metadata objects.
3. Find all `Table("name", metadata, ...)` constructor calls; extract the first string argument as the table name.
4. `metadata.reflect(bind=engine)` dynamically loads the schema from the database — this cannot be resolved statically; flag as "runtime-reflected schema."
5. For `create_all()` / `drop_all()` calls, confirm that the MetaData and Table objects are used in schema management.

**Key Challenges**:
- Schema reflection via `metadata.reflect()` yields no static entity list.
- Table objects may be defined in one module and imported/used in many others.
- `Table` may be constructed inside factory functions with a variable name argument.

**Analysis Tools**: `ast`, `tree-sitter-python`
**Complexity**: Medium

---

## 4. Alembic Migrations

**Name**: Alembic
**Type**: Migration Tool (Relational)
**Supported Databases**: All databases supported by SQLAlchemy

**Detection Signals**:
- Dependencies: `alembic` in requirements files.
- Directory: `alembic/` at or near the repo root, containing `env.py` and `versions/`.
- Config file: `alembic.ini` at or near the repo root.
- File pattern: `alembic/versions/*.py` — each file is one migration.

**Entity Definition Style**:
Migrations are Python scripts. Each version file contains `upgrade()` and `downgrade()` functions that call `op.*` functions from `alembic.op`.

```python
def upgrade():
    op.create_table("orders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id")),
    )

def downgrade():
    op.drop_table("orders")
```

**Extraction Approach**:
1. Locate `alembic/versions/` directory.
2. Parse each `*.py` file in that directory using `ast`.
3. Within `upgrade()` function bodies, find calls to:
   - `op.create_table("name", ...)` — extract table name (first argument).
   - `op.drop_table("name")` — extract table name (confirms existence historically).
   - `op.rename_table("old", "new")` — track both names.
   - `op.add_column("table_name", ...)` — confirms existence of named table.
   - `op.create_index(...)`, `op.create_unique_constraint(...)` — secondary signals confirming a table name.
4. Order migration files by dependency chain: parse the `down_revision` variable in each file to reconstruct the chain and determine the final schema state.
5. Combine: a table that appears in `create_table` across all migrations and is never `drop_table`-d in a later migration is a current entity.

**Key Challenges**:
- `op.execute("CREATE TABLE ...")` raw SQL within a migration bypasses the `op.*` API — must also parse raw SQL strings.
- `--autogenerate` migrations use the ORM models as source of truth; manually written migrations may differ.
- Table names may be schema-qualified strings like `"reporting.orders"`.
- Multiple heads (branches) in the migration graph require DAG traversal.

**Analysis Tools**: `ast`, `tree-sitter-python`; custom DAG traversal for revision chain
**Complexity**: High

---

## 5. Django ORM

**Name**: Django ORM
**Type**: Relational ORM
**Supported Databases**: PostgreSQL, MySQL/MariaDB, SQLite, Oracle

**Detection Signals**:
- Dependencies: `django`, `Django` in requirements files.
- Directory: presence of `manage.py` at the repo root; `settings.py` or `settings/` directory containing `DATABASES` configuration.
- File pattern: `models.py` inside Django app directories; `<app>/models/*.py`.
- Imports: `from django.db import models`; class inheritance from `models.Model`.
- `INSTALLED_APPS` in `settings.py` lists app names that contain models.

**Entity Definition Style**:
Class-based. Every table is a Python class inheriting from `django.db.models.Model`. The table name defaults to `<app_label>_<classname>` (lowercased) but can be overridden in the `Meta` inner class.

```python
from django.db import models

class Order(models.Model):
    user = models.ForeignKey("auth.User", on_delete=models.CASCADE)
    total = models.DecimalField(max_digits=10, decimal_places=2)

    class Meta:
        db_table = "shop_orders"
```

**Extraction Approach**:
1. Detect Django by presence of `manage.py` and `django` dependency.
2. Parse `settings.py` (or `settings/*.py`) for `INSTALLED_APPS` to enumerate app names.
3. For each app, find `models.py` or `models/__init__.py` or `models/*.py`.
4. Parse each models file using `ast`. Find class definitions where any base class resolves to `models.Model` (directly or through inheritance).
5. For each model class:
   - Default table name: `<app_label>_<ClassName.lower()>`. App label is typically the app directory name.
   - Check for inner `class Meta:` and look for `db_table = "..."` assignment to override.
   - Check `app_label` in `Meta` to override the app label portion.
6. Abstract models (`abstract = True` in `Meta`) define no table — skip them.
7. Proxy models (`proxy = True` in `Meta`) map to the parent's table — note as alias, not a new table.

**Key Challenges**:
- Abstract model hierarchies can be deep; must fully resolve the inheritance chain to determine which classes are concrete.
- Proxy models reference the same underlying table as the parent — must detect `proxy = True`.
- Multi-table inheritance generates an implicit one-to-one link table.
- Third-party Django apps in `INSTALLED_APPS` introduce models that are not in the repo source.
- Swappable models (`AUTH_USER_MODEL`) — the actual class may vary based on settings.
- `db_table` may be an f-string or constructed from a variable.

**Analysis Tools**: `ast`, `tree-sitter-python`; Django's own `manage.py inspectdb` (runtime); `astroid` for import resolution
**Complexity**: Medium

---

## 6. Django Migrations

**Name**: Django Migrations
**Type**: Migration Tool (Relational)
**Supported Databases**: Same as Django ORM

**Detection Signals**:
- Directory: `<app>/migrations/` containing `0001_initial.py`, `0002_*.py`, etc.
- Files inherit from `django.db.migrations.Migration`.
- Each file has a `dependencies` list and an `operations` list.

**Entity Definition Style**:
Each migration file contains a `Migration` class with an `operations` list of migration operations.

```python
from django.db import migrations, models

class Migration(migrations.Migration):
    dependencies = [("shop", "0001_initial")]
    operations = [
        migrations.CreateModel(
            name="Order",
            fields=[
                ("id", models.AutoField(primary_key=True)),
                ("total", models.DecimalField(max_digits=10, decimal_places=2)),
            ],
        ),
    ]
```

**Extraction Approach**:
1. Locate all `<app>/migrations/*.py` files.
2. Parse each file using `ast`. Find the `operations` list assignment on the `Migration` class.
3. Iterate the list elements and detect call nodes:
   - `migrations.CreateModel(name="Order", ...)` — extract `name` as the model name; table name is `<app_label>_<name.lower()>` (or from `options={"db_table": "..."}` if present).
   - `migrations.DeleteModel(name="Order")` — marks deletion.
   - `migrations.RenameModel(old_name="...", new_name="...")` — track rename.
   - `migrations.AlterModelTable(name="...", table="...")` — explicit table rename.
   - `migrations.RunSQL("CREATE TABLE ...")` — raw SQL; parse the string.
   - `migrations.RunPython(some_func)` — data migration; attempt to parse `some_func` body for raw SQL.
4. Reconstruct dependency graph using `dependencies` lists. Apply operations in order to determine current schema state.

**Key Challenges**:
- `RunSQL` operations may contain multi-statement SQL strings including DDL.
- `RunPython` functions can execute arbitrary Python that modifies schema via `schema_editor`.
- Squashed migrations (`replaces` attribute) merge multiple migrations into one; must handle both paths.
- Apps that share a migration history via `dependencies` require cross-app graph traversal.

**Analysis Tools**: `ast`, `tree-sitter-python`; Django's own `migrate --plan` (runtime)
**Complexity**: High

---

## 7. Peewee ORM

**Name**: Peewee
**Type**: Relational ORM
**Supported Databases**: SQLite, MySQL/MariaDB, PostgreSQL

**Detection Signals**:
- Dependencies: `peewee` in requirements files.
- Imports: `from peewee import Model, CharField, IntegerField, ...`; `import peewee`
- File patterns: `models.py`, `db.py` containing Peewee model classes.
- Class inheritance from `peewee.Model` or a custom subclass.

**Entity Definition Style**:
Class-based. Each table is a class inheriting (directly or indirectly) from `peewee.Model`. The table name defaults to the class name (lowercased) or can be set in the `Meta` inner class.

```python
from peewee import Model, CharField, IntegerField, SqliteDatabase

db = SqliteDatabase("app.db")

class BaseModel(Model):
    class Meta:
        database = db

class User(BaseModel):
    username = CharField(unique=True)
    age = IntegerField()

    class Meta:
        table_name = "users"
```

**Extraction Approach**:
1. Detect `peewee` dependency and imports.
2. Parse model files with `ast`. Identify `peewee.Model` (and common intermediate base names like `BaseModel`).
3. Find all classes whose base chain includes the Peewee `Model`. This requires tracking intermediate base classes locally.
4. For each model class:
   - Default table name: class name lowercased.
   - Check inner `class Meta:` for `table_name = "..."` or the legacy `db_table = "..."`.
   - Check `legacy_table_names = False` in Meta (affects name formatting).
5. Classes with `abstract = True` in `Meta` define no table.

**Key Challenges**:
- Base class chain may span multiple files; requires import resolution.
- `ModelBase` metaclass can alter table naming at runtime.
- Peewee extensions (e.g., `playhouse.postgres_ext`) introduce additional field and model types.
- `table_name` may be dynamically computed.

**Analysis Tools**: `ast`, `tree-sitter-python`
**Complexity**: Low

---

## 8. Tortoise ORM

**Name**: Tortoise ORM
**Type**: Relational ORM (async)
**Supported Databases**: PostgreSQL (asyncpg), MySQL (aiomysql), SQLite (aiosqlite), Microsoft SQL Server (via asyncodbc)

**Detection Signals**:
- Dependencies: `tortoise-orm`, `tortoise_orm` in requirements files.
- Imports: `from tortoise import fields, Model`; `from tortoise.models import Model`
- Initialization pattern: `Tortoise.init(...)` call with `modules={"models": ["app.models"]}`.
- File patterns: `models.py`, `models/*.py`.

**Entity Definition Style**:
Class-based, similar to Django. Each table is a class inheriting from `tortoise.models.Model`.

```python
from tortoise import fields
from tortoise.models import Model

class Tournament(Model):
    id = fields.IntField(pk=True)
    name = fields.TextField()

    class Meta:
        table = "tournament"
```

**Extraction Approach**:
1. Detect `tortoise-orm` dependency.
2. Parse model files with `ast`. Find classes inheriting from `Model` (with `tortoise` import context).
3. For each model class:
   - Default table name: class name lowercased.
   - Check inner `class Meta:` for `table = "..."`.
   - Check `schema = "..."` in `Meta` for schema qualifier.
4. Abstract models have `abstract = True` in `Meta`.
5. The `Tortoise.init()` call's `modules` argument lists all model module paths — use this to discover where models live.

**Key Challenges**:
- Async context; purely static analysis — no execution needed.
- `generate_schemas()` call confirms intent to create tables from models.
- Model modules may be referenced by string in `Tortoise.init()`, requiring module path resolution.

**Analysis Tools**: `ast`, `tree-sitter-python`
**Complexity**: Low

---

## 9. SQLModel

**Name**: SQLModel
**Type**: Relational ORM (built on SQLAlchemy + Pydantic)
**Supported Databases**: Same as SQLAlchemy

**Detection Signals**:
- Dependencies: `sqlmodel` in requirements files.
- Imports: `from sqlmodel import SQLModel, Field`; `from sqlmodel import Session, select`
- Class inheritance from `SQLModel` with `table=True` in the class definition.

**Entity Definition Style**:
Class-based using Pydantic-style field annotations. A class is a database table only when `table=True` is passed to the class definition; otherwise it is a Pydantic validation model only.

```python
from sqlmodel import SQLModel, Field
from typing import Optional

class Hero(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    secret_name: str

    class Config:
        # or Meta in newer versions
        pass
```

**Extraction Approach**:
1. Detect `sqlmodel` dependency.
2. Parse all `.py` files with `ast`. Find class definitions where:
   - One of the base classes is `SQLModel` (or an import alias thereof), AND
   - The class keyword arguments include `table=True`.
3. Extract the class name; default table name is class name lowercased.
4. Check for `__tablename__` attribute or `table_name` in a `Config`/`Meta` inner class.
5. Classes without `table=True` are pure Pydantic models — do not count as database entities (but see section 26).

**Key Challenges**:
- Distinguishing table models (`table=True`) from plain validation models requires inspecting class keywords — this is an `ast.ClassDef.keywords` node in Python's AST.
- Inheritance hierarchies: a non-table parent may define shared fields for multiple table subclasses.
- SQLModel internally creates SQLAlchemy metadata; the two stacks can coexist.

**Analysis Tools**: `ast` (specifically `ClassDef.keywords`), `tree-sitter-python`
**Complexity**: Low

---

## 10. Pony ORM

**Name**: Pony ORM
**Type**: Relational ORM
**Supported Databases**: SQLite, PostgreSQL, MySQL/MariaDB, CockroachDB, Oracle

**Detection Signals**:
- Dependencies: `pony`, `ponyorm` in requirements files.
- Imports: `from pony.orm import Database, Required, Optional, Set, PrimaryKey`; `import pony.orm`
- Pattern: `db = Database()` followed by class definitions using `db.Entity` as a base.

**Entity Definition Style**:
Class-based using a `Database` object. Entities inherit from `db.Entity` where `db` is a `pony.orm.Database()` instance.

```python
from pony.orm import Database, Required, PrimaryKey

db = Database()

class Product(db.Entity):
    _table_ = "products"
    id = PrimaryKey(int, auto=True)
    name = Required(str)
```

**Extraction Approach**:
1. Detect `pony` dependency.
2. Parse `.py` files with `ast`. Find `Database()` instantiations and record the variable name (e.g., `db`).
3. Find class definitions whose base is `<db_var>.Entity`.
4. For each entity class:
   - Default table name: class name (Pony does not lowercase by default; actual behavior depends on version and database).
   - Check for `_table_ = "..."` attribute assignment to override.
5. Pony requires `db.generate_mapping()` to finalize; find this call to confirm the db is active.

**Key Challenges**:
- `db` may be renamed or imported from another module.
- Multiple `Database()` objects in one project are unusual but possible.
- Pony's metaclass does significant work at import time; static analysis catches only the surface definition.

**Analysis Tools**: `ast`, `tree-sitter-python`
**Complexity**: Low

---

## 11. Raw SQL — psycopg2 / psycopg3

**Name**: psycopg2 / psycopg3
**Type**: Raw SQL
**Supported Databases**: PostgreSQL

**Detection Signals**:
- Dependencies: `psycopg2`, `psycopg2-binary`, `psycopg` (psycopg3) in requirements files.
- Imports: `import psycopg2`; `import psycopg`; `from psycopg2 import connect`
- No ORM model classes; SQL strings passed to `cursor.execute(...)`.

**Entity Definition Style**:
No declarative entity definition. SQL DDL and DML are written as strings inside Python code or in separate `.sql` files. Entities are implicit in the SQL text.

```python
import psycopg2
conn = psycopg2.connect(DSN)
cur = conn.cursor()
cur.execute("INSERT INTO orders (user_id, total) VALUES (%s, %s)", (1, 99.99))
```

**Extraction Approach**:
1. Detect `psycopg2` / `psycopg` dependency and imports.
2. Parse `.py` files with `ast`. Find `cursor.execute(...)` and `cursor.executemany(...)` calls.
3. Extract the first argument (the SQL string) where it is a string literal, f-string, or concatenation.
4. Apply SQL parsing to the extracted strings using `sqlparse` or `sqlfluff`:
   - Match `CREATE TABLE [IF NOT EXISTS] <name>` — definitive entity.
   - Match `INSERT INTO <name>`, `UPDATE <name>`, `DELETE FROM <name>`, `SELECT ... FROM <name>` — entity references.
5. Also search for raw `.sql` files in the repo and parse those with SQL parsers.
6. For f-strings or format strings with variable table names, flag as "dynamic — cannot resolve statically."

**Key Challenges**:
- SQL strings may be split across multiple lines with string concatenation or triple-quoted strings.
- Parameterized queries use `%s` placeholders; the table name itself is rarely parameterized, but it can be (anti-pattern).
- Query strings may be loaded from files, environment variables, or a constants module.
- `cursor` variable name varies; may be aliased.

**Analysis Tools**: `ast`, `sqlparse`, `sqlfluff`, `tree-sitter-sql`
**Complexity**: High

---

## 12. Raw SQL — PyMySQL / mysql-connector-python

**Name**: PyMySQL / mysql-connector-python
**Type**: Raw SQL
**Supported Databases**: MySQL / MariaDB

**Detection Signals**:
- Dependencies: `pymysql`, `PyMySQL`, `mysql-connector-python`, `mysqlclient` in requirements files.
- Imports: `import pymysql`; `import mysql.connector`; `from pymysql import connect`

**Entity Definition Style**:
Same as psycopg2 — raw SQL strings, no declarative entity model.

**Extraction Approach**:
Identical to the psycopg2 approach: parse `cursor.execute(...)` calls and extract SQL strings. Apply `sqlparse` or `sqlfluff` to identify table names in DDL and DML statements.

**Key Challenges**: Same as psycopg2.

**Analysis Tools**: `ast`, `sqlparse`, `sqlfluff`
**Complexity**: High

---

## 13. Raw SQL — sqlite3 (stdlib)

**Name**: sqlite3
**Type**: Raw SQL
**Supported Databases**: SQLite

**Detection Signals**:
- No external dependency — stdlib module.
- Imports: `import sqlite3`; `from sqlite3 import connect`
- Patterns: `sqlite3.connect("file.db")`, `conn.execute("...")`, `conn.cursor()`

**Entity Definition Style**:
Same as psycopg2 — raw SQL strings. SQLite databases are also files; the filename (`.db`, `.sqlite`, `.sqlite3`) is itself a signal of a data entity namespace.

**Extraction Approach**:
1. Find `import sqlite3`.
2. Find `sqlite3.connect(...)` — the argument is the database file path (another entity signal).
3. Follow the same `cursor.execute()` SQL parsing approach as psycopg2.
4. Also check for `.db`, `.sqlite`, `.sqlite3` files in the repo — these are literal SQLite databases that may be committed.
5. Parse those database files using `sqlite3` at analysis time to enumerate tables (this is a runtime operation, not static analysis, but low-risk since SQLite files are self-contained).

**Key Challenges**:
- `:memory:` databases have no persistent schema and cannot be statically resolved.
- SQLite files committed to the repo can be inspected directly with `.schema`.

**Analysis Tools**: `ast`, `sqlparse`, `sqlite3` (for reading committed `.db` files)
**Complexity**: Medium

---

## 14. Raw SQL Migration Files (Flyway / Liquibase)

**Name**: Flyway / Liquibase (SQL migration files used alongside Python projects)
**Type**: Migration Tool (SQL-native)
**Supported Databases**: PostgreSQL, MySQL, SQLite, Oracle, SQL Server, and others depending on driver

**Detection Signals**:
- Flyway: directory named `db/migration/` or `src/main/resources/db/migration/` containing files named `V<version>__<description>.sql` (e.g., `V1__create_users.sql`).
- Liquibase: `changelog.xml`, `changelog.yaml`, `changelog.json`, or `db.changelog-master.xml`; changesets in `db/changelog/` or similar.
- Config files: `flyway.conf`, `flyway.toml`; `liquibase.properties`.
- Python project using Flyway: may invoke Flyway via `subprocess` or as a Docker service; no direct Python dependency.

**Entity Definition Style**:
Flyway: plain SQL DDL files. Liquibase: XML/YAML/JSON changesets wrapping DDL operations.

Flyway example (`V1__create_users.sql`):
```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL
);
```

Liquibase example (`changelog.xml`):
```xml
<changeSet id="1" author="dev">
    <createTable tableName="users">
        <column name="id" type="INT" autoIncrement="true"/>
    </createTable>
</changeSet>
```

**Extraction Approach**:

For Flyway:
1. Locate `V*.sql` files in migration directories.
2. Parse each SQL file using `sqlparse` or `sqlfluff`.
3. Extract `CREATE TABLE`, `DROP TABLE`, `RENAME TABLE` / `ALTER TABLE ... RENAME TO` statements.
4. Order files by version number to determine final schema state.

For Liquibase:
1. Locate `changelog.xml` / `changelog.yaml` / `changelog.json`.
2. Parse XML with `xml.etree.ElementTree` or `lxml`; YAML with `PyYAML`; JSON with `json`.
3. Find `<createTable tableName="...">` elements (XML) or `createTable: tableName: "..."` keys (YAML).
4. Also process `<include file="...">` to traverse referenced changelog files.
5. Order changesets by sequence to determine current state.

**Key Challenges**:
- Flyway supports repeatable migrations (`R__*.sql`) and undo migrations (`U__*.sql`) in addition to versioned ones.
- Liquibase changesets can use `runOnChange`, contexts, and labels that conditionally apply changes.
- SQL files may contain stored procedures, triggers, and views in addition to tables.
- Multi-schema setups qualify table names.

**Analysis Tools**: `sqlparse`, `sqlfluff`, `xml.etree.ElementTree`, `lxml`, `PyYAML`
**Complexity**: Medium (Flyway) / High (Liquibase)

---

## 15. Prisma Client Python

**Name**: Prisma Client Python
**Type**: Relational ORM / Code Generator
**Supported Databases**: PostgreSQL, MySQL, SQLite, MongoDB, SQL Server, CockroachDB

**Detection Signals**:
- Dependencies: `prisma` in requirements files.
- File: `schema.prisma` (or `prisma/schema.prisma`) in the repo root or a `prisma/` subdirectory.
- Generator block in schema: `generator client { provider = "prisma-client-py" }`.
- Generated client in `prisma/` directory.

**Entity Definition Style**:
Schema-file-based. Entities (called `model`) are defined in `schema.prisma` using Prisma Schema Language (PSL).

```prisma
model User {
  id    Int     @id @default(autoincrement())
  email String  @unique
  posts Post[]
}

model Post {
  id       Int    @id @default(autoincrement())
  title    String
  authorId Int
  author   User   @relation(fields: [authorId], references: [id])

  @@map("blog_posts")
}
```

**Extraction Approach**:
1. Locate `schema.prisma` file(s).
2. Parse the PSL file as text (no standard Python parser exists; use regex or a custom parser):
   - Find all `model <Name> { ... }` blocks.
   - The default table name is the model name. Check for `@@map("table_name")` attribute to override.
3. Also check `enum` blocks — these may map to database enum types.
4. The `datasource` block specifies the database provider and connection.
5. Cross-reference with generated `prisma/` output files if present for confirmation.

**Key Challenges**:
- PSL is not Python; requires a separate parser. Can use regex-based parsing or the `prisma` Python package's own schema parser if installed.
- `@@map` overrides the table name.
- `@@schema("schema_name")` applies to multi-schema setups (PostgreSQL).
- View models (`view`) are defined similarly to models in newer Prisma versions.

**Analysis Tools**: Regex, custom PSL parser, `prisma` Python package (if available)
**Complexity**: Low

---

## 16. MongoDB — MongoEngine

**Name**: MongoEngine
**Type**: NoSQL ODM
**Supported Databases**: MongoDB

**Detection Signals**:
- Dependencies: `mongoengine` in requirements files.
- Imports: `from mongoengine import Document, EmbeddedDocument, StringField, ...`; `import mongoengine`
- Connection: `mongoengine.connect(...)` call.
- Class inheritance from `mongoengine.Document` or `mongoengine.DynamicDocument`.

**Entity Definition Style**:
Class-based. Each collection is a class inheriting from `Document` or `DynamicDocument`.

```python
from mongoengine import Document, StringField, IntField

class User(Document):
    username = StringField(required=True)
    age = IntField()

    meta = {
        "collection": "users",
        "indexes": ["username"],
    }
```

**Extraction Approach**:
1. Detect `mongoengine` dependency.
2. Parse `.py` files with `ast`. Find classes inheriting from `Document`, `DynamicDocument`, `EmbeddedDocument`.
3. For each class:
   - Default collection name: class name lowercased.
   - Check for `meta` dict attribute; look for `"collection"` key to get explicit collection name.
   - `EmbeddedDocument` subclasses are embedded in other documents, not top-level collections — exclude from entity list unless important.
4. `abstract = True` in `meta` means no collection for that class.
5. `allow_inheritance = True` in `meta` enables class hierarchy in the collection.

**Key Challenges**:
- `meta` is a plain dict assignment; its keys are strings, requiring string literal detection.
- Multiple inheritance levels; intermediate abstract classes.
- `DynamicDocument` allows arbitrary fields not declared statically.
- `mongoengine.connect()` may specify a `db` argument that qualifies the collection namespace.

**Analysis Tools**: `ast`, `tree-sitter-python`
**Complexity**: Low

---

## 17. MongoDB — PyMongo

**Name**: PyMongo
**Type**: NoSQL Driver (Raw)
**Supported Databases**: MongoDB

**Detection Signals**:
- Dependencies: `pymongo` in requirements files.
- Imports: `from pymongo import MongoClient`; `import pymongo`
- Patterns: `client["dbname"]["collection_name"]`, `db.collection_name`, `db.get_collection("name")`

**Entity Definition Style**:
No declarative entity definition. Collections are referenced by string name directly on a database object.

```python
from pymongo import MongoClient

client = MongoClient("mongodb://localhost:27017/")
db = client["mydb"]
users = db["users"]
users.insert_one({"name": "Alice"})
```

**Extraction Approach**:
1. Detect `pymongo` dependency.
2. Parse `.py` files with `ast`.
3. Find `MongoClient(...)` instantiations. Track the resulting variable.
4. Find subscript operations on database objects: `client["dbname"]["collection_name"]` — extract both the database name and collection name as string literals.
5. Find attribute access: `db.users`, `db.orders` — attribute name is the collection name. Note: this is ambiguous since `db.something` might not always be a collection access.
6. Find `db.get_collection("name")` calls — extract string argument.
7. Find `db.create_collection("name")` — definitive collection creation.
8. Aggregate all unique collection name strings found.

**Key Challenges**:
- Database and collection names may be in variables, config files, or environment variables.
- `db.some_collection` attribute access is extremely ambiguous without type information.
- Dynamically constructed collection names (e.g., per-tenant sharding: `db[f"tenant_{tenant_id}_events"]`).
- Motor (async PyMongo) uses the exact same API surface — detection overlap is intentional.

**Analysis Tools**: `ast`, `tree-sitter-python`
**Complexity**: High

---

## 18. MongoDB — Motor (async PyMongo)

**Name**: Motor
**Type**: NoSQL Driver (Async Raw)
**Supported Databases**: MongoDB

**Detection Signals**:
- Dependencies: `motor` in requirements files.
- Imports: `from motor.motor_asyncio import AsyncIOMotorClient`; `import motor`
- Same collection access patterns as PyMongo but with `await` on operations.

**Entity Definition Style**:
Identical to PyMongo — no declarative entity model; collections accessed by string name.

**Extraction Approach**:
Identical to PyMongo approach. Look for `AsyncIOMotorClient(...)` as the entry point.

**Key Challenges**: Same as PyMongo.

**Analysis Tools**: `ast`, `tree-sitter-python`
**Complexity**: High

---

## 19. MongoDB — Beanie (ODM)

**Name**: Beanie
**Type**: NoSQL ODM (async, built on Pydantic)
**Supported Databases**: MongoDB

**Detection Signals**:
- Dependencies: `beanie` in requirements files.
- Imports: `from beanie import Document, Indexed, init_beanie`
- Class inheritance from `beanie.Document`.
- `init_beanie(database=..., document_models=[...])` call listing all document classes.

**Entity Definition Style**:
Class-based using Pydantic. Each collection is a class inheriting from `beanie.Document`.

```python
from beanie import Document, Indexed
from pydantic import Field

class Product(Document):
    name: str
    price: float = Field(gt=0)

    class Settings:
        name = "products"
```

**Extraction Approach**:
1. Detect `beanie` dependency.
2. Parse `.py` files with `ast`. Find classes inheriting from `Document` (from `beanie`).
3. For each class:
   - Default collection name: class name.
   - Check inner `class Settings:` for `name = "..."` to override collection name.
4. Find `init_beanie(document_models=[...])` — the list explicitly enumerates all managed document classes, providing a definitive roster.
5. Link the `Settings.name` values to get actual collection names.

**Key Challenges**:
- `init_beanie` may be called with a variable holding the model list rather than a literal list.
- Beanie supports `Link` and `BackLink` for inter-document references; these reference other collections.

**Analysis Tools**: `ast`, `tree-sitter-python`
**Complexity**: Low

---

## 20. Redis — redis-py / aioredis

**Name**: redis-py / aioredis
**Type**: NoSQL Key-Value Client
**Supported Databases**: Redis

**Detection Signals**:
- Dependencies: `redis`, `aioredis` in requirements files.
- Imports: `import redis`; `from redis import Redis`; `import aioredis`; `from redis.asyncio import Redis`
- Patterns: `r.set("key", ...)`, `r.get("key")`, `r.hset("hash_name", ...)`, `r.lpush("list_name", ...)`

**Entity Definition Style**:
No declarative entity model. Data structures are referenced by string key names. The logical entity is the key prefix or hash/list/set name.

```python
import redis

r = redis.Redis(host="localhost", port=6379)
r.set("session:abc123", user_data)
r.hset("user:1001", mapping={"name": "Alice"})
r.lpush("job_queue", job_id)
```

**Extraction Approach**:
1. Detect `redis` or `aioredis` dependency.
2. Parse `.py` files with `ast`. Find `Redis(...)` or `StrictRedis(...)` instantiations.
3. Find method calls on Redis client instances:
   - `r.set("key", ...)`, `r.get("key")`, `r.delete("key")` — scalar key.
   - `r.hset("hash", ...)`, `r.hget("hash", ...)`, `r.hgetall("hash")` — hash key.
   - `r.lpush("list", ...)`, `r.rpush("list", ...)`, `r.lrange("list", ...)` — list key.
   - `r.sadd("set", ...)`, `r.smembers("set", ...)` — set key.
   - `r.zadd("zset", ...)`, `r.zrange("zset", ...)` — sorted set key.
4. Extract string literal key names. Identify patterns: keys often use colon notation (`"user:*"`, `"session:*"`) — group by prefix to identify logical entities.
5. Flag dynamic keys (e.g., `f"user:{user_id}"`) and extract the prefix portion.

**Key Challenges**:
- Key names are almost always dynamic; only string prefixes are statically recoverable.
- No schema — Redis is schemaless, so "entities" are inferred from key naming conventions.
- `redis.from_url()` and connection pools add complexity in tracing the client variable.
- Higher-level abstractions (e.g., `django-redis`, `celery` using Redis as broker) add implicit key namespaces.

**Analysis Tools**: `ast`, `tree-sitter-python`
**Complexity**: High

---

## 21. Elasticsearch — elasticsearch-py

**Name**: elasticsearch-py (low-level client)
**Type**: NoSQL Search Index Client
**Supported Databases**: Elasticsearch, OpenSearch

**Detection Signals**:
- Dependencies: `elasticsearch`, `elasticsearch7`, `elasticsearch8`, `opensearch-py` in requirements files.
- Imports: `from elasticsearch import Elasticsearch`; `import elasticsearch`
- Patterns: `es.index(index="...", body=...)`, `es.search(index="...")`, `es.indices.create(index="...")`

**Entity Definition Style**:
No declarative entity model. Indices are referenced by string name in API calls.

```python
from elasticsearch import Elasticsearch

es = Elasticsearch()
es.indices.create(index="products", body={"mappings": {...}})
es.index(index="products", document={"name": "Widget"})
```

**Extraction Approach**:
1. Detect `elasticsearch` dependency.
2. Parse `.py` files with `ast`. Find `Elasticsearch(...)` instantiations.
3. Find method calls on `es` (or aliased) client objects:
   - `es.index(index="name", ...)` — index name.
   - `es.search(index="name", ...)` or `es.search(index=["name1", "name2"], ...)` — index name or list.
   - `es.indices.create(index="name", ...)` — definitive index creation.
   - `es.indices.delete(index="name", ...)` — deletion.
   - `es.indices.put_mapping(index="name", ...)` — confirms index existence.
4. Extract string literals for the `index` keyword argument or positional argument.
5. Also search for index name constants defined as module-level strings (e.g., `PRODUCTS_INDEX = "products"`).

**Key Challenges**:
- Index names may be versioned with aliases (e.g., `products_v2` aliased to `products`).
- Multi-index search uses `index="*"` or a comma-separated string — cannot enumerate.
- OpenSearch uses an identical API surface; detection is the same.
- Index templates define schemas for dynamically created indices — must parse `es.indices.put_template(...)`.

**Analysis Tools**: `ast`, `tree-sitter-python`
**Complexity**: Medium

---

## 22. Elasticsearch — elasticsearch-dsl

**Name**: elasticsearch-dsl
**Type**: NoSQL ODM / Query Builder
**Supported Databases**: Elasticsearch, OpenSearch

**Detection Signals**:
- Dependencies: `elasticsearch-dsl` in requirements files.
- Imports: `from elasticsearch_dsl import Document, Index, Keyword, Text, ...`; `from elasticsearch_dsl import Search`
- Class inheritance from `elasticsearch_dsl.Document`.

**Entity Definition Style**:
Class-based. Each index is defined as a class inheriting from `elasticsearch_dsl.Document`.

```python
from elasticsearch_dsl import Document, Text, Keyword, Date

class Article(Document):
    title = Text()
    author = Keyword()
    published = Date()

    class Index:
        name = "articles"
        settings = {"number_of_shards": 1}
```

**Extraction Approach**:
1. Detect `elasticsearch-dsl` dependency.
2. Parse `.py` files with `ast`. Find classes inheriting from `Document` (from `elasticsearch_dsl`).
3. For each class:
   - Check inner `class Index:` for `name = "..."` — this is the index name.
   - If no `class Index:` present, the default index name is the class name lowercased.
4. Also look for `Index("name")` standalone objects used for index management without a Document class.
5. `init()` / `save()` / `search()` calls on document instances confirm active indices.

**Key Challenges**:
- Index aliases can decouple the logical name from the physical index name.
- Dynamic index names based on date patterns (e.g., `"logs-2024.01.01"`) are common but not statically resolvable.

**Analysis Tools**: `ast`, `tree-sitter-python`
**Complexity**: Low

---

## 23. Cassandra — cassandra-driver

**Name**: cassandra-driver
**Type**: NoSQL Driver (Raw CQL)
**Supported Databases**: Apache Cassandra, DataStax Astra

**Detection Signals**:
- Dependencies: `cassandra-driver` in requirements files.
- Imports: `from cassandra.cluster import Cluster`; `from cassandra.cqlengine import columns, models`; `import cassandra`
- Patterns: `Cluster([...]).connect("keyspace")`, `session.execute("CQL string")`

**Entity Definition Style**:
Two modes:

**Raw CQL** (similar to raw SQL):
```python
from cassandra.cluster import Cluster
cluster = Cluster()
session = cluster.connect("mykeyspace")
session.execute("INSERT INTO users (id, name) VALUES (%s, %s)", (1, "Alice"))
```

**CQLEngine ORM**:
```python
from cassandra.cqlengine import columns
from cassandra.cqlengine.models import Model

class User(Model):
    __keyspace__ = "mykeyspace"
    __table_name__ = "users"
    id = columns.UUID(primary_key=True)
    name = columns.Text()
```

**Extraction Approach**:

For raw CQL:
1. Find `session.execute(...)` calls and extract CQL string literals.
2. Parse CQL strings: `CREATE TABLE [IF NOT EXISTS] <keyspace>.<table>` or just `<table>` within a connected keyspace.
3. Also parse `CREATE KEYSPACE` statements for the keyspace name.

For CQLEngine ORM:
1. Find classes inheriting from `cassandra.cqlengine.models.Model`.
2. Extract `__table_name__` attribute (explicit table name) or fall back to class name lowercased.
3. Extract `__keyspace__` for full qualification.

**Key Challenges**:
- CQL and SQL look similar but are not identical; use a CQL-aware parser or extend SQL regex patterns.
- Keyspace + table forms the full entity identifier.
- Materialized views and secondary indices in Cassandra may appear in DDL.

**Analysis Tools**: `ast`, `sqlparse` (partial CQL support), regex for CQL DDL patterns
**Complexity**: Medium

---

## 24. DynamoDB — boto3

**Name**: boto3 (DynamoDB)
**Type**: NoSQL AWS Managed Database Client
**Supported Databases**: Amazon DynamoDB

**Detection Signals**:
- Dependencies: `boto3` in requirements files.
- Imports: `import boto3`; `from boto3.dynamodb.conditions import Key, Attr`
- Patterns: `boto3.resource("dynamodb")`, `boto3.client("dynamodb")`, `dynamodb.Table("name")`, `client.create_table(TableName="...")`

**Entity Definition Style**:
No declarative entity model. Tables are referenced by string name.

```python
import boto3

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table("Users")
table.put_item(Item={"id": "1", "name": "Alice"})

# Or via low-level client
client = boto3.client("dynamodb")
client.create_table(TableName="Orders", ...)
```

**Extraction Approach**:
1. Detect `boto3` dependency.
2. Parse `.py` files with `ast`. Find `boto3.resource("dynamodb")` and `boto3.client("dynamodb")` calls.
3. For the high-level resource:
   - Find `.Table("name")` calls on the dynamodb resource object — extract string argument.
4. For the low-level client:
   - Find `client.create_table(TableName="...")` — extract `TableName` value.
   - Find `client.put_item(TableName="...")`, `client.get_item(TableName="...")`, `client.query(TableName="...")`, etc.
5. Also check CloudFormation/SAM templates (`template.yaml`, `serverless.yml`) in the repo for `AWS::DynamoDB::Table` resources, which define tables that boto3 then accesses.

**Key Challenges**:
- Table names often come from environment variables (`os.environ["USERS_TABLE"]`) or config — flag as "runtime-configured."
- A single `Table` object may be reused for many operations — only need to find the first reference.
- AWS CDK (Python) may define tables in infrastructure code using `aws_cdk.aws_dynamodb.Table(...)`.

**Analysis Tools**: `ast`, `tree-sitter-python`; YAML/JSON parsers for CloudFormation templates
**Complexity**: Medium

---

## 25. Google Cloud Datastore / Firestore

**Name**: google-cloud-datastore / google-cloud-firestore
**Type**: NoSQL Cloud Database Client
**Supported Databases**: Google Cloud Datastore, Google Cloud Firestore

**Detection Signals**:
- Dependencies: `google-cloud-datastore`, `google-cloud-firestore` in requirements files.
- Imports: `from google.cloud import datastore`; `from google.cloud import firestore`; `import google.cloud.firestore`

**Entity Definition Style** (Datastore):
Entities have a `Kind` (equivalent to a collection/table). Accessed via string kind names.

```python
from google.cloud import datastore

client = datastore.Client()
key = client.key("User", 12345)
entity = datastore.Entity(key=key)
entity.update({"name": "Alice"})
client.put(entity)
```

**Entity Definition Style** (Firestore):
Hierarchical: `Collection > Document > SubCollection`. Collections are referenced by string name.

```python
from google.cloud import firestore

db = firestore.Client()
db.collection("users").add({"name": "Alice"})
db.collection("orders").document("order_001").set({"total": 99.99})
```

**Extraction Approach**:

For Datastore:
1. Find `client.key("Kind", ...)` calls — first argument is the Kind name (entity type).
2. Find `datastore.Entity(key=...)` — follows from step 1.
3. Find `client.query(kind="Kind")` — direct kind reference.

For Firestore:
1. Find `db.collection("name")` calls — extract string argument as collection name.
2. Find `db.collection("name").document("id").collection("subcollection")` — nested collection names.
3. Enumerate unique collection names from all such call chains.

**Key Challenges**:
- Firestore subcollections create a hierarchical namespace; the full path matters.
- Collection names often constructed from constants or variables.
- NDB (older Google App Engine datastore ORM) uses `ndb.Model` subclasses with `_get_kind()` — separate detection needed.
- `google-cloud-ndb` has class-based models similar to Django.

**Analysis Tools**: `ast`, `tree-sitter-python`
**Complexity**: Medium

---

## 26. Pydantic Models as Entity Signals

**Name**: Pydantic
**Type**: Data Validation / Entity Signal
**Supported Databases**: N/A (not a database library, but models are strong entity signals)

**Detection Signals**:
- Dependencies: `pydantic` in requirements files.
- Imports: `from pydantic import BaseModel`; `from pydantic.v1 import BaseModel`
- Class inheritance from `BaseModel`.
- Location of model files: `schemas.py`, `models.py`, `entities.py`, `domain/`, `api/schemas/`.

**Entity Definition Style**:
Class-based. Pydantic models are Python classes inheriting from `BaseModel` with typed field annotations.

```python
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class Order(BaseModel):
    id: int
    user_id: int
    total: float
    created_at: datetime
    notes: Optional[str] = None
```

**Extraction Approach**:
1. Detect `pydantic` dependency.
2. Parse `.py` files with `ast`. Find classes inheriting from `BaseModel` (or `pydantic.BaseModel`).
3. Collect class names — these represent logical data shapes, which often correspond 1:1 with database entities.
4. Distinguish from database models: Pydantic models are most significant as entity signals when:
   - They live in `schemas.py`, `models.py`, `domain/*.py`, `entities/*.py`.
   - They are used as type annotations for ORM model fields or serialization of ORM query results.
   - They contain fields that match ORM model fields (use fuzzy name matching).
5. Do NOT treat all Pydantic models as entities — request/response schemas, config models, etc. are distinct.
6. Confidence heuristic: higher confidence if the class name appears in route/handler return types or in an ORM `from_orm()` call.

**Key Challenges**:
- Differentiating "domain entity" Pydantic models from "DTO / request schema" models requires context analysis.
- `RootModel`, `model_validator`, and computed fields in Pydantic v2 add complexity.
- SQLModel (`table=True`) and Beanie extend Pydantic — handle those separately as ORM entities.

**Analysis Tools**: `ast`, `tree-sitter-python`
**Complexity**: Medium

---

## 27. Python Dataclasses as Entity Signals

**Name**: Python Dataclasses (`dataclasses` stdlib)
**Type**: Data Structure / Entity Signal
**Supported Databases**: N/A (not a database library; signals domain entities)

**Detection Signals**:
- No external dependency — stdlib.
- Imports: `from dataclasses import dataclass, field`; `import dataclasses`
- Decorator: `@dataclass` or `@dataclasses.dataclass` applied to a class.
- File patterns: `domain/`, `entities/`, `models/`, `core/`.

**Entity Definition Style**:
Decorator-based. A plain Python class with the `@dataclass` decorator becomes a structured data class.

```python
from dataclasses import dataclass, field
from typing import List, Optional
from datetime import datetime

@dataclass
class Invoice:
    id: int
    customer_id: int
    line_items: List[dict] = field(default_factory=list)
    issued_at: datetime = field(default_factory=datetime.utcnow)
    paid: bool = False
```

**Extraction Approach**:
1. No dependency to detect — search all `.py` files.
2. Parse with `ast`. Find classes decorated with `dataclass` (check `decorator_list` on `ClassDef` nodes for `Name` nodes with id `"dataclass"` or `Attribute` nodes with attr `"dataclass"`).
3. Collect class names and their field names.
4. Entity signal confidence is context-dependent:
   - Higher confidence: dataclass is in a file named `entities.py`, `domain.py`, `models.py`, or in a `domain/` or `entities/` directory.
   - Higher confidence: the dataclass is used as a return type of a repository class or DAO method.
   - Lower confidence: dataclass is used for configuration, CLI args, or simple data transfer.
5. Do not assume all dataclasses are entities — narrow by module location and usage context.

**Key Challenges**:
- No inherent database connection; purely a signal of a domain concept.
- `@dataclass(frozen=True)` and `@dataclass(eq=True)` variants — all are structurally the same.
- May coexist with ORM models (ORM entity → dataclass for business logic layer).
- `attrs` and Pydantic can replace dataclasses; check all three.

**Analysis Tools**: `ast`, `tree-sitter-python`
**Complexity**: Low (detection) / Medium (entity signal disambiguation)

---

## 28. attrs as Entity Signals

**Name**: attrs
**Type**: Data Structure / Entity Signal
**Supported Databases**: N/A (not a database library; signals domain entities)

**Detection Signals**:
- Dependencies: `attrs`, `attr` in requirements files.
- Imports: `import attr`; `import attrs`; `from attr import s, ib, attrib`; `from attrs import define, field`
- Decorators: `@attr.s`, `@attrs.define`, `@attr.attrs`, `@define` applied to classes.

**Entity Definition Style**:
Decorator-based, similar to dataclasses but predating them. Two style generations: legacy (`@attr.s` with `attr.ib()`) and modern (`@attrs.define` with `attrs.field()`).

```python
# Modern style
import attrs

@attrs.define
class Payment:
    id: int
    amount: float
    currency: str = "USD"
    status: str = attrs.field(default="pending")

# Legacy style
import attr

@attr.s
class Payment:
    id = attr.ib()
    amount = attr.ib()
```

**Extraction Approach**:
1. Detect `attrs` / `attr` dependency.
2. Parse `.py` files with `ast`. Find classes decorated with:
   - `attr.s`, `attr.attrs`, `attr.make_class` (legacy).
   - `attrs.define`, `attrs.mutable`, `attrs.frozen` (modern).
3. Collect class names and field names.
4. Apply the same context-based confidence heuristics as dataclasses (section 27): look at file/directory names and how the classes are used.

**Key Challenges**:
- Two generations of API (`attr` vs `attrs` module, `@attr.s` vs `@attrs.define`) both need to be detected.
- `attr.make_class("Name", fields)` creates a class dynamically from a string name and field list — partially statically analyzable.
- attrs classes used purely as value objects (config, events) are not entities.

**Analysis Tools**: `ast`, `tree-sitter-python`
**Complexity**: Low

---

## Repository Detection Plan

Given a Python repository of unknown composition, use the following ordered detection strategy to identify which data entity storage approaches are in use. Higher-confidence signals are checked first; lower-confidence signals are used as supplementary confirmation.

### Phase 1: Dependency File Scan (Highest Confidence)

Parse the following files for package names:
- `requirements.txt`, `requirements/*.txt`, `requirements-*.txt`
- `pyproject.toml` — `[project.dependencies]`, `[tool.poetry.dependencies]`, `[tool.poetry.dev-dependencies]`
- `setup.py`, `setup.cfg` — `install_requires`, `extras_require`
- `Pipfile`, `Pipfile.lock`
- `conda.yaml`, `environment.yml`

Build a dependency set and match against:

| Package Name(s) | Indicates |
|---|---|
| `sqlalchemy`, `SQLAlchemy` | SQLAlchemy (ORM or Core) |
| `alembic` | Alembic migrations |
| `django`, `Django` | Django ORM + migrations |
| `peewee` | Peewee ORM |
| `tortoise-orm` | Tortoise ORM |
| `sqlmodel` | SQLModel |
| `pony`, `ponyorm` | Pony ORM |
| `psycopg2`, `psycopg2-binary`, `psycopg` | Raw PostgreSQL SQL |
| `pymysql`, `mysql-connector-python`, `mysqlclient` | Raw MySQL SQL |
| `prisma` | Prisma Client Python |
| `mongoengine` | MongoEngine ODM |
| `pymongo` | PyMongo (raw) |
| `motor` | Motor (async MongoDB) |
| `beanie` | Beanie ODM |
| `redis`, `redis-py` | redis-py |
| `aioredis` | aioredis (async Redis) |
| `elasticsearch`, `elasticsearch7`, `elasticsearch8` | elasticsearch-py |
| `elasticsearch-dsl` | elasticsearch-dsl |
| `cassandra-driver` | Cassandra driver |
| `boto3` | AWS services including DynamoDB |
| `google-cloud-datastore` | Datastore |
| `google-cloud-firestore` | Firestore |
| `google-cloud-ndb` | NDB (Datastore ORM) |
| `pydantic` | Pydantic models (entity signal) |
| `attrs`, `attr` | attrs (entity signal) |

`sqlite3` needs no dependency check (it is stdlib).
`dataclasses` needs no dependency check (it is stdlib since Python 3.7).

---

### Phase 2: Configuration and Schema File Scan (High Confidence)

Check for the following files/directories regardless of dependencies:

| File / Pattern | Indicates |
|---|---|
| `manage.py` at repo root | Django project |
| `alembic.ini` | Alembic migrations |
| `alembic/versions/*.py` | Alembic migration files |
| `*/migrations/0001_*.py` | Django migrations |
| `schema.prisma` or `prisma/schema.prisma` | Prisma |
| `V[0-9]*__*.sql` in any `migration*` or `db` directory | Flyway SQL migrations |
| `changelog.xml`, `db.changelog*.xml` | Liquibase |
| `changelog.yaml` / `changelog.yml` with Liquibase structure | Liquibase |
| `*.db`, `*.sqlite`, `*.sqlite3` files | SQLite databases (committed) |
| `settings.py` or `config/settings.py` with `DATABASES` key | Django ORM |

---

### Phase 3: Import and Code Pattern Scan (Medium-High Confidence)

For each candidate framework detected in phases 1–2, parse the Python source tree to confirm and locate entity definitions:

1. **SQLAlchemy**: Find `declarative_base()` or `class Base(DeclarativeBase)` → confirms Declarative ORM. Find `Table("name", metadata, ...)` without ORM mapping → confirms Core.
2. **Django**: Find `from django.db import models` and `class X(models.Model)` in `models.py` files.
3. **Peewee**: Find `from peewee import Model` and classes inheriting `Model`.
4. **Tortoise**: Find `from tortoise.models import Model` and `Tortoise.init(...)`.
5. **SQLModel**: Find `from sqlmodel import SQLModel` and `class X(SQLModel, table=True)`.
6. **Pony ORM**: Find `db = Database()` and `class X(db.Entity)`.
7. **MongoEngine**: Find `from mongoengine import Document` and `class X(Document)`.
8. **Beanie**: Find `from beanie import Document` and `init_beanie(...)`.
9. **elasticsearch-dsl**: Find `from elasticsearch_dsl import Document` and `class X(Document)`.
10. **CQLEngine**: Find `from cassandra.cqlengine.models import Model` and subclasses.
11. **PyMongo / Motor**: Find `MongoClient(...)` or `AsyncIOMotorClient(...)`.
12. **DynamoDB (boto3)**: Find `boto3.resource("dynamodb")` or `boto3.client("dynamodb")`.
13. **Firestore**: Find `firestore.Client()` and `.collection("name")` calls.
14. **Datastore**: Find `datastore.Client()` and `client.key("Kind", ...)` calls.
15. **redis-py**: Find `redis.Redis(...)` and key operation calls.
16. **elasticsearch-py**: Find `Elasticsearch(...)` and `es.index(index="...")` calls.
17. **Pydantic**: Find `from pydantic import BaseModel` and subclasses — flag as "entity signal" (medium confidence).
18. **dataclasses**: Find `@dataclass` decorators — flag as "entity signal" (low-medium confidence).
19. **attrs**: Find `@attr.s` / `@attrs.define` decorators — flag as "entity signal" (low-medium confidence).

---

### Phase 4: Raw SQL Fallback Scan

If no ORM is detected but a database driver is present (psycopg2, pymysql, sqlite3), scan all `.py` files and `.sql` files for:
- `CREATE TABLE` / `CREATE TABLE IF NOT EXISTS` statements.
- `INSERT INTO`, `UPDATE`, `DELETE FROM`, `SELECT ... FROM` statements (for confirming entity names even without DDL).

Use `sqlparse` to tokenize and identify table names.

---

### Phase 5: Confidence Scoring and Output

Combine all signals and assign confidence levels:

| Signal Type | Confidence |
|---|---|
| Dependency + ORM class definition found | High |
| Migration files with `CREATE TABLE` | High |
| Schema file (`schema.prisma`, `changelog.xml`) | High |
| Dependency + raw driver usage with SQL literals | Medium |
| ORM class found but dependency not in requirements (may be transitive) | Medium |
| Pydantic/dataclass/attrs class in `models.py` or `entities.py` | Medium |
| Pydantic/dataclass/attrs class in other locations | Low |
| Raw SQL strings with table names, no driver import found | Low |
| Dynamic table/collection names (f-strings, variables) | Flag as "dynamic — manual review required" |

---

### Recommended Tool Stack for Analysis

- **AST parsing**: Python's built-in `ast` module for all Python source files.
- **Structured AST traversal**: `libcst` for comment/formatting-preserving transformations; `astroid` for cross-module type inference.
- **Grammar-based parsing**: `tree-sitter` with `tree-sitter-python` grammar for robust parsing of malformed or unusual Python files.
- **SQL parsing**: `sqlparse` for tokenizing SQL strings; `sqlfluff` for dialect-aware analysis (PostgreSQL, MySQL, SQLite, etc.).
- **YAML parsing**: `PyYAML` or `ruamel.yaml` for Liquibase changelogs and CloudFormation templates.
- **XML parsing**: `xml.etree.ElementTree` (stdlib) or `lxml` for Liquibase XML.
- **TOML parsing**: `tomllib` (stdlib, Python 3.11+) or `tomli` for `pyproject.toml`.
- **File search**: `pathlib.Path.rglob()` for locating files by name pattern.
- **SQLite inspection**: `sqlite3` module to open and query `.db` files committed in the repo.
