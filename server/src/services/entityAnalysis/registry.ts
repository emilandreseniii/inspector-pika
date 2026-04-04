import { BaseExtractor, ExtractorContext } from './extractors/base'
import { JpaExtractor } from './extractors/languages/java/jpa'
import { MybatisExtractor } from './extractors/languages/java/mybatis'
import { JooqExtractor } from './extractors/languages/java/jooq'
import { SpringDataJdbcExtractor } from './extractors/languages/java/springDataJdbc'
import { SqlAlchemyExtractor } from './extractors/languages/python/sqlalchemy'
import { DjangoExtractor } from './extractors/languages/python/django'
import { TortoiseOrmExtractor } from './extractors/languages/python/tortoiseOrm'
import { PeeweeExtractor } from './extractors/languages/python/peewee'
import { SqlModelExtractor } from './extractors/languages/python/sqlModel'
import { BeanieExtractor } from './extractors/languages/python/beanie'
import { ExposedExtractor } from './extractors/languages/kotlin/exposed'
import { KtormExtractor } from './extractors/languages/kotlin/ktorm'
import { PrismaExtractor } from './extractors/languages/typescript/prisma'
import { TypeOrmExtractor } from './extractors/languages/typescript/typeorm'
import { DrizzleExtractor } from './extractors/languages/typescript/drizzle'
import { SequelizeExtractor } from './extractors/languages/typescript/sequelize'
import { MongooseExtractor } from './extractors/languages/typescript/mongoose'
import { MikroOrmExtractor } from './extractors/languages/typescript/mikroOrm'
import { GormExtractor } from './extractors/languages/go/gorm'
import { EntExtractor } from './extractors/languages/go/ent'
import { SqlcExtractor } from './extractors/languages/go/sqlc'
import { SqlboilerExtractor } from './extractors/languages/go/sqlboiler'
import { BunOrmExtractor } from './extractors/languages/go/bunOrm'
import { ActiveRecordExtractor } from './extractors/languages/ruby/activeRecord'
import { SequelExtractor as SequelRubyExtractor } from './extractors/languages/ruby/sequel'
import { MongoidExtractor } from './extractors/languages/ruby/mongoid'
import { RomExtractor } from './extractors/languages/ruby/rom'
import { EfCoreExtractor } from './extractors/languages/csharp/efCore'
import { DapperExtractor } from './extractors/languages/csharp/dapper'
import { NHibernateExtractor } from './extractors/languages/csharp/nhibernate'
import { DieselExtractor } from './extractors/languages/rust/diesel'
import { SeaOrmExtractor } from './extractors/languages/rust/seaOrm'
import { SqlxExtractor } from './extractors/languages/rust/sqlx'
import { EloquentExtractor } from './extractors/languages/php/eloquent'
import { DoctrineExtractor } from './extractors/languages/php/doctrine'
import { CycleOrmExtractor } from './extractors/languages/php/cycleOrm'
import { PropelExtractor } from './extractors/languages/php/propel'
import { SlickExtractor } from './extractors/languages/scala/slick'
import { DoobieExtractor } from './extractors/languages/scala/doobie'
import { QuillExtractor } from './extractors/languages/scala/quill'
import { EctoExtractor } from './extractors/languages/elixir/ecto'
import { FluentExtractor } from './extractors/languages/swift/fluent'
import { GrdbExtractor } from './extractors/languages/swift/grdb'
import { SqlDdlExtractor } from './extractors/shared/sqlDdlExtractor'
import { MigrationFileExtractor } from './extractors/shared/migrationFileExtractor'
import { ProtoMessagesExtractor } from './extractors/shared/protoMessages'

type ExtractorClass = new (ctx: ExtractorContext) => BaseExtractor

const registry = new Map<string, ExtractorClass>()

function register(language: string, approach: string, cls: ExtractorClass) {
  registry.set(`${language}:${approach}`, cls)
}

