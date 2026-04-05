import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock fs/promises ────────────────────────────────────────────────────────
vi.mock('fs/promises', () => ({
  default: {
    readdir: vi.fn(),
    lstat: vi.fn(),
    rm: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn(),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}))

// ── Mock drizzle db ─────────────────────────────────────────────────────────
vi.mock('../../db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}))

import fs from 'fs/promises'
import { db } from '../../db'
import {
  dirSize,
  DiskManager,
} from '../diskManager'

// ── Helpers ──────────────────────────────────────────────────────────────────

type Dirent = { name: string; isDirectory: () => boolean; isFile: () => boolean }

function makeDirent(name: string, isDir: boolean): Dirent {
  return { name, isDirectory: () => isDir, isFile: () => !isDir }
}

function makeStats(size: number) {
  return { size }
}

// ── dirSize ──────────────────────────────────────────────────────────────────

describe('dirSize', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 0 for a missing directory', async () => {
    vi.mocked(fs.readdir).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    expect(await dirSize('/no/such/path')).toBe(0)
  })

  it('sums file sizes in a flat directory', async () => {
    vi.mocked(fs.readdir).mockResolvedValue([makeDirent('a.txt', false), makeDirent('b.txt', false)] as any)
    vi.mocked(fs.lstat)
      .mockResolvedValueOnce(makeStats(100) as any)
      .mockResolvedValueOnce(makeStats(200) as any)
    expect(await dirSize('/flat')).toBe(300)
  })

  it('recursively sums nested directories', async () => {
    // root: subdir/ + file.txt
    vi.mocked(fs.readdir)
      .mockResolvedValueOnce([makeDirent('sub', true), makeDirent('file.txt', false)] as any)
      // subdir: child.txt
      .mockResolvedValueOnce([makeDirent('child.txt', false)] as any)
    vi.mocked(fs.lstat)
      .mockResolvedValueOnce(makeStats(50) as any)  // file.txt
      .mockResolvedValueOnce(makeStats(150) as any) // child.txt
    expect(await dirSize('/nested')).toBe(200)
  })

  it('returns 0 for an empty directory', async () => {
    vi.mocked(fs.readdir).mockResolvedValue([] as any)
    expect(await dirSize('/empty')).toBe(0)
  })
})

// ── DiskManager ───────────────────────────────────────────────────────────────

