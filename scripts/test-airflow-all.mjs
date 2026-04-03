import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const AIRFLOW_SOURCE = 'data/apache/airflow/source'

function findPyFiles(dir) {
  const results = []
  try {
    for (const entry of readdirSync(dir)) {
      if (['__pycache__', '.git', 'node_modules', 'venv', '.venv'].includes(entry)) continue
      const full = join(dir, entry)
      const s = statSync(full)
      if (s.isDirectory()) results.push(...findPyFiles(full))
      else if (entry.endsWith('.py')) results.push(full)
    }
  } catch {}
  return results
}

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
    if (depth === 0 && !raw.trimEnd().endsWith('\\')) {
      result.push(buffer.replace(/\\\s*$/, ''))
      buffer = null
    }
  }
  if (buffer !== null) result.push(buffer)
  return result
}

const files = findPyFiles(AIRFLOW_SOURCE)
const modelFiles = files.filter(f => {
  try { return readFileSync(f, 'utf-8').includes('__tablename__') } catch { return false }
})

console.log(`Found ${modelFiles.length} files with __tablename__`)

for (const file of modelFiles) {
  const content = readFileSync(file, 'utf-8')
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

  const tables = classBlocks.filter(b => b.lines.some(l => l.includes('__tablename__')))
  const shortFile = file.replace(AIRFLOW_SOURCE + '/', '')
  if (tables.length === 0) {
    console.log(`  WARN: ${shortFile} has __tablename__ but no class block detected it`)
  } else {
    console.log(`  OK  : ${shortFile} → ${tables.map(t => t.name).join(', ')}`)
  }
}
