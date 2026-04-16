import { Router, Request, Response, NextFunction } from 'express'
import { eq, desc, and, sql, count } from 'drizzle-orm'
import { db } from '../db'
import { repositories, repoPackages, repoLanguages, jobs, repoEntityApproaches, repoEntities, repoEntityFields, repoEntityRelationships, repoApiApproaches, repoApiSurfaces, repoApiOps, repoApiOpParams } from '../db/schema'

export const repositoriesRouter = Router()

// GET /api/v1/repositories
repositoriesRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [rows, langRepoIds, pkgRepoIds, apiRepoIds, entityRepoIds] = await Promise.all([
      db.select().from(repositories).orderBy(desc(repositories.fetchedAt)),
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

// GET /api/v1/repositories/:id/entity-approaches
repositoriesRouter.get('/:id/entity-approaches', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid repository id' }); return }

    const approaches = await db.select().from(repoEntityApproaches).where(eq(repoEntityApproaches.repoId, id))

    // Attach entity count per approach
    const withCounts = await Promise.all(
      approaches.map(async (a) => {
        const [{ value }] = await db
          .select({ value: count() })
          .from(repoEntities)
          .where(and(eq(repoEntities.repoId, id), eq(repoEntities.sourceApproachId, a.id)))
        return { ...a, entityCount: value }
      }),
    )

    res.json({ data: withCounts })
  } catch (err) {
    next(err)
  }
})

// GET /api/v1/repositories/:id/entities
repositoriesRouter.get('/:id/entities', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid repository id' }); return }

    const typeFilter = req.query.type as string | undefined
    const approachFilter = req.query.approach as string | undefined
    const search = req.query.search as string | undefined

    let entityQuery = db
      .select()
      .from(repoEntities)
      .where(eq(repoEntities.repoId, id))

    const entities = await entityQuery.orderBy(repoEntities.normalizedName)

    // Apply filters in JS (simple enough for this scale)
    let filtered = entities
    if (typeFilter) filtered = filtered.filter((e) => e.entityType === typeFilter)
    if (search) filtered = filtered.filter((e) => e.normalizedName.includes(search.toLowerCase()))

    // Attach fields and source approach for each entity
    const result = await Promise.all(
      filtered.map(async (entity) => {
        const [fields, sourceApproach] = await Promise.all([
          db.select().from(repoEntityFields).where(eq(repoEntityFields.entityId, entity.id)).orderBy(repoEntityFields.ordinalPosition),
          entity.sourceApproachId
            ? db.select().from(repoEntityApproaches).where(eq(repoEntityApproaches.id, entity.sourceApproachId)).limit(1).then((rows) => rows[0] ?? null)
            : Promise.resolve(null),
        ])

        // Apply approach filter after resolving sourceApproach
        if (approachFilter && sourceApproach?.approach !== approachFilter) return null

        return { ...entity, fields, sourceApproach }
      }),
    )

    const data = result.filter(Boolean)
    res.json({ data, total: data.length })
  } catch (err) {
    next(err)
  }
})

// GET /api/v1/repositories/:id/entity-relationships
repositoriesRouter.get('/:id/entity-relationships', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid repository id' }); return }

    const relationships = await db
      .select({
        id: repoEntityRelationships.id,
        sourceEntityId: repoEntityRelationships.sourceEntityId,
        targetEntityId: repoEntityRelationships.targetEntityId,
        targetEntityName: repoEntityRelationships.targetEntityName,
        relationshipType: repoEntityRelationships.relationshipType,
        sourceField: repoEntityRelationships.sourceField,
        targetField: repoEntityRelationships.targetField,
        sourceEntityName: repoEntities.name,
      })
      .from(repoEntityRelationships)
      .leftJoin(repoEntities, eq(repoEntityRelationships.sourceEntityId, repoEntities.id))
      .where(eq(repoEntityRelationships.repoId, id))

    res.json({ data: relationships })
  } catch (err) {
    next(err)
  }
})

