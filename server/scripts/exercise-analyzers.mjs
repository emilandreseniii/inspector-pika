/**
 * Exercises all four analyzers across a curated set of repos.
 * Run from server/ directory: node scripts/exercise-analyzers.mjs
 *
 * Phase 1: Explore new repos (to fill language gaps: TS, Ruby, PHP, C#, Kotlin)
 * Phase 2: Run all missing analyses on every cloned repo
 * Phase 3: Report summary
 */
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
require('dotenv').config({ path: '../../.env' })

const BASE = 'http://localhost:3000/api/v1'

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ── Helpers ──────────────────────────────────────────────────────────────────

async function ensureRepo(fullName) {
  const [owner, name] = fullName.split('/')
  // Check if already in DB
  const list = await api('GET', `/repositories?pageSize=1&search=${encodeURIComponent(fullName)}`)
  const existing = list.data?.find(r => r.fullName === fullName)
  if (existing) return existing.id

  console.log(`  Exploring ${fullName}…`)
  const j = await api('POST', '/jobs', { type: 'explore_github_repo', repo: fullName })
  const jobId = j.data.id
  await waitForJob(jobId, `explore ${fullName}`)
  // Re-fetch
  const list2 = await api('GET', `/repositories?pageSize=5&search=${encodeURIComponent(fullName)}`)
  return list2.data?.find(r => r.fullName === fullName)?.id
}

async function waitForJob(jobId, label, timeoutMs = 20 * 60 * 1000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    await sleep(5000)
    const j = await api('GET', `/jobs/${jobId}`)
    const status = j.data?.status
    if (status === 'completed') { console.log(`    ✓ ${label}`); return true }
    if (status === 'failed') {
      console.log(`    ✗ ${label}: ${j.data.error}`)
      return false
    }
    process.stdout.write('.')
  }
  console.log(`    ✗ ${label}: timed out`)
  return false
}

async function runAnalysis(type, repoId, repo, extra = {}) {
  const j = await api('POST', '/jobs', { type, repoId, repo, ...extra })
  if (j.error) { console.log(`    ✗ create job ${type} for ${repo}: ${j.error}`); return false }
  return waitForJob(j.data.id, `${type} ${repo}`)
}

// ── Phase 1: Repos to add for language diversity ──────────────────────────────

const NEW_REPOS = [
  // TypeScript / JavaScript
  'nestjs/nest',           // NestJS – decorators, controllers, TypeORM
  'typeorm/typeorm',       // TypeORM itself
  'expressjs/express',     // classic Express
  // Ruby
  'sinatra/sinatra',       // small Ruby web framework
  // PHP
  'laravel/laravel',       // Laravel skeleton
  // C#
  'dotnet-architecture/eShopOnWeb',  // ASP.NET Core + EF Core demo
  // Kotlin
  'JetBrains/Exposed',     // Kotlin SQL framework
]

// ── Phase 2: Full analysis matrix ────────────────────────────────────────────
// [ fullName, repoId (filled after ensure), analyses to run ]

const ANALYSIS_PLAN = [
  // Already-cloned repos with gaps
  ['django/django',      49575, ['analyze_languages','analyze_dependencies','analyze_entities','analyze_apis']],
  ['pallets/flask',      49576, ['analyze_languages','analyze_dependencies','analyze_entities','analyze_apis']],
  ['apache/cayenne',        32, ['analyze_languages','analyze_dependencies','analyze_entities','analyze_apis']],
  ['apache/openjpa',        37, ['analyze_languages','analyze_dependencies','analyze_entities','analyze_apis']],
  ['apache/roller',         78, ['analyze_languages','analyze_dependencies','analyze_entities','analyze_apis']],
  ['apache/airflow',       620, ['analyze_languages','analyze_dependencies','analyze_entities','analyze_apis']],
  ['apache/fineract',      725, ['analyze_languages','analyze_dependencies','analyze_entities','analyze_apis']],
  ['apache/syncope',       550, ['analyze_languages','analyze_dependencies','analyze_entities','analyze_apis']],
  ['apache/pekko-grpc',   2598, ['analyze_languages','analyze_dependencies','analyze_entities','analyze_apis']],
  ['apache/rocketmq-dashboard', 2389, ['analyze_languages','analyze_dependencies','analyze_entities','analyze_apis']],
  ['apache/servicecomb-java-chassis', 987, ['analyze_languages','analyze_dependencies','analyze_entities','analyze_apis']],
  ['apache/camel-spring-boot-examples', 2105, ['analyze_languages','analyze_dependencies','analyze_entities','analyze_apis']],
  ['apache/skywalking-banyandb-client-proto', 3058, ['analyze_languages','analyze_dependencies','analyze_entities','analyze_apis']],
  ['anthropics/argo-cd',  12441, ['analyze_languages','analyze_entities','analyze_apis']],
  ['anthropics/connect-rust', 12446, ['analyze_languages','analyze_entities','analyze_apis']],
  // New repos (IDs filled dynamically)
  ['nestjs/nest',           null, ['analyze_languages','analyze_dependencies','analyze_entities','analyze_apis']],
  ['typeorm/typeorm',       null, ['analyze_languages','analyze_dependencies','analyze_entities','analyze_apis']],
  ['expressjs/express',     null, ['analyze_languages','analyze_dependencies','analyze_entities','analyze_apis']],
  ['sinatra/sinatra',       null, ['analyze_languages','analyze_dependencies','analyze_entities','analyze_apis']],
  ['laravel/laravel',       null, ['analyze_languages','analyze_dependencies','analyze_entities','analyze_apis']],
  ['dotnet-architecture/eShopOnWeb', 49591, ['analyze_languages','analyze_dependencies','analyze_entities','analyze_apis']],
  ['JetBrains/Exposed',     null, ['analyze_languages','analyze_dependencies','analyze_entities','analyze_apis']],
]

// ─────────────────────────────────────────────────────────────────────────────

const results = []

async function main() {
  console.log('=== Phase 1: Ensure repos exist ===')
  for (const repo of NEW_REPOS) {
    const id = await ensureRepo(repo)
    if (!id) { console.log(`  ✗ Could not find/explore ${repo}`); continue }
    const entry = ANALYSIS_PLAN.find(([r]) => r === repo)
    if (entry) entry[1] = id
    console.log(`  ${repo} → id ${id}`)
  }

  console.log('\n=== Phase 2: Run all analyses ===')
  for (const [repo, repoId, analyses] of ANALYSIS_PLAN) {
    if (!repoId) { console.log(`  skip ${repo} (no repoId)`); continue }
    console.log(`\n── ${repo} (id=${repoId}) ──`)
    for (const type of analyses) {
      const extra = type === 'analyze_entities' || type === 'analyze_apis'
        ? { forceReanalysis: true } : {}
      const ok = await runAnalysis(type, repoId, repo, extra)
      results.push({ repo, type, ok })
    }
  }

  console.log('\n=== Summary ===')
  const failed = results.filter(r => !r.ok)
  const passed = results.filter(r => r.ok)
  console.log(`Passed: ${passed.length}  Failed: ${failed.length}`)
  if (failed.length) {
    console.log('\nFailures:')
    failed.forEach(f => console.log(`  ✗ ${f.type} ${f.repo}`))
  }
}

main().catch(console.error)
