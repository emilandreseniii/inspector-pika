# Disk Space Management — Design

Covers FR-10 (Settings) and FR-11 (Disk Space Management).

---

## 1. Overview

Inspector Pika clones repositories and stores ORT output under `data/`. On a long-running instance this directory can grow without bound. The disk management subsystem caps its size by evicting least-recently-used repo directories when the total exceeds a configurable maximum.

---

## 2. Database Schema

### `settings` table

Simple key/value store. Values are stored as JSONB to accommodate any future setting type.

```
settings
  key   TEXT PRIMARY KEY
  value JSONB NOT NULL
```

Initial keys:

| key | default | description |
|-----|---------|-------------|
| `disk_max_bytes` | `21474836480` (20 GiB) | Maximum allowed data-dir size |
| `disk_check_interval_minutes` | `10` | Periodic check frequency |
| `disk_check_on_operation` | `true` | Check before every clone/pull |

### `disk_cache` table

One row per tracked directory. Sizes are measured after operations and stored here — no live stat on every read.

```
disk_cache
  id            SERIAL PRIMARY KEY
  entry_type    TEXT NOT NULL            -- 'repo' | 'logs'
  key           TEXT NOT NULL            -- 'owner/name' for repos, 'jobs' for logs
  path          TEXT NOT NULL            -- absolute directory path
  size_bytes    BIGINT NOT NULL DEFAULT 0
  last_used_at  TIMESTAMP NOT NULL DEFAULT NOW()
  UNIQUE (entry_type, key)
```

---

## 3. DiskManager Service

`server/src/services/diskManager.ts`

Singleton exported as `diskManager`. The server calls `diskManager.start()` on startup to arm the periodic check.

```
DiskManager
  start(getSettings)       arm setInterval; re-arms when settings change
  stop()                   clear interval
  recordAccess(type, key, dir)
    - measure dir size (recursive sum)
    - upsert disk_cache row (size_bytes, last_used_at = NOW())
  touchAccess(type, key)
    - update last_used_at = NOW() without re-measuring size
  checkAndEvict()
    - load settings from DB
    - sum all size_bytes from disk_cache
    - if sum <= max: return (no-op)
    - sort entries by last_used_at ASC (LRU first)
    - evict entries until sum <= max * 0.9  (target 90% to avoid thrash)
    - evicting 'repo': rm -rf path + DELETE disk_cache row
    - evicting 'logs': delete individual .log files oldest-first (not the dir)
  getDiskInfo()
    - return { entries[], totalBytes, maxBytes }
```

### Size measurement

```typescript
async function dirSize(p: string): Promise<number> {
  // Recursive fs.readdir + fs.stat, summing file sizes.
  // Symlinks are not followed (lstat).
  // Returns 0 if path does not exist.
}
```

---

## 4. Settings Service

`server/src/services/settingsService.ts`

Thin wrapper around the `settings` table. Returns typed defaults when no row exists.

```typescript
interface AppSettings {
  diskMaxBytes: number              // default 20 * 1024 ** 3
  diskCheckIntervalMinutes: number  // default 10
  diskCheckOnOperation: boolean     // default true
}

getSettings(): Promise<AppSettings>
updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>
```

---

## 5. Integration with jobRunner / ortAnalyzer

Two hook points:

### 5a. Before `cloneOrUpdate`

```typescript
// In ortAnalyzer.ts (or called from jobRunner.ts before cloneOrUpdate):
if (settings.diskCheckOnOperation) {
  await diskManager.checkAndEvict()
}
await cloneOrUpdate(...)
await diskManager.recordAccess('repo', `${owner}/${name}`, sourceDir)
```

### 5b. On any analysis job for a repo

```typescript
// After determining sourceDir but before running analysis:
await diskManager.touchAccess('repo', `${owner}/${name}`)
```

### 5c. Log directory tracking

After each job log is written:

```typescript
// In jobRunner.ts, after job completion (success or failure):
await diskManager.recordAccess('logs', 'jobs', JOB_LOGS_DIR)
```

---

## 6. API Routes

`server/src/routes/settings.ts` → mounted at `/api/v1/settings`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/settings` | Return current `AppSettings` |
| PUT | `/api/v1/settings` | Patch one or more settings; triggers interval restart |
| GET | `/api/v1/settings/disk` | Return `DiskInfo` (entries, totalBytes, maxBytes) |
| POST | `/api/v1/settings/disk/check` | Run space check immediately |

---

## 7. Shared Types

Added to `shared/src/index.ts`:

```typescript
AppSettingsSchema     // diskMaxBytes, diskCheckIntervalMinutes, diskCheckOnOperation
DiskCacheEntrySchema  // id, entryType, key, path, sizeBytes, lastUsedAt
DiskInfoSchema        // entries[], totalBytes, maxBytes
```

---

## 8. UI — Settings Page

`client/src/pages/SettingsPage.tsx`

Sections:

### 8a. Storage Limits
- "Max data directory size" — number input (GB), saved on blur/submit
- "Disk check interval" — number input (minutes)
- "Check before each clone" — toggle

### 8b. Disk Usage
- Progress bar: `totalBytes / maxBytes`
- "Run Space Check" button → POST `/api/v1/settings/disk/check`
- Table of cache entries: Type | Key | Size | Last Used

### Navigation

`AppHeader` gains a third main tab: **Settings** (route `/settings`).

---

## 9. Periodic Check Lifecycle

```
server/src/index.ts
  ↓
diskManager.start(settingsService.getSettings)
  ↓ reads settings
setInterval(checkAndEvict, interval_ms)

PUT /api/v1/settings
  ↓ saves new settings
diskManager.restart()   // clears old interval, arms new one
```

---

## 10. Eviction Target

Eviction targets 90% of the configured max (not 100%) to create a buffer and reduce churn. Example: with a 20 GiB limit, eviction stops when usage falls below 18 GiB.

---

## 11. Testing

Unit tests cover `diskManager`:
- `dirSize` — sums nested files correctly; returns 0 for missing dir
- `recordAccess` — upserts the DB row with measured size
- `touchAccess` — updates only `last_used_at`
- `checkAndEvict` — no-op when under limit; evicts LRU entries when over; targets 90%
- `checkAndEvict` — evicts logs by deleting oldest `.log` files, not the directory

All DB and filesystem calls mocked via `vi.spyOn` / `vi.mock`.
