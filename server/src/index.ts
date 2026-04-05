import './env'
import path from 'path'
import express from 'express'
import cors from 'cors'
import { router } from './routes'
import { errorHandler } from './middleware/errorHandler'
import { backfillPackages } from './services/packagesBackfill'
import { diskManager } from './services/diskManager'
import { getSettings } from './services/settingsService'

const PROJECT_ROOT = path.resolve(__dirname, '../../../')
const DATA_DIR = path.join(PROJECT_ROOT, 'data')
const JOB_LOGS_DIR = path.join(DATA_DIR, 'jobs')

const app = express()
const PORT = process.env.PORT ?? 3000

app.use(cors())
app.use(express.json())
app.use('/api/v1', router)
app.use(errorHandler)

app.listen(PORT, async () => {
  console.log(`Inspector Pika server running on http://localhost:${PORT}`)
  console.log(`  Health: http://localhost:${PORT}/api/v1/health`)
  await backfillPackages().catch((err) => console.warn('[packages] Backfill failed:', err.message))
  diskManager.start(getSettings)
  // Fire-and-forget: populate disk_cache for repos that existed before this feature
  diskManager.backfill(DATA_DIR, JOB_LOGS_DIR).catch((err) => console.warn('[disk] Backfill failed:', err.message))
})
