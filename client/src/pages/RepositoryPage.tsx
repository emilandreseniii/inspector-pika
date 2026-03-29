import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { Repository, RepoPackage, RepoLanguage, RepoEntity, RepoEntityApproach } from '@inspector-pika/shared'
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

  const [entities, setEntities] = useState<RepoEntity[]>([])
  const [entityApproaches, setEntityApproaches] = useState<RepoEntityApproach[]>([])
  const [expandedEntity, setExpandedEntity] = useState<number | null>(null)

  const [depStatus, setDepStatus] = useState<JobStatus>('idle')
  const [depError, setDepError] = useState<string | null>(null)
  const [langStatus, setLangStatus] = useState<JobStatus>('idle')
  const [langError, setLangError] = useState<string | null>(null)
  const [entityStatus, setEntityStatus] = useState<JobStatus>('idle')
  const [entityError, setEntityError] = useState<string | null>(null)

  const [langUpdatedAt, setLangUpdatedAt] = useState<string | null>(null)
  const [depUpdatedAt, setDepUpdatedAt] = useState<string | null>(null)
  const [entityUpdatedAt, setEntityUpdatedAt] = useState<string | null>(null)

  const depPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const langPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const entityPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
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

  // Syncs job statuses from the server and refreshes data for any that just completed.
  // Called on mount and every 5 seconds.
  const syncJobs = useRef<(() => Promise<void>) | null>(null)
  syncJobs.current = async () => {
    const res = await fetch(`/api/v1/repositories/${id}/jobs`).catch(() => null)
    if (!res) return
    const json = await res.json().catch(() => null)
    if (!json?.data) return
    const jobMap = json.data as Record<string, { id: number; status: string; error: string | null; completedAt: string | null }>

    const sync = async (
      key: string,
      currentStatus: JobStatus,
      setStatus: (s: JobStatus) => void,
      setErr: (e: string | null) => void,
      pollRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>,
      onComplete: () => Promise<void>,
    ) => {
      const job = jobMap[key]
      if (!job) return
      const serverStatus = job.status as JobStatus
      if (serverStatus === currentStatus) return

      if (serverStatus === 'completed' && currentStatus !== 'completed') {
        setStatus('completed')
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
        await onComplete()
      } else if (serverStatus === 'failed' && currentStatus !== 'failed') {
        setStatus('failed')
        setErr(job.error ?? 'Job failed')
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      } else if ((serverStatus === 'pending' || serverStatus === 'running') && currentStatus === 'idle') {
        setStatus(serverStatus)
        // Start polling so further transitions are caught
        startPolling(job.id, setStatus, setErr, pollRef, onComplete)
      }
    }

    await Promise.all([
      sync('analyze_languages', langStatus, setLangStatus, setLangError, langPollRef, async () => {
        const r = await fetch(`/api/v1/repositories/${id}/languages`)
        const j = await r.json()
        if (!j.error) { setLanguages(j.data); if (j.lastAnalyzedAt) setLangUpdatedAt(fmtDate(j.lastAnalyzedAt)) }
      }),
      sync('analyze_dependencies', depStatus, setDepStatus, setDepError, depPollRef, async () => {
        const r = await fetch(`/api/v1/repositories/${id}/packages`)
        const j = await r.json()
        if (!j.error) { setPackages(j.data); if (j.data[0]?.createdAt) setDepUpdatedAt(fmtDate(j.data[0].createdAt)) }
      }),
      sync('analyze_entities', entityStatus, setEntityStatus, setEntityError, entityPollRef, async () => {
        const [er, ea] = await Promise.all([
          fetch(`/api/v1/repositories/${id}/entities`).then((r) => r.json()),
          fetch(`/api/v1/repositories/${id}/entity-approaches`).then((r) => r.json()),
        ])
        if (!er.error) setEntities(er.data)
        if (!ea.error) { setEntityApproaches(ea.data); if (ea.data[0]?.createdAt) setEntityUpdatedAt(fmtDate(ea.data[0].createdAt)) }
      }),
    ])
  }

  // Run syncJobs on mount and every 5 seconds
  useEffect(() => {
    syncJobs.current?.()
    const interval = setInterval(() => syncJobs.current?.(), 5000)
    return () => clearInterval(interval)
  }, [id])

  useEffect(() => {
    fetch(`/api/v1/repositories/${id}`)
      .then((r) => r.json())
      .then((json) => { if (json.error) setError(json.error); else setRepo(json.data) })
      .catch(() => setError('Failed to load repository.'))

    fetch(`/api/v1/repositories/${id}/packages`)
      .then((r) => r.json())
      .then((json) => {
        if (!json.error && json.data.length > 0) {
          setPackages(json.data)
          if (json.data[0]?.createdAt) setDepUpdatedAt(fmtDate(json.data[0].createdAt))
        }
      })
      .catch(() => {})

    fetch(`/api/v1/repositories/${id}/languages`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) return
        if (json.data.length > 0) setLanguages(json.data)
        if (json.analyzed) setLangStatus('completed')
        if (json.lastAnalyzedAt) setLangUpdatedAt(fmtDate(json.lastAnalyzedAt))
      })
      .catch(() => {})

    fetch(`/api/v1/repositories/${id}/entities`)
      .then((r) => r.json())
      .then((json) => { if (!json.error && json.data.length > 0) setEntities(json.data) })
      .catch(() => {})

    fetch(`/api/v1/repositories/${id}/entity-approaches`)
      .then((r) => r.json())
      .then((json) => {
        if (!json.error && json.data.length > 0) {
          setEntityApproaches(json.data)
          setEntityStatus('completed')
          if (json.data[0]?.createdAt) setEntityUpdatedAt(fmtDate(json.data[0].createdAt))
        }
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

  async function startEntityJob() {
    if (!repo) return
    setShowJobMenu(false)
    setEntityStatus('pending')
    setEntityError(null)
    try {
      const res = await fetch('/api/v1/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'analyze_entities', repoId: repo.id, repo: repo.fullName }),
      })
      const json = await res.json()
      if (!res.ok) { setEntityStatus('failed'); setEntityError(json.error); return }
      startPolling(json.data.id, setEntityStatus, setEntityError, entityPollRef, async () => {
        const [er, ea] = await Promise.all([
          fetch(`/api/v1/repositories/${id}/entities`).then((r) => r.json()),
          fetch(`/api/v1/repositories/${id}/entity-approaches`).then((r) => r.json()),
        ])
        if (!er.error) setEntities(er.data)
        if (!ea.error) {
          setEntityApproaches(ea.data)
          if (ea.data[0]?.createdAt) setEntityUpdatedAt(fmtDate(ea.data[0].createdAt))
        }
      })
    } catch {
      setEntityStatus('failed')
      setEntityError('Failed to start job.')
    }
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
          if (!j.error) {
            setPackages(j.data)
            if (j.data[0]?.createdAt) setDepUpdatedAt(fmtDate(j.data[0].createdAt))
          }
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
          if (!j.error) {
            setLanguages(j.data)
            if (j.lastAnalyzedAt) setLangUpdatedAt(fmtDate(j.lastAnalyzedAt))
          }
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
    if (entityPollRef.current) clearInterval(entityPollRef.current)
  }, [])

  const isDepBusy = depStatus === 'pending' || depStatus === 'running'
  const isLangBusy = langStatus === 'pending' || langStatus === 'running'
  const isEntityBusy = entityStatus === 'pending' || entityStatus === 'running'
  const isAnyBusy = isDepBusy || isLangBusy || isEntityBusy

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
                      ? `${isDepBusy ? (depStatus === 'pending' ? 'Queuing' : 'Analyzing') : isLangBusy ? (langStatus === 'pending' ? 'Queuing' : 'Detecting') : (entityStatus === 'pending' ? 'Queuing' : 'Detecting')}…`
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
                      <button style={styles.menuItem} onClick={() => startEntityJob()}>
                        🗄 Detect Data Entities
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {depError && <p style={styles.jobError}>{depError}</p>}
              {langError && <p style={styles.jobError}>{langError}</p>}
              {entityError && <p style={styles.jobError}>{entityError}</p>}

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
              <div style={styles.sectionHeaderRow}>
                <h3 style={styles.sectionHeading}>
                  Languages
                  {languages.length > 0 && <span style={styles.badge}>{languages.length}</span>}
                </h3>
                <div style={styles.sectionActions}>
                  <span style={styles.updatedAt}>{langUpdatedAt ? `Updated: ${langUpdatedAt}` : 'Not yet run'}</span>
                  <button style={{ ...styles.analyzeBtn, ...(isLangBusy ? styles.analyzeBtnBusy : {}) }} disabled={isLangBusy} onClick={() => startJob('analyze_languages')}>
                    {isLangBusy ? 'Analyzing…' : 'Analyze'}
                  </button>
                </div>
              </div>

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
              <div style={styles.sectionHeaderRow}>
                <h3 style={styles.sectionHeading}>
                  Detected Packages
                  {packages.length > 0 && <span style={styles.badge}>{packages.length}</span>}
                </h3>
                <div style={styles.sectionActions}>
                  <span style={styles.updatedAt}>{depUpdatedAt ? `Updated: ${depUpdatedAt}` : 'Not yet run'}</span>
                  <button style={{ ...styles.analyzeBtn, ...(isDepBusy ? styles.analyzeBtnBusy : {}) }} disabled={isDepBusy} onClick={() => startJob('analyze_dependencies')}>
                    {isDepBusy ? 'Analyzing…' : 'Analyze'}
                  </button>
                </div>
              </div>

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
            {/* ── Data Entities section ── */}
            <div style={{ ...styles.section, marginTop: 24 }}>
              <div style={styles.sectionHeaderRow}>
                <h3 style={styles.sectionHeading}>
                  Data Entities
                  {entities.length > 0 && <span style={styles.badge}>{entities.length}</span>}
                </h3>
                <div style={styles.sectionActions}>
                  <span style={styles.updatedAt}>{entityUpdatedAt ? `Updated: ${entityUpdatedAt}` : 'Not yet run'}</span>
                  <button style={{ ...styles.analyzeBtn, ...(isEntityBusy ? styles.analyzeBtnBusy : {}) }} disabled={isEntityBusy} onClick={() => startEntityJob()}>
                    {isEntityBusy ? 'Analyzing…' : 'Analyze'}
                  </button>
                </div>
              </div>

              {entityApproaches.length > 0 && (
                <div style={styles.approachBadges}>
                  {entityApproaches.map((a) => (
                    <span key={a.id} style={{ ...styles.approachBadge, ...confidenceStyle(a.confidence) }} title={a.signals?.join('\n')}>
                      {APPROACH_LABELS[a.approach] ?? a.approach}
                      {a.entityCount != null ? ` (${a.entityCount})` : ''}
                    </span>
                  ))}
                </div>
              )}

              {isEntityBusy && <p style={styles.muted}>Detection in progress…</p>}

              {!isEntityBusy && entities.length === 0 && entityStatus === 'idle' && (
                <p style={styles.muted}>No entity data yet. Use <strong>Start A Job → Detect Data Entities</strong> to analyze.</p>
              )}

              {!isEntityBusy && entities.length === 0 && entityStatus !== 'idle' && (
                <p style={styles.muted}>No data entities detected in this repository.</p>
              )}

              {entities.length > 0 && (
                <table style={styles.pkgTable}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Entity / Table</th>
                      <th style={styles.th}>Type</th>
                      <th style={{ ...styles.th, textAlign: 'right' as const }}>Fields</th>
                      <th style={styles.th}>Source</th>
                      <th style={styles.th}>Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entities.map((entity) => (
                      <>
                        <tr
                          key={entity.id}
                          onClick={() => setExpandedEntity(expandedEntity === entity.id ? null : entity.id)}
                          style={{ ...styles.entityRow, cursor: entity.fields?.length ? 'pointer' : 'default' }}
                        >
                          <td style={{ ...styles.td, fontFamily: 'monospace', fontWeight: 500 }}>
                            {entity.fields?.length ? (expandedEntity === entity.id ? '▾ ' : '▸ ') : '  '}
                            {entity.name}
                          </td>
                          <td style={styles.td}>{entity.entityType}</td>
                          <td style={{ ...styles.td, textAlign: 'right' as const }}>{entity.fields?.length ?? 0}</td>
                          <td style={styles.td}>{entity.sourceApproach ? (APPROACH_LABELS[entity.sourceApproach.approach] ?? entity.sourceApproach.approach) : '—'}</td>
                          <td style={styles.td}>
                            <span style={{ ...styles.confidenceBadge, ...confidenceStyle(entity.confidence) }}>
                              {entity.confidence}
                            </span>
                          </td>
                        </tr>
                        {expandedEntity === entity.id && entity.fields && entity.fields.length > 0 && (
                          <tr key={`${entity.id}-fields`}>
                            <td colSpan={5} style={{ padding: 0 }}>
                              <table style={{ ...styles.pkgTable, margin: '0 0 0 24px', width: 'calc(100% - 24px)', borderTop: 'none', borderRadius: 0 }}>
                                <thead>
                                  <tr>
                                    <th style={{ ...styles.th, background: '#f0f2f5' }}>Column</th>
                                    <th style={{ ...styles.th, background: '#f0f2f5' }}>Type</th>
                                    <th style={{ ...styles.th, background: '#f0f2f5' }}>Normalized Type</th>
                                    <th style={{ ...styles.th, background: '#f0f2f5' }}>Flags</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {entity.fields.map((field) => (
                                    <tr key={field.id}>
                                      <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: 12 }}>{field.name}</td>
                                      <td style={{ ...styles.td, fontSize: 12, color: '#57606a' }}>{field.nativeType ?? '—'}</td>
                                      <td style={{ ...styles.td, fontSize: 12 }}>{field.dataType}</td>
                                      <td style={{ ...styles.td, fontSize: 11 }}>
                                        {field.isPrimaryKey === 'true' && <span style={styles.flag}>PK</span>}
                                        {field.isForeignKey === 'true' && <span style={styles.flag}>FK</span>}
                                        {field.isUnique === 'true' && <span style={{ ...styles.flag, background: '#ddf4ff', color: '#0969da' }}>UQ</span>}
                                        {field.isNullable === 'false' && <span style={{ ...styles.flag, background: '#fff8c5', color: '#7d4e00' }}>NN</span>}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </>
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

function fmtDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10)
}

const APPROACH_LABELS: Record<string, string> = {
  jpa_hibernate: 'JPA/Hibernate',
  mybatis: 'MyBatis',
  jooq: 'jOOQ',
  spring_data_jdbc: 'Spring Data JDBC',
  django_orm: 'Django ORM',
  sqlalchemy: 'SQLAlchemy',
  prisma: 'Prisma',
  typeorm: 'TypeORM',
  drizzle_orm: 'Drizzle ORM',
  sequelize: 'Sequelize',
  mongoose: 'Mongoose',
  activerecord: 'ActiveRecord',
  gorm: 'GORM',
  ent: 'Ent',
  sqlc: 'sqlc',
  ef_core: 'EF Core',
  dapper: 'Dapper',
  diesel: 'Diesel',
  sea_orm: 'SeaORM',
  eloquent: 'Eloquent',
  doctrine: 'Doctrine',
  sql_ddl: 'SQL DDL',
  migration_files: 'Migrations',
  protobuf: 'Protobuf',
  graphql_schema: 'GraphQL',
  openapi: 'OpenAPI',
}

function confidenceStyle(confidence: string): React.CSSProperties {
  if (confidence === 'high') return { background: '#dafbe1', color: '#116329' }
  if (confidence === 'medium') return { background: '#fff8c5', color: '#7d4e00' }
  return { background: '#f6f8fa', color: '#57606a' }
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
    margin: 0,
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
  approachBadges: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 6,
    marginBottom: 16,
  } as React.CSSProperties,
  approachBadge: {
    display: 'inline-block',
    padding: '3px 10px',
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 500,
    cursor: 'default',
  } as React.CSSProperties,
  confidenceBadge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 10,
    fontSize: 11,
    fontWeight: 500,
  } as React.CSSProperties,
  entityRow: {
    transition: 'background 0.1s',
  } as React.CSSProperties,
  flag: {
    display: 'inline-block',
    padding: '1px 5px',
    background: '#ffebe9',
    color: '#cf222e',
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 700,
    marginRight: 3,
  } as React.CSSProperties,
  sectionHeaderRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  } as React.CSSProperties,
  sectionActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
  } as React.CSSProperties,
  updatedAt: {
    fontSize: 12,
    color: '#57606a',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  analyzeBtn: {
    padding: '5px 12px',
    background: '#0969da',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  analyzeBtnBusy: {
    background: '#57606a',
    cursor: 'default',
  } as React.CSSProperties,
}
