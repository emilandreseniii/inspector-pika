import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { makeChain } from '../../test-utils/drizzleMock'

vi.mock('../../db', () => ({
  db: { select: vi.fn(), selectDistinct: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
}))

import { db } from '../../db'
import { repositoriesRouter } from '../repositories'

const app = express()
app.use(express.json())
app.use('/api/v1/repositories', repositoriesRouter)

const mockRepo = {
  id: 1, provider: 'github', owner: 'apache', name: 'kafka',
  fullName: 'apache/kafka', description: 'A distributed event streaming platform',
  defaultBranch: 'trunk', stars: 28000, forks: 14000, isPrivate: false,
  url: 'https://github.com/apache/kafka', fetchedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
}

const mockPackage = {
  id: 1, repoId: 1, packageId: 'NPM::express:4.18.0', purl: 'pkg:npm/express@4.18.0',
  type: 'NPM', namespace: '', name: 'express', version: '4.18.0',
  declaredLicenses: ['MIT'], description: null, homepageUrl: null,
  createdAt: new Date().toISOString(),
}

const mockLanguage = { id: 1, repoId: 1, language: 'Java', bytes: 9500 }

beforeEach(() => {
  vi.mocked(db.select).mockImplementation(() => makeChain([]))
  vi.mocked(db.selectDistinct).mockImplementation(() => makeChain([]))
})

// ─── GET /repositories ───────────────────────────────────────────────────────

describe('GET /api/v1/repositories', () => {
  it('returns 200 with an array', async () => {
    vi.mocked(db.select).mockImplementation(() => makeChain([mockRepo]))
    // selectDistinct already returns [] from beforeEach (no analysis data)
    const res = await request(app).get('/api/v1/repositories')
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].fullName).toBe('apache/kafka')
    expect(res.body.data[0].analysisStatus).toEqual({ hasLanguages: false, hasPackages: false, hasApis: false, hasEntities: false })
  })

  it('returns 200 with empty array when no repos exist', async () => {
    // select and selectDistinct both return [] from beforeEach
    const res = await request(app).get('/api/v1/repositories')
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
  })
})

// ─── GET /repositories/:id ───────────────────────────────────────────────────

describe('GET /api/v1/repositories/:id', () => {
  it('returns 200 with the repo when found', async () => {
    vi.mocked(db.select).mockImplementation(() => makeChain([mockRepo]))
    const res = await request(app).get('/api/v1/repositories/1')
    expect(res.status).toBe(200)
    expect(res.body.data.fullName).toBe('apache/kafka')
  })

  it('returns 404 when repo does not exist', async () => {
    vi.mocked(db.select).mockImplementation(() => makeChain([]))
    const res = await request(app).get('/api/v1/repositories/999')
    expect(res.status).toBe(404)
    expect(res.body.error).toBeDefined()
  })

  it('returns 400 for a non-integer id', async () => {
    const res = await request(app).get('/api/v1/repositories/not-a-number')
    expect(res.status).toBe(400)
  })
})

// ─── GET /repositories/:id/packages ─────────────────────────────────────────

describe('GET /api/v1/repositories/:id/packages', () => {
  it('returns 200 with packages array', async () => {
    vi.mocked(db.select).mockImplementation(() => makeChain([mockPackage]))
    const res = await request(app).get('/api/v1/repositories/1/packages')
    expect(res.status).toBe(200)
    expect(res.body.data[0].name).toBe('express')
  })

  it('returns 200 with empty array when no packages', async () => {
    vi.mocked(db.select).mockImplementation(() => makeChain([]))
    const res = await request(app).get('/api/v1/repositories/1/packages')
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
  })

  it('returns 400 for a non-integer id', async () => {
    const res = await request(app).get('/api/v1/repositories/abc/packages')
    expect(res.status).toBe(400)
  })
})

// ─── GET /repositories/:id/languages ────────────────────────────────────────

