import { eq } from 'drizzle-orm'
import { db } from '../db'
import { settings } from '../db/schema'

export interface AppSettings {
  diskMaxBytes: number              // default 20 GiB
  diskCheckIntervalMinutes: number  // default 10
  diskCheckOnOperation: boolean     // default true
}

const DEFAULTS: AppSettings = {
  diskMaxBytes: 20 * 1024 * 1024 * 1024,
  diskCheckIntervalMinutes: 10,
  diskCheckOnOperation: true,
}

const KEYS = Object.keys(DEFAULTS) as (keyof AppSettings)[]

export async function getSettings(): Promise<AppSettings> {
  const rows = await db.select().from(settings)
  const result = { ...DEFAULTS }
  for (const row of rows) {
    if (KEYS.includes(row.key as keyof AppSettings)) {
      ;(result as any)[row.key] = row.value
    }
  }
  return result
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  for (const [key, value] of Object.entries(patch)) {
    if (!KEYS.includes(key as keyof AppSettings)) continue
    await db
      .insert(settings)
      .values({ key, value: value as any })
      .onConflictDoUpdate({ target: settings.key, set: { value: value as any } })
  }
  return getSettings()
}
