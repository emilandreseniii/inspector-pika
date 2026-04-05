import fs from 'fs/promises'
import path from 'path'
import { eq, and } from 'drizzle-orm'
import { db } from '../db'
import { diskCache } from '../db/schema'

// ── Types ────────────────────────────────────────────────────────────────────

export type DiskEntryType = 'repo' | 'logs'

export interface DiskCacheRow {
  id: number
  entryType: string
  key: string
  path: string
  sizeBytes: number
  lastUsedAt: Date
}

export interface DiskInfo {
  entries: DiskCacheRow[]
  totalBytes: number
  maxBytes: number
}

export interface DiskSettings {
  diskMaxBytes: number
  diskCheckIntervalMinutes: number
  diskCheckOnOperation: boolean
}

// ── Eviction target: stop once we're at 90% of max ───────────────────────────
const EVICTION_TARGET_RATIO = 0.9

// ── dirSize ──────────────────────────────────────────────────────────────────

/**
 * Recursively sum the sizes of all files in `dir`.
 * Returns 0 if the directory does not exist or cannot be read.
 * Symlinks are not followed (uses lstat).
 */
export async function dirSize(dir: string): Promise<number> {
  let total = 0
  let entries: Awaited<ReturnType<typeof fs.readdir>>
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      total += await dirSize(fullPath)
    } else if (entry.isFile()) {
      try {
        const stat = await fs.lstat(fullPath)
        total += stat.size
      } catch {
        // ignore unreadable files
      }
    }
  }
  return total
}

// ── DiskManager ───────────────────────────────────────────────────────────────

export class DiskManager {
  private intervalHandle: ReturnType<typeof setInterval> | null = null

  /**
   * Start the periodic space-check timer.
   * @param getSettings - async function that returns current settings (re-read on each tick)
   */
  start(getSettings: () => Promise<DiskSettings>): void {
    this.stop()
    const arm = async () => {
      const s = await getSettings().catch(() => null)
      if (!s) return
      this.stop()
      this.intervalHandle = setInterval(async () => {
        const current = await getSettings().catch(() => null)
        if (current) await this.checkAndEvict(current).catch(() => {})
      }, s.diskCheckIntervalMinutes * 60 * 1000)
    }
    arm()
  }

  stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle)
      this.intervalHandle = null
    }
  }

  /** Restart the timer (called when settings change). */
  restart(getSettings: () => Promise<DiskSettings>): void {
    this.start(getSettings)
  }

  /**
   * Measure the directory size and upsert a disk_cache row.
   * Call this after a clone/pull or after writing job logs.
   */
  async recordAccess(type: DiskEntryType, key: string, dir: string): Promise<void> {
    const size = await dirSize(dir)
    await db
      .insert(diskCache)
      .values({
        entryType: type,
        key,
        path: dir,
        sizeBytes: size,
        lastUsedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [diskCache.entryType, diskCache.key],
        set: {
          path: dir,
          sizeBytes: size,
          lastUsedAt: new Date(),
        },
      })
  }

  /**
   * Update only lastUsedAt without re-measuring size.
   * Call this when an analysis job runs but no clone/pull occurred.
   */
  async touchAccess(type: DiskEntryType, key: string): Promise<void> {
    await db
      .update(diskCache)
      .set({ lastUsedAt: new Date() })
      .where(and(eq(diskCache.entryType, type), eq(diskCache.key, key)))
  }

  /**
   * Check total usage and evict LRU entries until usage is within the target.
   */
  async checkAndEvict(settings: DiskSettings): Promise<void> {
    const entries = await db
      .select()
      .from(diskCache)
      .orderBy(diskCache.lastUsedAt) as DiskCacheRow[]

    let totalBytes = entries.reduce((sum, e) => sum + e.sizeBytes, 0)
    const targetBytes = settings.diskMaxBytes * EVICTION_TARGET_RATIO

    if (totalBytes <= settings.diskMaxBytes) return

    for (const entry of entries) {
      if (totalBytes <= targetBytes) break
      await this._evict(entry)
      totalBytes -= entry.sizeBytes
    }
  }

  /** Evict a single disk_cache entry: delete directory + remove DB row. */
  private async _evict(entry: DiskCacheRow): Promise<void> {
    if (entry.entryType === 'repo') {
      try {
        await fs.rm(entry.path, { recursive: true, force: true })
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          console.error(`[DiskManager] Failed to remove ${entry.path}:`, err.message)
        }
      }
      await db.delete(diskCache).where(eq(diskCache.id, entry.id))
    } else if (entry.entryType === 'logs') {
      // For logs, delete individual .log files oldest-first rather than the directory
      await this._evictOldestLogs(entry.path, entry.sizeBytes)
      // Re-measure and update (or remove if now empty)
      const newSize = await dirSize(entry.path)
      if (newSize === 0) {
        await db.delete(diskCache).where(eq(diskCache.id, entry.id))
      } else {
        await db.update(diskCache)
          .set({ sizeBytes: newSize, lastUsedAt: new Date() })
          .where(eq(diskCache.id, entry.id))
      }
    }
  }

  /** Delete oldest .log files in dir until we've freed ~half the entry size. */
  private async _evictOldestLogs(dir: string, sizeBytes: number): Promise<void> {
    let entries: Awaited<ReturnType<typeof fs.readdir>>
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    const logs: { file: string; mtime: number; size: number }[] = []
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.log')) continue
      try {
        const stat = await fs.lstat(path.join(dir, e.name))
        logs.push({ file: path.join(dir, e.name), mtime: stat.mtimeMs, size: stat.size })
      } catch { /* skip */ }
    }
    logs.sort((a, b) => a.mtime - b.mtime) // oldest first

    let freed = 0
    const target = sizeBytes / 2
    for (const log of logs) {
      if (freed >= target) break
      await fs.unlink(log.file).catch(() => {})
      freed += log.size
    }
  }

  /** Return current disk info for the settings page. */
  async getDiskInfo(maxBytes: number): Promise<DiskInfo> {
    const entries = await db.select().from(diskCache).orderBy(diskCache.lastUsedAt) as DiskCacheRow[]
    const totalBytes = entries.reduce((sum, e) => sum + e.sizeBytes, 0)
    return { entries, totalBytes, maxBytes }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const diskManager = new DiskManager()
