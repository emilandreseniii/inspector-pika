import { useEffect, useState, useCallback } from 'react'
import AppHeader from '../components/AppHeader'
import type { AppSettings, DiskInfo } from '@inspector-pika/shared'

function fmtBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [diskInfo, setDiskInfo] = useState<DiskInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  // Local form state (GB for display, stored as bytes internally)
  const [maxGb, setMaxGb] = useState('')
  const [intervalMin, setIntervalMin] = useState('')
  const [checkOnOp, setCheckOnOp] = useState(true)

  const loadDiskInfo = useCallback(() => {
    return fetch('/api/v1/settings/disk')
      .then((r) => r.json())
      .then((json) => { if (!json.error) setDiskInfo(json.data) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    Promise.all([
      fetch('/api/v1/settings').then((r) => r.json()),
      fetch('/api/v1/settings/disk').then((r) => r.json()),
    ])
      .then(([sJson, dJson]) => {
        if (sJson.error) { setError(sJson.error); return }
        const s: AppSettings = sJson.data
        setSettings(s)
        setMaxGb(String(s.diskMaxBytes / 1024 ** 3))
        setIntervalMin(String(s.diskCheckIntervalMinutes))
        setCheckOnOp(s.diskCheckOnOperation)
        if (!dJson.error) setDiskInfo(dJson.data)
      })
      .catch(() => setError('Failed to load settings.'))
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    setSaving(true)
    setSaveMsg(null)
    setError(null)
    try {
      const patch: Partial<AppSettings> = {
        diskMaxBytes: parseFloat(maxGb) * 1024 ** 3,
        diskCheckIntervalMinutes: parseInt(intervalMin, 10),
        diskCheckOnOperation: checkOnOp,
      }
      const res = await fetch('/api/v1/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const json = await res.json()
      if (json.error) { setError(json.error); return }
      setSettings(json.data)
      setSaveMsg('Settings saved.')
      await loadDiskInfo()
    } catch {
      setError('Failed to save settings.')
    } finally {
      setSaving(false)
    }
  }

  async function handleRunCheck() {
    setChecking(true)
    try {
      const res = await fetch('/api/v1/settings/disk/check', { method: 'POST' })
      const json = await res.json()
      if (!json.error) setDiskInfo(json.data)
    } catch { /* ignore */ }
    finally { setChecking(false) }
  }

  const usageRatio = diskInfo && settings
    ? Math.min(diskInfo.totalBytes / settings.diskMaxBytes, 1)
    : 0
  const usagePercent = Math.round(usageRatio * 100)
  const barColor = usageRatio > 0.9 ? '#cf222e' : usageRatio > 0.75 ? '#9a6700' : '#1a7f37'

  return (
    <div style={styles.root}>
      <AppHeader />
      <main style={styles.content}>
        <h2 style={styles.heading}>Settings</h2>

        {loading && <p style={styles.muted}>Loading…</p>}
        {error && <p style={styles.error}>{error}</p>}

        {!loading && settings && (
          <>
            {/* ── Storage Limits ── */}
            <section style={styles.card}>
              <h3 style={styles.cardHeading}>Storage Limits</h3>
              <div style={styles.fieldRow}>
                <label style={styles.label}>Maximum data directory size (GB)</label>
                <input
                  type="number" min="1" step="1"
                  value={maxGb}
                  onChange={(e) => setMaxGb(e.target.value)}
                  style={styles.input}
                />
              </div>
              <div style={styles.fieldRow}>
                <label style={styles.label}>Disk check interval (minutes)</label>
                <input
                  type="number" min="1" step="1"
                  value={intervalMin}
                  onChange={(e) => setIntervalMin(e.target.value)}
                  style={styles.input}
                />
              </div>
              <div style={styles.fieldRow}>
                <label style={styles.label}>Check before each clone / pull</label>
                <input
                  type="checkbox"
                  checked={checkOnOp}
                  onChange={(e) => setCheckOnOp(e.target.checked)}
                  style={styles.checkbox}
                />
              </div>
              <div style={styles.actionRow}>
                <button
                  style={{ ...styles.btn, ...(saving ? styles.btnBusy : {}) }}
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? 'Saving…' : 'Save Settings'}
                </button>
                {saveMsg && <span style={styles.saveMsg}>{saveMsg}</span>}
              </div>
            </section>

            {/* ── Disk Usage ── */}
            <section style={styles.card}>
              <div style={styles.diskHeader}>
                <h3 style={{ ...styles.cardHeading, margin: 0 }}>Disk Usage</h3>
                <button
                  style={{ ...styles.btn, ...(checking ? styles.btnBusy : {}), fontSize: 13 }}
                  onClick={handleRunCheck}
                  disabled={checking}
                >
                  {checking ? 'Running…' : 'Run Space Check'}
                </button>
              </div>

              {diskInfo && (
                <>
                  <div style={styles.progressWrap}>
                    <div style={{ ...styles.progressBar, width: `${usagePercent}%`, background: barColor }} />
                  </div>
                  <p style={styles.usageLabel}>
                    {fmtBytes(diskInfo.totalBytes)} used of {fmtBytes(diskInfo.maxBytes)} ({usagePercent}%)
                  </p>

                  {diskInfo.entries.length === 0 ? (
                    <p style={styles.muted}>No tracked entries yet. Entries appear after analysis jobs run.</p>
                  ) : (
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>Type</th>
                          <th style={styles.th}>Key</th>
                          <th style={{ ...styles.th, textAlign: 'right' }}>Size</th>
                          <th style={styles.th}>Last Used</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diskInfo.entries.map((e) => (
                          <tr key={e.id}>
                            <td style={styles.td}>
                              <span style={{ ...styles.typeBadge, background: e.entryType === 'repo' ? '#0969da' : '#57606a' }}>
                                {e.entryType}
                              </span>
                            </td>
                            <td style={styles.td}>{e.key}</td>
                            <td style={{ ...styles.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtBytes(e.sizeBytes)}</td>
                            <td style={{ ...styles.td, color: '#57606a' }}>{fmtDate(e.lastUsedAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  root: { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', minHeight: '100vh', background: '#f6f8fa' },
  content: { maxWidth: 800, margin: '0 auto', padding: '24px 32px' },
  heading: { fontSize: 22, fontWeight: 700, margin: '0 0 24px' },
  card: { background: '#fff', border: '1px solid #d0d7de', borderRadius: 8, padding: '20px 24px', marginBottom: 24 },
  cardHeading: { fontSize: 16, fontWeight: 600, margin: '0 0 16px', color: '#24292f' },
  fieldRow: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14 },
  label: { fontSize: 14, color: '#24292f', flex: 1, minWidth: 260 },
  input: { width: 120, padding: '5px 10px', border: '1px solid #d0d7de', borderRadius: 6, fontSize: 14 },
  checkbox: { width: 16, height: 16, cursor: 'pointer' },
  actionRow: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 },
  btn: { padding: '6px 16px', background: '#0969da', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 500 },
  btnBusy: { background: '#6e9fd4', cursor: 'not-allowed' },
  saveMsg: { fontSize: 13, color: '#1a7f37' },
  diskHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  progressWrap: { height: 10, background: '#f0f0f0', borderRadius: 5, overflow: 'hidden', marginBottom: 6 },
  progressBar: { height: '100%', borderRadius: 5, transition: 'width 0.3s ease' },
  usageLabel: { fontSize: 13, color: '#57606a', marginBottom: 16 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14, background: '#fff', border: '1px solid #d0d7de', borderRadius: 8, overflow: 'hidden' },
  th: { padding: '8px 14px', textAlign: 'left', fontWeight: 600, background: '#f6f8fa', borderBottom: '1px solid #d0d7de', color: '#24292f', fontSize: 13 },
  td: { padding: '8px 14px', borderBottom: '1px solid #f6f8fa', color: '#24292f' },
  typeBadge: { display: 'inline-block', padding: '1px 7px', borderRadius: 10, fontSize: 11, fontWeight: 700, color: '#fff' },
  muted: { color: '#57606a', fontSize: 14 },
  error: { color: 'crimson', fontSize: 14 },
}
