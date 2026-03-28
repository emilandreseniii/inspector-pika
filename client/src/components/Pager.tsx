interface Props {
  page: number       // 0-based
  totalItems: number
  pageSize: number
  onChange: (page: number) => void
}

export default function Pager({ page, totalItems, pageSize, onChange }: Props) {
  const totalPages = Math.ceil(totalItems / pageSize)
  if (totalPages <= 1) return null

  const start = page * pageSize + 1
  const end = Math.min((page + 1) * pageSize, totalItems)

  // Build page number list: always show first, last, and a window of ±2 around current
  const pages: (number | '…')[] = []
  for (let p = 0; p < totalPages; p++) {
    if (p === 0 || p === totalPages - 1 || Math.abs(p - page) <= 2) {
      pages.push(p)
    } else if (pages[pages.length - 1] !== '…') {
      pages.push('…')
    }
  }

  return (
    <div style={styles.wrap}>
      <span style={styles.info}>{start}–{end} of {totalItems}</span>
      <div style={styles.controls}>
        <button style={styles.btn} disabled={page === 0} onClick={() => onChange(page - 1)}>← Prev</button>
        {pages.map((p, i) =>
          p === '…'
            ? <span key={`ellipsis-${i}`} style={styles.ellipsis}>…</span>
            : <button
                key={p}
                style={{ ...styles.btn, ...(p === page ? styles.btnActive : {}) }}
                onClick={() => onChange(p)}
              >
                {p + 1}
              </button>
        )}
        <button style={styles.btn} disabled={page === totalPages - 1} onClick={() => onChange(page + 1)}>Next →</button>
      </div>
    </div>
  )
}

const styles = {
  wrap: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    fontSize: 13,
    color: '#57606a',
  },
  info: {
    color: '#57606a',
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  btn: {
    padding: '4px 10px',
    fontSize: 13,
    border: '1px solid #d0d7de',
    borderRadius: 6,
    background: '#fff',
    cursor: 'pointer',
    color: '#24292f',
  } as React.CSSProperties,
  btnActive: {
    background: '#0969da',
    color: '#fff',
    borderColor: '#0969da',
  } as React.CSSProperties,
  ellipsis: {
    padding: '0 4px',
    color: '#57606a',
  },
}
