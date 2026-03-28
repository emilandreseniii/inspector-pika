import { Router, Request, Response, NextFunction } from 'express'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import {
  repos,
  repoLanguages,
  repoDependencies,
  repoComponents,
  repoApiEndpoints,
  repoDocs,
} from '../db/schema'
import {
  fetchRepoSummary,
  fetchLanguages,
  fetchDependencyFiles,
} from '../services/github'
import { parseNpmDependencies, parsePipDependencies, parseGoDependencies } from '../services/analyzer'
import { AnalyzeRepoInputSchema } from '@inspector-pika/shared'

export const reposRouter = Router()

// GET /api/v1/repos — list all analyzed repos
reposRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await db.select().from(repos)
    res.json({ data: rows })
  } catch (err) {
    next(err)
  }
})

// POST /api/v1/repos/analyze — fetch and store a repo from GitHub
reposRouter.post('/analyze', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = AnalyzeRepoInputSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message })
      return
    }

    const [owner, name] = parsed.data.repo.split('/')

    // Upsert repo summary
    const summary = await fetchRepoSummary(owner, name)
    const [repo] = await db
      .insert(repos)
      .values({
        owner: summary.owner,
        name: summary.name,
        fullName: summary.fullName,
        description: summary.description,
        defaultBranch: summary.defaultBranch,
        stars: summary.stars,
        forks: summary.forks,
        isPrivate: summary.isPrivate,
        metadata: summary.metadata,
        fetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: repos.fullName,
        set: {
          description: summary.description,
          stars: summary.stars,
          forks: summary.forks,
          metadata: summary.metadata,
          fetchedAt: new Date(),
        },
      })
      .returning()

    // Languages
    const languages = await fetchLanguages(owner, name)
    await db.delete(repoLanguages).where(eq(repoLanguages.repoId, repo.id))
    if (Object.keys(languages).length > 0) {
      await db.insert(repoLanguages).values(
        Object.entries(languages).map(([language, bytes]) => ({
          repoId: repo.id,
          language,
          bytes,
        }))
      )
    }

    // Dependencies
    const depFiles = await fetchDependencyFiles(owner, name)
    await db.delete(repoDependencies).where(eq(repoDependencies.repoId, repo.id))
    for (const { file, ecosystem, content } of depFiles) {
      let parsed: ReturnType<typeof parseNpmDependencies> = []
      if (file === 'package.json') parsed = parseNpmDependencies(content)
      else if (file === 'requirements.txt' || file === 'Pipfile') parsed = parsePipDependencies(content)
      else if (file === 'go.mod') parsed = parseGoDependencies(content)

      if (parsed.length > 0) {
        await db.insert(repoDependencies).values(
          parsed.map((d) => ({
            repoId: repo.id,
            name: d.name,
            version: d.version,
            ecosystem,
            isDevDependency: d.isDevDependency,
            githubRepo: d.githubRepo,
          }))
        )
      }
    }

    res.status(201).json({ data: repo })
  } catch (err) {
    next(err)
  }
})

// GET /api/v1/repos/:owner/:name
reposRouter.get('/:owner/:name', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fullName = `${req.params.owner}/${req.params.name}`
    const [repo] = await db.select().from(repos).where(eq(repos.fullName, fullName))
    if (!repo) {
      res.status(404).json({ error: 'Repo not found. Use POST /repos/analyze to add it.' })
      return
    }
    res.json({ data: repo })
  } catch (err) {
    next(err)
  }
})

// GET /api/v1/repos/:owner/:name/languages
reposRouter.get('/:owner/:name/languages', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fullName = `${req.params.owner}/${req.params.name}`
    const [repo] = await db.select().from(repos).where(eq(repos.fullName, fullName))
    if (!repo) { res.status(404).json({ error: 'Repo not found' }); return }
    const rows = await db.select().from(repoLanguages).where(eq(repoLanguages.repoId, repo.id))
    res.json({ data: rows })
  } catch (err) { next(err) }
})

// GET /api/v1/repos/:owner/:name/dependencies
reposRouter.get('/:owner/:name/dependencies', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fullName = `${req.params.owner}/${req.params.name}`
    const [repo] = await db.select().from(repos).where(eq(repos.fullName, fullName))
    if (!repo) { res.status(404).json({ error: 'Repo not found' }); return }
    const rows = await db.select().from(repoDependencies).where(eq(repoDependencies.repoId, repo.id))
    res.json({ data: rows })
  } catch (err) { next(err) }
})

// GET /api/v1/repos/:owner/:name/components
reposRouter.get('/:owner/:name/components', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fullName = `${req.params.owner}/${req.params.name}`
    const [repo] = await db.select().from(repos).where(eq(repos.fullName, fullName))
    if (!repo) { res.status(404).json({ error: 'Repo not found' }); return }
    const rows = await db.select().from(repoComponents).where(eq(repoComponents.repoId, repo.id))
    res.json({ data: rows })
  } catch (err) { next(err) }
})

// GET /api/v1/repos/:owner/:name/endpoints
reposRouter.get('/:owner/:name/endpoints', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fullName = `${req.params.owner}/${req.params.name}`
    const [repo] = await db.select().from(repos).where(eq(repos.fullName, fullName))
    if (!repo) { res.status(404).json({ error: 'Repo not found' }); return }
    const rows = await db.select().from(repoApiEndpoints).where(eq(repoApiEndpoints.repoId, repo.id))
    res.json({ data: rows })
  } catch (err) { next(err) }
})

// GET /api/v1/repos/:owner/:name/docs
reposRouter.get('/:owner/:name/docs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fullName = `${req.params.owner}/${req.params.name}`
    const [repo] = await db.select().from(repos).where(eq(repos.fullName, fullName))
    if (!repo) { res.status(404).json({ error: 'Repo not found' }); return }
    const rows = await db.select().from(repoDocs).where(eq(repoDocs.repoId, repo.id))
    res.json({ data: rows })
  } catch (err) { next(err) }
})