// GET /api/v1/repositories/:id/jobs
// Returns the most recent job of each analysis type for this repo.
repositoriesRouter.get('/:id/jobs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid repository id' }); return }

    const types = ['analyze_dependencies', 'analyze_languages', 'analyze_entities', 'analyze_apis']
    const rows = await Promise.all(
      types.map((type) =>
        db.select({
          id: jobs.id,
          type: jobs.type,
          status: jobs.status,
          error: jobs.error,
          startedAt: jobs.startedAt,
          completedAt: jobs.completedAt,
        })
          .from(jobs)
          .where(and(eq(jobs.type, type), sql`(${jobs.input}#>>'{}')::jsonb->>'repoId' = ${id.toString()}`))
          .orderBy(desc(jobs.createdAt))
          .limit(1)
          .then((r) => r[0] ?? null)
      )
    )

    const data: Record<string, typeof rows[0]> = {}
    types.forEach((type, i) => { if (rows[i]) data[type] = rows[i] })
    res.json({ data })
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
      db.select({ id: jobs.id, completedAt: jobs.completedAt }).from(jobs).where(
        and(
          eq(jobs.type, 'analyze_languages'),
          eq(jobs.status, 'completed'),
          sql`(${jobs.input}#>>'{}')::jsonb->>'repoId' = ${id.toString()}`
        )
      ).orderBy(desc(jobs.completedAt)).limit(1),
    ])
    res.json({ data: rows, analyzed: completedJobs.length > 0, lastAnalyzedAt: completedJobs[0]?.completedAt ?? null })
  } catch (err) {
    next(err)
  }
})

// GET /api/v1/repositories/:id/api-approaches
repositoriesRouter.get('/:id/api-approaches', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid repository id' }); return }

    const approaches = await db
      .select()
      .from(repoApiApproaches)
      .where(eq(repoApiApproaches.repoId, id))
      .orderBy(repoApiApproaches.language, repoApiApproaches.approach)

    res.json({ data: approaches })
  } catch (err) {
    next(err)
  }
})

// GET /api/v1/repositories/:id/api-surfaces
// Optional query param: ?style=http|graphql|rpc
repositoriesRouter.get('/:id/api-surfaces', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid repository id' }); return }

    const surfaces = await db
      .select()
      .from(repoApiSurfaces)
      .where(eq(repoApiSurfaces.repoId, id))
      .orderBy(repoApiSurfaces.apiStyle, repoApiSurfaces.name)

    const styleFilter = req.query.style as string | undefined
    const filtered = styleFilter ? surfaces.filter((s) => s.apiStyle === styleFilter) : surfaces

    // Attach op count per surface
    const withCounts = await Promise.all(
      filtered.map(async (s) => {
        const [{ value }] = await db
          .select({ value: count() })
          .from(repoApiOps)
          .where(eq(repoApiOps.surfaceId, s.id))
        return { ...s, opCount: value }
      }),
    )

    res.json({ data: withCounts })
  } catch (err) {
    next(err)
  }
})

// GET /api/v1/repositories/:id/api-ops
// Optional query params: ?surfaceId=N  ?style=http|graphql|rpc
repositoriesRouter.get('/:id/api-ops', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid repository id' }); return }

    const ops = await db
      .select()
      .from(repoApiOps)
      .where(eq(repoApiOps.repoId, id))
      .orderBy(repoApiOps.surfaceId, repoApiOps.path, repoApiOps.httpMethod)

    const surfaceFilter = req.query.surfaceId ? parseInt(req.query.surfaceId as string, 10) : undefined
    const styleFilter = req.query.style as string | undefined

    let filtered = ops
    if (surfaceFilter && !isNaN(surfaceFilter)) {
      filtered = filtered.filter((o) => o.surfaceId === surfaceFilter)
    }

    // Attach params per op
    const withParams = await Promise.all(
      filtered.map(async (op) => {
        const params = await db
          .select()
          .from(repoApiOpParams)
          .where(eq(repoApiOpParams.opId, op.id))
          .orderBy(repoApiOpParams.ordinalPosition)
        return { ...op, params }
      }),
    )

    // Apply style filter after joining with params (style is on the surface; filter by httpMethod presence as proxy)
    const result = styleFilter
      ? withParams.filter((o) => {
          if (styleFilter === 'http') return o.httpMethod !== null
          if (styleFilter === 'graphql') return o.operationType !== null
          if (styleFilter === 'rpc') return o.rpcMethodName !== null
          return true
        })
      : withParams

    res.json({ data: result, total: result.length })
  } catch (err) {
    next(err)
  }
})
