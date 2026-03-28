import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Repository } from '@inspector-pika/shared'
import SearchBox from './SearchBox'
import Pager from './Pager'

const PAGE_SIZE = 25

function filterRepos(repos: Repository[], search: string): Repository[] {
  const q = search.trim().toLowerCase()
  if (!q) return repos
  return repos.filter(r => r.fullName.toLowerCase().includes(q))
}

function getSuggestions(repos: Repository[], search: string): string[] {
  const q = search.trim().toLowerCase()
  if (!q) return []

  if (!q.includes('/')) {
    const seen = new Set<string>()
    const orgs: string[] = []
    for (const r of repos) {
      const o = r.owner.toLowerCase()
      if (o.startsWith(q) && !seen.has(o)) { seen.add(o); orgs.push(r.owner) }
    }
    return orgs.sort().slice(0, 10)
  } else {
    return repos
      .filter(r => r.fullName.toLowerCase().startsWith(q))
      .map(r => r.fullName)
      .slice(0, 10)
  }
}

export default function ExploreTab() {
  const navigate = useNavigate()
  const [repos, setRepos] = useState<Repository[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)

  useEffect(() => {
    fetch('/api/v1/repositories')
      .then((r) => r.json())
      .then((json) => {
        if (json.error) setError(json.error)
        else setRepos(json.data)
      })
      .catch(() => setError('Failed to load repositories.'))
      .finally(() => setLoading(false))
  }, [])

  function handleSearch(value: string) {
    setSearch(value)
    setPage(0)
  }

  const filtered = filterRepos(repos, search)
  const suggestions = getSuggestions(repos, search)
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div>
      <div style={styles.topBar}>
        <h2 style={styles.heading}>Repositories</h2>
        <SearchBox
          value={search}
          onChange={handleSearch}
          suggestions={suggestions}
          placeholder="Filter by org or org/repo…"
        />
      </div>

      {loading && <p style={styles.muted}>Loading…</p>}
      {error && <p style={styles.error}>{error}</p>}

      {!loading && !error && repos.length === 0 && (
        <p style={styles.muted}>
          No repositories explored yet. Go to the <strong>Jobs</strong> tab to start exploring.
        </p>
      )}

      {!loading && !error && repos.length > 0 && filtered.length === 0 && (
        <p style={styles.muted}>No repositories match <strong>{search}</strong>.</p>
      )}

      {pageRows.length > 0 && (
        <>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Repository</th>
                <th style={styles.th}>Provider</th>
                <th style={styles.th}>Stars</th>
                <th style={styles.th}>Forks</th>
                <th style={styles.th}>Last Fetched</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((repo) => (
                <tr key={repo.id}>
                  <td style={styles.td}>
                    <button
                      style={styles.repoLink}
                      onClick={() => navigate(`/repositories/${repo.id}`)}
                    >
                      {repo.fullName}
                    </button>
                  </td>
                  <td style={styles.td}>{repo.provider}</td>
                  <td style={styles.td}>{repo.stars?.toLocaleString() ?? '—'}</td>
                  <td style={styles.td}>{repo.forks?.toLocaleString() ?? '—'}</td>
                  <td style={styles.td}>{new Date(repo.fetchedAt).toLocaleString()}</td>
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

const styles = {
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 20,
  } as React.CSSProperties,
  heading: {
    fontSize: 20,
    fontWeight: 600,
    margin: 0,
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
  repoLink: {
    background: 'none',
    border: 'none',
    color: '#0969da',
    cursor: 'pointer',
    fontSize: 14,
    padding: 0,
    fontWeight: 500,
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
