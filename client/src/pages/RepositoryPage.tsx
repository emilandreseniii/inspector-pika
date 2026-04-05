import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { Repository, RepoPackage, RepoLanguage, RepoEntity, RepoEntityApproach, RepoApiApproachRecord, RepoApiSurface, RepoApiOp } from '@inspector-pika/shared'
import AppHeader from '../components/AppHeader'
import Pager from '../components/Pager'

const PAGE_SIZES = [10, 20, 50, 100, 200] as const
type BottomTab = 'packages' | 'apis' | 'entities'

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

  const [apiApproaches, setApiApproaches] = useState<RepoApiApproachRecord[]>([])
  const [apiSurfaces, setApiSurfaces] = useState<RepoApiSurface[]>([])
  const [apiOps, setApiOps] = useState<Record<number, RepoApiOp[]>>({})
  const [expandedSurface, setExpandedSurface] = useState<number | null>(null)
  const [apiStatus, setApiStatus] = useState<JobStatus>('idle')
  const [apiError, setApiError] = useState<string | null>(null)

  const [bottomTab, setBottomTab] = useState<BottomTab>('packages')
  const [pkgPage, setPkgPage] = useState(0)
  const [pkgPageSize, setPkgPageSize] = useState(50)
  const [apiPage, setApiPage] = useState(0)
  const [apiPageSize, setApiPageSize] = useState(50)
  const [entityPage, setEntityPage] = useState(0)
  const [entityPageSize, setEntityPageSize] = useState(50)

  const [langUpdatedAt, setLangUpdatedAt] = useState<string | null>(null)
  const [depUpdatedAt, setDepUpdatedAt] = useState<string | null>(null)
  const [entityUpdatedAt, setEntityUpdatedAt] = useState<string | null>(null)
  const [apiUpdatedAt, setApiUpdatedAt] = useState<string | null>(null)

  const [depJobId, setDepJobId] = useState<number | null>(null)
  const [langJobId, setLangJobId] = useState<number | null>(null)
  const [entityJobId, setEntityJobId] = useState<number | null>(null)
  const [apiJobId, setApiJobId] = useState<number | null>(null)

  const depPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const langPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const entityPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const apiPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
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
      setJobId: (id: number) => void,
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
        setJobId(job.id)
        setStatus(serverStatus)
        // Start polling so further transitions are caught
        startPolling(job.id, setStatus, setErr, pollRef, onComplete)
      }
    }

    await Promise.all([
      sync('analyze_apis', apiStatus, setApiStatus, setApiError, setApiJobId, apiPollRef, async () => {
        const [ar, sr] = await Promise.all([
          fetch(`/api/v1/repositories/${id}/api-approaches`).then((r) => r.json()),
          fetch(`/api/v1/repositories/${id}/api-surfaces`).then((r) => r.json()),
        ])
        if (!ar.error) setApiApproaches(ar.data)
        if (!sr.error) { setApiSurfaces(sr.data); if (sr.data[0]?.createdAt) setApiUpdatedAt(fmtDate(sr.data[0].createdAt)) }
      }),
      sync('analyze_languages', langStatus, setLangStatus, setLangError, setLangJobId, langPollRef, async () => {
        const r = await fetch(`/api/v1/repositories/${id}/languages`)
        const j = await r.json()
        if (!j.error) { setLanguages(j.data); if (j.lastAnalyzedAt) setLangUpdatedAt(fmtDate(j.lastAnalyzedAt)) }
      }),
      sync('analyze_dependencies', depStatus, setDepStatus, setDepError, setDepJobId, depPollRef, async () => {
        const r = await fetch(`/api/v1/repositories/${id}/packages`)
        const j = await r.json()
        if (!j.error) { setPackages(j.data); if (j.data[0]?.createdAt) setDepUpdatedAt(fmtDate(j.data[0].createdAt)) }
      }),
      sync('analyze_entities', entityStatus, setEntityStatus, setEntityError, setEntityJobId, entityPollRef, async () => {
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

    fetch(`/api/v1/repositories/${id}/api-approaches`)
      .then((r) => r.json())
      .then((json) => { if (!json.error && json.data.length > 0) setApiApproaches(json.data) })
      .catch(() => {})

    fetch(`/api/v1/repositories/${id}/api-surfaces`)
      .then((r) => r.json())
      .then((json) => {
        if (!json.error && json.data.length > 0) {
          setApiSurfaces(json.data)
          setApiStatus('completed')
          if (json.data[0]?.createdAt) setApiUpdatedAt(fmtDate(json.data[0].createdAt))
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
      setEntityJobId(json.data.id)
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
        setDepJobId(json.data.id)
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
        setLangJobId(json.data.id)
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
    if (apiPollRef.current) clearInterval(apiPollRef.current)
  }, [])

  async function startApiJob() {
    if (!repo) return
    setShowJobMenu(false)
    setApiStatus('pending')
    setApiError(null)
    try {
      const res = await fetch('/api/v1/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'analyze_apis', repoId: repo.id, repo: repo.fullName }),
      })
      const json = await res.json()
      if (!res.ok) { setApiStatus('failed'); setApiError(json.error); return }
      setApiJobId(json.data.id)
      startPolling(json.data.id, setApiStatus, setApiError, apiPollRef, async () => {
        const [ar, sr] = await Promise.all([
          fetch(`/api/v1/repositories/${id}/api-approaches`).then((r) => r.json()),
          fetch(`/api/v1/repositories/${id}/api-surfaces`).then((r) => r.json()),
        ])
        if (!ar.error) setApiApproaches(ar.data)
        if (!sr.error) { setApiSurfaces(sr.data); if (sr.data[0]?.createdAt) setApiUpdatedAt(fmtDate(sr.data[0].createdAt)) }
      })
    } catch {
      setApiStatus('failed')
      setApiError('Failed to start job.')
    }
  }

  async function loadSurfaceOps(surfaceId: number) {
    if (apiOps[surfaceId]) return
    const res = await fetch(`/api/v1/repositories/${id}/api-ops?surfaceId=${surfaceId}`).catch(() => null)
    if (!res) return
    const json = await res.json().catch(() => null)
    if (!json?.error) setApiOps((prev) => ({ ...prev, [surfaceId]: json.data }))
  }

  function toggleSurface(surfaceId: number) {
    if (expandedSurface === surfaceId) {
      setExpandedSurface(null)
    } else {
      setExpandedSurface(surfaceId)
      loadSurfaceOps(surfaceId)
    }
  }

  const isDepBusy = depStatus === 'pending' || depStatus === 'running'
  const isLangBusy = langStatus === 'pending' || langStatus === 'running'
  const isEntityBusy = entityStatus === 'pending' || entityStatus === 'running'
  const isApiBusy = apiStatus === 'pending' || apiStatus === 'running'
  const isAnyBusy = isDepBusy || isLangBusy || isEntityBusy || isApiBusy
  const activeJobId = isDepBusy ? depJobId : isLangBusy ? langJobId : isEntityBusy ? entityJobId : isApiBusy ? apiJobId : null

  const totalBytes = languages.reduce((sum, l) => sum + (l.bytes ?? 0), 0)

  return (
    <div style={styles.container}>
      <AppHeader />

      <main style={styles.content}>
        <button style={styles.back} onClick={() => navigate('/repos')}>← Back</button>

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
                    onClick={isAnyBusy && activeJobId ? () => navigate(`/jobs/${activeJobId}`) : () => setShowJobMenu((v) => !v)}
                  >
                    {isAnyBusy
                      ? `${isDepBusy ? (depStatus === 'pending' ? 'Queuing' : 'Analyzing') : isLangBusy ? (langStatus === 'pending' ? 'Queuing' : 'Detecting') : isEntityBusy ? (entityStatus === 'pending' ? 'Queuing' : 'Detecting') : (apiStatus === 'pending' ? 'Queuing' : 'Scanning')}…`
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
                      <button style={styles.menuItem} onClick={() => startApiJob()}>
                        🔌 Detect APIs
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {depError && <p style={styles.jobError}>{depError}</p>}
              {langError && <p style={styles.jobError}>{langError}</p>}
              {entityError && <p style={styles.jobError}>{entityError}</p>}
              {apiError && <p style={styles.jobError}>{apiError}</p>}

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
                  <button style={{ ...styles.analyzeBtn, ...(isLangBusy ? styles.analyzeBtnBusy : {}) }} onClick={isLangBusy && langJobId ? () => navigate(`/jobs/${langJobId}`) : () => startJob('analyze_languages')}>
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

            {/* ── Bottom tabbed section: Packages | API Surfaces | Data Entities ── */}
            <div style={{ ...styles.section, marginTop: 24, padding: 0, overflow: 'hidden' }}>

              {/* Tab bar + per-tab actions */}
              <div style={styles.tabBar}>
                {(['packages', 'apis', 'entities'] as const).map((tab) => {
                  const label = tab === 'packages' ? 'Packages' : tab === 'apis' ? 'API Surfaces' : 'Data Entities'
                  const count = tab === 'packages' ? packages.length : tab === 'apis' ? apiSurfaces.length : entities.length
                  return (
                    <button
                      key={tab}
                      style={{ ...styles.tabBtn, ...(bottomTab === tab ? styles.tabBtnActive : {}) }}
                      onClick={() => setBottomTab(tab)}
                    >
                      {label}
                      {count > 0 && <span style={{ ...styles.badge, marginLeft: 6 }}>{count}</span>}
                    </button>
                  )
                })}
                <div style={{ flex: 1 }} />
                <div style={{ ...styles.sectionActions, padding: '0 16px' }}>
                  {bottomTab === 'packages' && (
                    <>
                      <span style={styles.updatedAt}>{depUpdatedAt ? `Updated: ${depUpdatedAt}` : 'Not yet run'}</span>
                      <button style={{ ...styles.analyzeBtn, ...(isDepBusy ? styles.analyzeBtnBusy : {}) }} onClick={isDepBusy && depJobId ? () => navigate(`/jobs/${depJobId}`) : () => startJob('analyze_dependencies')}>
                        {isDepBusy ? 'Analyzing…' : 'Analyze'}
                      </button>
                    </>
                  )}
                  {bottomTab === 'apis' && (
                    <>
                      <span style={styles.updatedAt}>{apiUpdatedAt ? `Updated: ${apiUpdatedAt}` : 'Not yet run'}</span>
                      <button style={{ ...styles.analyzeBtn, ...(isApiBusy ? styles.analyzeBtnBusy : {}) }} onClick={isApiBusy && apiJobId ? () => navigate(`/jobs/${apiJobId}`) : () => startApiJob()}>
                        {isApiBusy ? 'Scanning…' : 'Analyze'}
                      </button>
                    </>
                  )}
                  {bottomTab === 'entities' && (
                    <>
                      <span style={styles.updatedAt}>{entityUpdatedAt ? `Updated: ${entityUpdatedAt}` : 'Not yet run'}</span>
                      <button style={{ ...styles.analyzeBtn, ...(isEntityBusy ? styles.analyzeBtnBusy : {}) }} onClick={isEntityBusy && entityJobId ? () => navigate(`/jobs/${entityJobId}`) : () => startEntityJob()}>
                        {isEntityBusy ? 'Analyzing…' : 'Analyze'}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Tab content */}
              <div style={{ padding: 24 }}>

                {/* ── Packages tab ── */}
                {bottomTab === 'packages' && (
                  <>
                    {isDepBusy && <p style={styles.muted}>Analysis in progress — this may take several minutes…</p>}
                    {!isDepBusy && packages.length === 0 && (
                      <p style={styles.muted}>No packages analysed yet. Use <strong>Start A Job → Analyze Dependencies</strong> to run ORT.</p>
                    )}
                    {packages.length > 0 && (
                      <>
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
                            {packages.slice(pkgPage * pkgPageSize, (pkgPage + 1) * pkgPageSize).map((pkg) => (
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
                        <div style={styles.pageSizeRow}>
                          <span style={styles.pageSizeLabel}>Show</span>
                          <select style={styles.pageSizeSelect} value={pkgPageSize} onChange={(e) => { setPkgPageSize(Number(e.target.value)); setPkgPage(0) }}>
                            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
                          </select>
                          <span style={styles.pageSizeLabel}>per page</span>
                        </div>
                        <Pager page={pkgPage} totalItems={packages.length} pageSize={pkgPageSize} onChange={setPkgPage} />
                      </>
                    )}
                  </>
                )}

                {/* ── API Surfaces tab ── */}
                {bottomTab === 'apis' && (
                  <>
                    {apiApproaches.length > 0 && (
                      <div style={styles.approachBadges}>
                        {apiApproaches.map((a) => (
                          <span key={a.id} style={{ ...styles.approachBadge, ...confidenceStyle(a.confidence) }} title={a.signals?.join('\n')}>
                            {API_APPROACH_LABELS[a.approach] ?? a.approach}
                            {a.endpointCount != null ? ` (${a.endpointCount})` : ''}
                          </span>
                        ))}
                      </div>
                    )}
                    {isApiBusy && <p style={styles.muted}>Detection in progress…</p>}
                    {!isApiBusy && apiSurfaces.length === 0 && apiStatus === 'idle' && (
                      <p style={styles.muted}>No API data yet. Use <strong>Start A Job → Detect APIs</strong> to analyze.</p>
                    )}
                    {!isApiBusy && apiSurfaces.length === 0 && apiStatus !== 'idle' && (
                      <p style={styles.muted}>No API surfaces detected in this repository.</p>
                    )}
                    {apiSurfaces.length > 0 && (
                      <>
                        <table style={styles.pkgTable}>
                          <thead>
                            <tr>
                              <th style={styles.th}>Surface</th>
                              <th style={styles.th}>Style</th>
                              <th style={styles.th}>Base Path / Package</th>
                              <th style={{ ...styles.th, textAlign: 'right' as const }}>Ops</th>
                            </tr>
                          </thead>
                          <tbody>
                            {apiSurfaces.slice(apiPage * apiPageSize, (apiPage + 1) * apiPageSize).map((surface) => (
                              <>
                                <tr
                                  key={surface.id}
                                  onClick={() => toggleSurface(surface.id)}
                                  style={{ ...styles.entityRow, cursor: 'pointer' }}
                                >
                                  <td style={{ ...styles.td, fontFamily: 'monospace', fontWeight: 500 }}>
                                    {expandedSurface === surface.id ? '▾ ' : '▸ '}
                                    {surface.name}
                                  </td>
                                  <td style={styles.td}>
                                    <span style={{ ...styles.confidenceBadge, ...apiStyleBadge(surface.apiStyle) }}>
                                      {surface.apiStyle === 'rpc' ? (surface.protocol ?? 'rpc').toUpperCase() : surface.apiStyle.toUpperCase()}
                                    </span>
                                  </td>
                                  <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: 12, color: '#57606a' }}>
                                    {surface.basePath ?? surface.packageOrModule ?? '—'}
                                  </td>
                                  <td style={{ ...styles.td, textAlign: 'right' as const }}>{surface.opCount ?? 0}</td>
                                </tr>
                                {expandedSurface === surface.id && (
                                  <tr key={`${surface.id}-ops`}>
                                    <td colSpan={4} style={{ padding: 0 }}>
                                      {!apiOps[surface.id] ? (
                                        <p style={{ ...styles.muted, padding: '8px 24px' }}>Loading…</p>
                                      ) : apiOps[surface.id].length === 0 ? (
                                        <p style={{ ...styles.muted, padding: '8px 24px' }}>No operations found.</p>
                                      ) : (
                                        <table style={{ ...styles.pkgTable, margin: '0 0 0 24px', width: 'calc(100% - 24px)', borderTop: 'none', borderRadius: 0 }}>
                                          <thead>
                                            <tr>
                                              {surface.apiStyle === 'http' ? (
                                                <>
                                                  <th style={{ ...styles.th, background: '#f0f2f5', width: 80 }}>Method</th>
                                                  <th style={{ ...styles.th, background: '#f0f2f5' }}>Path</th>
                                                  <th style={{ ...styles.th, background: '#f0f2f5' }}>Returns</th>
                                                  <th style={{ ...styles.th, background: '#f0f2f5', textAlign: 'right' as const }}>Params</th>
                                                </>
                                              ) : (
                                                <>
                                                  <th style={{ ...styles.th, background: '#f0f2f5' }}>RPC Method</th>
                                                  <th style={{ ...styles.th, background: '#f0f2f5' }}>Request</th>
                                                  <th style={{ ...styles.th, background: '#f0f2f5' }}>Response</th>
                                                  <th style={{ ...styles.th, background: '#f0f2f5' }}>Streaming</th>
                                                </>
                                              )}
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {apiOps[surface.id].map((op) => (
                                              <tr key={op.id}>
                                                {surface.apiStyle === 'http' ? (
                                                  <>
                                                    <td style={{ ...styles.td, fontSize: 12 }}>
                                                      <span style={{ ...styles.confidenceBadge, ...httpMethodStyle(op.httpMethod ?? '') }}>
                                                        {op.httpMethod ?? '—'}
                                                      </span>
                                                    </td>
                                                    <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: 12 }}>{op.path ?? '—'}</td>
                                                    <td style={{ ...styles.td, fontSize: 12, color: '#57606a', fontFamily: 'monospace' }}>{op.returnType ?? '—'}</td>
                                                    <td style={{ ...styles.td, fontSize: 12, textAlign: 'right' as const }}>{op.params?.length ?? 0}</td>
                                                  </>
                                                ) : (
                                                  <>
                                                    <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: 12, fontWeight: 500 }}>{op.rpcMethodName ?? '—'}</td>
                                                    <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: 12, color: '#57606a' }}>{op.requestType ?? '—'}</td>
                                                    <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: 12, color: '#57606a' }}>{op.responseType ?? '—'}</td>
                                                    <td style={{ ...styles.td, fontSize: 12 }}>
                                                      {op.rpcStreaming && op.rpcStreaming !== 'none'
                                                        ? <span style={{ ...styles.confidenceBadge, background: '#ddf4ff', color: '#0969da' }}>{op.rpcStreaming}</span>
                                                        : <span style={{ color: '#57606a' }}>unary</span>}
                                                    </td>
                                                  </>
                                                )}
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      )}
                                    </td>
                                  </tr>
                                )}
                              </>
                            ))}
                          </tbody>
                        </table>
                        <div style={styles.pageSizeRow}>
                          <span style={styles.pageSizeLabel}>Show</span>
                          <select style={styles.pageSizeSelect} value={apiPageSize} onChange={(e) => { setApiPageSize(Number(e.target.value)); setApiPage(0) }}>
                            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
                          </select>
                          <span style={styles.pageSizeLabel}>per page</span>
                        </div>
                        <Pager page={apiPage} totalItems={apiSurfaces.length} pageSize={apiPageSize} onChange={setApiPage} />
                      </>
                    )}
                  </>
                )}

                {/* ── Data Entities tab ── */}
                {bottomTab === 'entities' && (
                  <>
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
                      <>
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
                            {entities.slice(entityPage * entityPageSize, (entityPage + 1) * entityPageSize).map((entity) => (
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
                        <div style={styles.pageSizeRow}>
                          <span style={styles.pageSizeLabel}>Show</span>
                          <select style={styles.pageSizeSelect} value={entityPageSize} onChange={(e) => { setEntityPageSize(Number(e.target.value)); setEntityPage(0) }}>
                            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
                          </select>
                          <span style={styles.pageSizeLabel}>per page</span>
                        </div>
                        <Pager page={entityPage} totalItems={entities.length} pageSize={entityPageSize} onChange={setEntityPage} />
                      </>
                    )}
                  </>
                )}

              </div>
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

const API_APPROACH_LABELS: Record<string, string> = {
  spring_mvc: 'Spring MVC',
  jax_rs: 'JAX-RS',
  grpc_proto: 'gRPC (Proto)',
  fastapi: 'FastAPI',
  flask: 'Flask',
  django_rest: 'Django REST',
  express: 'Express',
  netflix_dgs: 'Netflix DGS',
  graphql_schema: 'GraphQL Schema',
}

function apiStyleBadge(style: string): React.CSSProperties {
  if (style === 'rpc') return { background: '#fff8c5', color: '#7d4e00' }
  if (style === 'graphql') return { background: '#f1e4ff', color: '#6e40c9' }
  return { background: '#ddf4ff', color: '#0969da' }
}

function httpMethodStyle(method: string): React.CSSProperties {
  if (method === 'GET') return { background: '#ddf4ff', color: '#0969da' }
  if (method === 'POST') return { background: '#dafbe1', color: '#116329' }
  if (method === 'PUT') return { background: '#fff8c5', color: '#7d4e00' }
  if (method === 'PATCH') return { background: '#fff8c5', color: '#7d4e00' }
  if (method === 'DELETE') return { background: '#ffebe9', color: '#cf222e' }
  return { background: '#f6f8fa', color: '#57606a' }
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
  tabBar: {
    display: 'flex',
    alignItems: 'center',
    borderBottom: '1px solid #d0d7de',
    padding: '0 8px',
    minHeight: 48,
  } as React.CSSProperties,
  tabBtn: {
    padding: '12px 16px',
    background: 'none',
    border: 'none',
    borderBottom: '2px solid transparent',
    cursor: 'pointer',
    fontSize: 14,
    color: '#57606a',
    fontWeight: 400,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    marginBottom: -1,
  } as React.CSSProperties,
  tabBtnActive: {
    borderBottomColor: '#0969da',
    color: '#24292f',
    fontWeight: 600,
  } as React.CSSProperties,
  pageSizeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    fontSize: 13,
    color: '#57606a',
  } as React.CSSProperties,
  pageSizeLabel: {
    color: '#57606a',
  } as React.CSSProperties,
  pageSizeSelect: {
    padding: '3px 6px',
    fontSize: 13,
    border: '1px solid #d0d7de',
    borderRadius: 6,
    background: '#fff',
    cursor: 'pointer',
    color: '#24292f',
  } as React.CSSProperties,
}
