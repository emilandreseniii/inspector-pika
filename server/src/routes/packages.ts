import { Router, Request, Response, NextFunction } from 'express'
import { eq, sql, asc } from 'drizzle-orm'
import { db } from '../db'
import { packages, repoPackages, repositories } from '../db/schema'

export const packagesRouter = Router()

// GET /api/v1/packages — all canonical packages with version + repo counts
packagesRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await db
      .select({
        id: packages.id,
        type: packages.type,
        namespace: packages.namespace,
        name: packages.name,
        description: packages.description,
        homepageUrl: packages.homepageUrl,
        createdAt: packages.createdAt,
        updatedAt: packages.updatedAt,
        versionCount: sql<number>`cast(count(distinct ${repoPackages.version}) as int)`,
        repoCount: sql<number>`cast(count(distinct ${repoPackages.repoId}) as int)`,
      })
      .from(packages)
      .leftJoin(repoPackages, eq(repoPackages.canonPackageId, packages.id))
      .groupBy(packages.id)
      .orderBy(asc(packages.type), asc(packages.namespace), asc(packages.name))
    res.json({ data: rows })
  } catch (err) {
    next(err)
  }
})

// GET /api/v1/packages/:id — package detail
packagesRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid package id' }); return }
    const [pkg] = await db.select().from(packages).where(eq(packages.id, id))
    if (!pkg) { res.status(404).json({ error: 'Package not found' }); return }
    res.json({ data: pkg })
  } catch (err) {
    next(err)
  }
})

// GET /api/v1/packages/:id/versions — distinct versions with repo counts
packagesRouter.get('/:id/versions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid package id' }); return }
    const rows = await db
      .select({
        version: repoPackages.version,
        repoCount: sql<number>`cast(count(distinct ${repoPackages.repoId}) as int)`,
      })
      .from(repoPackages)
      .where(eq(repoPackages.canonPackageId, id))
      .groupBy(repoPackages.version)
      .orderBy(asc(repoPackages.version))
    res.json({ data: rows })
  } catch (err) {
    next(err)
  }
})

// GET /api/v1/packages/:id/repos — repos using this package
packagesRouter.get('/:id/repos', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid package id' }); return }
    const rows = await db
      .select({
        repoId: repositories.id,
        fullName: repositories.fullName,
        provider: repositories.provider,
        version: repoPackages.version,
      })
      .from(repoPackages)
      .innerJoin(repositories, eq(repositories.id, repoPackages.repoId))
      .where(eq(repoPackages.canonPackageId, id))
      .orderBy(repositories.fullName)
    res.json({ data: rows })
  } catch (err) {
    next(err)
  }
})