// ---- Java / Kotlin ----
register('Java',   'jpa_hibernate',     JpaExtractor)
register('Kotlin', 'jpa_hibernate',     JpaExtractor)   // same annotations
register('Java',   'mybatis',           MybatisExtractor)
register('Java',   'jooq',              JooqExtractor)
register('Java',   'spring_data_jdbc', SpringDataJdbcExtractor)
register('Kotlin', 'spring_data_jdbc', SpringDataJdbcExtractor)
register('Kotlin', 'exposed',          ExposedExtractor)
register('Kotlin', 'ktorm',            KtormExtractor)

// ---- Cross-language ----
register('cross-language', 'sql_ddl',           SqlDdlExtractor)
register('cross-language', 'migration_files',   MigrationFileExtractor)
register('cross-language', 'proto_messages',    ProtoMessagesExtractor)

// ---- Stubs for future extractors (no-op placeholders) ----
// These will be replaced with real implementations over time.
// Registering them here means the detector can detect them and
// the registry won't emit "no extractor registered" warnings.

// ---- Python ----
register('Python', 'sqlalchemy',    SqlAlchemyExtractor)
register('Python', 'django_orm',    DjangoExtractor)
register('Python', 'tortoise_orm',  TortoiseOrmExtractor)
register('Python', 'peewee',        PeeweeExtractor)
register('Python', 'sql_model',     SqlModelExtractor)
register('Python', 'beanie',        BeanieExtractor)

// ---- JavaScript / TypeScript ----
register('TypeScript', 'prisma',      PrismaExtractor)
register('TypeScript', 'typeorm',     TypeOrmExtractor)
register('JavaScript', 'typeorm',     TypeOrmExtractor)
register('TypeScript', 'drizzle_orm', DrizzleExtractor)
register('TypeScript', 'sequelize',   SequelizeExtractor)
register('JavaScript', 'sequelize',   SequelizeExtractor)
register('TypeScript', 'mongoose',    MongooseExtractor)
register('JavaScript', 'mongoose',    MongooseExtractor)
register('TypeScript', 'mikro_orm',   MikroOrmExtractor)

// ---- Ruby ----
register('Ruby', 'active_record', ActiveRecordExtractor)
register('Ruby', 'sequel',        SequelRubyExtractor)
register('Ruby', 'mongoid',       MongoidExtractor)
register('Ruby', 'rom',           RomExtractor)

// ---- C# ----
register('C#', 'ef_core', EfCoreExtractor)
register('C#', 'dapper',      DapperExtractor)
register('C#', 'nhibernate',  NHibernateExtractor)

// ---- Go ----
register('Go', 'gorm', GormExtractor)
register('Go', 'ent',  EntExtractor)
register('Go', 'sqlc',     SqlcExtractor)
register('Go', 'sqlboiler', SqlboilerExtractor)
register('Go', 'bun_orm',   BunOrmExtractor)

// ---- Rust ----
register('Rust', 'diesel',  DieselExtractor)
register('Rust', 'sea_orm', SeaOrmExtractor)
register('Rust', 'sqlx',    SqlxExtractor)

// ---- PHP ----
register('PHP', 'eloquent', EloquentExtractor)
register('PHP', 'doctrine', DoctrineExtractor)
register('PHP', 'cycle_orm', CycleOrmExtractor)
register('PHP', 'propel',    PropelExtractor)

// ---- Scala ----
register('Scala', 'slick',  SlickExtractor)
register('Scala', 'doobie', DoobieExtractor)
register('Scala', 'quill',  QuillExtractor)

// ---- Elixir ----
register('Elixir', 'ecto', EctoExtractor)

// ---- Swift ----
register('Swift', 'fluent', FluentExtractor)
register('Swift', 'grdb',   GrdbExtractor)

export function getExtractor(
  language: string,
  approach: string,
  ctx: ExtractorContext,
): BaseExtractor | null {
  const cls = registry.get(`${language}:${approach}`)
  if (!cls) return null
  return new cls(ctx)
}

export function hasExtractor(language: string, approach: string): boolean {
  return registry.has(`${language}:${approach}`)
}
