import { Router } from 'express'
import { repositoriesRouter } from './repositories'
import { jobsRouter } from './jobs'
import { orgsRouter } from './orgs'
import { packagesRouter } from './packages'

export const router = Router()

router.get('/health', (_req, res) => res.json({ status: 'ok' }))
router.use('/repositories', repositoriesRouter)
router.use('/jobs', jobsRouter)
router.use('/orgs', orgsRouter)
router.use('/packages', packagesRouter)
