import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { makeChain } from '../../test-utils/drizzleMock'

vi.mock('../../db', () => ({
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
}))

vi.mock('../../services/jobRunner', () => ({
  runJob: vi.fn().mockResolvedValue(undefined),
}))

import { db } from '../../db'
import { runJob } from '../../services/jobRunner'
import { jobsRouter } from '../jobs'

const app = express()
app.use(express.json())
app.use('/api/v1/jobs', jobsRouter)

const mockJob = {
  id: 1, type: 'explore_github_repo', status: 'pending',
  input: { type: 'explore_github_repo', repo: 'facebook/react' },
  result: null, error: null,
  startedAt: null, completedAt: null,
  createdAt: new Date().toISOString(),
}

beforeEach(() => {
  vi.mocked(db.select).mockImplementation(() => makeChain([]))
  vi.mocked(db.insert).mockImplementation(() => makeChain([mockJob]))
  vi.mocked(runJob).mockResolvedValue(undefined)
})

// ─── GET /jobs ───────────────────────────────────────────────────────────────

describe('GET /api/v1/jobs', () => {
  it('returns 200 with jobs array', async () => {
    vi.mocked(db.select).mockImplementation(() => makeChain([mockJob]))
    const res = await request(app).get('/api/v1/jobs')
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].type).toBe('explore_github_repo')
  })

  it('returns 200 with empty array when no jobs', async () => {
    vi.mocked(db.select).mockImplementation(() => makeChain([]))
    const res = await request(app).get('/api/v1/jobs')
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
  })
})

// ─── GET /jobs/:id ───────────────────────────────────────────────────────────

describe('GET /api/v1/jobs/:id', () => {
  it('returns 200 with the job when found', async () => {
    vi.mocked(db.select).mockImplementation(() => makeChain([mockJob]))
    const res = await request(app).get('/api/v1/jobs/1')
    expect(res.status).toBe(200)
    expect(res.body.data.id).toBe(1)
  })

  it('returns 404 when job does not exist', async () => {
    vi.mocked(db.select).mockImplementation(() => makeChain([]))
    const res = await request(app).get('/api/v1/jobs/999')
    expect(res.status).toBe(404)
    expect(res.body.error).toBeDefined()
  })

  it('returns 400 for a non-integer id', async () => {
    const res = await request(app).get('/api/v1/jobs/not-a-number')
    expect(res.status).toBe(400)
  })
})

// ─── POST /jobs ──────────────────────────────────────────────────────────────

describe('POST /api/v1/jobs', () => {
  it('creates an explore_github_repo job and returns 201', async () => {
    vi.mocked(db.insert).mockImplementation(() => makeChain([mockJob]))
    const res = await request(app)
      .post('/api/v1/jobs')
      .send({ type: 'explore_github_repo', repo: 'facebook/react' })
    expect(res.status).toBe(201)
    expect(res.body.data.type).toBe('explore_github_repo')
  })

  it('creates an explore_github_org job and returns 201', async () => {
    const orgJob = { ...mockJob, type: 'explore_github_org', input: { type: 'explore_github_org', org: 'apache' } }
    vi.mocked(db.insert).mockImplementation(() => makeChain([orgJob]))
    const res = await request(app)
      .post('/api/v1/jobs')
      .send({ type: 'explore_github_org', org: 'apache' })
    expect(res.status).toBe(201)
  })

  it('creates an analyze_dependencies job and returns 201', async () => {
    const depJob = { ...mockJob, type: 'analyze_dependencies' }
    vi.mocked(db.insert).mockImplementation(() => makeChain([depJob]))
    const res = await request(app)
      .post('/api/v1/jobs')
      .send({ type: 'analyze_dependencies', repoId: 1, repo: 'apache/kafka' })
    expect(res.status).toBe(201)
  })

  it('creates an analyze_languages job and returns 201', async () => {
    const langJob = { ...mockJob, type: 'analyze_languages' }
    vi.mocked(db.insert).mockImplementation(() => makeChain([langJob]))
    const res = await request(app)
      .post('/api/v1/jobs')
      .send({ type: 'analyze_languages', repoId: 1, repo: 'apache/kafka' })
    expect(res.status).toBe(201)
  })

  it('fires runJob asynchronously without blocking the response', async () => {
    vi.mocked(db.insert).mockImplementation(() => makeChain([mockJob]))
    let resolveJob!: () => void
    vi.mocked(runJob).mockReturnValue(new Promise<void>((r) => { resolveJob = r }))
    const res = await request(app)
      .post('/api/v1/jobs')
      .send({ type: 'explore_github_repo', repo: 'facebook/react' })
    expect(res.status).toBe(201) // responded before the job finished
    resolveJob()
  })

  it('returns 400 for an unknown job type', async () => {
    const res = await request(app)
      .post('/api/v1/jobs')
      .send({ type: 'unknown_type' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBeDefined()
  })

  it('returns 400 when repo field is missing for explore_github_repo', async () => {
    const res = await request(app)
      .post('/api/v1/jobs')
      .send({ type: 'explore_github_repo' })
    expect(res.status).toBe(400)
  })

  it('returns 400 when repo format is invalid (no slash)', async () => {
    const res = await request(app)
      .post('/api/v1/jobs')
      .send({ type: 'explore_github_repo', repo: 'noslash' })
    expect(res.status).toBe(400)
  })

  it('returns 400 when org is empty string for explore_github_org', async () => {
    const res = await request(app)
      .post('/api/v1/jobs')
      .send({ type: 'explore_github_org', org: '' })
    expect(res.status).toBe(400)
  })

  it('returns 400 when repoId is missing for analyze_dependencies', async () => {
    const res = await request(app)
      .post('/api/v1/jobs')
      .send({ type: 'analyze_dependencies', repo: 'owner/name' })
    expect(res.status).toBe(400)
  })

  it('returns 400 when body is empty', async () => {
    const res = await request(app).post('/api/v1/jobs').send({})
    expect(res.status).toBe(400)
  })
})
