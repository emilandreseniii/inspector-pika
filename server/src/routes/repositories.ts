import { Router, Request, Response, NextFunction } from 'express'
import { eq, desc, and, sql, count } from 'drizzle-orm'
import { db } from '../db'
import { repositories, repoPackages, repoLanguages, jobs, repoEntityApproaches, repoEntities, repoEntityFields, repoEntityRelationships } from '../db/schema'

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

    const types = ['analyze_dependencies', 'analyze_languages', 'analyze_entities']
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
