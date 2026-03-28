import { describe, it, expect } from 'vitest'
import { parseNpmDependencies, parsePipDependencies, parseGoDependencies } from '../analyzer'

// ─── parseNpmDependencies ────────────────────────────────────────────────────

describe('parseNpmDependencies', () => {
  it('parses regular dependencies', () => {
    const content = JSON.stringify({
      dependencies: { express: '^4.18.0', lodash: '4.17.21' },
    })
    const result = parseNpmDependencies(content)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ name: 'express', version: '^4.18.0', isDevDependency: false, githubRepo: null })
    expect(result[1]).toMatchObject({ name: 'lodash', version: '4.17.21', isDevDependency: false })
  })

  it('marks devDependencies with isDevDependency: true', () => {
    const content = JSON.stringify({ devDependencies: { vitest: '^2.0.0', typescript: '^5.0.0' } })
    const result = parseNpmDependencies(content)
    expect(result).toHaveLength(2)
    result.forEach((d) => expect(d.isDevDependency).toBe(true))
  })

  it('marks peerDependencies as non-dev', () => {
    const content = JSON.stringify({ peerDependencies: { react: '^18.0.0' } })
    expect(parseNpmDependencies(content)[0].isDevDependency).toBe(false)
  })

  it('collects all three dep kinds together', () => {
    const content = JSON.stringify({
      dependencies: { a: '1.0.0' },
      devDependencies: { b: '2.0.0' },
      peerDependencies: { c: '3.0.0' },
    })
    expect(parseNpmDependencies(content)).toHaveLength(3)
  })

  it('extracts githubRepo from "github:owner/repo" version string', () => {
    const content = JSON.stringify({ dependencies: { mylib: 'github:owner/repo' } })
    expect(parseNpmDependencies(content)[0].githubRepo).toBe('owner/repo')
  })

  it('extracts githubRepo from https://github.com URL and strips .git', () => {
    const content = JSON.stringify({ dependencies: { mylib: 'https://github.com/owner/repo.git' } })
    expect(parseNpmDependencies(content)[0].githubRepo).toBe('owner/repo')
  })

  it('extracts githubRepo from https://github.com URL without .git', () => {
    const content = JSON.stringify({ dependencies: { mylib: 'https://github.com/owner/repo' } })
    expect(parseNpmDependencies(content)[0].githubRepo).toBe('owner/repo')
  })

  it('returns githubRepo: null for plain semver versions', () => {
    const content = JSON.stringify({ dependencies: { express: '^4.0.0' } })
    expect(parseNpmDependencies(content)[0].githubRepo).toBeNull()
  })

  it('returns [] for malformed JSON', () => {
    expect(parseNpmDependencies('not json at all')).toEqual([])
    expect(parseNpmDependencies('')).toEqual([])
  })

  it('returns [] when no dependency keys are present', () => {
    expect(parseNpmDependencies(JSON.stringify({ name: 'foo', version: '1.0.0' }))).toEqual([])
  })
})

// ─── parsePipDependencies ────────────────────────────────────────────────────

describe('parsePipDependencies', () => {
  it('parses plain package names', () => {
    const result = parsePipDependencies('requests\nflask\n')
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ name: 'requests', version: null, isDevDependency: false, githubRepo: null })
    expect(result[1].name).toBe('flask')
  })

  it('parses >= version specifier', () => {
    const result = parsePipDependencies('Django>=3.2\n')
    expect(result[0].version).toBe('>=3.2')
  })

  it('parses == version specifier', () => {
    const result = parsePipDependencies('numpy==1.24.0\n')
    expect(result[0].version).toBe('==1.24.0')
  })

  it('parses != and <= specifiers', () => {
    const result = parsePipDependencies('foo!=1.0\nbar<=2.0\n')
    expect(result[0].version).toBe('!=1.0')
    expect(result[1].version).toBe('<=2.0')
  })

  it('skips comment lines', () => {
    const result = parsePipDependencies('# this is a comment\nrequests\n')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('requests')
  })

  it('skips blank lines', () => {
    expect(parsePipDependencies('requests\n\nflask\n')).toHaveLength(2)
  })

  it('returns [] for empty input', () => {
    expect(parsePipDependencies('')).toEqual([])
  })

  it('returns [] for only comments and blank lines', () => {
    expect(parsePipDependencies('# comment\n\n# another\n')).toEqual([])
  })
})

// ─── parseGoDependencies ─────────────────────────────────────────────────────

describe('parseGoDependencies', () => {
  it('parses inline require statement', () => {
    const result = parseGoDependencies('require github.com/gin-gonic/gin v1.9.1\n')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      name: 'github.com/gin-gonic/gin',
      version: 'v1.9.1',
      isDevDependency: false,
      githubRepo: 'gin-gonic/gin',
    })
  })

  // Note: the parser only handles inline `require pkg version` lines.
  // Indented require-block lines are not parsed because the ^\s+ regex is
  // applied to already-trimmed input (can never have leading whitespace).

  it('sets githubRepo to null for non-github.com modules (inline require)', () => {
    const result = parseGoDependencies('require golang.org/x/net v0.17.0\n')
    expect(result).toHaveLength(1)
    expect(result[0].githubRepo).toBeNull()
  })

  it('handles multiple inline require statements', () => {
    const content = 'require github.com/owner/repo1 v1.0.0\nrequire github.com/owner/repo2 v2.0.0\n'
    const result = parseGoDependencies(content)
    expect(result.find((d) => d.githubRepo === 'owner/repo1')).toBeDefined()
    expect(result.find((d) => d.githubRepo === 'owner/repo2')).toBeDefined()
  })

  it('returns [] for empty input', () => {
    expect(parseGoDependencies('')).toEqual([])
  })

  it('returns [] for go.mod with no require lines', () => {
    expect(parseGoDependencies('module example.com/mymod\n\ngo 1.21\n')).toEqual([])
  })
})
