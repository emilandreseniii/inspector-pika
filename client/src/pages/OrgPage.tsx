import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import type { Repository } from '@inspector-pika/shared'

interface OrgMeta {
  owner: string
  provider: string
  repoCount: number
}

export default function OrgPage() {
  const { owner } = useParams<{ owner: string }>()
  const navigate = useNavigate()
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

            {repos.length === 0 ? (
              <p style={styles.muted}>No repositories found.</p>
            ) : (
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Repository</th>
                    <th style={styles.th}>Description</th>
                    <th style={{ ...styles.th, textAlign: 'right' }}>Stars</th>
                    <th style={{ ...styles.th, textAlign: 'right' }}>Forks</th>
                  </tr>
                </thead>
                <tbody>
                  {repos.map((repo) => (
                    <tr key={repo.id} style={styles.trClickable}
                      onClick={() => navigate(`/repositories/${repo.id}`)}>
                      <td style={styles.td}><span style={styles.link}>{repo.name}</span></td>
                      <td style={{ ...styles.td, color: '#57606a', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {repo.description ?? '—'}
                      </td>
                      <td style={{ ...styles.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{repo.stars ?? 0}</td>
                      <td style={{ ...styles.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{repo.forks ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
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
  table: { width: '100%', borderCollapse: 'collapse', background: '#fff', border: '1px solid #d0d7de', borderRadius: 8, overflow: 'hidden', fontSize: 14 },
  th: { padding: '10px 16px', textAlign: 'left', fontWeight: 600, background: '#f6f8fa', borderBottom: '1px solid #d0d7de', color: '#24292f', fontSize: 13 },
  td: { padding: '10px 16px', borderBottom: '1px solid #f6f8fa', color: '#24292f' },
  trClickable: { cursor: 'pointer' },
  link: { color: '#0969da', fontWeight: 500 },
  muted: { color: '#57606a', fontSize: 14 },
  error: { color: 'crimson', fontSize: 14 },
}
