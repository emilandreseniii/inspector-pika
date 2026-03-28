import { Router, Request, Response, NextFunction } from 'express'
import { eq, desc, and, sql } from 'drizzle-orm'
import { db } from '../db'
import { repositories, repoPackages, repoLanguages, jobs } from '../db/schema'

export const repositoriesRouter = Router()

// GET /api/v1/repositories
repositoriesRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await db.select().from(repositories).orderBy(desc(repositories.fetchedAt))
    res.json({ data: rows })
  } catch (err) {
    next(err)
  }
})

// GET /api/v1/repositories/:id
repositoriesRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid repository id' }); return }
    const [repo] = await db.select().from(repositories).where(eq(repositories.id, id))
    if (!repo) { res.status(404).json({ error: 'Repository not found' }); return }
    res.json({ data: repo })
  } catch (err) {
    next(err)
  }
})

// GET /api/v1/repositories/:id/packages
repositoriesRouter.get('/:id/packages', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid repository id' }); return }
    const rows = await db
      .select()
      .from(repoPackages)
      .where(eq(repoPackages.repoId, id))
      .orderBy(repoPackages.type, repoPackages.name)
    res.json({ data: rows })
  } catch (err) {
    next(err)
  }
})

// GET /api/v1/repositories/:id/languages
repositoriesRouter.get('/:id/languages', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid repository id' }); return }
    const [rows, completedJobs] = await Promise.all([
      db.select().from(repoLanguages).where(eq(repoLanguages.repoId, id)).orderBy(desc(repoLanguages.bytes)),
      db.select({ id: jobs.id }).from(jobs).where(
        and(
          eq(jobs.type, 'analyze_languages'),
          eq(jobs.status, 'completed'),
          sql`${jobs.input}->>'repoId' = ${id.toString()}`
        )
      ).limit(1),
    ])
    res.json({ data: rows, analyzed: completedJobs.length > 0 })
  } catch (err) {
    next(err)
  }
})
