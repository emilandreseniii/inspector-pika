import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Job } from '@inspector-pika/shared'
import StartJobModal from './StartJobModal'
import SearchBox from './SearchBox'
import Pager from './Pager'

const PAGE_SIZE = 20

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
      padding: '2px 8px',
      borderRadius: 12,
      fontSize: 12,
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
  return type
}

// Search format: "org/apache"  "repo/apache/kafka"  or plain text
function filterJobs(jobs: Job[], search: string): Job[] {
  const q = search.trim().toLowerCase()
  if (!q) return jobs
  if (q.startsWith('org/')) {
    const orgQ = q.slice(4)
    return jobs.filter(j =>
      j.type === 'explore_github_org' &&
      String(j.input.org).toLowerCase().startsWith(orgQ)
    )
  }
  if (q.startsWith('repo/')) {
    const repoQ = q.slice(5)
    return jobs.filter(j =>
      j.type === 'explore_github_repo' &&
      String(j.input.repo).toLowerCase().startsWith(repoQ)
    )
  }
  return jobs.filter(j => jobLabel(j.type, j.input).toLowerCase().includes(q))
}

function getSuggestions(jobs: Job[], search: string): string[] {
  const q = search.trim().toLowerCase()
  if (!q) return []

  if (q === 'org' || q.startsWith('org/')) {
    const orgQ = q.startsWith('org/') ? q.slice(4) : ''
    const seen = new Set<string>()
    const results: string[] = []
    for (const j of jobs) {
      if (j.type !== 'explore_github_org') continue
      const org = String(j.input.org).toLowerCase()
      if (org.startsWith(orgQ) && !seen.has(org)) { seen.add(org); results.push(`org/${j.input.org}`) }
    }
    return results.sort().slice(0, 10)
  }

  if (q === 'repo' || q.startsWith('repo/')) {
    const repoQ = q.startsWith('repo/') ? q.slice(5) : ''
    const seen = new Set<string>()
    const results: string[] = []
    for (const j of jobs) {
      if (j.type !== 'explore_github_repo') continue
      const repo = String(j.input.repo).toLowerCase()
      if (repo.startsWith(repoQ) && !seen.has(repo)) { seen.add(repo); results.push(`repo/${j.input.repo}`) }
    }
    return results.sort().slice(0, 10)
  }

  const suggestions: string[] = []
  if ('org'.startsWith(q)) suggestions.push('org/')
  if ('repo'.startsWith(q)) suggestions.push('repo/')
  const seen = new Set<string>()
  for (const j of jobs) {
    const label = jobLabel(j.type, j.input)
    if (label.toLowerCase().includes(q) && !seen.has(label)) { seen.add(label); suggestions.push(label) }
  }
  return suggestions.slice(0, 10)
}

export default function JobsTab() {
  const navigate = useNavigate()
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function fetchJobs() {
    return fetch('/api/v1/jobs')
      .then((r) => r.json())
      .then((json) => {
        if (json.error) setError(json.error)
        else setJobs(json.data)
      })
      .catch(() => setError('Failed to load jobs.'))
  }

  useEffect(() => {
    fetchJobs().finally(() => setLoading(false))
    pollRef.current = setInterval(fetchJobs, 3000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  function handleSearch(value: string) { setSearch(value); setPage(0) }
  function handleJobStarted() { setShowModal(false); fetchJobs() }

  const filtered = filterJobs(jobs, search)
  const suggestions = getSuggestions(jobs, search)
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div>
      <div style={styles.topBar}>
        <h2 style={styles.heading}>Jobs</h2>
        <SearchBox
          value={search}
          onChange={handleSearch}
          suggestions={suggestions}
          placeholder="Filter: org/name or repo/owner/name…"
        />
        <button style={styles.startBtn} onClick={() => setShowModal(true)}>
          + Start a Job
        </button>
      </div>

      {loading && <p style={styles.muted}>Loading…</p>}
      {error && <p style={styles.error}>{error}</p>}

      {!loading && !error && jobs.length === 0 && (
        <p style={styles.muted}>No jobs yet. Click <strong>Start a Job</strong> to explore a repository or organization.</p>
      )}

      {!loading && !error && jobs.length > 0 && filtered.length === 0 && (
        <p style={styles.muted}>No jobs match <strong>{search}</strong>.</p>
      )}

      {pageRows.length > 0 && (
        <>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Description</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Started</th>
                <th style={styles.th}>Completed</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((job) => (
                <tr key={job.id} style={styles.trClickable} onClick={() => navigate(`/jobs/${job.id}`)}>
                  <td style={styles.td}>{jobLabel(job.type, job.input)}</td>
                  <td style={styles.td}><StatusBadge status={job.status} /></td>
                  <td style={styles.td}>{job.startedAt ? new Date(job.startedAt).toLocaleString() : '—'}</td>
                  <td style={styles.td}>{job.completedAt ? new Date(job.completedAt).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={page} totalItems={filtered.length} pageSize={PAGE_SIZE} onChange={setPage} />
        </>
      )}

      {showModal && (
        <StartJobModal onClose={() => setShowModal(false)} onStarted={handleJobStarted} />
      )}
    </div>
  )
}

const styles = {
  topBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  } as React.CSSProperties,
  heading: {
    fontSize: 20,
    fontWeight: 600,
    margin: 0,
    flexShrink: 0,
  } as React.CSSProperties,
  startBtn: {
    padding: '7px 14px',
    background: '#2da44e',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 600,
    flexShrink: 0,
  } as React.CSSProperties,
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    background: '#fff',
    border: '1px solid #d0d7de',
    borderRadius: 8,
    overflow: 'hidden',
    fontSize: 14,
  } as React.CSSProperties,
  th: {
    padding: '10px 16px',
    textAlign: 'left' as const,
    fontWeight: 600,
    background: '#f6f8fa',
    borderBottom: '1px solid #d0d7de',
    color: '#24292f',
    fontSize: 13,
  } as React.CSSProperties,
  td: {
    padding: '10px 16px',
    borderBottom: '1px solid #f6f8fa',
    color: '#24292f',
  } as React.CSSProperties,
  trClickable: {
    cursor: 'pointer',
  } as React.CSSProperties,
  muted: {
    color: '#57606a',
    fontSize: 14,
  } as React.CSSProperties,
  error: {
    color: 'crimson',
    fontSize: 14,
  } as React.CSSProperties,
}
