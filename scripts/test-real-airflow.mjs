import { readFileSync } from 'fs'

const content = readFileSync(
  'C:/dev/inspector-pika/data/apache/airflow/source/airflow-core/src/airflow/models/pool.py',
  'utf-8'
)
console.log('Has __tablename__:', content.includes('__tablename__'))

function joinLogicalLines(content) {
  const rawLines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const result = []
  let buffer = null
  let depth = 0

  for (let li = 0; li < rawLines.length; li++) {
    const raw = rawLines[li]
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

console.log('Classes found:', classBlocks.map(b => `${b.name}(${b.bases}) lines=${b.lines.length}`))
classBlocks.forEach(b => {
  const hasTablename = b.lines.some(l => l.includes('__tablename__'))
  if (hasTablename) {
    console.log(`\n=== ${b.name} ===`)
    b.lines.filter(l => l.trim() && !l.trim().startsWith('#')).forEach(l => console.log('  ' + l.trim()))
  }
})
