import './env'
import express from 'express'
import cors from 'cors'
import { router } from './routes'
import { errorHandler } from './middleware/errorHandler'
import { backfillPackages } from './services/packagesBackfill'
import { diskManager } from './services/diskManager'
import { getSettings } from './services/settingsService'

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
})
