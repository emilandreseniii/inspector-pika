import { BaseExtractor, ExtractorContext } from './extractors/base'
import { JpaExtractor } from './extractors/languages/java/jpa'
import { MybatisExtractor } from './extractors/languages/java/mybatis'
import { JooqExtractor } from './extractors/languages/java/jooq'
import { SpringDataJdbcExtractor } from './extractors/languages/java/springDataJdbc'
import { SqlAlchemyExtractor } from './extractors/languages/python/sqlalchemy'
import { DjangoExtractor } from './extractors/languages/python/django'
import { TortoiseOrmExtractor } from './extractors/languages/python/tortoiseOrm'
import { PeeweeExtractor } from './extractors/languages/python/peewee'
import { PrismaExtractor } from './extractors/languages/typescript/prisma'
import { TypeOrmExtractor } from './extractors/languages/typescript/typeorm'
import { DrizzleExtractor } from './extractors/languages/typescript/drizzle'
import { SequelizeExtractor } from './extractors/languages/typescript/sequelize'
import { MongooseExtractor } from './extractors/languages/typescript/mongoose'
import { GormExtractor } from './extractors/languages/go/gorm'
import { EntExtractor } from './extractors/languages/go/ent'
import { SqlcExtractor } from './extractors/languages/go/sqlc'
import { ActiveRecordExtractor } from './extractors/languages/ruby/activeRecord'
import { SequelExtractor as SequelRubyExtractor } from './extractors/languages/ruby/sequel'
import { EfCoreExtractor } from './extractors/languages/csharp/efCore'
import { DieselExtractor } from './extractors/languages/rust/diesel'
import { SeaOrmExtractor } from './extractors/languages/rust/seaOrm'
import { SqlxExtractor } from './extractors/languages/rust/sqlx'
import { EloquentExtractor } from './extractors/languages/php/eloquent'
import { DoctrineExtractor } from './extractors/languages/php/doctrine'
import { SqlDdlExtractor } from './extractors/shared/sqlDdlExtractor'
import { MigrationFileExtractor } from './extractors/shared/migrationFileExtractor'

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

// ---- Cross-language ----
register('cross-language', 'sql_ddl',           SqlDdlExtractor)
register('cross-language', 'migration_files',   MigrationFileExtractor)

// ---- Stubs for future extractors (no-op placeholders) ----
// These will be replaced with real implementations over time.
// Registering them here means the detector can detect them and
// the registry won't emit "no extractor registered" warnings.

// ---- Python ----
register('Python', 'sqlalchemy',    SqlAlchemyExtractor)
register('Python', 'django_orm',    DjangoExtractor)
register('Python', 'tortoise_orm',  TortoiseOrmExtractor)
register('Python', 'peewee',        PeeweeExtractor)

// ---- JavaScript / TypeScript ----
register('TypeScript', 'prisma',      PrismaExtractor)
register('TypeScript', 'typeorm',     TypeOrmExtractor)
register('JavaScript', 'typeorm',     TypeOrmExtractor)
register('TypeScript', 'drizzle_orm', DrizzleExtractor)
register('TypeScript', 'sequelize',   SequelizeExtractor)
register('JavaScript', 'sequelize',   SequelizeExtractor)
register('TypeScript', 'mongoose',    MongooseExtractor)
register('JavaScript', 'mongoose',    MongooseExtractor)

// ---- Ruby ----
register('Ruby', 'active_record', ActiveRecordExtractor)
register('Ruby', 'sequel',        SequelRubyExtractor)

// ---- C# ----
register('C#', 'ef_core', EfCoreExtractor)

// ---- Go ----
register('Go', 'gorm', GormExtractor)
register('Go', 'ent',  EntExtractor)
register('Go', 'sqlc', SqlcExtractor)

// ---- Rust ----
register('Rust', 'diesel',  DieselExtractor)
register('Rust', 'sea_orm', SeaOrmExtractor)
register('Rust', 'sqlx',    SqlxExtractor)

// ---- PHP ----
register('PHP', 'eloquent', EloquentExtractor)
register('PHP', 'doctrine', DoctrineExtractor)

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
