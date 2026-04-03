import { readFileSync } from 'fs'

const content = readFileSync(
  'data/apache/airflow/source/airflow-core/src/airflow/models/connection.py',
  'utf-8'
)

// Full joinLogicalLines with string tracking (same as sqlalchemy.ts)
function joinLogicalLines(content) {
  const rawLines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const result = []
  let buffer = null
  let depth = 0
  let inSingleStr = false
  let inDoubleStr = false
  let inTripleSingle = false
  let inTripleDouble = false

  for (let li = 0; li < rawLines.length; li++) {
    const raw = rawLines[li]
    for (let ci = 0; ci < raw.length; ci++) {
      const ch = raw[ci]
      const two = raw.slice(ci, ci + 3)
      if (!inSingleStr && !inDoubleStr && !inTripleSingle && !inTripleDouble) {
        if (two === "'''") { inTripleSingle = true; ci += 2; continue }
        if (two === '"""') { inTripleDouble = true; ci += 2; continue }
        if (ch === "'") { inSingleStr = true; continue }
        if (ch === '"') { inDoubleStr = true; continue }
        if (ch === '#') break
        if (ch === '(' || ch === '[' || ch === '{') depth++
        else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1)
      } else if (inTripleSingle && two === "'''") { inTripleSingle = false; ci += 2 }
      else if (inTripleDouble && two === '"""') { inTripleDouble = false; ci += 2 }
      else if (inSingleStr && ch === "'" && raw[ci - 1] !== '\\') inSingleStr = false
      else if (inDoubleStr && ch === '"' && raw[ci - 1] !== '\\') inDoubleStr = false
    }
    if (buffer === null) buffer = raw
    else buffer += ' ' + raw.trim()
    const endsBackslash = raw.trimEnd().endsWith('\\')
    if (depth === 0 && !endsBackslash && !inTripleSingle && !inTripleDouble) {
      result.push(buffer.replace(/\\\s*$/, ''))
      buffer = null
    }
  }
  if (buffer !== null) result.push(buffer)
  return result
}

const lines = joinLogicalLines(content)

// Check for depth issues in logical lines
let depth2 = 0
for (let i = 0; i < lines.length; i++) {
  const line = lines[i]
  let inSingleStr = false, inDoubleStr = false, inTripleSingle = false, inTripleDouble = false
  for (let ci = 0; ci < line.length; ci++) {
    const ch = line[ci]
    const two = line.slice(ci, ci + 3)
    if (!inSingleStr && !inDoubleStr && !inTripleSingle && !inTripleDouble) {
      if (two === "'''") { inTripleSingle = true; ci += 2; continue }
      if (two === '"""') { inTripleDouble = true; ci += 2; continue }
      if (ch === "'") { inSingleStr = true; continue }
      if (ch === '"') { inDoubleStr = true; continue }
      if (ch === '#') break
      if (ch === '(' || ch === '[' || ch === '{') depth2++
      else if (ch === ')' || ch === ']' || ch === '}') depth2 = Math.max(0, depth2 - 1)
    } else if (inTripleSingle && two === "'''") { inTripleSingle = false; ci += 2 }
    else if (inTripleDouble && two === '"""') { inTripleDouble = false; ci += 2 }
    else if (inSingleStr && ch === "'" && line[ci - 1] !== '\\') inSingleStr = false
    else if (inDoubleStr && ch === '"' && line[ci - 1] !== '\\') inDoubleStr = false
  }
}

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
})
