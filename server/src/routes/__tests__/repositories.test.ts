import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import { makeChain } from '../../test-utils/drizzleMock'

vi.mock('../../db', () => ({
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
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

beforeEach(() => vi.mocked(db.select).mockImplementation(() => makeChain([])))

// ─── GET /repositories ───────────────────────────────────────────────────────

describe('GET /api/v1/repositories', () => {
  it('returns 200 with an array', async () => {
    vi.mocked(db.select).mockImplementation(() => makeChain([mockRepo]))
    const res = await request(app).get('/api/v1/repositories')
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].fullName).toBe('apache/kafka')
  })

  it('returns 200 with empty array when no repos exist', async () => {
    vi.mocked(db.select).mockImplementation(() => makeChain([]))
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

  it('returns 400 for a non-integer id', async () => {
    const res = await request(app).get('/api/v1/repositories/abc/languages')
    expect(res.status).toBe(400)
  })
})
