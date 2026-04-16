import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import type { Repository } from '@inspector-pika/shared'
import AppHeader from '../components/AppHeader'
import RepositoryTable from '../components/RepositoryTable'

interface OrgMeta {
  owner: string
  provider: string
  repoCount: number
}

export default function OrgPage() {
  const { owner } = useParams<{ owner: string }>()
  const [meta, setMeta] = useState<OrgMeta | null>(null)
  const [repos, setRepos] = useState<Repository[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/v1/orgs/${owner}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) { setError(json.error); return }
        const repoList: Repository[] = json.data
        setRepos(repoList)
        if (repoList.length > 0) {
          setMeta({ owner: repoList[0].owner, provider: repoList[0].provider, repoCount: repoList.length })
        } else {
          setMeta({ owner: owner!, provider: '—', repoCount: 0 })
        }
      })
      .catch(() => setError('Failed to load organisation.'))
      .finally(() => setLoading(false))
  }, [owner])

  return (
    <div style={styles.root}>
      <AppHeader />
      <main style={styles.content}>
        {loading && <p style={styles.muted}>Loading…</p>}
        {error && <p style={styles.error}>{error}</p>}
        {!loading && !error && meta && (
          <>
            <div style={styles.topBar}>
              <div>
                <h2 style={styles.heading}>{meta.owner}</h2>
                <p style={styles.sub}>{meta.provider} · {meta.repoCount} {meta.repoCount === 1 ? 'repository' : 'repositories'}</p>
              </div>
            </div>

            {repos.length === 0
              ? <p style={styles.muted}>No repositories found.</p>
              : <RepositoryTable repos={repos} nameMode="short" />
            }
          </>
        )}
      </main>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  root: { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', minHeight: '100vh', background: '#f6f8fa' },
  content: { maxWidth: 1100, margin: '0 auto', padding: '24px 32px' },
  topBar: { display: 'flex', alignItems: 'flex-start', marginBottom: 24 },
  heading: { fontSize: 22, fontWeight: 700, margin: '0 0 4px' },
  sub: { margin: 0, fontSize: 14, color: '#57606a' },
  muted: { color: '#57606a', fontSize: 14 },
  error: { color: 'crimson', fontSize: 14 },
}
