import { describe, it, expect } from 'vitest'
import { CreateJobSchema } from '@inspector-pika/shared'

describe('CreateJobSchema', () => {
  // ── explore_github_repo ──────────────────────────────────────────────────

  describe('explore_github_repo', () => {
    it('accepts a valid owner/repo string', () => {
      const result = CreateJobSchema.safeParse({ type: 'explore_github_repo', repo: 'facebook/react' })
      expect(result.success).toBe(true)
    })

    it('accepts repos with dots and dashes', () => {
      const result = CreateJobSchema.safeParse({ type: 'explore_github_repo', repo: 'my-org/my.repo' })
      expect(result.success).toBe(true)
    })

    it('rejects a repo string with no slash', () => {
      const result = CreateJobSchema.safeParse({ type: 'explore_github_repo', repo: 'noslash' })
      expect(result.success).toBe(false)
    })

    it('rejects an empty repo string', () => {
      const result = CreateJobSchema.safeParse({ type: 'explore_github_repo', repo: '' })
      expect(result.success).toBe(false)
    })

    it('rejects when repo field is missing', () => {
      const result = CreateJobSchema.safeParse({ type: 'explore_github_repo' })
      expect(result.success).toBe(false)
    })
  })

  // ── explore_github_org ───────────────────────────────────────────────────

  describe('explore_github_org', () => {
    it('accepts a valid org name', () => {
      const result = CreateJobSchema.safeParse({ type: 'explore_github_org', org: 'apache' })
      expect(result.success).toBe(true)
    })

    it('rejects an empty org name', () => {
      const result = CreateJobSchema.safeParse({ type: 'explore_github_org', org: '' })
      expect(result.success).toBe(false)
    })

    it('rejects when org field is missing', () => {
      const result = CreateJobSchema.safeParse({ type: 'explore_github_org' })
      expect(result.success).toBe(false)
    })
  })

  // ── analyze_dependencies ─────────────────────────────────────────────────

  describe('analyze_dependencies', () => {
    it('accepts valid repoId and repo', () => {
      const result = CreateJobSchema.safeParse({
        type: 'analyze_dependencies',
        repoId: 1,
        repo: 'owner/name',
      })
      expect(result.success).toBe(true)
    })

    it('rejects non-integer repoId', () => {
      const result = CreateJobSchema.safeParse({
        type: 'analyze_dependencies',
        repoId: 1.5,
        repo: 'owner/name',
      })
      expect(result.success).toBe(false)
    })

    it('rejects zero repoId', () => {
      const result = CreateJobSchema.safeParse({
        type: 'analyze_dependencies',
        repoId: 0,
        repo: 'owner/name',
      })
      expect(result.success).toBe(false)
    })

    it('rejects negative repoId', () => {
      const result = CreateJobSchema.safeParse({
        type: 'analyze_dependencies',
        repoId: -1,
        repo: 'owner/name',
      })
      expect(result.success).toBe(false)
    })

    it('rejects invalid repo format', () => {
      const result = CreateJobSchema.safeParse({
        type: 'analyze_dependencies',
        repoId: 1,
        repo: 'noslash',
      })
      expect(result.success).toBe(false)
    })

    it('rejects when repoId is missing', () => {
      const result = CreateJobSchema.safeParse({ type: 'analyze_dependencies', repo: 'owner/name' })
      expect(result.success).toBe(false)
    })
  })

  // ── analyze_languages ────────────────────────────────────────────────────

  describe('analyze_languages', () => {
    it('accepts valid repoId and repo', () => {
      const result = CreateJobSchema.safeParse({
        type: 'analyze_languages',
        repoId: 42,
        repo: 'owner/name',
      })
      expect(result.success).toBe(true)
    })

    it('rejects when repo field is missing', () => {
      const result = CreateJobSchema.safeParse({ type: 'analyze_languages', repoId: 1 })
      expect(result.success).toBe(false)
    })
  })

  // ── unknown type ─────────────────────────────────────────────────────────

  it('rejects an unknown job type', () => {
    const result = CreateJobSchema.safeParse({ type: 'do_something_else' })
    expect(result.success).toBe(false)
  })

  it('rejects when type is missing', () => {
    const result = CreateJobSchema.safeParse({ repo: 'owner/name' })
    expect(result.success).toBe(false)
  })
})
