import { Router, Request, Response, NextFunction } from 'express'
import { eq, sql, desc } from 'drizzle-orm'
import { db } from '../db'
import { repositories } from '../db/schema'

export const orgsRouter = Router()

// GET /api/v1/orgs — list all organisations derived from explored repositories
orgsRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await db
      .select({
        owner: repositories.owner,
        provider: repositories.provider,
        repoCount: sql<number>`cast(count(*) as int)`,
      })
      .from(repositories)
      .groupBy(repositories.owner, repositories.provider)
      .orderBy(repositories.owner)
    res.json({ data: rows })
  } catch (err) {
    next(err)
  }
})

// GET /api/v1/orgs/:owner — repositories for a specific organisation
orgsRouter.get('/:owner', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { owner } = req.params
    const rows = await db
      .select()
      .from(repositories)
      .where(eq(repositories.owner, owner))
      .orderBy(desc(repositories.fetchedAt))
    res.json({ data: rows })
  } catch (err) {
    next(err)
  }
})
