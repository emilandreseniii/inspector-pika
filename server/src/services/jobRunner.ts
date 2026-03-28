import { eq } from 'drizzle-orm'
import { db } from '../db'
import { jobs, repositories, repoPackages, repoLanguages } from '../db/schema'
import { fetchRepoSummary, fetchOrgRepos } from './github'
import { cloneOrUpdate, runOrtAnalyze, parseOrtResult, repoDirs } from './ortAnalyzer'
import { detectLanguages } from './enryAnalyzer'
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
