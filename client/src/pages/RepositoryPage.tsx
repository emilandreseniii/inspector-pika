import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { Repository, RepoPackage, RepoLanguage } from '@inspector-pika/shared'
import logo from '../assets/logo.svg'

const PROVIDER_LABELS: Record<string, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  bitbucket: 'Bitbucket',
}

type JobStatus = 'idle' | 'pending' | 'running' | 'completed' | 'failed'

export default function RepositoryPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [repo, setRepo] = useState<Repository | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [packages, setPackages] = useState<RepoPackage[]>([])
  const [languages, setLanguages] = useState<RepoLanguage[]>([])
  const [showJobMenu, setShowJobMenu] = useState(false)

  const [depStatus, setDepStatus] = useState<JobStatus>('idle')
  const [depError, setDepError] = useState<string | null>(null)
  const [langStatus, setLangStatus] = useState<JobStatus>('idle')
  const [langError, setLangError] = useState<string | null>(null)

  const depPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const langPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!showJobMenu) return
    function handleOutsideClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowJobMenu(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [showJobMenu])

  useEffect(() => {
    fetch(`/api/v1/repositories/${id}`)
      .then((r) => r.json())
      .then((json) => { if (json.error) setError(json.error); else setRepo(json.data) })
      .catch(() => setError('Failed to load repository.'))

    fetch(`/api/v1/repositories/${id}/packages`)
      .then((r) => r.json())
      .then((json) => { if (!json.error && json.data.length > 0) setPackages(json.data) })
      .catch(() => {})

    fetch(`/api/v1/repositories/${id}/languages`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) return
        if (json.data.length > 0) setLanguages(json.data)
        if (json.analyzed) setLangStatus('completed')
      })
      .catch(() => {})
  }, [id])

  function startPolling(
    jobId: number,
    setStatus: (s: JobStatus) => void,
    setJobError: (e: string | null) => void,
    pollRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>,
    onComplete: () => void,
  ) {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/v1/jobs/${jobId}`)
        const json = await res.json()
        const job = json.data
        if (job.status === 'completed') {
          clearInterval(pollRef.current!)
          setStatus('completed')
          onComplete()
        } else if (job.status === 'failed') {
          clearInterval(pollRef.current!)
          setStatus('failed')
          setJobError(job.error ?? 'Job failed')
        } else {
          setStatus(job.status)
        }
      } catch { /* ignore poll errors */ }
    }, 3000)
  }

  async function startJob(type: 'analyze_dependencies' | 'analyze_languages') {
    if (!repo) return
    setShowJobMenu(false)

    if (type === 'analyze_dependencies') {
      setDepStatus('pending')
      setDepError(null)
      try {
        const res = await fetch('/api/v1/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, repoId: repo.id, repo: repo.fullName }),
        })
        const json = await res.json()
        if (!res.ok) { setDepStatus('failed'); setDepError(json.error); return }
        startPolling(json.data.id, setDepStatus, setDepError, depPollRef, async () => {
          const r = await fetch(`/api/v1/repositories/${id}/packages`)
          const j = await r.json()
          if (!j.error) setPackages(j.data)
        })
      } catch {
        setDepStatus('failed')
        setDepError('Failed to start job.')
      }
    } else {
      setLangStatus('pending')
      setLangError(null)
      try {
        const res = await fetch('/api/v1/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, repoId: repo.id, repo: repo.fullName }),
        })
        const json = await res.json()
        if (!res.ok) { setLangStatus('failed'); setLangError(json.error); return }
        startPolling(json.data.id, setLangStatus, setLangError, langPollRef, async () => {
          const r = await fetch(`/api/v1/repositories/${id}/languages`)
          const j = await r.json()
          if (!j.error) setLanguages(j.data)
        })
      } catch {
        setLangStatus('failed')
        setLangError('Failed to start job.')
      }
    }
  }

  useEffect(() => () => {
    if (depPollRef.current) clearInterval(depPollRef.current)
    if (langPollRef.current) clearInterval(langPollRef.current)
  }, [])

  const isDepBusy = depStatus === 'pending' || depStatus === 'running'
  const isLangBusy = langStatus === 'pending' || langStatus === 'running'
  const isAnyBusy = isDepBusy || isLangBusy

  const totalBytes = languages.reduce((sum, l) => sum + (l.bytes ?? 0), 0)

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <img src={logo} alt="Inspector Pika" style={styles.logo} />
        <h1 style={styles.title}>Inspector Pika</h1>
      </header>

      <main style={styles.content}>
        <button style={styles.back} onClick={() => navigate('/')}>← Back</button>

        {error && <p style={styles.error}>{error}</p>}

        {repo && (
          <>
            {/* ── Repo info card ── */}
            <div style={styles.card}>
              <div style={styles.cardHeader}>
                <div>
                  <h2 style={styles.repoName}>{repo.fullName}</h2>
                  {repo.description && <p style={styles.description}>{repo.description}</p>}
                </div>

                {/* Start A Job dropdown */}
                <div ref={menuRef} style={styles.menuWrap}>
                  <button
                    style={{ ...styles.startBtn, ...(isAnyBusy ? styles.startBtnBusy : {}) }}
                    onClick={() => !isAnyBusy && setShowJobMenu((v) => !v)}
                    disabled={isAnyBusy}
                  >
                    {isAnyBusy
                      ? `${isDepBusy ? (depStatus === 'pending' ? 'Queuing' : 'Analyzing') : (langStatus === 'pending' ? 'Queuing' : 'Detecting')}…`
                      : '▼ Start A Job'}
                  </button>
                  {showJobMenu && (
                    <div style={styles.menu}>
                      <button style={styles.menuItem} onClick={() => startJob('analyze_dependencies')}>
                        ⚙ Analyze Dependencies
                      </button>
                      <button style={styles.menuItem} onClick={() => startJob('analyze_languages')}>
                        🔍 Analyze Languages
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {depError && <p style={styles.jobError}>{depError}</p>}
              {langError && <p style={styles.jobError}>{langError}</p>}

              <table style={styles.table}>
                <tbody>
                  <tr>
                    <td style={styles.label}>Repository</td>
                    <td style={styles.value}>{repo.fullName}</td>
                  </tr>
                  <tr>
                    <td style={styles.label}>Location</td>
                    <td style={styles.value}>
                      {repo.url ? (
                        <a href={repo.url} target="_blank" rel="noopener noreferrer" style={styles.link}>
                          {PROVIDER_LABELS[repo.provider] ?? repo.provider}
                        </a>
                      ) : (PROVIDER_LABELS[repo.provider] ?? repo.provider)}
                    </td>
                  </tr>
                  <tr>
                    <td style={styles.label}>Default Branch</td>
                    <td style={styles.value}>{repo.defaultBranch ?? '—'}</td>
                  </tr>
                  <tr>
                    <td style={styles.label}>Stars</td>
                    <td style={styles.value}>{repo.stars?.toLocaleString() ?? '—'}</td>
                  </tr>
                  <tr>
                    <td style={styles.label}>Forks</td>
                    <td style={styles.value}>{repo.forks?.toLocaleString() ?? '—'}</td>
                  </tr>
                  <tr>
                    <td style={styles.label}>Visibility</td>
                    <td style={styles.value}>{repo.isPrivate ? 'Private' : 'Public'}</td>
                  </tr>
                  <tr>
                    <td style={styles.label}>Last Fetched</td>
                    <td style={styles.value}>{new Date(repo.fetchedAt).toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* ── Languages section ── */}
            <div style={styles.section}>
              <h3 style={styles.sectionHeading}>
                Languages
                {languages.length > 0 && <span style={styles.badge}>{languages.length}</span>}
              </h3>

              {isLangBusy && (
                <p style={styles.muted}>Detection in progress…</p>
              )}

              {!isLangBusy && languages.length === 0 && langStatus === 'idle' && (
                <p style={styles.muted}>No language data yet. Use <strong>Start A Job → Analyze Languages</strong> to detect.</p>
              )}

              {!isLangBusy && languages.length === 0 && langStatus !== 'idle' && (
                <p style={styles.muted}>No programming languages detected in this repository.</p>
              )}

              {languages.length > 0 && (
                <table style={styles.pkgTable}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Language</th>
                      <th style={{ ...styles.th, width: 80, textAlign: 'right' }}>%</th>
                      <th style={styles.th}>Distribution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {languages.map((lang) => {
                      const pct = totalBytes > 0 ? ((lang.bytes ?? 0) / totalBytes) * 100 : 0
                      return (
                        <tr key={lang.id}>
                          <td style={styles.td}>{lang.language}</td>
                          <td style={{ ...styles.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {(pct).toFixed(1)}%
                          </td>
                          <td style={styles.td}>
                            <div style={styles.barTrack}>
                              <div style={{ ...styles.barFill, width: `${pct}%` }} />
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* ── Packages section ── */}
            <div style={{ ...styles.section, marginTop: 24 }}>
              <h3 style={styles.sectionHeading}>
                Detected Packages
                {packages.length > 0 && <span style={styles.badge}>{packages.length}</span>}
              </h3>

              {isDepBusy && (
                <p style={styles.muted}>Analysis in progress — this may take several minutes…</p>
              )}

              {!isDepBusy && packages.length === 0 && (
                <p style={styles.muted}>No packages analysed yet. Use <strong>Start A Job → Analyze Dependencies</strong> to run ORT.</p>
              )}

              {packages.length > 0 && (
                <table style={styles.pkgTable}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Package</th>
                      <th style={styles.th}>Type</th>
                      <th style={styles.th}>Version</th>
                      <th style={styles.th}>License(s)</th>
                      <th style={styles.th}>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {packages.map((pkg) => (
                      <tr key={pkg.id}>
                        <td style={styles.td}>
                          {pkg.homepageUrl ? (
                            <a href={pkg.homepageUrl} target="_blank" rel="noopener noreferrer" style={styles.link}>
                              {pkg.namespace ? `${pkg.namespace}/${pkg.name}` : pkg.name}
                            </a>
                          ) : (
                            pkg.namespace ? `${pkg.namespace}/${pkg.name}` : pkg.name
                          )}
                        </td>
                        <td style={styles.td}>{pkg.type ?? '—'}</td>
                        <td style={styles.td}>{pkg.version ?? '—'}</td>
                        <td style={styles.td}>
                          {pkg.declaredLicenses && pkg.declaredLicenses.length > 0
                            ? pkg.declaredLicenses.join(', ')
                            : '—'}
                        </td>
                        <td style={{ ...styles.td, ...styles.descCell }}>
                          {pkg.description
                            ? <span title={pkg.description}>
                                {pkg.description.length > 20
                                  ? pkg.description.slice(0, 20) + '…'
                                  : pkg.description}
                              </span>
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}

const styles = {
  container: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    minHeight: '100vh',
    background: '#f6f8fa',
  } as React.CSSProperties,
  header: {
    background: '#24292f',
    padding: '0 32px',
    display: 'flex',
    alignItems: 'center',
    height: 56,
  } as React.CSSProperties,
  logo: {
    height: 54,
    width: 54,
    marginRight: 12,
    flexShrink: 0,
  } as React.CSSProperties,
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 600,
    margin: 0,
  } as React.CSSProperties,
  content: {
    padding: 32,
    maxWidth: 800,
    margin: '0 auto',
  } as React.CSSProperties,
  back: {
    background: 'none',
    border: 'none',
    color: '#0969da',
    cursor: 'pointer',
    fontSize: 14,
    padding: '0 0 20px 0',
    display: 'block',
  } as React.CSSProperties,
  card: {
    background: '#fff',
    border: '1px solid #d0d7de',
    borderRadius: 8,
    padding: 24,
    marginBottom: 24,
  } as React.CSSProperties,
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 4,
  } as React.CSSProperties,
  repoName: {
    margin: '0 0 8px 0',
    fontSize: 22,
    fontWeight: 600,
  } as React.CSSProperties,
  description: {
    color: '#57606a',
    margin: '0 0 8px 0',
    fontSize: 14,
  } as React.CSSProperties,
  menuWrap: {
    position: 'relative' as const,
    flexShrink: 0,
  } as React.CSSProperties,
  startBtn: {
    padding: '8px 16px',
    background: '#0969da',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 600,
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  startBtnBusy: {
    background: '#57606a',
    cursor: 'default',
  } as React.CSSProperties,
  menu: {
    position: 'absolute' as const,
    right: 0,
    top: 'calc(100% + 4px)',
    background: '#fff',
    border: '1px solid #d0d7de',
    borderRadius: 6,
    boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
    zIndex: 100,
    minWidth: 200,
    overflow: 'hidden',
  } as React.CSSProperties,
  menuItem: {
    display: 'block',
    width: '100%',
    padding: '10px 16px',
    background: 'none',
    border: 'none',
    textAlign: 'left' as const,
    fontSize: 14,
    cursor: 'pointer',
    color: '#24292f',
  } as React.CSSProperties,
  jobError: {
    color: 'crimson',
    fontSize: 13,
    margin: '8px 0 0 0',
  } as React.CSSProperties,
  table: {
    borderCollapse: 'collapse' as const,
    width: '100%',
    marginTop: 16,
  } as React.CSSProperties,
  label: {
    padding: '10px 16px 10px 0',
    color: '#57606a',
    fontSize: 14,
    fontWeight: 500,
    width: 160,
    verticalAlign: 'top',
    borderTop: '1px solid #f6f8fa',
  } as React.CSSProperties,
  value: {
    padding: '10px 0',
    fontSize: 14,
    borderTop: '1px solid #f6f8fa',
  } as React.CSSProperties,
  link: {
    color: '#0969da',
    textDecoration: 'none',
  } as React.CSSProperties,
  error: {
    color: 'crimson',
    fontSize: 14,
  } as React.CSSProperties,
  section: {
    background: '#fff',
    border: '1px solid #d0d7de',
    borderRadius: 8,
    padding: 24,
  } as React.CSSProperties,
  sectionHeading: {
    fontSize: 16,
    fontWeight: 600,
    margin: '0 0 16px 0',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  } as React.CSSProperties,
  badge: {
    display: 'inline-block',
    padding: '1px 8px',
    background: '#0969da',
    color: '#fff',
    borderRadius: 10,
    fontSize: 12,
    fontWeight: 600,
  } as React.CSSProperties,
  pkgTable: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: 13,
    border: '1px solid #d0d7de',
    borderRadius: 6,
    overflow: 'hidden',
  } as React.CSSProperties,
  th: {
    padding: '8px 12px',
    textAlign: 'left' as const,
    fontWeight: 600,
    background: '#f6f8fa',
    borderBottom: '1px solid #d0d7de',
    color: '#24292f',
    fontSize: 12,
  } as React.CSSProperties,
  td: {
    padding: '8px 12px',
    borderBottom: '1px solid #f6f8fa',
    color: '#24292f',
    verticalAlign: 'top',
  } as React.CSSProperties,
  descCell: {
    color: '#57606a',
    maxWidth: 300,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  muted: {
    color: '#57606a',
    fontSize: 14,
    margin: 0,
  } as React.CSSProperties,
  barTrack: {
    background: '#e8eaed',
    borderRadius: 4,
    height: 8,
    overflow: 'hidden',
    minWidth: 80,
  } as React.CSSProperties,
  barFill: {
    background: '#0969da',
    height: '100%',
    borderRadius: 4,
    transition: 'width 0.3s ease',
  } as React.CSSProperties,
}
