import { BaseExtractor, ExtractorContext } from './extractors/base'
import { JpaExtractor } from './extractors/languages/java/jpa'
import { MybatisExtractor } from './extractors/languages/java/mybatis'
import { JooqExtractor } from './extractors/languages/java/jooq'
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

// ---- Cross-language ----
register('cross-language', 'sql_ddl',           SqlDdlExtractor)
register('cross-language', 'migration_files',   MigrationFileExtractor)

// ---- Stubs for future extractors (no-op placeholders) ----
// These will be replaced with real implementations over time.
// Registering them here means the detector can detect them and
// the registry won't emit "no extractor registered" warnings.

// Python
// register('Python', 'django_orm',     DjangoExtractor)
// register('Python', 'sqlalchemy',     SqlAlchemyExtractor)

// JavaScript / TypeScript
// register('TypeScript', 'prisma',     PrismaExtractor)
// register('TypeScript', 'typeorm',    TypeOrmExtractor)
// register('TypeScript', 'drizzle_orm', DrizzleExtractor)

// Ruby
// register('Ruby', 'activerecord',     ActiveRecordExtractor)

// C#
// register('C#', 'ef_core',           EfCoreExtractor)

// Go
// register('Go', 'gorm',              GormExtractor)

// Rust
// register('Rust', 'diesel',          DieselExtractor)

// PHP
// register('PHP', 'eloquent',         EloquentExtractor)

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
