import { Router } from 'express'
import { repositoriesRouter } from './repositories'
import { jobsRouter } from './jobs'

export const router = Router()

router.get('/health', (_req, res) => res.json({ status: 'ok' }))
router.use('/repositories', repositoriesRouter)
router.use('/jobs', jobsRouter)
