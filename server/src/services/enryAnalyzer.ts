import { spawn } from 'child_process'
import path from 'path'

const PROJECT_ROOT = path.resolve(__dirname, '../../../')
const ENRY_BIN = path.join(PROJECT_ROOT, 'tools', 'enry', 'enry.exe')

export interface EnryLanguage {
  language: string
  bytes: number // percentage × 100 (e.g. 8311 = 83.11%)
}

export async function detectLanguages(sourceDir: string): Promise<EnryLanguage[]> {
  const output = await new Promise<string>((resolve, reject) => {
    const proc = spawn(ENRY_BIN, ['-mode=byte', sourceDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr.on('data', (d: Buffer) => process.stderr.write(d))
    proc.on('close', (code) => {
      if (code === 0 || stdout.trim().length > 0) resolve(stdout)
      else reject(new Error(`enry exited with code ${code}`))
    })
    proc.on('error', reject)
  })

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([\d.]+)%\t(.+)$/)
      if (!match) return null
      return {
        language: match[2].trim(),
        bytes: Math.round(parseFloat(match[1]) * 100),
      }
    })
    .filter((x): x is EnryLanguage => x !== null)
}
