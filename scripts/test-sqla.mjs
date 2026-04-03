// Quick diagnostic: test SQLAlchemy class block detection logic
const content = `
from sqlalchemy.orm import Mapped, mapped_column

class PoolStats:
    total: int
    running: int

class Pool(Base):
    __tablename__ = "slot_pool"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pool: Mapped[str | None] = mapped_column(String(256), unique=True, nullable=True)
    slots: Mapped[int] = mapped_column(Integer, default=0)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    include_deferred: Mapped[bool] = mapped_column(
        Boolean, nullable=False
    )
`

function joinLogicalLines(content) {
  const rawLines = content.split('\n')
  const result = []
  let buffer = null
  let depth = 0

  for (const raw of rawLines) {
    for (let ci = 0; ci < raw.length; ci++) {
      const ch = raw[ci]
      if (ch === '#') break
      if (ch === '(' || ch === '[' || ch === '{') depth++
      else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1)
    }

    if (buffer === null) {
      buffer = raw
    } else {
      buffer += ' ' + raw.trim()
    }

    const endsBackslash = raw.trimEnd().endsWith('\\')
    if (depth === 0 && !endsBackslash) {
      result.push(buffer.replace(/\\s*$/, ''))
      buffer = null
    }
  }

  if (buffer !== null) result.push(buffer)
  return result
}

const lines = joinLogicalLines(content)
console.log('== Joined lines ==')
lines.forEach(l => { if (l.trim()) console.log(' |' + l + '|') })

// Class block detection
const classBlocks = []
let current = null

for (let i = 0; i < lines.length; i++) {
  const line = lines[i]
  const classMatch = line.match(/^class\s+(\w+)\s*\(([^)]*)\)\s*:/)
  if (classMatch) {
    if (current) classBlocks.push(current)
    current = { name: classMatch[1], bases: classMatch[2], lines: [], lineNo: i + 1 }
  } else if (current) {
    if (line === '' || line.startsWith(' ') || line.startsWith('\t')) {
      current.lines.push(line)
    } else {
      classBlocks.push(current)
      current = null
      i--
    }
  }
}
if (current) classBlocks.push(current)

console.log('\n== Class blocks ==')
classBlocks.forEach(b => {
  const hasTablename = b.lines.some(l => l.includes('__tablename__'))
  console.log(`  ${b.name}(${b.bases}) lines=${b.lines.length} hasTablename=${hasTablename}`)
  if (hasTablename) {
    b.lines.forEach(l => { if (l.trim()) console.log('    ' + l.trim()) })
  }
})

// Test Mapped annotation detection in Pool block
const poolBlock = classBlocks.find(b => b.name === 'Pool')
if (poolBlock) {
  console.log('\n== Pool field detection ==')
  for (const rawLine of poolBlock.lines) {
    const line = rawLine.trim()
    if (!line) continue
    const headerMatch = line.match(/^(\w+)\s*:\s*Mapped\[/)
    if (headerMatch) {
      const fieldName = headerMatch[1]
      const mappedStart = line.indexOf('Mapped[') + 'Mapped['.length
      let depth = 1
      let i = mappedStart
      for (; i < line.length && depth > 0; i++) {
        if (line[i] === '[') depth++
        else if (line[i] === ']') depth--
      }
      const mappedType = line.slice(mappedStart, i - 1).trim()
      const rest = line.slice(i)
      const parenStart = rest.indexOf('(')
      let args = ''
      if (parenStart !== -1) {
        let d = 0
        for (let j = parenStart; j < rest.length; j++) {
          if (rest[j] === '(') d++
          else if (rest[j] === ')') { d--; if (d === 0) { args = rest.slice(parenStart + 1, j); break } }
        }
      }
      const isPK = /primary_key\s*=\s*True/.test(args)
      const isNullable = args.includes('nullable=True') || (args.includes('nullable=False') ? false : !isPK && (mappedType.includes('| None') || mappedType.includes('Optional[')))
      console.log(`  ${fieldName}: Mapped[${mappedType}] args="${args}" isPK=${isPK} nullable=${isNullable}`)
    }
  }
}
