import { useState } from 'react'

type JobType = 'explore_github_repo' | 'explore_github_org'

interface Props {
  onClose: () => void
  onStarted: () => void
}

export default function StartJobModal({ onClose, onStarted }: Props) {
  const [jobType, setJobType] = useState<JobType | null>(null)
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const body =
      jobType === 'explore_github_repo'
        ? { type: 'explore_github_repo', repo: input.trim() }
        : { type: 'explore_github_org', org: input.trim() }

    setLoading(true)
    try {
      const res = await fetch('/api/v1/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error); return }
      onStarted()
    } catch {
      setError('Failed to start job.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h3 style={styles.modalTitle}>Start a Job</h3>
          <button style={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {!jobType ? (
          <div style={styles.typeList}>
            <p style={styles.hint}>Select a job type:</p>
            <button
              style={styles.typeBtn}
              onClick={() => setJobType('explore_github_repo')}
            >
              <span style={styles.typeBtnTitle}>Explore GitHub Repository</span>
              <span style={styles.typeBtnDesc}>Fetch and store a single GitHub repo by owner/repo</span>
            </button>
            <button
              style={styles.typeBtn}
              onClick={() => setJobType('explore_github_org')}
            >
              <span style={styles.typeBtnTitle}>Explore GitHub Organization</span>
              <span style={styles.typeBtnDesc}>Fetch and store all repositories for a GitHub organization</span>
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <button
              type="button"
              style={styles.backLink}
              onClick={() => { setJobType(null); setInput(''); setError(null) }}
            >
              ← Back
            </button>

            <p style={styles.hint}>
              {jobType === 'explore_github_repo'
                ? 'Enter the repository in owner/repo format:'
                : 'Enter the GitHub organization name:'}
            </p>

            <input
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={jobType === 'explore_github_repo' ? 'e.g. facebook/react' : 'e.g. vercel'}
              style={styles.input}
            />

            {error && <p style={styles.error}>{error}</p>}

            <div style={styles.actions}>
              <button type="button" style={styles.cancelBtn} onClick={onClose}>Cancel</button>
              <button type="submit" style={styles.submitBtn} disabled={loading || !input.trim()}>
                {loading ? 'Starting…' : 'Start Job'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

const styles = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(1,4,9,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  } as React.CSSProperties,
  modal: {
    background: '#fff',
    borderRadius: 12,
    width: 480,
    maxWidth: '90vw',
    padding: 24,
    boxShadow: '0 8px 24px rgba(1,4,9,0.3)',
  } as React.CSSProperties,
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  } as React.CSSProperties,
  modalTitle: {
    margin: 0,
    fontSize: 18,
    fontWeight: 600,
  } as React.CSSProperties,
  closeBtn: {
    background: 'none',
    border: 'none',
    fontSize: 16,
    cursor: 'pointer',
    color: '#57606a',
    padding: 4,
  } as React.CSSProperties,
  hint: {
    margin: '0 0 12px 0',
    fontSize: 14,
    color: '#57606a',
  } as React.CSSProperties,
  typeList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
  } as React.CSSProperties,
  typeBtn: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'flex-start',
    padding: '14px 16px',
    background: '#f6f8fa',
    border: '1px solid #d0d7de',
    borderRadius: 8,
    cursor: 'pointer',
    textAlign: 'left' as const,
    gap: 4,
  } as React.CSSProperties,
  typeBtnTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: '#0969da',
  } as React.CSSProperties,
  typeBtnDesc: {
    fontSize: 13,
    color: '#57606a',
  } as React.CSSProperties,
  backLink: {
    background: 'none',
    border: 'none',
    color: '#0969da',
    cursor: 'pointer',
    fontSize: 13,
    padding: '0 0 12px 0',
    display: 'block',
  } as React.CSSProperties,
  input: {
    width: '100%',
    padding: '8px 12px',
    fontSize: 14,
    borderRadius: 6,
    border: '1px solid #d0d7de',
    boxSizing: 'border-box' as const,
    marginBottom: 12,
  } as React.CSSProperties,
  error: {
    color: 'crimson',
    fontSize: 13,
    margin: '0 0 12px 0',
  } as React.CSSProperties,
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
  } as React.CSSProperties,
  cancelBtn: {
    padding: '7px 16px',
    background: '#f6f8fa',
    border: '1px solid #d0d7de',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 14,
  } as React.CSSProperties,
  submitBtn: {
    padding: '7px 16px',
    background: '#2da44e',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 600,
  } as React.CSSProperties,
}
