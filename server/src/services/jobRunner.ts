import fs from 'fs'
import fsPromises from 'fs/promises'
import path from 'path'
import { eq, and, ne, count, desc } from 'drizzle-orm'
import { db } from '../db'
import { jobs, repositories, repoPackages, packages, repoLanguages, repoEntityApproaches, repoEntities, repoEntityFields, repoEntityRelationships, repoApiApproaches, repoApiSurfaces, repoApiOps, repoApiOpParams } from '../db/schema'
import { fetchRepoSummary, fetchOrgRepos } from './github'
import { cloneOrUpdate, runOrtAnalyze, parseOrtResult, repoDirs } from './ortAnalyzer'
import { detectLanguages } from './enryAnalyzer'
import { analyzeEntities } from './entityAnalysis'
import { toSnakeCase } from './entityAnalysis/normalizer'
import { analyzeApis } from './apiAnalysis'
import type { CreateJobInput } from '@inspector-pika/shared'

const PROJECT_ROOT = path.resolve(__dirname, '../../../')
const JOB_LOGS_DIR = path.join(PROJECT_ROOT, 'data', 'jobs')

export function jobLogPath(jobId: number): string {
  return path.join(JOB_LOGS_DIR, `${jobId}.log`)
}

type LogFn = (chunk: string) => void

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

