import { Router, Request, Response, NextFunction } from 'express'
import { getSettings, updateSettings } from '../services/settingsService'
import { diskManager } from '../services/diskManager'

export const settingsRouter = Router()

// GET /api/v1/settings
settingsRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ data: await getSettings() })
  } catch (err) { next(err) }
})

// PUT /api/v1/settings
settingsRouter.put('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const updated = await updateSettings(req.body)
    // Restart the periodic disk check with the new interval
    diskManager.restart(getSettings)
    res.json({ data: updated })
  } catch (err) { next(err) }
})

// GET /api/v1/settings/disk
settingsRouter.get('/disk', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const s = await getSettings()
    res.json({ data: await diskManager.getDiskInfo(s.diskMaxBytes) })
  } catch (err) { next(err) }
})

// POST /api/v1/settings/disk/check
settingsRouter.post('/disk/check', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const s = await getSettings()
    await diskManager.checkAndEvict(s)
    res.json({ data: await diskManager.getDiskInfo(s.diskMaxBytes) })
  } catch (err) { next(err) }
})
