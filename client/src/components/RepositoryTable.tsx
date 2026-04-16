import { useNavigate } from 'react-router-dom'
import type { Repository } from '@inspector-pika/shared'

interface Props {
  repos: Repository[]
  /** Show org/repo (fullName) or just repo name. Defaults to 'full'. */
  nameMode?: 'full' | 'short'
}

function AnalysisCell({ done, label }: { done: boolean; label: string }) {
  return done
    ? <span style={styles.check} title={`${label} analyzed`}>✓</span>
    : <span style={styles.dash}>—</span>
}

export default function RepositoryTable({ repos, nameMode = 'full' }: Props) {
  const navigate = useNavigate()

  return (
    <table style={styles.table}>
      <thead>
        <tr>
          <th style={styles.th}>Repository</th>
          <th style={styles.th}>Provider</th>
          <th style={{ ...styles.th, ...styles.thAnalysis }} title="Languages analysis">
            <span style={styles.analysisIcon}>L</span>
          </th>
          <th style={{ ...styles.th, ...styles.thAnalysis }} title="Packages analysis">
            <span style={styles.analysisIcon}>P</span>
          </th>
          <th style={{ ...styles.th, ...styles.thAnalysis }} title="API Surfaces analysis">
            <span style={styles.analysisIcon}>A</span>
          </th>
          <th style={{ ...styles.th, ...styles.thAnalysis }} title="Data Entities analysis">
            <span style={styles.analysisIcon}>E</span>
          </th>
          <th style={styles.th}>Stars</th>
          <th style={styles.th}>Forks</th>
          <th style={styles.th}>Last Fetched</th>
        </tr>
      </thead>
      <tbody>
        {repos.map((repo) => (
          <tr key={repo.id}>
            <td style={styles.td}>
              <button
                style={styles.repoLink}
                onClick={() => navigate(`/repositories/${repo.id}`)}
              >
                {nameMode === 'short' ? repo.name : repo.fullName}
              </button>
            </td>
            <td style={styles.td}>{repo.provider}</td>
            <td style={{ ...styles.td, ...styles.tdAnalysis }}>
              <AnalysisCell done={repo.analysisStatus?.hasLanguages ?? false} label="Languages" />
            </td>
            <td style={{ ...styles.td, ...styles.tdAnalysis }}>
              <AnalysisCell done={repo.analysisStatus?.hasPackages ?? false} label="Packages" />
            </td>
            <td style={{ ...styles.td, ...styles.tdAnalysis }}>
              <AnalysisCell done={repo.analysisStatus?.hasApis ?? false} label="API Surfaces" />
            </td>
            <td style={{ ...styles.td, ...styles.tdAnalysis }}>
              <AnalysisCell done={repo.analysisStatus?.hasEntities ?? false} label="Data Entities" />
            </td>
            <td style={styles.td}>{repo.stars?.toLocaleString() ?? '—'}</td>
            <td style={styles.td}>{repo.forks?.toLocaleString() ?? '—'}</td>
            <td style={styles.td}>{new Date(repo.fetchedAt).toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const styles = {
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
  thAnalysis: {
    width: 36,
    textAlign: 'center' as const,
    padding: '10px 4px',
  } as React.CSSProperties,
  tdAnalysis: {
    textAlign: 'center' as const,
    padding: '10px 4px',
  } as React.CSSProperties,
  analysisIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 20,
    height: 20,
    borderRadius: 4,
    background: '#d0d7de',
    color: '#24292f',
    fontSize: 11,
    fontWeight: 700,
    cursor: 'default',
  } as React.CSSProperties,
  check: {
    color: '#1a7f37',
    fontWeight: 700,
    fontSize: 14,
  } as React.CSSProperties,
  dash: {
    color: '#d0d7de',
    fontSize: 14,
  } as React.CSSProperties,
}
