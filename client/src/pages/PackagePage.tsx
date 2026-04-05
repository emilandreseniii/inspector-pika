import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import type { Package, PackageVersion, PackageRepo } from '@inspector-pika/shared'

const TYPE_COLORS: Record<string, string> = {
  NPM: '#cc3534', Maven: '#c7822a', PyPI: '#3572a5', Go: '#00add8',
  Cargo: '#dea584', Composer: '#8892be', NuGet: '#178600',
}

function TypeBadge({ type }: { type: string }) {
  const bg = TYPE_COLORS[type] ?? '#57606a'
  return (
    <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 10, fontSize: 12, fontWeight: 700, color: '#fff', background: bg }}>
      {type}
    </span>
  )
}

type SubTab = 'versions' | 'repos'

export default function PackagePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [pkg, setPkg] = useState<Package | null>(null)
  const [versions, setVersions] = useState<PackageVersion[]>([])
  const [repos, setRepos] = useState<PackageRepo[]>([])
  const [subTab, setSubTab] = useState<SubTab>('versions')
  const [loading, setLoading] = useState(true)
  const [versionsLoaded, setVersionsLoaded] = useState(false)
  const [reposLoaded, setReposLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/v1/packages/${id}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) { setError(json.error); return }
        setPkg(json.data)
      })
      .catch(() => setError('Failed to load package.'))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    if (subTab === 'versions' && !versionsLoaded) {
      fetch(`/api/v1/packages/${id}/versions`)
        .then((r) => r.json())
        .then((json) => { if (!json.error) setVersions(json.data) })
        .catch(() => {})
        .finally(() => setVersionsLoaded(true))
    }
    if (subTab === 'repos' && !reposLoaded) {
      fetch(`/api/v1/packages/${id}/repos`)
        .then((r) => r.json())
        .then((json) => { if (!json.error) setRepos(json.data) })
        .catch(() => {})
        .finally(() => setReposLoaded(true))
    }
  }, [subTab, id, versionsLoaded, reposLoaded])

  if (loading) return (
    <div style={styles.root}>
      <AppHeader />
      <main style={styles.content}><p style={styles.muted}>Loading…</p></main>
    </div>
  )

  if (error || !pkg) return (
    <div style={styles.root}>
      <AppHeader />
      <main style={styles.content}><p style={styles.error}>{error ?? 'Package not found.'}</p></main>
    </div>
  )

  const displayName = pkg.namespace ? `${pkg.namespace}/${pkg.name}` : pkg.name

  return (
    <div style={styles.root}>
      <AppHeader />
      <main style={styles.content}>
        <div style={styles.pkgHeader}>
          <div style={styles.pkgTitleRow}>
            <TypeBadge type={pkg.type} />
            <h2 style={styles.heading}>{displayName}</h2>
          </div>
          {pkg.description && <p style={styles.description}>{pkg.description}</p>}
          {pkg.homepageUrl && (
            <p style={styles.homepage}>
              <a href={pkg.homepageUrl} target="_blank" rel="noopener noreferrer" style={styles.homepageLink}>
                {pkg.homepageUrl}
              </a>
            </p>
          )}
          <div style={styles.stats}>
            <span style={styles.stat}><strong>{pkg.versionCount ?? 0}</strong> versions</span>
            <span style={styles.stat}><strong>{pkg.repoCount ?? 0}</strong> repos</span>
          </div>
        </div>

        <nav style={styles.subNav}>
          {(['versions', 'repos'] as SubTab[]).map((t) => (
            <button
              key={t}
              style={{ ...styles.subTab, ...(subTab === t ? styles.subTabActive : {}) }}
              onClick={() => setSubTab(t)}
            >
              {t === 'versions' ? 'Versions' : 'Repos'}
            </button>
          ))}
        </nav>

        {subTab === 'versions' && (
          !versionsLoaded ? <p style={styles.muted}>Loading…</p> :
          versions.length === 0 ? <p style={styles.muted}>No versions recorded.</p> : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Version</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>Repos</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.version}>
                    <td style={styles.td}><code style={styles.code}>{v.version}</code></td>
                    <td style={{ ...styles.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{v.repoCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}

        {subTab === 'repos' && (
          !reposLoaded ? <p style={styles.muted}>Loading…</p> :
          repos.length === 0 ? <p style={styles.muted}>No repos use this package.</p> : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Repository</th>
                  <th style={styles.th}>Provider</th>
                  <th style={styles.th}>Version</th>
                </tr>
              </thead>
              <tbody>
                {repos.map((r) => (
                  <tr key={`${r.repoId}-${r.version}`} style={styles.trClickable}
                    onClick={() => navigate(`/repositories/${r.repoId}`)}>
                    <td style={styles.td}><span style={styles.link}>{r.fullName}</span></td>
                    <td style={styles.td}>{r.provider}</td>
                    <td style={styles.td}><code style={styles.code}>{r.version}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </main>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  root: { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', minHeight: '100vh', background: '#f6f8fa' },
  content: { maxWidth: 1100, margin: '0 auto', padding: '24px 32px' },
  pkgHeader: { background: '#fff', border: '1px solid #d0d7de', borderRadius: 8, padding: '20px 24px', marginBottom: 24 },
  pkgTitleRow: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 },
  heading: { fontSize: 20, fontWeight: 700, margin: 0 },
  description: { margin: '0 0 8px', color: '#57606a', fontSize: 14 },
  homepage: { margin: '0 0 12px' },
  homepageLink: { color: '#0969da', fontSize: 13 },
  stats: { display: 'flex', gap: 20 },
  stat: { fontSize: 13, color: '#57606a' },
  subNav: { display: 'flex', gap: 0, borderBottom: '1px solid #d0d7de', marginBottom: 20 },
  subTab: { padding: '10px 16px', border: 'none', borderBottom: '3px solid transparent', background: 'none', cursor: 'pointer', fontSize: 14, color: '#57606a', fontWeight: 500, marginBottom: -1 },
  subTabActive: { color: '#24292f', borderBottomColor: '#fd8c73', fontWeight: 600 },
  table: { width: '100%', borderCollapse: 'collapse', background: '#fff', border: '1px solid #d0d7de', borderRadius: 8, overflow: 'hidden', fontSize: 14 },
  th: { padding: '10px 16px', textAlign: 'left', fontWeight: 600, background: '#f6f8fa', borderBottom: '1px solid #d0d7de', color: '#24292f', fontSize: 13 },
  td: { padding: '10px 16px', borderBottom: '1px solid #f6f8fa', color: '#24292f' },
  trClickable: { cursor: 'pointer' },
  link: { color: '#0969da', fontWeight: 500 },
  code: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 },
  muted: { color: '#57606a', fontSize: 14 },
  error: { color: 'crimson', fontSize: 14 },
}
