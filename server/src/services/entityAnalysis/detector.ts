import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DetectedApproach, Confidence } from './extractors/base'

interface DetectedLanguage {
  language: string
  bytes: number
}

/**
 * Phase 1: detect which entity storage approaches are used in a repository.
 * Returns a list of DetectedApproach objects with confidence scores.
 */
export async function detectApproaches(
  sourceDir: string,
  languages: DetectedLanguage[],
): Promise<DetectedApproach[]> {
  const detectedLanguages = new Set(languages.map((l) => l.language))
  const approaches: DetectedApproach[] = []

  // Run detectors in parallel
  const detectorPromises: Promise<DetectedApproach[]>[] = [
    // Cross-language detectors always run
    detectSqlDdl(sourceDir),
    detectMigrationFiles(sourceDir),
    detectProtobuf(sourceDir),
    detectOpenApi(sourceDir),
    detectGraphql(sourceDir),
  ]

  if (detectedLanguages.has('Java') || detectedLanguages.has('Kotlin') || detectedLanguages.has('Scala')) {
    detectorPromises.push(detectJavaApproaches(sourceDir))
  }
  if (detectedLanguages.has('Python')) {
    detectorPromises.push(detectPythonApproaches(sourceDir))
  }
  if (detectedLanguages.has('TypeScript') || detectedLanguages.has('JavaScript')) {
    detectorPromises.push(detectJsApproaches(sourceDir))
  }
  if (detectedLanguages.has('Ruby')) {
    detectorPromises.push(detectRubyApproaches(sourceDir))
  }
  if (detectedLanguages.has('Go')) {
    detectorPromises.push(detectGoApproaches(sourceDir))
  }
  if (detectedLanguages.has('C#')) {
    detectorPromises.push(detectCsharpApproaches(sourceDir))
  }
  if (detectedLanguages.has('PHP')) {
    detectorPromises.push(detectPhpApproaches(sourceDir))
  }
  if (detectedLanguages.has('Rust')) {
    detectorPromises.push(detectRustApproaches(sourceDir))
  }
  if (detectedLanguages.has('Kotlin')) {
    detectorPromises.push(detectKotlinApproaches(sourceDir))
  }

  const results = await Promise.allSettled(detectorPromises)
  for (const result of results) {
    if (result.status === 'fulfilled') {
      approaches.push(...result.value)
    }
  }

  return approaches
}

// ---- Java / Kotlin detector ----

async function detectJavaApproaches(sourceDir: string): Promise<DetectedApproach[]> {
  const approaches: DetectedApproach[] = []

  // Read build files
  const [pomContent, gradleContent] = await Promise.all([
    readSafe(join(sourceDir, 'pom.xml')),
    readSafe(join(sourceDir, 'build.gradle')).then((c) => c || readSafe(join(sourceDir, 'build.gradle.kts'))),
  ])

  const buildContent = (pomContent ?? '') + (gradleContent ?? '')

  // JPA / Hibernate
  const jpaSignals: string[] = []
  if (/hibernate-core|hibernate-entitymanager|spring-data-jpa|jakarta\.persistence|javax\.persistence/i.test(buildContent)) {
    jpaSignals.push("Tier A: JPA/Hibernate dependency found in build file")
  }
  const jpaAnnotations = await grepDir(sourceDir, '**/*.{java,kt}', /@Entity\b/, 50)
  if (jpaAnnotations > 0) {
    jpaSignals.push(`Tier B: @Entity annotation found in ${jpaAnnotations} file(s)`)
  }
  if (jpaSignals.length > 0) {
    approaches.push({
      language: 'Java',
      approach: 'jpa_hibernate',
      confidence: computeConfidence(jpaSignals),
      signals: jpaSignals,
    })
  }

  // MyBatis
  const mybatisSignals: string[] = []
  if (/mybatis|ibatis/i.test(buildContent)) {
    mybatisSignals.push("Tier A: MyBatis dependency found in build file")
  }
  const mapperXmlCount = await globCount(sourceDir, '**/*Mapper.xml')
  if (mapperXmlCount > 0) {
    mybatisSignals.push(`Tier B: ${mapperXmlCount} *Mapper.xml file(s) found`)
  }
  if (mybatisSignals.length > 0) {
    approaches.push({
      language: 'Java',
      approach: 'mybatis',
      confidence: computeConfidence(mybatisSignals),
      signals: mybatisSignals,
    })
  }

  // JOOQ
  const jooqSignals: string[] = []
  if (/jooq|org\.jooq/i.test(buildContent)) {
    jooqSignals.push("Tier A: jOOQ dependency found in build file")
  }
  const tableImplCount = await grepDir(sourceDir, '**/*.java', /extends\s+TableImpl/, 20)
  if (tableImplCount > 0) {
    jooqSignals.push(`Tier B: ${tableImplCount} generated TableImpl class(es) found`)
  }
  if (jooqSignals.length > 0) {
    approaches.push({
      language: 'Java',
      approach: 'jooq',
      confidence: computeConfidence(jooqSignals),
      signals: jooqSignals,
    })
  }

  // Spring Data JDBC
  const sdJdbcSignals: string[] = []
  if (/spring-data-jdbc|spring-data-relational/i.test(buildContent)) {
    sdJdbcSignals.push("Tier A: Spring Data JDBC dependency found in build file")
  }
  if (sdJdbcSignals.length > 0) {
    approaches.push({
      language: 'Java',
      approach: 'spring_data_jdbc',
      confidence: computeConfidence(sdJdbcSignals),
      signals: sdJdbcSignals,
    })
  }

  return approaches
}

