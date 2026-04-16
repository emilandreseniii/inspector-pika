import { Router, Request, Response, NextFunction } from 'express'
import { eq, sql, desc } from 'drizzle-orm'
import { db } from '../db'
import { repositories, repoLanguages, repoPackages, repoApiSurfaces, repoEntityApproaches } from '../db/schema'

export const orgsRouter = Router()

// GET /api/v1/orgs — list all organisations derived from explored repositories
orgsRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [orgRows, langRepoIds, pkgRepoIds, apiRepoIds, entityRepoIds] = await Promise.all([
      db
        .select({
          owner: repositories.owner,
          provider: repositories.provider,
          repoCount: sql<number>`cast(count(*) as int)`,
          repoIds: sql<number[]>`array_agg(${repositories.id})`,
        })
        .from(repositories)
        .groupBy(repositories.owner, repositories.provider)
        .orderBy(repositories.owner),
      db.selectDistinct({ repoId: repoLanguages.repoId }).from(repoLanguages),
      db.selectDistinct({ repoId: repoPackages.repoId }).from(repoPackages),
      db.selectDistinct({ repoId: repoApiSurfaces.repoId }).from(repoApiSurfaces),
      db.selectDistinct({ repoId: repoEntityApproaches.repoId }).from(repoEntityApproaches),
    ])

    const langSet = new Set(langRepoIds.map((r) => r.repoId))
    const pkgSet = new Set(pkgRepoIds.map((r) => r.repoId))
    const apiSet = new Set(apiRepoIds.map((r) => r.repoId))
    const entitySet = new Set(entityRepoIds.map((r) => r.repoId))

    const data = orgRows.map(({ repoIds, repoCount, owner, provider }) => {
      const analyzed = repoIds.filter((id) => langSet.has(id)).length
        + repoIds.filter((id) => pkgSet.has(id)).length
        + repoIds.filter((id) => apiSet.has(id)).length
        + repoIds.filter((id) => entitySet.has(id)).length
      const analyzedPct = repoCount > 0
        ? parseFloat((analyzed / (repoCount * 4) * 100).toFixed(1))
        : 0
      return { owner, provider, repoCount, analyzedCount: analyzed, analyzedPct }
    })

    res.json({ data })
  } catch (err) {
    next(err)
  }
})

// GET /api/v1/orgs/:owner — repositories for a specific organisation
orgsRouter.get('/:owner', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { owner } = req.params
    const [rows, langRepoIds, pkgRepoIds, apiRepoIds, entityRepoIds] = await Promise.all([
      db.select().from(repositories).where(eq(repositories.owner, owner)).orderBy(desc(repositories.fetchedAt)),
      db.selectDistinct({ repoId: repoLanguages.repoId }).from(repoLanguages),
      db.selectDistinct({ repoId: repoPackages.repoId }).from(repoPackages),
      db.selectDistinct({ repoId: repoApiSurfaces.repoId }).from(repoApiSurfaces),
      db.selectDistinct({ repoId: repoEntityApproaches.repoId }).from(repoEntityApproaches),
    ])

    const langSet = new Set(langRepoIds.map((r) => r.repoId))
    const pkgSet = new Set(pkgRepoIds.map((r) => r.repoId))
    const apiSet = new Set(apiRepoIds.map((r) => r.repoId))
    const entitySet = new Set(entityRepoIds.map((r) => r.repoId))

    const data = rows.map((repo) => ({
      ...repo,
      analysisStatus: {
        hasLanguages: langSet.has(repo.id),
        hasPackages: pkgSet.has(repo.id),
        hasApis: apiSet.has(repo.id),
        hasEntities: entitySet.has(repo.id),
      },
    }))

    res.json({ data })
  } catch (err) {
    next(err)
  }
})
