import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock fs/promises before importing the module under test
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    access: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}))

// Mock child_process so runProcess never actually spawns anything
vi.mock('child_process', () => ({ spawn: vi.fn() }))

import fs from 'fs/promises'
import { repoDirs, parseOrtResult, runOrtAnalyze } from '../ortAnalyzer'
import { spawn } from 'child_process'
import { EventEmitter } from 'events'
import { Readable } from 'stream'

function makeProc(stdout = '', exitCode = 0, stderrText = '') {
  const proc = new EventEmitter() as any
  let started = false
  // Use a custom Readable that schedules the data push only when the stream
  // is actually consumed (i.e. when runProcess attaches a 'data' listener
  // and switches the stream to flowing mode).
  proc.stdout = new Readable({
    read() {
      if (!started) {
        started = true
        process.nextTick(() => {
          proc.stdout.push(stdout || null)
          if (stderrText) proc.stderr.push(stderrText)
          proc.stderr.push(null)
          // Defer close so stream 'data' events fire before 'close'
          process.nextTick(() => proc.emit('close', exitCode))
        })
      }
    },
  })
  proc.stderr = new Readable({ read() {} })
  return proc
}

// ─── repoDirs ────────────────────────────────────────────────────────────────

describe('repoDirs', () => {
  it('returns source and ortOutput paths containing owner and name', () => {
    const { source, ortOutput } = repoDirs('myorg/myrepo')
    expect(source).toContain('myorg')
    expect(source).toContain('myrepo')
    expect(source).toMatch(/source$/)
    expect(ortOutput).toMatch(/ort-results$/)
  })

  it('handles org names with dots and dashes', () => {
    const { source } = repoDirs('my-org/my.repo')
    expect(source).toContain('my-org')
    expect(source).toContain('my.repo')
  })
})

// ─── parseOrtResult ──────────────────────────────────────────────────────────

describe('parseOrtResult', () => {
  beforeEach(() => {
    vi.mocked(fs.readFile).mockReset()
  })

  function mockResult(packages: unknown[]) {
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({ analyzer: { result: { packages } } }) as any,
    )
  }

  it('parses a standard NPM package', async () => {
    mockResult([{
      id: 'NPM::express:4.18.0',
      purl: 'pkg:npm/express@4.18.0',
      declaredLicenses: ['MIT'],
      description: 'Fast web framework',
      homepageUrl: 'https://expressjs.com',
    }])
    const pkgs = await parseOrtResult('/output')
    expect(pkgs).toHaveLength(1)
    expect(pkgs[0]).toMatchObject({
      name: 'express',
      version: '4.18.0',
      type: 'NPM',
      namespace: null, // empty string segment in "NPM::express:4.18.0" becomes null
      purl: 'pkg:npm/express@4.18.0',
      declaredLicenses: ['MIT'],
      description: 'Fast web framework',
      homepageUrl: 'https://expressjs.com',
    })
  })

  it('parses a Maven package with namespace', async () => {
    mockResult([{ id: 'Maven:org.apache:commons-lang3:3.12.0', declaredLicenses: [] }])
    const pkgs = await parseOrtResult('/output')
    expect(pkgs[0]).toMatchObject({ type: 'Maven', namespace: 'org.apache', name: 'commons-lang3', version: '3.12.0' })
  })

  it('parses a Go module', async () => {
    mockResult([{ id: 'Go::github.com/gin-gonic/gin:v1.9.1', declaredLicenses: [] }])
    const pkgs = await parseOrtResult('/output')
    expect(pkgs[0].type).toBe('Go')
    expect(pkgs[0].version).toBe('v1.9.1')
  })

  it('handles packageId with fewer than 4 colon-parts gracefully', async () => {
    mockResult([{ id: 'just-a-name', declaredLicenses: [] }])
    const pkgs = await parseOrtResult('/output')
    expect(pkgs[0].name).toBe('just-a-name')
    expect(pkgs[0].type).toBeNull()
    expect(pkgs[0].namespace).toBeNull()
    expect(pkgs[0].version).toBeNull()
  })

  it('handles missing optional fields (purl, description, homepageUrl)', async () => {
    mockResult([{ id: 'NPM::lodash:4.17.21', declaredLicenses: [] }])
    const pkgs = await parseOrtResult('/output')
    expect(pkgs[0].purl).toBeNull()
    expect(pkgs[0].description).toBeNull()
    expect(pkgs[0].homepageUrl).toBeNull()
  })

  it('returns [] for an empty packages array', async () => {
    mockResult([])
    expect(await parseOrtResult('/output')).toEqual([])
  })

  it('returns [] when the packages key is missing', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({ analyzer: { result: {} } }) as any,
    )
    expect(await parseOrtResult('/output')).toEqual([])
  })

  it('returns [] when result structure is missing entirely', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}) as any)
    expect(await parseOrtResult('/output')).toEqual([])
  })
})

