import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { Job } from '@inspector-pika/shared'

const STATUS_COLORS: Record<string, string> = {
  pending: '#9a6700',
  running: '#0969da',
  completed: '#1a7f37',
  failed: '#cf222e',
  cancelled: '#57606a',
}

const STATUS_BG: Record<string, string> = {
  pending: '#fff8c5',
  running: '#ddf4ff',
  completed: '#dafbe1',
  failed: '#ffebe9',
  cancelled: '#f6f8fa',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '3px 10px',
      borderRadius: 12,
      fontSize: 13,
      fontWeight: 600,
      color: STATUS_COLORS[status] ?? '#57606a',
      background: STATUS_BG[status] ?? '#f6f8fa',
    }}>
      {status}
    </span>
  )
}

function jobLabel(type: string, input: Record<string, unknown>): string {
  if (type === 'explore_github_repo') return `Explore repo: ${input.repo}`
  if (type === 'explore_github_org') return `Explore org: ${input.org}`
  if (type === 'analyze_dependencies') return `Analyze dependencies: ${input.repo}`
  if (type === 'analyze_languages') return `Analyze languages: ${input.repo}`
  if (type === 'analyze_entities') return `Analyze entities: ${input.repo}`
  return type
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

const ACTIVE_STATUSES = new Set(['pending', 'running'])

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [job, setJob] = useState<Job | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function fetchJob() {
    return fetch(`/api/v1/jobs/${id}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) { setError(json.error); return }
        setJob(json.data)
        // Stop polling once the job reaches a terminal state
        if (!ACTIVE_STATUSES.has(json.data.status) && pollRef.current) {
          clearInterval(pollRef.current)
          pollRef.current = null
        }
      })
      .catch(() => setError('Failed to load job.'))
  }

  useEffect(() => {
    fetchJob().finally(() => setLoading(false))
    pollRef.current = setInterval(fetchJob, 3000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [id])

  async function handleCancel() {
    setCancelling(true)
    setCancelError(null)
    try {
      const res = await fetch(`/api/v1/jobs/${id}/cancel`, { method: 'POST' })
      const json = await res.json()
      if (json.error) {
        setCancelError(json.error)
      } else {
        setJob(json.data)
      }
    } catch {
      setCancelError('Request failed.')
    } finally {
      setCancelling(false)
    }
  }

  if (loading) return <div style={styles.page}><p style={styles.muted}>Loading…</p></div>
  if (error) return <div style={styles.page}><p style={styles.errorText}>{error}</p></div>
  if (!job) return null

  const isCancellable = ACTIVE_STATUSES.has(job.status)
  const label = jobLabel(job.type, job.input)

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={() => navigate('/jobs')}>← Back</button>
        <h2 style={styles.heading}>{label}</h2>
        {isCancellable && (
          <button
            style={{ ...styles.cancelBtn, ...(cancelling ? styles.cancelBtnBusy : {}) }}
            disabled={cancelling}
            onClick={handleCancel}
          >
            {cancelling ? 'Cancelling…' : 'Cancel Job'}
          </button>
        )}
      </div>

      {cancelError && <p style={styles.errorText}>{cancelError}</p>}

      <div style={styles.card}>
        <table style={styles.metaTable}>
          <tbody>
            <tr>
              <th style={styles.metaTh}>Job ID</th>
              <td style={styles.metaTd}>{job.id}</td>
            </tr>
            <tr>
              <th style={styles.metaTh}>Type</th>
              <td style={styles.metaTd}>{job.type}</td>
            </tr>
            <tr>
              <th style={styles.metaTh}>Status</th>
              <td style={styles.metaTd}><StatusBadge status={job.status} /></td>
            </tr>
            <tr>
              <th style={styles.metaTh}>Created</th>
              <td style={styles.metaTd}>{fmtDateTime(job.createdAt)}</td>
            </tr>
            <tr>
              <th style={styles.metaTh}>Started</th>
              <td style={styles.metaTd}>{fmtDateTime(job.startedAt)}</td>
            </tr>
            <tr>
              <th style={styles.metaTh}>Completed</th>
              <td style={styles.metaTd}>{fmtDateTime(job.completedAt)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={styles.section}>
        <h3 style={styles.sectionHeading}>Input</h3>
        <pre style={styles.codeBlock}>{JSON.stringify(job.input, null, 2)}</pre>
      </div>

      {job.error && (
        <div style={styles.section}>
          <h3 style={{ ...styles.sectionHeading, color: '#cf222e' }}>Error</h3>
          <pre style={{ ...styles.codeBlock, background: '#ffebe9', borderColor: '#ffd7d5' }}>{job.error}</pre>
        </div>
      )}

      {job.result && (
        <div style={styles.section}>
          <h3 style={styles.sectionHeading}>Result</h3>
          <pre style={styles.codeBlock}>{JSON.stringify(job.result, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: 800,
    margin: '0 auto',
    padding: '24px 16px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
    flexWrap: 'wrap',
  },
  heading: {
    fontSize: 20,
    fontWeight: 600,
    margin: 0,
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  backBtn: {
    padding: '6px 12px',
    background: 'transparent',
    border: '1px solid #d0d7de',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 13,
    color: '#24292f',
    flexShrink: 0,
  },
  cancelBtn: {
    padding: '6px 14px',
    background: '#cf222e',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
    flexShrink: 0,
  },
  cancelBtnBusy: {
    background: '#9e1b23',
    cursor: 'not-allowed',
  },
  card: {
    background: '#fff',
    border: '1px solid #d0d7de',
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 20,
  },
  metaTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 14,
  },
  metaTh: {
    padding: '10px 16px',
    fontWeight: 600,
    color: '#57606a',
    background: '#f6f8fa',
    width: 140,
    textAlign: 'left',
    borderBottom: '1px solid #f0f0f0',
    fontSize: 13,
  },
  metaTd: {
    padding: '10px 16px',
    color: '#24292f',
    borderBottom: '1px solid #f0f0f0',
  },
  section: {
    marginBottom: 20,
  },
  sectionHeading: {
    fontSize: 15,
    fontWeight: 600,
    marginBottom: 8,
    color: '#24292f',
  },
  codeBlock: {
    background: '#f6f8fa',
    border: '1px solid #d0d7de',
    borderRadius: 6,
    padding: '12px 16px',
    fontSize: 12,
    lineHeight: 1.5,
    overflow: 'auto',
    margin: 0,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  muted: {
    color: '#57606a',
    fontSize: 14,
  },
  errorText: {
    color: '#cf222e',
    fontSize: 14,
    marginBottom: 12,
  },
}
