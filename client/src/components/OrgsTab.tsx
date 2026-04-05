import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Org } from '@inspector-pika/shared'
import SearchBox from './SearchBox'
import Pager from './Pager'

const PAGE_SIZE = 25

export default function OrgsTab() {
  const navigate = useNavigate()
  const [orgs, setOrgs] = useState<Org[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)

  useEffect(() => {
    fetch('/api/v1/orgs')
      .then((r) => r.json())
      .then((json) => {
        if (json.error) setError(json.error)
        else setOrgs(json.data)
      })
      .catch(() => setError('Failed to load organisations.'))
      .finally(() => setLoading(false))
  }, [])

  const filtered = orgs.filter((o) =>
    !search.trim() || o.owner.toLowerCase().includes(search.trim().toLowerCase())
  )
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div>
      <div style={styles.topBar}>
        <h2 style={styles.heading}>Organisations</h2>
        <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(0) }}
          suggestions={[]} placeholder="Filter by org name…" />
      </div>

      {loading && <p style={styles.muted}>Loading…</p>}
      {error && <p style={styles.error}>{error}</p>}
      {!loading && !error && orgs.length === 0 && (
        <p style={styles.muted}>No organisations yet. Explore some repositories first.</p>
      )}
      {!loading && !error && orgs.length > 0 && filtered.length === 0 && (
        <p style={styles.muted}>No organisations match <strong>{search}</strong>.</p>
      )}

      {pageRows.length > 0 && (
        <>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Organisation</th>
                <th style={styles.th}>Provider</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Repos</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((org) => (
                <tr key={`${org.provider}:${org.owner}`} style={styles.trClickable}
                  onClick={() => navigate(`/orgs/${org.owner}`)}>
                  <td style={styles.td}>
                    <span style={styles.link}>{org.owner}</span>
                  </td>
                  <td style={styles.td}>{org.provider}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>{org.repoCount}</td>
                </tr>
              ))}
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
