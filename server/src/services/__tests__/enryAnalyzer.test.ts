import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

vi.mock('child_process', () => ({ spawn: vi.fn() }))

import { spawn } from 'child_process'
import { detectLanguages } from '../enryAnalyzer'

// Use plain EventEmitters for stdout/stderr so 'data' fires synchronously before 'close'
function makeProc(stdoutData: string, exitCode = 0) {
  const proc = new EventEmitter() as any
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  process.nextTick(() => {
    if (stdoutData) proc.stdout.emit('data', Buffer.from(stdoutData))
    proc.emit('close', exitCode)
  })
  return proc
}

beforeEach(() => vi.mocked(spawn).mockReset())

// ─── detectLanguages ─────────────────────────────────────────────────────────

describe('detectLanguages', () => {
  it('parses single language output', async () => {
    vi.mocked(spawn).mockReturnValue(makeProc('100.00%\tTypeScript\n') as any)
    const langs = await detectLanguages('/src')
    expect(langs).toHaveLength(1)
    expect(langs[0]).toEqual({ language: 'TypeScript', bytes: 10000 })
  })

  it('parses multiple languages', async () => {
    vi.mocked(spawn).mockReturnValue(makeProc('83.11%\tGo\n12.50%\tTypeScript\n4.39%\tMakefile\n') as any)
    const langs = await detectLanguages('/src')
    expect(langs).toHaveLength(3)
    expect(langs[0]).toEqual({ language: 'Go', bytes: 8311 })
    expect(langs[1]).toEqual({ language: 'TypeScript', bytes: 1250 })
    expect(langs[2]).toEqual({ language: 'Makefile', bytes: 439 })
  })

  it('converts percentage to integer correctly (rounds)', async () => {
    vi.mocked(spawn).mockReturnValue(makeProc('33.33%\tRuby\n') as any)
    const langs = await detectLanguages('/src')
    expect(langs[0].bytes).toBe(3333)
  })

  it('skips blank lines', async () => {
    vi.mocked(spawn).mockReturnValue(makeProc('\n60.00%\tRust\n\n40.00%\tC\n\n') as any)
    const langs = await detectLanguages('/src')
    expect(langs).toHaveLength(2)
  })

  it('skips malformed lines that do not match the pattern', async () => {
    vi.mocked(spawn).mockReturnValue(makeProc('not-a-valid-line\n50.00%\tJavaScript\n') as any)
    const langs = await detectLanguages('/src')
    expect(langs).toHaveLength(1)
    expect(langs[0].language).toBe('JavaScript')
  })

  it('returns [] for empty output', async () => {
    vi.mocked(spawn).mockReturnValue(makeProc('') as any)
    expect(await detectLanguages('/src')).toEqual([])
  })

  it('resolves to [] when exit code is non-zero and stdout is empty', async () => {
    vi.mocked(spawn).mockReturnValue(makeProc('', 1) as any)
    await expect(detectLanguages('/src')).rejects.toThrow('enry exited with code 1')
  })

  it('resolves successfully even when exit code is non-zero but stdout has content', async () => {
    vi.mocked(spawn).mockReturnValue(makeProc('75.00%\tPython\n25.00%\tShell\n', 1) as any)
    const langs = await detectLanguages('/src')
    expect(langs).toHaveLength(2)
  })

  it('passes the correct arguments to spawn', async () => {
    vi.mocked(spawn).mockReturnValue(makeProc('100.00%\tGo\n') as any)
    await detectLanguages('/my/source/dir')
    expect(vi.mocked(spawn)).toHaveBeenCalledWith(
      expect.stringContaining('enry'),
      expect.arrayContaining(['-mode=byte', '/my/source/dir']),
      expect.any(Object),
    )
  })
})
