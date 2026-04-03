import { readFileSync } from 'fs'

const content = readFileSync(
  'data/apache/airflow/source/airflow-core/src/airflow/models/connection.py',
  'utf-8'
)

function joinLogicalLines(content) {
  const rawLines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
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
    if (buffer === null) buffer = raw
    else buffer += ' ' + raw.trim()
    const endsBackslash = raw.trimEnd().endsWith('\\')
    if (depth === 0 && !endsBackslash) {
      result.push(buffer.replace(/\\\s*$/, ''))
      buffer = null
    }
  }
  if (buffer !== null) result.push(buffer)
  return result
}

const lines = joinLogicalLines(content)
const classBlocks = []
let current = null
for (let i = 0; i < lines.length; i++) {
  const line = lines[i]
  const m = line.match(/^class\s+(\w+)\s*\(([^)]*)\)\s*:/)
  if (m) {
    if (current) classBlocks.push(current)
    current = { name: m[1], lines: [] }
  } else if (current) {
    if (line === '' || line.startsWith(' ') || line.startsWith('\t')) current.lines.push(line)
    else { classBlocks.push(current); current = null; i-- }
  }
}
if (current) classBlocks.push(current)

classBlocks.forEach(b => {
  const hasTablename = b.lines.some(l => l.includes('__tablename__'))
  console.log(`${b.name} lines=${b.lines.length} hasTablename=${hasTablename}`)
  if (b.lines.length < 5) {
    b.lines.forEach(l => console.log('  |' + l + '|'))
  }
})

// Also check depth at each logical line
console.log('\n-- Checking for unclosed parens --')
let depth2 = 0
for (let i = 0; i < lines.length; i++) {
  const line = lines[i]
  for (let ci = 0; ci < line.length; ci++) {
    const ch = line[ci]
    if (ch === '#') break
    if (ch === '(' || ch === '[' || ch === '{') depth2++
    else if (ch === ')' || ch === ']' || ch === '}') depth2 = Math.max(0, depth2 - 1)
  }
  if (depth2 !== 0) console.log(`Line ${i+1} depth=${depth2}: ${line.slice(0, 80)}`)
}
