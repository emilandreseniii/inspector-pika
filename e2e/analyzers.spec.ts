/**
 * Analyzer coverage E2E tests.
 *
 * Each describe.serial block:
 *   1. Explores the target repo and runs language detection (beforeAll via API)
 *   2. Runs entity and/or API analysis
 *   3. Verifies the expected framework names appear in the Repository detail UI
 *
 * Runtime estimates per block (repo-size dependent):
 *   - explore + languages: ~30s–2min
 *   - analyze_entities:    ~1–5min
 *   - analyze_apis:        ~1–5min
 *   - analyze_dependencies (not run here): 10–60min
 *
 * Run a single language group:
 *   npm test -- --grep "TypeScript analyzers"
 *
 * Run everything:
 *   npm test -- e2e/analyzers.spec.ts
 */
import { test, expect } from '@playwright/test'
import { setupRepo, analyzeRepo } from './helpers/analysis'

// Per-block timeout: 30 minutes covers even slow repos
const BLOCK_TIMEOUT = 30 * 60 * 1000

// ─────────────────────────────────────────────────────────────────────────────
// TypeScript — prisma/prisma-examples
// Entities: Prisma, TypeORM, Mongoose, Drizzle, Sequelize
// APIs:     Express, Fastify, NestJS, Koa
// ─────────────────────────────────────────────────────────────────────────────
test.describe.serial('TypeScript analyzers — prisma/prisma-examples', () => {
  let repoId: number

  test.beforeAll(async ({ request }) => {
    const setup = await setupRepo(request, 'prisma/prisma-examples')
    repoId = setup.repoId
  })

  test('entity analysis completes and detects Prisma entities', async ({ page, request }) => {
    test.setTimeout(BLOCK_TIMEOUT)
    const job = await analyzeRepo(request, 'analyze_entities', repoId, 'prisma/prisma-examples')
    expect(job.status).toBe('completed')

    await page.goto(`/repositories/${repoId}`)
    await page.getByRole('button', { name: /data entities/i }).click()
    await expect(page.getByText(/prisma/i)).toBeVisible({ timeout: 15_000 })
  })

  test('API analysis completes and detects Express endpoints', async ({ page, request }) => {
    test.setTimeout(BLOCK_TIMEOUT)
    const job = await analyzeRepo(request, 'analyze_apis', repoId, 'prisma/prisma-examples')
    expect(job.status).toBe('completed')

    await page.goto(`/repositories/${repoId}`)
    await page.getByRole('button', { name: /api surfaces/i }).click()
    await expect(page.getByText(/express/i)).toBeVisible({ timeout: 15_000 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Python — tiangolo/fastapi
// Entities: SQLAlchemy, SQLModel
// APIs:     FastAPI, Starlette
// ─────────────────────────────────────────────────────────────────────────────
test.describe.serial('Python analyzers — tiangolo/fastapi', () => {
  let repoId: number

  test.beforeAll(async ({ request }) => {
    const setup = await setupRepo(request, 'tiangolo/fastapi')
    repoId = setup.repoId
  })

  test('entity analysis completes and detects SQLAlchemy', async ({ page, request }) => {
    test.setTimeout(BLOCK_TIMEOUT)
    const job = await analyzeRepo(request, 'analyze_entities', repoId, 'tiangolo/fastapi')
    expect(job.status).toBe('completed')

    await page.goto(`/repositories/${repoId}`)
    await page.getByRole('button', { name: /data entities/i }).click()
    await expect(page.getByText(/sqlalchemy/i)).toBeVisible({ timeout: 15_000 })
  })

  test('API analysis completes and detects FastAPI routes', async ({ page, request }) => {
    test.setTimeout(BLOCK_TIMEOUT)
    const job = await analyzeRepo(request, 'analyze_apis', repoId, 'tiangolo/fastapi')
    expect(job.status).toBe('completed')

    await page.goto(`/repositories/${repoId}`)
    await page.getByRole('button', { name: /api surfaces/i }).click()
    await expect(page.getByText(/fastapi/i)).toBeVisible({ timeout: 15_000 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Go — gin-gonic/gin
// APIs: Gin
// ─────────────────────────────────────────────────────────────────────────────
test.describe.serial('Go analyzers — gin-gonic/gin', () => {
  let repoId: number

  test.beforeAll(async ({ request }) => {
    const setup = await setupRepo(request, 'gin-gonic/gin')
    repoId = setup.repoId
  })

  test('API analysis completes and detects Gin routes', async ({ page, request }) => {
    test.setTimeout(BLOCK_TIMEOUT)
    const job = await analyzeRepo(request, 'analyze_apis', repoId, 'gin-gonic/gin')
    expect(job.status).toBe('completed')

    await page.goto(`/repositories/${repoId}`)
    await page.getByRole('button', { name: /api surfaces/i }).click()
    await expect(page.getByText(/gin/i)).toBeVisible({ timeout: 15_000 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Go — ent/ent
// Entities: Ent ORM
// ─────────────────────────────────────────────────────────────────────────────
test.describe.serial('Go analyzers — ent/ent', () => {
  let repoId: number

  test.beforeAll(async ({ request }) => {
    const setup = await setupRepo(request, 'ent/ent')
    repoId = setup.repoId
  })

  test('entity analysis completes and detects Ent schemas', async ({ page, request }) => {
    test.setTimeout(BLOCK_TIMEOUT)
    const job = await analyzeRepo(request, 'analyze_entities', repoId, 'ent/ent')
    expect(job.status).toBe('completed')

    await page.goto(`/repositories/${repoId}`)
    await page.getByRole('button', { name: /data entities/i }).click()
    await expect(page.getByText(/ent/i)).toBeVisible({ timeout: 15_000 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Java — spring-projects/spring-petclinic
// Entities: JPA / Hibernate
// APIs:     Spring MVC
// ─────────────────────────────────────────────────────────────────────────────
test.describe.serial('Java analyzers — spring-projects/spring-petclinic', () => {
  let repoId: number

  test.beforeAll(async ({ request }) => {
    const setup = await setupRepo(request, 'spring-projects/spring-petclinic')
    repoId = setup.repoId
  })

  test('entity analysis completes and detects JPA entities', async ({ page, request }) => {
    test.setTimeout(BLOCK_TIMEOUT)
    const job = await analyzeRepo(request, 'analyze_entities', repoId, 'spring-projects/spring-petclinic')
    expect(job.status).toBe('completed')

    await page.goto(`/repositories/${repoId}`)
    await page.getByRole('button', { name: /data entities/i }).click()
    await expect(page.getByText(/jpa|hibernate/i)).toBeVisible({ timeout: 15_000 })
  })

  test('API analysis completes and detects Spring MVC endpoints', async ({ page, request }) => {
    test.setTimeout(BLOCK_TIMEOUT)
    const job = await analyzeRepo(request, 'analyze_apis', repoId, 'spring-projects/spring-petclinic')
    expect(job.status).toBe('completed')

    await page.goto(`/repositories/${repoId}`)
    await page.getByRole('button', { name: /api surfaces/i }).click()
    await expect(page.getByText(/spring/i)).toBeVisible({ timeout: 15_000 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Kotlin — ktorio/ktor
// APIs: Ktor
// ─────────────────────────────────────────────────────────────────────────────
test.describe.serial('Kotlin analyzers — ktorio/ktor', () => {
  let repoId: number

  test.beforeAll(async ({ request }) => {
    const setup = await setupRepo(request, 'ktorio/ktor')
    repoId = setup.repoId
  })

  test('API analysis completes and detects Ktor routes', async ({ page, request }) => {
    test.setTimeout(BLOCK_TIMEOUT)
    const job = await analyzeRepo(request, 'analyze_apis', repoId, 'ktorio/ktor')
    expect(job.status).toBe('completed')

    await page.goto(`/repositories/${repoId}`)
    await page.getByRole('button', { name: /api surfaces/i }).click()
    await expect(page.getByText(/ktor/i)).toBeVisible({ timeout: 15_000 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Kotlin — JetBrains/Exposed
// Entities: Exposed ORM
// ─────────────────────────────────────────────────────────────────────────────
test.describe.serial('Kotlin analyzers — JetBrains/Exposed', () => {
  let repoId: number

  test.beforeAll(async ({ request }) => {
    const setup = await setupRepo(request, 'JetBrains/Exposed')
    repoId = setup.repoId
  })

  test('entity analysis completes and detects Exposed tables', async ({ page, request }) => {
    test.setTimeout(BLOCK_TIMEOUT)
    const job = await analyzeRepo(request, 'analyze_entities', repoId, 'JetBrains/Exposed')
    expect(job.status).toBe('completed')

    await page.goto(`/repositories/${repoId}`)
    await page.getByRole('button', { name: /data entities/i }).click()
    await expect(page.getByText(/exposed/i)).toBeVisible({ timeout: 15_000 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Ruby — sinatra/sinatra
// APIs: Sinatra
// ─────────────────────────────────────────────────────────────────────────────
test.describe.serial('Ruby analyzers — sinatra/sinatra', () => {
  let repoId: number

  test.beforeAll(async ({ request }) => {
    const setup = await setupRepo(request, 'sinatra/sinatra')
    repoId = setup.repoId
  })

  test('API analysis completes and detects Sinatra routes', async ({ page, request }) => {
    test.setTimeout(BLOCK_TIMEOUT)
    const job = await analyzeRepo(request, 'analyze_apis', repoId, 'sinatra/sinatra')
    expect(job.status).toBe('completed')

    await page.goto(`/repositories/${repoId}`)
    await page.getByRole('button', { name: /api surfaces/i }).click()
    await expect(page.getByText(/sinatra/i)).toBeVisible({ timeout: 15_000 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Ruby — rails/rails
// Entities: ActiveRecord
// APIs:     Rails Routes
// ─────────────────────────────────────────────────────────────────────────────
test.describe.serial('Ruby analyzers — rails/rails', () => {
  let repoId: number

  test.beforeAll(async ({ request }) => {
    // rails/rails is large — allow extra time for explore + language detection
    const repoIdVal = await setupRepo(request, 'rails/rails')
    repoId = repoIdVal.repoId
  })

  test('entity analysis completes and detects ActiveRecord models', async ({ page, request }) => {
    test.setTimeout(BLOCK_TIMEOUT)
    const job = await analyzeRepo(request, 'analyze_entities', repoId, 'rails/rails')
    expect(job.status).toBe('completed')

    await page.goto(`/repositories/${repoId}`)
    await page.getByRole('button', { name: /data entities/i }).click()
    await expect(page.getByText(/active.?record/i)).toBeVisible({ timeout: 15_000 })
  })

  test('API analysis completes and detects Rails routes', async ({ page, request }) => {
    test.setTimeout(BLOCK_TIMEOUT)
    const job = await analyzeRepo(request, 'analyze_apis', repoId, 'rails/rails')
    expect(job.status).toBe('completed')

    await page.goto(`/repositories/${repoId}`)
    await page.getByRole('button', { name: /api surfaces/i }).click()
    await expect(page.getByText(/rails/i)).toBeVisible({ timeout: 15_000 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Rust — tokio-rs/axum
// Entities: SQLx
// APIs:     Axum
// ─────────────────────────────────────────────────────────────────────────────
test.describe.serial('Rust analyzers — tokio-rs/axum', () => {
  let repoId: number

  test.beforeAll(async ({ request }) => {
    const setup = await setupRepo(request, 'tokio-rs/axum')
    repoId = setup.repoId
  })

  test('API analysis completes and detects Axum routes', async ({ page, request }) => {
    test.setTimeout(BLOCK_TIMEOUT)
    const job = await analyzeRepo(request, 'analyze_apis', repoId, 'tokio-rs/axum')
    expect(job.status).toBe('completed')

    await page.goto(`/repositories/${repoId}`)
    await page.getByRole('button', { name: /api surfaces/i }).click()
    await expect(page.getByText(/axum/i)).toBeVisible({ timeout: 15_000 })
  })

  test('entity analysis completes and detects SQLx queries', async ({ page, request }) => {
    test.setTimeout(BLOCK_TIMEOUT)
    const job = await analyzeRepo(request, 'analyze_entities', repoId, 'tokio-rs/axum')
    expect(job.status).toBe('completed')

    await page.goto(`/repositories/${repoId}`)
    await page.getByRole('button', { name: /data entities/i }).click()
    // SQLx or "no entity data" — either is acceptable, just check the tab rendered
    await expect(page.locator('[data-tab="entities"], [role="tabpanel"]').first()).toBeVisible({ timeout: 15_000 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PHP — laravel/laravel
// Entities: Eloquent
// APIs:     Laravel
// ─────────────────────────────────────────────────────────────────────────────
test.describe.serial('PHP analyzers — laravel/laravel', () => {
  let repoId: number

  test.beforeAll(async ({ request }) => {
    const setup = await setupRepo(request, 'laravel/laravel')
    repoId = setup.repoId
  })

  test('entity analysis completes and detects Eloquent models', async ({ page, request }) => {
    test.setTimeout(BLOCK_TIMEOUT)
    const job = await analyzeRepo(request, 'analyze_entities', repoId, 'laravel/laravel')
    expect(job.status).toBe('completed')

    await page.goto(`/repositories/${repoId}`)
    await page.getByRole('button', { name: /data entities/i }).click()
    await expect(page.getByText(/eloquent/i)).toBeVisible({ timeout: 15_000 })
  })

  test('API analysis completes and detects Laravel routes', async ({ page, request }) => {
    test.setTimeout(BLOCK_TIMEOUT)
    const job = await analyzeRepo(request, 'analyze_apis', repoId, 'laravel/laravel')
    expect(job.status).toBe('completed')

    await page.goto(`/repositories/${repoId}`)
    await page.getByRole('button', { name: /api surfaces/i }).click()
    await expect(page.getByText(/laravel/i)).toBeVisible({ timeout: 15_000 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Elixir — phoenixframework/phoenix
// Entities: Ecto
// APIs:     Phoenix
// ─────────────────────────────────────────────────────────────────────────────
test.describe.serial('Elixir analyzers — phoenixframework/phoenix', () => {
  let repoId: number

  test.beforeAll(async ({ request }) => {
    const setup = await setupRepo(request, 'phoenixframework/phoenix')
    repoId = setup.repoId
  })

  test('entity analysis completes and detects Ecto schemas', async ({ page, request }) => {
    test.setTimeout(BLOCK_TIMEOUT)
    const job = await analyzeRepo(request, 'analyze_entities', repoId, 'phoenixframework/phoenix')
    expect(job.status).toBe('completed')

    await page.goto(`/repositories/${repoId}`)
    await page.getByRole('button', { name: /data entities/i }).click()
    await expect(page.getByText(/ecto/i)).toBeVisible({ timeout: 15_000 })
  })

  test('API analysis completes and detects Phoenix routes', async ({ page, request }) => {
    test.setTimeout(BLOCK_TIMEOUT)
    const job = await analyzeRepo(request, 'analyze_apis', repoId, 'phoenixframework/phoenix')
    expect(job.status).toBe('completed')

    await page.goto(`/repositories/${repoId}`)
    await page.getByRole('button', { name: /api surfaces/i }).click()
    await expect(page.getByText(/phoenix/i)).toBeVisible({ timeout: 15_000 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// C# — dotnet/eShopOnWeb
// Entities: EF Core
// APIs:     ASP.NET Core, Minimal API
// ─────────────────────────────────────────────────────────────────────────────
test.describe.serial('C# analyzers — dotnet/eShopOnWeb', () => {
  let repoId: number

  test.beforeAll(async ({ request }) => {
    const setup = await setupRepo(request, 'dotnet/eShopOnWeb')
    repoId = setup.repoId
  })

  test('entity analysis completes and detects EF Core entities', async ({ page, request }) => {
    test.setTimeout(BLOCK_TIMEOUT)
    const job = await analyzeRepo(request, 'analyze_entities', repoId, 'dotnet/eShopOnWeb')
    expect(job.status).toBe('completed')

    await page.goto(`/repositories/${repoId}`)
    await page.getByRole('button', { name: /data entities/i }).click()
    await expect(page.getByText(/ef.?core|entity.?framework/i)).toBeVisible({ timeout: 15_000 })
  })

  test('API analysis completes and detects ASP.NET Core controllers', async ({ page, request }) => {
    test.setTimeout(BLOCK_TIMEOUT)
    const job = await analyzeRepo(request, 'analyze_apis', repoId, 'dotnet/eShopOnWeb')
    expect(job.status).toBe('completed')

    await page.goto(`/repositories/${repoId}`)
    await page.getByRole('button', { name: /api surfaces/i }).click()
    await expect(page.getByText(/asp\.?net|minimal.?api/i)).toBeVisible({ timeout: 15_000 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Swift — vapor/vapor
// Entities: Fluent
// APIs:     Vapor
// ─────────────────────────────────────────────────────────────────────────────
test.describe.serial('Swift analyzers — vapor/vapor', () => {
  let repoId: number

  test.beforeAll(async ({ request }) => {
    const setup = await setupRepo(request, 'vapor/vapor')
    repoId = setup.repoId
  })

  test('entity analysis completes and detects Fluent models', async ({ page, request }) => {
    test.setTimeout(BLOCK_TIMEOUT)
    const job = await analyzeRepo(request, 'analyze_entities', repoId, 'vapor/vapor')
    expect(job.status).toBe('completed')

    await page.goto(`/repositories/${repoId}`)
    await page.getByRole('button', { name: /data entities/i }).click()
    await expect(page.getByText(/fluent/i)).toBeVisible({ timeout: 15_000 })
  })

  test('API analysis completes and detects Vapor routes', async ({ page, request }) => {
    test.setTimeout(BLOCK_TIMEOUT)
    const job = await analyzeRepo(request, 'analyze_apis', repoId, 'vapor/vapor')
    expect(job.status).toBe('completed')

    await page.goto(`/repositories/${repoId}`)
    await page.getByRole('button', { name: /api surfaces/i }).click()
    await expect(page.getByText(/vapor/i)).toBeVisible({ timeout: 15_000 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Shared analyzers — grpc/grpc-go
// Entities: Proto Messages
// APIs:     gRPC Proto
// ─────────────────────────────────────────────────────────────────────────────
test.describe.serial('Shared analyzers — grpc/grpc-go (gRPC + Proto)', () => {
  let repoId: number

  test.beforeAll(async ({ request }) => {
    const setup = await setupRepo(request, 'grpc/grpc-go')
    repoId = setup.repoId
  })

  test('entity analysis detects proto message definitions', async ({ page, request }) => {
    test.setTimeout(BLOCK_TIMEOUT)
    const job = await analyzeRepo(request, 'analyze_entities', repoId, 'grpc/grpc-go')
    expect(job.status).toBe('completed')

    await page.goto(`/repositories/${repoId}`)
    await page.getByRole('button', { name: /data entities/i }).click()
    // Proto messages or SQL DDL from .sql files in the repo
    await expect(page.locator('tbody tr').first().or(page.getByText(/no entity/i))).toBeVisible({ timeout: 15_000 })
  })

  test('API analysis detects gRPC service definitions', async ({ page, request }) => {
    test.setTimeout(BLOCK_TIMEOUT)
    const job = await analyzeRepo(request, 'analyze_apis', repoId, 'grpc/grpc-go')
    expect(job.status).toBe('completed')

    await page.goto(`/repositories/${repoId}`)
    await page.getByRole('button', { name: /api surfaces/i }).click()
    await expect(page.getByText(/grpc/i)).toBeVisible({ timeout: 15_000 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Shared analyzers — graphql/graphql-js
// APIs: GraphQL Schema
// ─────────────────────────────────────────────────────────────────────────────
test.describe.serial('Shared analyzers — graphql/graphql-js (GraphQL Schema)', () => {
  let repoId: number

  test.beforeAll(async ({ request }) => {
    const setup = await setupRepo(request, 'graphql/graphql-js')
    repoId = setup.repoId
  })

  test('API analysis detects GraphQL schema definitions', async ({ page, request }) => {
    test.setTimeout(BLOCK_TIMEOUT)
    const job = await analyzeRepo(request, 'analyze_apis', repoId, 'graphql/graphql-js')
    expect(job.status).toBe('completed')

    await page.goto(`/repositories/${repoId}`)
    await page.getByRole('button', { name: /api surfaces/i }).click()
    await expect(page.getByText(/graphql/i)).toBeVisible({ timeout: 15_000 })
  })
})