// ─── runOrtAnalyze ───────────────────────────────────────────────────────────

describe('runOrtAnalyze', () => {
  beforeEach(() => {
    vi.mocked(spawn).mockReset()
    vi.mocked(fs.mkdir).mockResolvedValue(undefined as any)
    vi.mocked(fs.access).mockResolvedValue(undefined)
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)
    vi.mocked(fs.unlink).mockResolvedValue(undefined)
  })

  it('resolves when ORT exits with code 0', async () => {
    vi.mocked(spawn).mockReturnValue(makeProc('', 0) as any)
    await expect(runOrtAnalyze('/src', '/out')).resolves.toBeUndefined()
  })

  it('resolves when ORT exits with code 1 but result file exists', async () => {
    vi.mocked(spawn).mockReturnValue(makeProc('', 1) as any)
    vi.mocked(fs.access).mockResolvedValue(undefined) // file exists
    await expect(runOrtAnalyze('/src', '/out')).resolves.toBeUndefined()
  })

  it('rejects when ORT exits with code 1 and result file is absent', async () => {
    vi.mocked(spawn).mockReturnValue(makeProc('', 1) as any)
    vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'))
    await expect(runOrtAnalyze('/src', '/out')).rejects.toThrow()
  })

  it('retries with npm disabled when ORT crashes with the npm crash pattern', async () => {
    const npmCrashStderr = 'IllegalArgumentException: references do not actually refer to packages'

    // First call fails with no result file and the npm crash pattern in stderr
    vi.mocked(spawn)
      .mockReturnValueOnce(makeProc('', 1, npmCrashStderr) as any) // first attempt fails
      .mockReturnValueOnce(makeProc('', 0) as any)                  // retry succeeds

    // access call order: (1) global config check → exists; (2) result check after first failure → ENOENT; (3+) succeed
    vi.mocked(fs.access)
      .mockResolvedValueOnce(undefined)           // global config already exists — skip bootstrap
      .mockRejectedValueOnce(new Error('ENOENT')) // no result after first failure → triggers retry
      .mockResolvedValue(undefined)               // subsequent checks succeed

    // readFile returns null (no pre-existing config) so backup logic is skipped
    vi.mocked(fs.readFile).mockResolvedValue(null as any)

    await expect(runOrtAnalyze('/src', '/out')).resolves.toBeUndefined()
    // spawn should have been called twice
    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(2)
    // writeFile should have been called to write the npm-disabled config
    expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
      expect.stringContaining('config.yml'),
      expect.stringContaining('enabledPackageManagers'),
      'utf-8',
    )
  })

  it('does not retry when ORT fails with no result file and stderr does not match npm crash pattern', async () => {
    const otherStderr = 'Some other unrelated error occurred'

    vi.mocked(spawn).mockReturnValueOnce(makeProc('', 1, otherStderr) as any)
    vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'))

    await expect(runOrtAnalyze('/src', '/out')).rejects.toThrow()
    // spawn should only have been called once — no retry
    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1)
  })
})
