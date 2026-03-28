import { Router, Request, Response, NextFunction } from 'express'
import { eq, desc } from 'drizzle-orm'
import { db } from '../db'
import { jobs } from '../db/schema'
import { runJob } from '../services/jobRunner'
import { CreateJobSchema } from '@inspector-pika/shared'

export const jobsRouter = Router()

// GET /api/v1/jobs
jobsRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await db.select().from(jobs).orderBy(desc(jobs.createdAt))
    res.json({ data: rows })
  } catch (err) {
    next(err)
  }
})

// POST /api/v1/jobs — create and immediately start a job
jobsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = CreateJobSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message })
      return
    }

    const input = parsed.data
    const [job] = await db
      .insert(jobs)
      .values({ type: input.type, input, status: 'pending' })
      .returning()

    // Run asynchronously — don't block the response
    runJob(job.id, input).catch((err) => {
      console.error(`Job ${job.id} runner threw unexpectedly:`, err)
    })

    res.status(201).json({ data: job })
  } catch (err) {
    next(err)
  }
})

// GET /api/v1/jobs/:id
jobsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) { res.status(400).json({ error: 'Invalid job id' }); return }
    const [job] = await db.select().from(jobs).where(eq(jobs.id, id))
    if (!job) { res.status(404).json({ error: 'Job not found' }); return }
    res.json({ data: job })
  } catch (err) {
    next(err)
  }
})
