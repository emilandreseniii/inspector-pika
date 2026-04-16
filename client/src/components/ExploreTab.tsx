import { useEffect, useState } from 'react'
import type { Repository } from '@inspector-pika/shared'
import SearchBox from './SearchBox'
import Pager from './Pager'
import RepositoryTable from './RepositoryTable'

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
          <RepositoryTable repos={pageRows} />
          <Pager page={page} totalItems={filtered.length} pageSize={PAGE_SIZE} onChange={setPage} />
        </>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 20,
  },
  heading: {
    fontSize: 20,
    fontWeight: 600,
    margin: 0,
    flexShrink: 0,
  },
  muted: {
    color: '#57606a',
    fontSize: 14,
  },
  error: {
    color: 'crimson',
    fontSize: 14,
  },
}