// ---- Python detector ----

async function detectPythonApproaches(sourceDir: string): Promise<DetectedApproach[]> {
  const approaches: DetectedApproach[] = []

  const reqContent = await readSafe(join(sourceDir, 'requirements.txt'))
    ?? await readSafe(join(sourceDir, 'pyproject.toml'))
    ?? await readSafe(join(sourceDir, 'setup.py'))
    ?? ''

  // Django ORM
  const djangoSignals: string[] = []
  if (/django/i.test(reqContent)) djangoSignals.push("Tier A: Django found in requirements")
  const modelsCount = await globCount(sourceDir, '**/models.py')
  if (modelsCount > 0) djangoSignals.push(`Tier B: ${modelsCount} models.py file(s) found`)
  if (djangoSignals.length > 0) {
    approaches.push({ language: 'Python', approach: 'django_orm', confidence: computeConfidence(djangoSignals), signals: djangoSignals })
  }

  // SQLAlchemy
  const sqlaSignals: string[] = []
  if (/sqlalchemy/i.test(reqContent)) sqlaSignals.push("Tier A: SQLAlchemy found in requirements")
  const sqlaCount = await grepDir(sourceDir, '**/*.py', /from\s+sqlalchemy|import\s+sqlalchemy/, 20)
  if (sqlaCount > 0) sqlaSignals.push(`Tier B: SQLAlchemy import found in ${sqlaCount} file(s)`)
  if (sqlaSignals.length > 0) {
    approaches.push({ language: 'Python', approach: 'sqlalchemy', confidence: computeConfidence(sqlaSignals), signals: sqlaSignals })
  }

  // Tortoise ORM
  const tortoiseSignals: string[] = []
  if (/tortoise-orm|tortoise_orm/i.test(reqContent)) tortoiseSignals.push("Tier A: tortoise-orm found in requirements")
  const tortoiseCount = await grepDir(sourceDir, '**/*.py', /from\s+tortoise|import\s+tortoise/, 10)
  if (tortoiseCount > 0) tortoiseSignals.push(`Tier B: tortoise import found in ${tortoiseCount} file(s)`)
  if (tortoiseSignals.length > 0) {
    approaches.push({ language: 'Python', approach: 'tortoise_orm', confidence: computeConfidence(tortoiseSignals), signals: tortoiseSignals })
  }

  // SQLModel
  const sqlModelSignals: string[] = []
  if (/sqlmodel/i.test(reqContent)) sqlModelSignals.push("Tier A: sqlmodel found in requirements")
  const sqlModelCount = await grepDir(sourceDir, '**/*.py', /SQLModel\s*,\s*table\s*=\s*True/, 10)
  if (sqlModelCount > 0) sqlModelSignals.push(`Tier B: SQLModel table class found in ${sqlModelCount} file(s)`)
  if (sqlModelSignals.length > 0) {
    approaches.push({ language: 'Python', approach: 'sql_model', confidence: computeConfidence(sqlModelSignals), signals: sqlModelSignals })
  }

  // Peewee
  const peeweeSignals: string[] = []
  if (/peewee/i.test(reqContent)) peeweeSignals.push("Tier A: peewee found in requirements")
  const peeweeCount = await grepDir(sourceDir, '**/*.py', /from\s+peewee|import\s+peewee/, 10)
  if (peeweeCount > 0) peeweeSignals.push(`Tier B: peewee import found in ${peeweeCount} file(s)`)
  if (peeweeSignals.length > 0) {
    approaches.push({ language: 'Python', approach: 'peewee', confidence: computeConfidence(peeweeSignals), signals: peeweeSignals })
  }

  return approaches
}

