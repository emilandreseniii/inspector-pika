import { eq, and, count, desc } from 'drizzle-orm'
import { db } from '../db'
import { jobs, repositories, repoPackages, repoLanguages, repoEntityApproaches, repoEntities, repoEntityFields, repoEntityRelationships } from '../db/schema'
import { fetchRepoSummary, fetchOrgRepos } from './github'
import { cloneOrUpdate, runOrtAnalyze, parseOrtResult, repoDirs } from './ortAnalyzer'
import { detectLanguages } from './enryAnalyzer'
import { analyzeEntities } from './entityAnalysis'
import { toSnakeCase } from './entityAnalysis/normalizer'
import type { CreateJobInput } from '@inspector-pika/shared'

async function upsertRepository(summary: Awaited<ReturnType<typeof fetchRepoSummary>>) {
  const [row] = await db
    .insert(repositories)
    .values({
      provider: 'github',
      owner: summary.owner,
      name: summary.name,
      fullName: summary.fullName,
      description: summary.description,
      defaultBranch: summary.defaultBranch,
      stars: summary.stars,
      forks: summary.forks,
      isPrivate: summary.isPrivate,
      url: summary.url,
      metadata: summary.metadata,
      fetchedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [repositories.provider, repositories.fullName],
      set: {
        description: summary.description,
        defaultBranch: summary.defaultBranch,
        stars: summary.stars,
        forks: summary.forks,
        url: summary.url,
        metadata: summary.metadata,
        fetchedAt: new Date(),
      },
    })
    .returning()
  return row
}

async function runExploreRepo(input: Extract<CreateJobInput, { type: 'explore_github_repo' }>) {
  const [owner, name] = input.repo.split('/')
  const summary = await fetchRepoSummary(owner, name)
  const row = await upsertRepository(summary)
  return { repositoryId: row.id, fullName: row.fullName }
}

async function runExploreOrg(input: Extract<CreateJobInput, { type: 'explore_github_org' }>) {
  const summaries = await fetchOrgRepos(input.org)
  const inserted: string[] = []
  for (const summary of summaries) {
    await upsertRepository(summary)
    inserted.push(summary.fullName)
  }
  return { org: input.org, count: inserted.length, repositories: inserted }
}

async function runAnalyzeDependencies(input: Extract<CreateJobInput, { type: 'analyze_dependencies' }>) {
  const { source, ortOutput } = repoDirs(input.repo)

  await cloneOrUpdate(input.repo, source)
  await runOrtAnalyze(source, ortOutput)

  const packages = await parseOrtResult(ortOutput)

  // Upsert packages into the database
  for (const pkg of packages) {
    await db
      .insert(repoPackages)
      .values({
        repoId: input.repoId,
        packageId: pkg.packageId,
        purl: pkg.purl,
        type: pkg.type,
        namespace: pkg.namespace,
        name: pkg.name,
        version: pkg.version,
        declaredLicenses: pkg.declaredLicenses,
        description: pkg.description,
        homepageUrl: pkg.homepageUrl,
        metadata: pkg.metadata,
      })
      .onConflictDoUpdate({
        target: [repoPackages.repoId, repoPackages.packageId],
        set: {
          purl: pkg.purl,
          type: pkg.type,
          namespace: pkg.namespace,
          name: pkg.name,
          version: pkg.version,
          declaredLicenses: pkg.declaredLicenses,
          description: pkg.description,
          homepageUrl: pkg.homepageUrl,
          metadata: pkg.metadata,
        },
      })
  }

  return { repo: input.repo, packageCount: packages.length }
}

async function runAnalyzeLanguages(input: Extract<CreateJobInput, { type: 'analyze_languages' }>) {
  const { source } = repoDirs(input.repo)

  await cloneOrUpdate(input.repo, source)
  const languages = await detectLanguages(source)

  // Replace all language rows for this repo
  await db.delete(repoLanguages).where(eq(repoLanguages.repoId, input.repoId))
  for (const lang of languages) {
    await db.insert(repoLanguages).values({
      repoId: input.repoId,
      language: lang.language,
      bytes: lang.bytes,
    })
  }

  return { repo: input.repo, languageCount: languages.length }
}

