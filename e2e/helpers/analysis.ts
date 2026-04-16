/**
 * Shared helpers for the analyzer E2E test suite.
 *
 * All job operations go directly through the REST API (page.request / fixtures.request)
 * so that test setup is fast and independent of UI interactions.
 * UI assertions are performed after setup is complete.
 */
import type { APIRequestContext } from '@playwright/test'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Job {
  id: number
  type: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  result?: Record<string, unknown>
  error?: string
}

export type AnalysisType =
  | 'explore_github_repo'
  | 'explore_github_org'
  | 'analyze_languages'
  | 'analyze_entities'
  | 'analyze_apis'
  | 'analyze_dependencies'

// ── Core helpers ──────────────────────────────────────────────────────────────

/**
 * Submit a job via the API and return its ID.
 */
export async function submitJob(request: APIRequestContext, payload: Record<string, unknown>): Promise<number> {
  const resp = await request.post('/api/v1/jobs', { data: payload })
  if (!resp.ok()) {
    const text = await resp.text()
    throw new Error(`POST /api/v1/jobs failed (${resp.status()}): ${text}`)
  }
  const body = await resp.json()
  return body.data.id as number
}

/**
 * Poll GET /api/v1/jobs/:id until the job reaches a terminal state
 * or the timeout expires.
 */
export async function waitForJob(
  request: APIRequestContext,
  jobId: number,
  timeoutMs = 10 * 60 * 1000,
  pollIntervalMs = 3_000,
): Promise<Job> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const resp = await request.get(`/api/v1/jobs/${jobId}`)
    if (!resp.ok()) throw new Error(`GET /api/v1/jobs/${jobId} failed (${resp.status()})`)
    const job = ((await resp.json()).data) as Job
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      return job
    }
    await new Promise(r => setTimeout(r, pollIntervalMs))
  }
  throw new Error(`Job ${jobId} did not reach a terminal state within ${timeoutMs}ms`)
}

// ── High-level helpers ────────────────────────────────────────────────────────

/**
 * Explore a GitHub repository and return its internal DB id.
 * If the repo is already explored the existing record is returned (job idempotent).
 */
export async function exploreRepo(
  request: APIRequestContext,
  fullName: string,
  timeoutMs = 3 * 60 * 1000,
): Promise<number> {
  const jobId = await submitJob(request, { type: 'explore_github_repo', repo: fullName })
  const job = await waitForJob(request, jobId, timeoutMs)
  if (job.status !== 'completed') {
    throw new Error(`explore_github_repo for ${fullName} ended with status=${job.status}: ${job.error ?? ''}`)
  }
  return (job.result as any).repositoryId as number
}

/**
 * Run one of the four analysis job types against a repo that has already been explored.
 * Returns the completed (or failed) job.
 */
export async function analyzeRepo(
  request: APIRequestContext,
  type: Exclude<AnalysisType, 'explore_github_repo' | 'explore_github_org'>,
  repoId: number,
  fullName: string,
  timeoutMs = 15 * 60 * 1000,
): Promise<Job> {
  const jobId = await submitJob(request, { type, repoId, repo: fullName })
  return waitForJob(request, jobId, timeoutMs)
}

/**
 * Run analyze_languages and return the detected language names.
 */
export async function analyzeLanguages(
  request: APIRequestContext,
  repoId: number,
  fullName: string,
): Promise<string[]> {
  const job = await analyzeRepo(request, 'analyze_languages', repoId, fullName, 5 * 60 * 1000)
  if (job.status !== 'completed') {
    throw new Error(`analyze_languages for ${fullName} failed: ${job.error ?? ''}`)
  }
  // Fetch languages from the API
  const resp = await request.get(`/api/v1/repositories/${repoId}/languages`)
  if (!resp.ok()) return []
  const { data } = await resp.json()
  return (data ?? []).map((l: any) => l.language as string)
}

/**
 * Ensure a repo is explored and languages are detected.
 * Returns { repoId }.  Safe to call multiple times (idempotent at the DB level).
 */
export async function setupRepo(
  request: APIRequestContext,
  fullName: string,
): Promise<{ repoId: number }> {
  const repoId = await exploreRepo(request, fullName)
  await analyzeLanguages(request, repoId, fullName)
  return { repoId }
}