// ---- JavaScript / TypeScript detector ----

async function detectJsApproaches(sourceDir: string): Promise<DetectedApproach[]> {
  const approaches: DetectedApproach[] = []

  const pkgContent = await readSafe(join(sourceDir, 'package.json')) ?? ''

  // Prisma
  const prismaSignals: string[] = []
  if (/["']prisma["']|["']@prisma\/client["']/i.test(pkgContent)) prismaSignals.push("Tier A: Prisma found in package.json")
  const prismaSchemaCount = await globCount(sourceDir, '**/schema.prisma')
  if (prismaSchemaCount > 0) prismaSignals.push(`Tier B: schema.prisma file found`)
  if (prismaSignals.length > 0) {
    approaches.push({ language: 'TypeScript', approach: 'prisma', confidence: computeConfidence(prismaSignals), signals: prismaSignals })
  }

  // TypeORM
  const typeormSignals: string[] = []
  if (/["']typeorm["']/i.test(pkgContent)) typeormSignals.push("Tier A: TypeORM found in package.json")
  const typeormCount = await grepDir(sourceDir, '**/*.{ts,js}', /@Entity\(\)/, 20)
  if (typeormCount > 0) typeormSignals.push(`Tier B: @Entity() found in ${typeormCount} file(s)`)
  if (typeormSignals.length > 0) {
    approaches.push({ language: 'TypeScript', approach: 'typeorm', confidence: computeConfidence(typeormSignals), signals: typeormSignals })
  }

  // Drizzle ORM
  const drizzleSignals: string[] = []
  if (/["']drizzle-orm["']/i.test(pkgContent)) drizzleSignals.push("Tier A: drizzle-orm found in package.json")
  if (drizzleSignals.length > 0) {
    approaches.push({ language: 'TypeScript', approach: 'drizzle_orm', confidence: computeConfidence(drizzleSignals), signals: drizzleSignals })
  }

  // Sequelize
  const seqSignals: string[] = []
  if (/["']sequelize["']/i.test(pkgContent)) seqSignals.push("Tier A: Sequelize found in package.json")
  if (seqSignals.length > 0) {
    approaches.push({ language: 'JavaScript', approach: 'sequelize', confidence: computeConfidence(seqSignals), signals: seqSignals })
  }

  // MikroORM
  const mikroOrmSignals: string[] = []
  if (/@mikro-orm\/core/.test(pkgContent)) mikroOrmSignals.push("Tier A: @mikro-orm/core found in package.json")
  const mikroOrmCount = await grepDir(sourceDir, '**/*.ts', /@Entity\(\)/, 10)
  if (mikroOrmCount > 0 && /@Property\s*\(/.test(pkgContent + '')) {
    mikroOrmSignals.push(`Tier B: @Entity() found in ${mikroOrmCount} file(s)`)
  }
  if (mikroOrmSignals.length > 0) {
    approaches.push({ language: 'TypeScript', approach: 'mikro_orm', confidence: computeConfidence(mikroOrmSignals), signals: mikroOrmSignals })
  }

  // Mongoose
  const mongooseSignals: string[] = []
  if (/["']mongoose["']/i.test(pkgContent)) mongooseSignals.push("Tier A: Mongoose found in package.json")
  if (mongooseSignals.length > 0) {
    approaches.push({ language: 'JavaScript', approach: 'mongoose', confidence: computeConfidence(mongooseSignals), signals: mongooseSignals })
  }

  return approaches
}

// ---- Ruby detector ----

async function detectRubyApproaches(sourceDir: string): Promise<DetectedApproach[]> {
  const approaches: DetectedApproach[] = []
  const gemfileContent = await readSafe(join(sourceDir, 'Gemfile')) ?? ''

  // ActiveRecord (Rails)
  const arSignals: string[] = []
  if (/activerecord|rails/i.test(gemfileContent)) arSignals.push('Tier A: ActiveRecord/Rails found in Gemfile')
  const migrateCount = await globCount(sourceDir, '**/db/migrate/*.rb')
  if (migrateCount > 0) arSignals.push(`Tier B: ${migrateCount} Rails migration file(s) found`)
  const schemaRb = await readSafe(join(sourceDir, 'db/schema.rb'))
  if (schemaRb) arSignals.push('Tier B: db/schema.rb found')
  if (arSignals.length > 0) {
    approaches.push({ language: 'Ruby', approach: 'active_record', confidence: computeConfidence(arSignals), signals: arSignals })
  }

  // Sequel
  const sequelSignals: string[] = []
  if (/\bsequel\b/i.test(gemfileContent)) sequelSignals.push('Tier A: Sequel found in Gemfile')
  const sequelModelCount = await grepDir(sourceDir, '**/*.rb', /Sequel::Model/, 10)
  if (sequelModelCount > 0) sequelSignals.push(`Tier C: ${sequelModelCount} Sequel::Model subclass(es) found`)
  const createTableCount = await grepDir(sourceDir, '**/*.rb', /DB\.create_table/, 10)
  if (createTableCount > 0) sequelSignals.push(`Tier C: ${createTableCount} DB.create_table call(s) found`)
  if (sequelSignals.length > 0) {
    approaches.push({ language: 'Ruby', approach: 'sequel', confidence: computeConfidence(sequelSignals), signals: sequelSignals })
  }

  return approaches
}

// ---- Go detector ----

async function detectGoApproaches(sourceDir: string): Promise<DetectedApproach[]> {
  const approaches: DetectedApproach[] = []
  const goModContent = await readSafe(join(sourceDir, 'go.mod')) ?? ''

  if (/gorm\.io\/gorm|github\.com\/jinzhu\/gorm/.test(goModContent)) {
    approaches.push({ language: 'Go', approach: 'gorm', confidence: 'high', signals: ["Tier A: GORM found in go.mod"] })
  }
  if (/entgo\.io\/ent/.test(goModContent)) {
    approaches.push({ language: 'Go', approach: 'ent', confidence: 'high', signals: ["Tier A: Ent found in go.mod"] })
  }
  if (/github\.com\/sqlc-dev\/sqlc|kyleconroy\/sqlc/.test(goModContent)) {
    approaches.push({ language: 'Go', approach: 'sqlc', confidence: 'high', signals: ["Tier A: sqlc found in go.mod"] })
  }

  return approaches
}

// ---- C# detector ----

async function detectCsharpApproaches(sourceDir: string): Promise<DetectedApproach[]> {
  const approaches: DetectedApproach[] = []
  const csprojFiles = await globFiles(sourceDir, '**/*.csproj')
  const csprojContent = (await Promise.all(csprojFiles.slice(0, 3).map((f) => readSafe(join(sourceDir, f))))).join('\n')

  if (/Microsoft\.EntityFrameworkCore|EntityFramework/i.test(csprojContent)) {
    approaches.push({ language: 'C#', approach: 'ef_core', confidence: 'high', signals: ["Tier A: EF Core found in .csproj"] })
  }
  if (/Dapper/i.test(csprojContent)) {
    approaches.push({ language: 'C#', approach: 'dapper', confidence: 'high', signals: ["Tier A: Dapper found in .csproj"] })
  }

  // NHibernate
  if (/NHibernate/i.test(csprojContent)) {
    approaches.push({ language: 'C#', approach: 'nhibernate', confidence: 'high', signals: ["Tier A: NHibernate found in .csproj"] })
  } else {
    const hbmCount = await globCount(sourceDir, '**/*.hbm.xml')
    if (hbmCount > 0) {
      approaches.push({ language: 'C#', approach: 'nhibernate', confidence: 'medium', signals: [`Tier B: ${hbmCount} HBM mapping file(s) found`] })
    }
  }

  return approaches
}

// ---- PHP detector ----

async function detectPhpApproaches(sourceDir: string): Promise<DetectedApproach[]> {
  const approaches: DetectedApproach[] = []
  const composerContent = await readSafe(join(sourceDir, 'composer.json')) ?? ''

  if (/laravel\/framework|illuminate\/database/i.test(composerContent)) {
    approaches.push({ language: 'PHP', approach: 'eloquent', confidence: 'high', signals: ["Tier A: Laravel/Eloquent found in composer.json"] })
  }
  if (/doctrine\/orm/i.test(composerContent)) {
    approaches.push({ language: 'PHP', approach: 'doctrine', confidence: 'high', signals: ["Tier A: Doctrine ORM found in composer.json"] })
  }

  return approaches
}

// ---- Rust detector ----

async function detectRustApproaches(sourceDir: string): Promise<DetectedApproach[]> {
  const approaches: DetectedApproach[] = []
  const cargoContent = await readSafe(join(sourceDir, 'Cargo.toml')) ?? ''

  if (/diesel/.test(cargoContent)) {
    approaches.push({ language: 'Rust', approach: 'diesel', confidence: 'high', signals: ["Tier A: Diesel found in Cargo.toml"] })
  }
  if (/sea-orm/.test(cargoContent)) {
    approaches.push({ language: 'Rust', approach: 'sea_orm', confidence: 'high', signals: ["Tier A: SeaORM found in Cargo.toml"] })
  }
  if (/sqlx/.test(cargoContent)) {
    approaches.push({ language: 'Rust', approach: 'sqlx', confidence: 'high', signals: ["Tier A: sqlx found in Cargo.toml"] })
  }

  return approaches
}

// ---- Kotlin detector ----

async function detectKotlinApproaches(sourceDir: string): Promise<DetectedApproach[]> {
  const approaches: DetectedApproach[] = []

  // Exposed
  const exposedSignals: string[] = []
  const [buildContent] = await Promise.all([
    readSafe(join(sourceDir, 'build.gradle.kts')).then((c) => c || readSafe(join(sourceDir, 'build.gradle'))).then((c) => c ?? ''),
  ])
  if (/exposed-core|exposed-dao|jetbrains\.exposed/.test(buildContent)) {
    exposedSignals.push("Tier A: Exposed dependency found in build.gradle")
  }
  const exposedCount = await grepDir(sourceDir, '**/*.kt', /:\s*(?:Int|Long|UUID)?(?:Id)?Table\s*\(/, 20)
  if (exposedCount > 0) exposedSignals.push(`Tier B: Table object found in ${exposedCount} file(s)`)
  if (exposedSignals.length > 0) {
    approaches.push({ language: 'Kotlin', approach: 'exposed', confidence: computeConfidence(exposedSignals), signals: exposedSignals })
  }

  return approaches
}

// ---- Cross-language detectors ----

async function detectSqlDdl(sourceDir: string): Promise<DetectedApproach[]> {
  const count = await globCount(sourceDir, '**/*.sql')
  if (count === 0) return []
  return [{
    language: 'cross-language',
    approach: 'sql_ddl',
    confidence: count > 5 ? 'high' : 'medium',
    signals: [`${count} .sql file(s) found`],
  }]
}

async function detectMigrationFiles(sourceDir: string): Promise<DetectedApproach[]> {
  // Check for common migration directories
  const signals: string[] = []
  const flywayCount = await globCount(sourceDir, '**/V*__*.sql')
  if (flywayCount > 0) signals.push(`Tier A: ${flywayCount} Flyway-style migration file(s) found (V*__*.sql)`)
  const migrationsCount = await globCount(sourceDir, '**/migrations/*.sql')
  if (migrationsCount > 0) signals.push(`Tier B: ${migrationsCount} SQL files in migrations/ directory`)
  if (signals.length === 0) return []
  return [{
    language: 'cross-language',
    approach: 'migration_files',
    confidence: flywayCount > 0 ? 'high' : 'medium',
    signals,
  }]
}

async function detectProtobuf(sourceDir: string): Promise<DetectedApproach[]> {
  const count = await globCount(sourceDir, '**/*.proto')
  if (count === 0) return []
  const signals = [`Tier B: ${count} .proto file(s) found`]
  return [
    { language: 'cross-language', approach: 'proto_messages', confidence: 'high', signals },
  ]
}

async function detectOpenApi(sourceDir: string): Promise<DetectedApproach[]> {
  const signals: string[] = []
  for (const name of ['openapi.yaml', 'openapi.json', 'swagger.yaml', 'swagger.json', 'api.yaml']) {
    const content = await readSafe(join(sourceDir, name))
    if (content && /(openapi|swagger):/i.test(content)) {
      signals.push(`Tier A: ${name} found at root`)
      break
    }
  }
  if (signals.length === 0) return []
  return [{ language: 'cross-language', approach: 'openapi', confidence: 'high', signals }]
}

async function detectGraphql(sourceDir: string): Promise<DetectedApproach[]> {
  const count = await globCount(sourceDir, '**/*.{graphql,graphqls}')
  if (count === 0) return []
  return [{ language: 'cross-language', approach: 'graphql_schema', confidence: 'high', signals: [`${count} GraphQL schema file(s) found`] }]
}

// ---- Helpers ----

function computeConfidence(signals: string[]): Confidence {
  const tierA = signals.filter((s) => s.includes('Tier A')).length
  const tierB = signals.filter((s) => s.includes('Tier B')).length
  if (tierA > 0 && tierB > 0) return 'high'
  if (tierA > 0) return 'medium'
  if (tierB > 0) return 'medium'
  return 'low'
}

async function readSafe(path: string): Promise<string | null> {
  try { return await readFile(path, 'utf-8') } catch { return null }
}

async function globCount(sourceDir: string, pattern: string): Promise<number> {
  const files = await globFiles(sourceDir, pattern)
  return files.length
}

const EXCLUDED = new Set(['node_modules', 'vendor', '.git', 'build', 'dist', 'target', '.gradle', '__pycache__', 'venv', '.venv'])

async function globFiles(sourceDir: string, pattern: string): Promise<string[]> {
  const { readdir, stat } = await import('node:fs/promises')
  const { join: pathJoin, relative } = await import('node:path')
  const results: string[] = []

  const ext = pattern.match(/\*\.(\w+)$/)?.[1]
  const multiExt = pattern.match(/\*\.\{([^}]+)\}$/)?.[1]?.split(',').map(e => e.trim())
  const filename = pattern.match(/\*\*\/([^*]+\.\w+)$/)?.[1]

  function matches(name: string): boolean {
    if (filename) return name === filename
    if (multiExt) return multiExt.some((e) => name.endsWith(`.${e}`))
    if (ext) return name.endsWith(`.${ext}`)
    return false
  }

  async function walk(dir: string): Promise<void> {
    let entries: string[]
    try { entries = await readdir(dir) } catch { return }
    for (const entry of entries) {
      if (EXCLUDED.has(entry)) continue
      const full = pathJoin(dir, entry)
      let s: Awaited<ReturnType<typeof stat>>
      try { s = await stat(full) } catch { continue }
      if (s.isDirectory()) await walk(full)
      else if (matches(entry)) results.push(relative(sourceDir, full).replace(/\\/g, '/'))
    }
  }

  await walk(sourceDir)
  return results
}

async function grepDir(sourceDir: string, pattern: string, regex: RegExp, limit: number): Promise<number> {
  const { readFile: rf } = await import('node:fs/promises')
  const { join: pathJoin } = await import('node:path')
  const files = await globFiles(sourceDir, pattern)
  let count = 0
  for (const file of files) {
    if (count >= limit) break
    try {
      const content = await rf(pathJoin(sourceDir, file), 'utf-8')
      if (regex.test(content)) count++
    } catch { /* skip */ }
  }
  return count
}
