import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Package } from '@inspector-pika/shared'
import SearchBox from './SearchBox'
import Pager from './Pager'

const PAGE_SIZE = 50

const TYPE_COLORS: Record<string, string> = {
  NPM: '#cc3534', Maven: '#c7822a', PyPI: '#3572a5', Go: '#00add8',
  Cargo: '#dea584', Composer: '#8892be', NuGet: '#178600',
}

function TypeBadge({ type }: { type: string }) {
  const bg = TYPE_COLORS[type] ?? '#57606a'
  return (
    <span style={{ display: 'inline-block', padding: '1px 7px', borderRadius: 10, fontSize: 11, fontWeight: 700, color: '#fff', background: bg, flexShrink: 0 }}>
      {type}
    </span>
  )
}

export default function PackagesTab() {
  const navigate = useNavigate()
  const [pkgs, setPkgs] = useState<Package[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)

  useEffect(() => {
    fetch('/api/v1/packages')
      .then((r) => r.json())
      .then((json) => {
        if (json.error) setError(json.error)
        else setPkgs(json.data)
      })
      .catch(() => setError('Failed to load packages.'))
      .finally(() => setLoading(false))
  }, [])

  const q = search.trim().toLowerCase()
  const filtered = q
    ? pkgs.filter((p) => p.name.toLowerCase().includes(q) || p.namespace.toLowerCase().includes(q) || p.type.toLowerCase().includes(q))
    : pkgs
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div>
      <div style={styles.topBar}>
        <h2 style={styles.heading}>Packages</h2>
        <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(0) }}
          suggestions={[]} placeholder="Filter by name, namespace, or type…" />
      </div>

      {loading && <p style={styles.muted}>Loading…</p>}
      {error && <p style={styles.error}>{error}</p>}
      {!loading && !error && pkgs.length === 0 && (
        <p style={styles.muted}>No packages yet. Run a dependency analysis job on a repository first.</p>
      )}
      {!loading && !error && pkgs.length > 0 && filtered.length === 0 && (
        <p style={styles.muted}>No packages match <strong>{search}</strong>.</p>
      )}

      {pageRows.length > 0 && (
        <>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Type</th>
                <th style={styles.th}>Package</th>
                <th style={styles.th}>Description</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Versions</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Repos</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((pkg) => {
                const displayName = pkg.namespace ? `${pkg.namespace}/${pkg.name}` : pkg.name
                return (
                  <tr key={pkg.id} style={styles.trClickable} onClick={() => navigate(`/packages/${pkg.id}`)}>
                    <td style={styles.td}><TypeBadge type={pkg.type} /></td>
                    <td style={styles.td}><span style={styles.link}>{displayName}</span></td>
                    <td style={{ ...styles.td, color: '#57606a', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {pkg.description ?? '—'}
                    </td>
                    <td style={{ ...styles.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{pkg.versionCount ?? 0}</td>
                    <td style={{ ...styles.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{pkg.repoCount ?? 0}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <Pager page={page} totalItems={filtered.length} pageSize={PAGE_SIZE} onChange={setPage} />
        </>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  topBar: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 },
  heading: { fontSize: 20, fontWeight: 600, margin: 0, flexShrink: 0 },
  table: { width: '100%', borderCollapse: 'collapse', background: '#fff', border: '1px solid #d0d7de', borderRadius: 8, overflow: 'hidden', fontSize: 14 },
  th: { padding: '10px 16px', textAlign: 'left', fontWeight: 600, background: '#f6f8fa', borderBottom: '1px solid #d0d7de', color: '#24292f', fontSize: 13 },
  td: { padding: '10px 16px', borderBottom: '1px solid #f6f8fa', color: '#24292f' },
  trClickable: { cursor: 'pointer' },
  link: { color: '#0969da', fontWeight: 500 },
  muted: { color: '#57606a', fontSize: 14 },
  error: { color: 'crimson', fontSize: 14 },
}