describe('GET /api/v1/repositories/:id/languages', () => {
  it('returns data and analyzed: false when no completed job exists', async () => {
    vi.mocked(db.select)
      .mockImplementationOnce(() => makeChain([mockLanguage])) // languages
      .mockImplementationOnce(() => makeChain([]))             // no completed jobs
    const res = await request(app).get('/api/v1/repositories/1/languages')
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.analyzed).toBe(false)
  })

  it('returns analyzed: true when a completed analyze_languages job exists', async () => {
    vi.mocked(db.select)
      .mockImplementationOnce(() => makeChain([]))          // no languages
      .mockImplementationOnce(() => makeChain([{ id: 5 }])) // completed job found
    const res = await request(app).get('/api/v1/repositories/1/languages')
    expect(res.status).toBe(200)
    expect(res.body.analyzed).toBe(true)
    expect(res.body.data).toEqual([])
  })

  it('returns lastAnalyzedAt from the most recent completed analyze_languages job', async () => {
    const completedAt = '2026-03-27T10:00:00.000Z'
    vi.mocked(db.select)
      .mockImplementationOnce(() => makeChain([mockLanguage]))                     // languages
      .mockImplementationOnce(() => makeChain([{ id: 7, completedAt }])) // completed job
    const res = await request(app).get('/api/v1/repositories/1/languages')
    expect(res.status).toBe(200)
    expect(res.body.analyzed).toBe(true)
    expect(res.body.lastAnalyzedAt).toBe(completedAt)
  })

  it('returns lastAnalyzedAt: null when no completed analyze_languages job exists', async () => {
    vi.mocked(db.select)
      .mockImplementationOnce(() => makeChain([mockLanguage])) // languages
      .mockImplementationOnce(() => makeChain([]))             // no completed jobs
    const res = await request(app).get('/api/v1/repositories/1/languages')
    expect(res.status).toBe(200)
    expect(res.body.lastAnalyzedAt).toBeNull()
  })

  it('returns 400 for a non-integer id', async () => {
    const res = await request(app).get('/api/v1/repositories/abc/languages')
    expect(res.status).toBe(400)
  })
})

// ─── GET /repositories/:id/jobs ─────────────────────────────────────────────

const mockJob = {
  id: 10,
  type: 'analyze_languages',
  status: 'completed',
  error: null,
  startedAt: new Date().toISOString(),
  completedAt: new Date().toISOString(),
}

describe('GET /api/v1/repositories/:id/jobs', () => {
  it('returns a map of most recent job per type', async () => {
    // The endpoint calls db.select 3 times (once per job type: analyze_dependencies, analyze_languages, analyze_entities)
    vi.mocked(db.select)
      .mockImplementationOnce(() => makeChain([]))              // analyze_dependencies — no job
      .mockImplementationOnce(() => makeChain([mockJob]))       // analyze_languages — has job
      .mockImplementationOnce(() => makeChain([]))              // analyze_entities — no job
    const res = await request(app).get('/api/v1/repositories/1/jobs')
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveProperty('analyze_languages')
    expect(res.body.data.analyze_languages.id).toBe(10)
    expect(res.body.data.analyze_languages.status).toBe('completed')
    // Types with no job should not appear in the map
    expect(res.body.data).not.toHaveProperty('analyze_dependencies')
    expect(res.body.data).not.toHaveProperty('analyze_entities')
  })

  it('returns empty object when no jobs exist for any type', async () => {
    vi.mocked(db.select)
      .mockImplementationOnce(() => makeChain([]))
      .mockImplementationOnce(() => makeChain([]))
      .mockImplementationOnce(() => makeChain([]))
    const res = await request(app).get('/api/v1/repositories/1/jobs')
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({})
  })

  it('returns all three types when jobs exist for each', async () => {
    const depJob = { ...mockJob, id: 1, type: 'analyze_dependencies' }
    const langJob = { ...mockJob, id: 2, type: 'analyze_languages' }
    const entJob = { ...mockJob, id: 3, type: 'analyze_entities', status: 'running' }
    vi.mocked(db.select)
      .mockImplementationOnce(() => makeChain([depJob]))
      .mockImplementationOnce(() => makeChain([langJob]))
      .mockImplementationOnce(() => makeChain([entJob]))
    const res = await request(app).get('/api/v1/repositories/1/jobs')
    expect(res.status).toBe(200)
    expect(Object.keys(res.body.data)).toHaveLength(3)
    expect(res.body.data.analyze_dependencies.id).toBe(1)
    expect(res.body.data.analyze_languages.id).toBe(2)
    expect(res.body.data.analyze_entities.status).toBe('running')
  })

  it('returns 400 for a non-integer id', async () => {
    const res = await request(app).get('/api/v1/repositories/abc/jobs')
    expect(res.status).toBe(400)
  })
})