async function runAnalyzeEntities(input: Extract<CreateJobInput, { type: 'analyze_entities' }>) {
  const { source } = repoDirs(input.repo)

  // Step a: verify repo exists
  const [repo] = await db.select().from(repositories).where(eq(repositories.id, input.repoId))
  if (!repo) throw new Error(`Repository ${input.repoId} not found`)

  // Step b: ensure cloned
  await cloneOrUpdate(input.repo, source)

  // Step c: load detected languages
  const languages = await db
    .select()
    .from(repoLanguages)
    .where(eq(repoLanguages.repoId, input.repoId))
    .orderBy(desc(repoLanguages.bytes))

  if (languages.length === 0) {
    console.warn(`[EntityAnalysis] No language data for repo ${input.repoId}. Run analyze_languages first for best results.`)
  }

  // Step d: check for existing results
  if (!input.forceReanalysis) {
    const existing = await db
      .select({ id: repoEntityApproaches.id })
      .from(repoEntityApproaches)
      .where(eq(repoEntityApproaches.repoId, input.repoId))
      .limit(1)

    if (existing.length > 0) {
      const [{ value: entityCount }] = await db
        .select({ value: count() })
        .from(repoEntities)
        .where(eq(repoEntities.repoId, input.repoId))
      return { skipped: true, reason: 'Data already exists. Set forceReanalysis: true to re-run.', entityCount }
    }
  }

  // Step e: clear previous results if forceReanalysis
  if (input.forceReanalysis) {
    await db.delete(repoEntityApproaches).where(eq(repoEntityApproaches.repoId, input.repoId))
    await db.delete(repoEntities).where(eq(repoEntities.repoId, input.repoId))
  }

  // Step f: run detection + extraction
  const analysisResult = await analyzeEntities({
    repoId: input.repoId,
    sourceDir: source,
    repoFullName: input.repo,
    detectedLanguages: languages,
    forceReanalysis: input.forceReanalysis,
  })

  // Step g: persist detected approaches
  // Maps extractorId (e.g. "java.jpa_hibernate") → DB row id
  const approachIdMap = new Map<string, number>()
  for (const approach of analysisResult.approaches) {
    const [row] = await db
      .insert(repoEntityApproaches)
      .values({
        repoId: input.repoId,
        language: approach.language,
        approach: approach.approach,
        confidence: approach.confidence,
        signals: approach.signals,
        detectedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [repoEntityApproaches.repoId, repoEntityApproaches.language, repoEntityApproaches.approach],
        set: { confidence: approach.confidence, signals: approach.signals, detectedAt: new Date() },
      })
      .returning()
    // Index by extractorId format: "java.jpa_hibernate" or "cross-language.sql_ddl"
    const extractorId = `${approach.language.toLowerCase()}.${approach.approach}`
    approachIdMap.set(extractorId, row.id)
  }

  // Step h: upsert entities and fields
  for (const entity of analysisResult.entities) {
    const primarySource = entity.primarySources[0]
    const sourceApproachId = primarySource ? (approachIdMap.get(primarySource.extractorId) ?? null) : null

    const [entityRow] = await db
      .insert(repoEntities)
      .values({
        repoId: input.repoId,
        name: entity.name,
        normalizedName: entity.normalizedName,
        sourceApproachId,
        entityType: entity.entityType,
        confidence: entity.confidence,
        primarySources: entity.primarySources,
      })
      .onConflictDoUpdate({
        target: [repoEntities.repoId, repoEntities.normalizedName],
        set: {
          name: entity.name,
          sourceApproachId,
          entityType: entity.entityType,
          confidence: entity.confidence,
          primarySources: entity.primarySources,
          updatedAt: new Date(),
        },
      })
      .returning()

    // Batch upsert fields
    for (const field of entity.fields) {
      await db
        .insert(repoEntityFields)
        .values({
          entityId: entityRow.id,
          name: field.name,
          normalizedName: field.normalizedName,
          dataType: field.dataType,
          nativeType: field.nativeType,
          isNullable: field.isNullable === null ? null : String(field.isNullable),
          isPrimaryKey: String(field.isPrimaryKey),
          isForeignKey: String(field.isForeignKey),
          isUnique: String(field.isUnique),
          defaultValue: field.defaultValue,
          ordinalPosition: field.ordinalPosition,
          metadata: field.metadata,
        })
        .onConflictDoUpdate({
          target: [repoEntityFields.entityId, repoEntityFields.normalizedName],
          set: {
            name: field.name,
            dataType: field.dataType,
            nativeType: field.nativeType,
            isNullable: field.isNullable === null ? null : String(field.isNullable),
            isPrimaryKey: String(field.isPrimaryKey),
            isForeignKey: String(field.isForeignKey),
            isUnique: String(field.isUnique),
            defaultValue: field.defaultValue,
            ordinalPosition: field.ordinalPosition,
            metadata: field.metadata,
          },
        })
    }
  }

  // Step i: resolve and insert relationships (second pass, after all entities are inserted)
  for (const entity of analysisResult.entities) {
    const [sourceRow] = await db
      .select({ id: repoEntities.id })
      .from(repoEntities)
      .where(and(eq(repoEntities.repoId, input.repoId), eq(repoEntities.normalizedName, entity.normalizedName)))

    if (!sourceRow) continue

    for (const rel of entity.relationships) {
      const [targetRow] = await db
        .select({ id: repoEntities.id })
        .from(repoEntities)
        .where(and(eq(repoEntities.repoId, input.repoId), eq(repoEntities.normalizedName, toSnakeCase(rel.targetEntityName))))
        .limit(1)

      await db
        .insert(repoEntityRelationships)
        .values({
          repoId: input.repoId,
          sourceEntityId: sourceRow.id,
          targetEntityId: targetRow?.id ?? null,
          targetEntityName: rel.targetEntityName,
          relationshipType: rel.type,
          sourceField: rel.sourceField,
          targetField: rel.targetField,
          metadata: rel.metadata,
        })
        .onConflictDoUpdate({
          target: [repoEntityRelationships.repoId, repoEntityRelationships.sourceEntityId, repoEntityRelationships.targetEntityName, repoEntityRelationships.relationshipType],
          set: {
            targetEntityId: targetRow?.id ?? null,
            sourceField: rel.sourceField,
            targetField: rel.targetField,
            metadata: rel.metadata,
          },
        })
    }
  }

  const fieldsFound = analysisResult.entities.reduce((sum, e) => sum + e.fields.length, 0)
  const relationshipsFound = analysisResult.entities.reduce((sum, e) => sum + e.relationships.length, 0)

  return {
    repo: input.repo,
    approachesDetected: analysisResult.stats.approachesDetected,
    entitiesFound: analysisResult.stats.entitiesAfterDedup,
    fieldsFound,
    relationshipsFound,
    warnings: analysisResult.stats.warnings,
    totalTimeMs: analysisResult.stats.totalTimeMs,
  }
}

export async function runJob(jobId: number, input: CreateJobInput): Promise<void> {
  await db
    .update(jobs)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(jobs.id, jobId))

  try {
    let result: Record<string, unknown>

    if (input.type === 'explore_github_repo') {
      result = await runExploreRepo(input)
    } else if (input.type === 'explore_github_org') {
      result = await runExploreOrg(input)
    } else if (input.type === 'analyze_languages') {
      result = await runAnalyzeLanguages(input)
    } else if (input.type === 'analyze_entities') {
      result = await runAnalyzeEntities(input)
    } else {
      result = await runAnalyzeDependencies(input)
    }

    await db
      .update(jobs)
      .set({ status: 'completed', result, completedAt: new Date() })
      .where(eq(jobs.id, jobId))
  } catch (err) {
    await db
      .update(jobs)
      .set({ status: 'failed', error: (err as Error).message, completedAt: new Date() })
      .where(eq(jobs.id, jobId))
  }
}