describe('DiskManager', () => {
  let manager: DiskManager

  // Build chainable drizzle mock helpers
  function mockSelect(rows: unknown[]) {
    const chain = { from: vi.fn(), where: vi.fn(), orderBy: vi.fn() }
    chain.from.mockReturnValue(chain)
    chain.where.mockReturnValue(chain)
    chain.orderBy.mockResolvedValue(rows)
    vi.mocked(db.select).mockReturnValue(chain as any)
    return chain
  }

  function mockInsert() {
    const chain = { values: vi.fn(), onConflictDoUpdate: vi.fn() }
    chain.values.mockReturnValue(chain)
    chain.onConflictDoUpdate.mockResolvedValue(undefined)
    vi.mocked(db.insert).mockReturnValue(chain as any)
    return chain
  }

  function mockUpdate() {
    const chain = { set: vi.fn(), where: vi.fn() }
    chain.set.mockReturnValue(chain)
    chain.where.mockResolvedValue(undefined)
    vi.mocked(db.update).mockReturnValue(chain as any)
    return chain
  }

  function mockDelete() {
    const chain = { where: vi.fn() }
    chain.where.mockResolvedValue(undefined)
    vi.mocked(db.delete).mockReturnValue(chain as any)
    return chain
  }

  beforeEach(() => {
    vi.clearAllMocks()
    manager = new DiskManager()
  })

  afterEach(() => {
    manager.stop()
  })

  // ── recordAccess ────────────────────────────────────────────────────────────

  describe('recordAccess', () => {
    it('measures directory size and upserts a disk_cache row', async () => {
      vi.mocked(fs.readdir).mockResolvedValue([makeDirent('f', false)] as any)
      vi.mocked(fs.lstat).mockResolvedValue(makeStats(1024) as any)
      const insert = mockInsert()

      await manager.recordAccess('repo', 'apache/spark', '/data/repos/apache/spark')

      expect(insert.values).toHaveBeenCalledWith(expect.objectContaining({
        entryType: 'repo',
        key: 'apache/spark',
        path: '/data/repos/apache/spark',
        sizeBytes: 1024,
      }))
      expect(insert.onConflictDoUpdate).toHaveBeenCalled()
    })
  })

  // ── touchAccess ─────────────────────────────────────────────────────────────

  describe('touchAccess', () => {
    it('updates only lastUsedAt without re-measuring size', async () => {
      const update = mockUpdate()

      await manager.touchAccess('repo', 'apache/spark')

      expect(update.set).toHaveBeenCalledWith(expect.objectContaining({
        lastUsedAt: expect.any(Date),
      }))
      expect(fs.readdir).not.toHaveBeenCalled()
    })
  })

  // ── checkAndEvict ───────────────────────────────────────────────────────────

  describe('checkAndEvict', () => {
    const SETTINGS_DEFAULT = {
      diskMaxBytes: 20 * 1024 ** 3,
      diskCheckIntervalMinutes: 10,
      diskCheckOnOperation: true,
    }

    it('is a no-op when total usage is under the limit', async () => {
      mockSelect([
        { id: 1, entryType: 'repo', key: 'a/b', path: '/data/repos/a/b', sizeBytes: 1000, lastUsedAt: new Date() },
      ])

      await manager.checkAndEvict(SETTINGS_DEFAULT)

      expect(fs.rm).not.toHaveBeenCalled()
    })

    it('evicts the LRU repo entry when over the limit', async () => {
      const maxBytes = 100
      const settings = { ...SETTINGS_DEFAULT, diskMaxBytes: maxBytes }

      const old = new Date('2020-01-01')
      const recent = new Date('2024-01-01')

      mockSelect([
        { id: 1, entryType: 'repo', key: 'old/repo', path: '/data/repos/old/repo', sizeBytes: 60, lastUsedAt: old },
        { id: 2, entryType: 'repo', key: 'new/repo', path: '/data/repos/new/repo', sizeBytes: 60, lastUsedAt: recent },
      ])
      mockDelete()

      await manager.checkAndEvict(settings)

      // rm -rf should have been called on the OLD repo (LRU)
      expect(fs.rm).toHaveBeenCalledWith('/data/repos/old/repo', { recursive: true, force: true })
      // Delete should have removed that cache row
      expect(db.delete).toHaveBeenCalled()
    })

    it('evicts multiple entries until usage falls to 90% of max', async () => {
      const maxBytes = 100
      const settings = { ...SETTINGS_DEFAULT, diskMaxBytes: maxBytes }
      // Total = 120, target = 90% of 100 = 90 → need to evict at least 30 bytes
      // Evicting both old entries (20+20=40) brings total to 80 ≤ 90 → done

      const veryOld = new Date('2019-01-01')
      const old = new Date('2020-01-01')
      const recent = new Date('2024-01-01')

      mockSelect([
        { id: 1, entryType: 'repo', key: 'oldest/repo', path: '/data/repos/oldest/repo', sizeBytes: 20, lastUsedAt: veryOld },
        { id: 2, entryType: 'repo', key: 'old/repo', path: '/data/repos/old/repo', sizeBytes: 20, lastUsedAt: old },
        { id: 3, entryType: 'repo', key: 'new/repo', path: '/data/repos/new/repo', sizeBytes: 80, lastUsedAt: recent },
      ])
      mockDelete()

      await manager.checkAndEvict(settings)

      // Only oldest and old should be evicted (total 120 - 20 - 20 = 80 ≤ 90)
      expect(fs.rm).toHaveBeenCalledTimes(2)
      expect(fs.rm).toHaveBeenCalledWith('/data/repos/oldest/repo', expect.anything())
      expect(fs.rm).toHaveBeenCalledWith('/data/repos/old/repo', expect.anything())
      expect(fs.rm).not.toHaveBeenCalledWith('/data/repos/new/repo', expect.anything())
    })

    it('stops evicting once usage is within target', async () => {
      const maxBytes = 100
      const settings = { ...SETTINGS_DEFAULT, diskMaxBytes: maxBytes }
      // Total = 105, target = 90 → evict oldest (50 bytes) → total = 55 ≤ 90

      const old = new Date('2020-01-01')
      const recent = new Date('2024-01-01')

      mockSelect([
        { id: 1, entryType: 'repo', key: 'old/a', path: '/data/repos/old/a', sizeBytes: 50, lastUsedAt: old },
        { id: 2, entryType: 'repo', key: 'new/b', path: '/data/repos/new/b', sizeBytes: 55, lastUsedAt: recent },
      ])
      mockDelete()

      await manager.checkAndEvict(settings)

      expect(fs.rm).toHaveBeenCalledTimes(1)
      expect(fs.rm).toHaveBeenCalledWith('/data/repos/old/a', expect.anything())
    })

    it('handles a missing directory gracefully when evicting', async () => {
      const maxBytes = 50
      const settings = { ...SETTINGS_DEFAULT, diskMaxBytes: maxBytes }

      mockSelect([
        { id: 1, entryType: 'repo', key: 'gone/repo', path: '/data/repos/gone/repo', sizeBytes: 60, lastUsedAt: new Date('2020-01-01') },
      ])
      mockDelete()
      vi.mocked(fs.rm).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

      // Should not throw even if rm fails
      await expect(manager.checkAndEvict(settings)).resolves.toBeUndefined()
      expect(db.delete).toHaveBeenCalled()
    })
  })

  // ── getDiskInfo ──────────────────────────────────────────────────────────────

  describe('getDiskInfo', () => {
    it('returns entries, totalBytes, and maxBytes', async () => {
      const entries = [
        { id: 1, entryType: 'repo', key: 'a/b', path: '/data/repos/a/b', sizeBytes: 500, lastUsedAt: new Date() },
        { id: 2, entryType: 'logs', key: 'jobs', path: '/data/jobs', sizeBytes: 200, lastUsedAt: new Date() },
      ]
      mockSelect(entries)

      const info = await manager.getDiskInfo(10 * 1024 ** 3)

      expect(info.totalBytes).toBe(700)
      expect(info.maxBytes).toBe(10 * 1024 ** 3)
      expect(info.entries).toHaveLength(2)
    })
  })
})
