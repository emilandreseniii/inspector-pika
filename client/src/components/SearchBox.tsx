import { useRef, useState, useEffect, useCallback } from 'react'

interface Props {
  value: string
  onChange: (value: string) => void
  suggestions: string[]
  placeholder?: string
}

export default function SearchBox({ value, onChange, suggestions, placeholder }: Props) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Reset highlighted item when suggestions change
  useEffect(() => { setActive(-1) }, [suggestions])

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const select = useCallback((s: string) => {
    onChange(s)
    // If suggestion ends with '/' keep dropdown open for next segment
    if (s.endsWith('/')) {
      setOpen(true)
      inputRef.current?.focus()
    } else {
      setOpen(false)
    }
  }, [onChange])

  function handleKey(e: React.KeyboardEvent) {
    if (!open || suggestions.length === 0) {
      if (e.key === 'ArrowDown' && suggestions.length > 0) { setOpen(true); setActive(0) }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(i => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(i => Math.max(i - 1, -1))
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault()
      select(suggestions[active])
    } else if (e.key === 'Escape') {
      setOpen(false)
      setActive(-1)
    }
  }

  const showDropdown = open && suggestions.length > 0

  return (
    <div ref={containerRef} style={styles.wrap}>
      <input
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => { if (suggestions.length > 0) setOpen(true) }}
        onKeyDown={handleKey}
        style={styles.input}
        autoComplete="off"
        spellCheck={false}
      />
      {value && (
        <button style={styles.clear} onMouseDown={e => { e.preventDefault(); onChange(''); setOpen(false) }}>✕</button>
      )}
      {showDropdown && (
        <ul style={styles.dropdown}>
          {suggestions.map((s, i) => (
            <li
              key={s}
              style={{ ...styles.item, ...(i === active ? styles.itemActive : {}) }}
              onMouseDown={e => { e.preventDefault(); select(s) }}
              onMouseEnter={() => setActive(i)}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const styles = {
  wrap: {
    position: 'relative' as const,
    flex: 1,
    maxWidth: 360,
  },
  input: {
    width: '100%',
    padding: '7px 32px 7px 12px',
    fontSize: 14,
    border: '1px solid #d0d7de',
    borderRadius: 6,
    outline: 'none',
    background: '#fff',
    boxSizing: 'border-box' as const,
  },
  clear: {
    position: 'absolute' as const,
    right: 8,
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: '#57606a',
    fontSize: 12,
    padding: 2,
    lineHeight: 1,
  },
  dropdown: {
    position: 'absolute' as const,
    top: 'calc(100% + 4px)',
    left: 0,
    right: 0,
    background: '#fff',
    border: '1px solid #d0d7de',
    borderRadius: 6,
    boxShadow: '0 4px 12px rgba(1,4,9,0.12)',
    margin: 0,
    padding: 0,
    listStyle: 'none',
    zIndex: 50,
    maxHeight: 280,
    overflowY: 'auto' as const,
  },
  item: {
    padding: '8px 12px',
    fontSize: 13,
    cursor: 'pointer',
    color: '#24292f',
    borderBottom: '1px solid #f6f8fa',
  },
  itemActive: {
    background: '#0969da',
    color: '#fff',
    borderBottomColor: '#0969da',
  },
}