async function runAnalyzeDependencies(input: Extract<CreateJobInput, { type: 'analyze_dependencies' }>, onLog?: LogFn) {
  const { source, ortOutput } = repoDirs(input.repo)

  await cloneOrUpdate(input.repo, source, onLog)
  await runOrtAnalyze(source, ortOutput, onLog)

  const ortPackages = await parseOrtResult(ortOutput)

  // Upsert packages into the database
  for (const pkg of ortPackages) {
    const pkgType = pkg.type ?? 'unknown'
    const pkgNamespace = pkg.namespace ?? ''

    // Upsert into canonical packages registry
    const [canonPkg] = await db
      .insert(packages)
      .values({
        type: pkgType,
        namespace: pkgNamespace,
        name: pkg.name,
        description: pkg.description ?? null,
        homepageUrl: pkg.homepageUrl ?? null,
      })
      .onConflictDoUpdate({
        target: [packages.type, packages.namespace, packages.name],
        set: {
          description: pkg.description ?? null,
          homepageUrl: pkg.homepageUrl ?? null,
          updatedAt: new Date(),
        },
      })
      .returning({ id: packages.id })

    await db
      .insert(repoPackages)
      .values({
        repoId: input.repoId,
        canonPackageId: canonPkg.id,
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
          canonPackageId: canonPkg.id,
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

  return { repo: input.repo, packageCount: ortPackages.length }
}

async function runAnalyzeLanguages(input: Extract<CreateJobInput, { type: 'analyze_languages' }>, onLog?: LogFn) {
  const { source } = repoDirs(input.repo)

  await cloneOrUpdate(input.repo, source, onLog)
  const languages = await detectLanguages(source, onLog)

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

async function runAnalyzeEntities(input: Extract<CreateJobInput, { type: 'analyze_entities' }>, onLog?: LogFn) {
  const { source } = repoDirs(input.repo)

  // Step a: verify repo exists
  const [repo] = await db.select().from(repositories).where(eq(repositories.id, input.repoId))
  if (!repo) throw new Error(`Repository ${input.repoId} not found`)

  // Step b: ensure cloned
  await cloneOrUpdate(input.repo, source, onLog)

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

async function runAnalyzeApis(input: Extract<CreateJobInput, { type: 'analyze_apis' }>, onLog?: LogFn) {
  const { source } = repoDirs(input.repo)

  const [repo] = await db.select().from(repositories).where(eq(repositories.id, input.repoId))
  if (!repo) throw new Error(`Repository ${input.repoId} not found`)

  await cloneOrUpdate(input.repo, source, onLog)

  const languages = await db
    .select()
    .from(repoLanguages)
    .where(eq(repoLanguages.repoId, input.repoId))
    .orderBy(desc(repoLanguages.bytes))

  if (languages.length === 0) {
    console.warn(`[ApiAnalysis] No language data for repo ${input.repoId}. Run analyze_languages first for best results.`)
  }

  // Skip if data already exists and not forced
  if (!input.forceReanalysis) {
    const existing = await db
      .select({ id: repoApiApproaches.id })
      .from(repoApiApproaches)
      .where(eq(repoApiApproaches.repoId, input.repoId))
      .limit(1)

    if (existing.length > 0) {
      const [{ value: endpointCount }] = await db
        .select({ value: count() })
        .from(repoApiOps)
        .where(eq(repoApiOps.repoId, input.repoId))
      return { skipped: true, reason: 'Data already exists. Set forceReanalysis: true to re-run.', endpointCount }
    }
  }

  // Clear previous results (cascades to surfaces → ops → params)
  if (input.forceReanalysis) {
    await db.delete(repoApiApproaches).where(eq(repoApiApproaches.repoId, input.repoId))
  }

  // Run detection + extraction
  const result = await analyzeApis({
    repoId: input.repoId,
    sourceDir: source,
    repoFullName: input.repo,
    detectedLanguages: languages,
    forceReanalysis: input.forceReanalysis,
  })

  // Persist detected approaches and build a lookup map: "language:approach" → DB row id
  const approachIdMap = new Map<string, number>()
  for (const approach of result.approaches) {
    const [row] = await db
      .insert(repoApiApproaches)
      .values({
        repoId: input.repoId,
        language: approach.language,
        approach: approach.approach,
        apiStyle: approach.apiStyle,
        confidence: approach.confidence,
        signals: approach.signals,
        detectedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [repoApiApproaches.repoId, repoApiApproaches.language, repoApiApproaches.approach],
        set: {
          apiStyle: approach.apiStyle,
          confidence: approach.confidence,
          signals: approach.signals,
          detectedAt: new Date(),
        },
      })
      .returning()
    approachIdMap.set(`${approach.language}:${approach.approach}`, row.id)
  }

  // Persist surfaces → ops → params
  let totalOps = 0
  for (const surface of result.surfaces) {
    const approachKey = `${result.approaches.find((a) => a.approach === surface.protocol || surface.apiStyle === a.apiStyle)?.language ?? 'cross-language'}:${result.approaches.find((a) => surface.apiStyle === a.apiStyle)?.approach ?? ''}`
    const sourceApproachId = approachIdMap.get(approachKey) ?? null

    const [surfaceRow] = await db
      .insert(repoApiSurfaces)
      .values({
        repoId: input.repoId,
        sourceApproachId,
        name: surface.name,
        normalizedName: toSnakeCase(surface.name),
        apiStyle: surface.apiStyle,
        protocol: surface.protocol ?? null,
        basePath: surface.basePath ?? null,
        packageOrModule: surface.packageOrModule ?? null,
        confidence: 'high',
        sourceFile: surface.sourceFile,
        sourceLine: surface.sourceLine ?? null,
      })
      .returning()

    for (const op of surface.endpoints) {
      const normalizedPath = op.path
        ? op.path.toLowerCase().replace(/\/$/, '') || '/'
        : null

      const [opRow] = await db
        .insert(repoApiOps)
        .values({
          repoId: input.repoId,
          surfaceId: surfaceRow.id,
          httpMethod: op.httpMethod ?? null,
          path: op.path ?? null,
          normalizedPath,
          operationType: op.operationType ?? null,
          operationName: op.operationName ?? null,
          rpcMethodName: op.rpcMethodName ?? null,
          requestType: op.requestType ?? null,
          responseType: op.responseType ?? null,
          rpcStreaming: op.rpcStreaming ?? null,
          summary: op.summary ?? null,
          tags: op.tags.length > 0 ? op.tags : null,
          returnType: op.returnType ?? null,
          confidence: 'high',
          sourceFile: op.sourceFile,
          sourceLine: op.sourceLine ?? null,
        })
        .returning()

      totalOps++

      for (let i = 0; i < op.parameters.length; i++) {
        const param = op.parameters[i]
        await db.insert(repoApiOpParams).values({
          opId: opRow.id,
          name: param.name,
          location: param.location,
          type: param.type ?? null,
          required: param.required ?? null,
          description: param.description ?? null,
          ordinalPosition: i,
        })
      }
    }

    // Update approach endpoint count
    if (sourceApproachId) {
      const [{ value: opCount }] = await db
        .select({ value: count() })
        .from(repoApiOps)
        .where(eq(repoApiOps.surfaceId, surfaceRow.id))
      await db
        .update(repoApiApproaches)
        .set({ endpointCount: opCount })
        .where(eq(repoApiApproaches.id, sourceApproachId))
    }
  }

  return {
    repo: input.repo,
    approachesDetected: result.approaches.length,
    surfacesFound: result.surfaces.length,
    endpointsFound: totalOps,
    warnings: result.stats.warnings,
    totalTimeMs: result.stats.totalTimeMs,
  }
}

export async function runJob(jobId: number, input: CreateJobInput): Promise<void> {
  await fsPromises.mkdir(JOB_LOGS_DIR, { recursive: true })
  const logPath = jobLogPath(jobId)
  const onLog: LogFn = (chunk) => {
    try { fs.appendFileSync(logPath, chunk) } catch { /* ignore log write errors */ }
  }

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
      result = await runAnalyzeLanguages(input, onLog)
    } else if (input.type === 'analyze_entities') {
      result = await runAnalyzeEntities(input, onLog)
    } else if (input.type === 'analyze_apis') {
      result = await runAnalyzeApis(input, onLog)
    } else {
      result = await runAnalyzeDependencies(input, onLog)
    }

    await db
      .update(jobs)
      .set({ status: 'completed', result, completedAt: new Date() })
      .where(and(eq(jobs.id, jobId), ne(jobs.status, 'cancelled')))
  } catch (err) {
    await db
      .update(jobs)
      .set({ status: 'failed', error: (err as Error).message, completedAt: new Date() })
      .where(and(eq(jobs.id, jobId), ne(jobs.status, 'cancelled')))
  }
}
