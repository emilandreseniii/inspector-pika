# Inspector Pika — Test Plan

## 1. Overview

This document covers the full test strategy for Inspector Pika: manual feature checklists for every page, the GitHub repositories used to exercise each analyzer, and the automated E2E test suite.

**App under test:** `http://localhost:5173` (Vite dev server → Express API on `:3000`)
**Test runner:** Playwright (`npm test` from repo root, requires both servers running)
**Unit tests:** Vitest (`cd server && npx vitest run`)

---

## 2. Test Environment

| Item | Value |
|------|-------|
| Base URL | `http://localhost:5173` |
| API URL | `http://localhost:3000/api/v1` |
| Database | PostgreSQL 16 (container `inspector-pika-postgres-1`) |
| Toolchain | Node 20 · Java 17 · Python 3 · Go 1.22 · Rust stable |
| Container start | `podman compose up` |

**Prerequisites before running E2E tests:**
1. Container stack is running (`podman compose up`)
2. A `GITHUB_TOKEN` is set in `.env` (required for org exploration and repo cloning)

---

## 3. Pages and Features

### 3.1 Navigation / App Shell

| # | Feature | Test Type |
|---|---------|-----------|
| N-1 | Loads at `/` and redirects to `/repos` | E2E: `navigation.spec.ts` |
| N-2 | **Explore** nav button switches to Explore view | E2E: `navigation.spec.ts` |
| N-3 | **Jobs** nav button navigates to `/jobs` | E2E: `navigation.spec.ts` |
| N-4 | **Settings** nav button navigates to `/settings` | E2E: `navigation.spec.ts` |
| N-5 | Sub-nav tabs: **Repos**, **Orgs**, **Packages** | E2E: `navigation.spec.ts` |
| N-6 | Unknown routes redirect to `/repos` | E2E: `navigation.spec.ts` |

---

### 3.2 Repos Page (`/repos`)

| # | Feature | Test Type |
|---|---------|-----------|
| R-1 | Repository list renders with table | E2E: `repository-page.spec.ts` |
| R-2 | Search by org (`apache`) narrows list | E2E: `search-and-pagination.spec.ts` |
| R-3 | Search by org/repo (`apache/kafka`) narrows to one | E2E: `search-and-pagination.spec.ts` |
| R-4 | Autocomplete suggestions appear while typing | E2E: `search-and-pagination.spec.ts` |
| R-5 | Clearing search restores full list | E2E: `search-and-pagination.spec.ts` |
| R-6 | **Next**/**Prev** pagination controls work (25 per page) | E2E: `search-and-pagination.spec.ts` |
| R-7 | Clicking a repo row navigates to `/repositories/:id` | E2E: `apache-org.spec.ts` |
| R-8 | **+ Start a Job** button opens modal | E2E: `start-job-modal.spec.ts` |

---

### 3.3 Start A Job Modal

| # | Feature | Test Type |
|---|---------|-----------|
| J-1 | Modal opens from **+ Start a Job** button | E2E: `start-job-modal.spec.ts` |
| J-2 | **Close** / backdrop click dismisses modal | E2E: `start-job-modal.spec.ts` |
| J-3 | **Explore GitHub Repository** option visible | E2E: `start-job-modal.spec.ts` |
| J-4 | **Explore GitHub Organization** option visible | E2E: `start-job-modal.spec.ts` |
| J-5 | Repo form validates `owner/repo` format | E2E: `start-job-modal.spec.ts` |
| J-6 | Org form validates non-empty input | E2E: `start-job-modal.spec.ts` |
| J-7 | Submitting a valid repo closes modal and creates job | E2E: `start-job-modal.spec.ts` |
| J-8 | Submitting a valid org closes modal and creates job | E2E: `apache-org.spec.ts` |

---

### 3.4 Orgs Page (`/orgs`)

| # | Feature | Test Type |
|---|---------|-----------|
| O-1 | Orgs list renders with org names | E2E: `orgs.spec.ts` |
| O-2 | Each org shows repo count | E2E: `orgs.spec.ts` |
| O-3 | Clicking an org navigates to `/orgs/:owner` | E2E: `orgs.spec.ts` |
| O-4 | Org detail page lists that org's repos | E2E: `orgs.spec.ts` |
| O-5 | Clicking a repo in org detail navigates to repo page | E2E: `orgs.spec.ts` |

---

### 3.5 Packages Page (`/packages`)

| # | Feature | Test Type |
|---|---------|-----------|
| P-1 | Packages list renders after at least one dep-analysis job | E2E: `packages.spec.ts` |
| P-2 | Package type badge visible (NPM, Maven, PyPI, etc.) | E2E: `packages.spec.ts` |
| P-3 | Package version count and repo count shown | E2E: `packages.spec.ts` |
| P-4 | Clicking a package opens `/packages/:id` | E2E: `packages.spec.ts` |
| P-5 | Package detail: name, type, homepage URL shown | E2E: `packages.spec.ts` |
| P-6 | Package detail: **Versions** tab lists versions | E2E: `packages.spec.ts` |
| P-7 | Package detail: **Repos** tab lists repos using package | E2E: `packages.spec.ts` |

---

### 3.6 Jobs Page (`/jobs`)

| # | Feature | Test Type |
|---|---------|-----------|
| JL-1 | Jobs list renders with status badges | E2E: (covered by `apache-org.spec.ts`) |
| JL-2 | Filter by org/repo name narrows list | Manual |
| JL-3 | Clicking a job row navigates to `/jobs/:id` | E2E: `job-detail.spec.ts` |
| JL-4 | Newest jobs appear at top | E2E: `apache-org.spec.ts` |

---

### 3.7 Job Detail Page (`/jobs/:id`)

| # | Feature | Test Type |
|---|---------|-----------|
| JD-1 | Job type, status, timing metadata shown | E2E: `job-detail.spec.ts` |
| JD-2 | Input JSON displayed | E2E: `job-detail.spec.ts` |
| JD-3 | Result JSON displayed when `completed` | E2E: `job-detail.spec.ts` |
| JD-4 | Error message shown when `failed` | E2E: `job-detail.spec.ts` |
| JD-5 | Log output section visible | E2E: `job-detail.spec.ts` |
| JD-6 | **Cancel** button visible when job is running | Manual |

---

### 3.8 Repository Detail Page (`/repositories/:id`)

| # | Feature | Test Type |
|---|---------|-----------|
| RD-1 | Repo metadata table (name, branch, visibility) | E2E: `repository-page.spec.ts` |
| RD-2 | **Back** button returns to repos list | E2E: `repository-page.spec.ts` |
| RD-3 | **Start A Job** dropdown has all 4 job types | E2E: `repository-page.spec.ts` |
| RD-4 | **Languages** section with "Not yet run" / timestamp | E2E: `repository-page.spec.ts` |
| RD-5 | Bottom tab: **Packages** | E2E: `repository-page.spec.ts` |
| RD-6 | Bottom tab: **API Surfaces** | E2E: `analyzers.spec.ts` |
| RD-7 | Bottom tab: **Data Entities** | E2E: `analyzers.spec.ts` |
| RD-8 | Language analysis results populate Languages section | E2E: `analyzers.spec.ts` |
| RD-9 | Entity analysis results populate Data Entities tab | E2E: `analyzers.spec.ts` |
| RD-10 | API analysis results populate API Surfaces tab | E2E: `analyzers.spec.ts` |
| RD-11 | Dependency results populate Packages tab | E2E: `analyzers.spec.ts` |

---

### 3.9 Settings Page (`/settings`)

| # | Feature | Test Type |
|---|---------|-----------|
| S-1 | Disk max bytes field pre-populated | E2E: `settings.spec.ts` |
| S-2 | Disk check interval field pre-populated | E2E: `settings.spec.ts` |
| S-3 | **Save** submits updated values | E2E: `settings.spec.ts` |
| S-4 | Disk usage section shows total/used bytes | E2E: `settings.spec.ts` |
| S-5 | Disk cache table lists cloned repos | E2E: `settings.spec.ts` |

---

## 4. Analyzer Coverage by Repository

### 4.1 Strategy

Each analyzer is exercised by cloning a real public GitHub repository and running the full analysis pipeline:

```
explore_github_repo  →  analyze_languages  →  analyze_entities + analyze_apis
```

`analyze_dependencies` (ORT) is excluded from the standard CI run due to 10–60 min runtime per repo; it is run manually or in a dedicated nightly suite.

### 4.2 Repository Selection Matrix

One repository per language family covers the majority of analyzers for that language. Where a single repo covers multiple frameworks it is marked with all of them.

---

#### TypeScript / JavaScript

| Repository | Entity Analyzers Expected | API Analyzers Expected |
|------------|--------------------------|------------------------|
| `prisma/prisma-examples` | Prisma, TypeORM, Mongoose, Drizzle, Sequelize | Express, Fastify, NestJS, Koa |
| `trpc/trpc` | — | tRPC |
| `vercel/next.js` | — | Next.js |
| `honojs/hono` | — | Hono |

Primary test repo: **`prisma/prisma-examples`** — exercises the widest range of TS analyzers in a single clone.

---

#### Python

| Repository | Entity Analyzers Expected | API Analyzers Expected |
|------------|--------------------------|------------------------|
| `tiangolo/fastapi` | SQLAlchemy, SQLModel | FastAPI, Starlette |
| `django/django` | Django ORM | Django REST Framework |
| `pallets/flask` | SQLAlchemy | Flask |
| `huge-success/sanic` | SQLAlchemy | Sanic |
| `aio-libs/aiohttp` | SQLAlchemy | aiohttp |
| `tortoise/tortoise-orm` | Tortoise ORM | — |
| `roman-right/beanie` | Beanie | — |
| `coleifer/peewee` | Peewee | — |

Primary test repo: **`tiangolo/fastapi`** — covers FastAPI + Starlette APIs and SQLAlchemy entities.

---

#### Go

| Repository | Entity Analyzers Expected | API Analyzers Expected |
|------------|--------------------------|------------------------|
| `gin-gonic/gin` | GORM (examples) | Gin |
| `go-chi/chi` | sqlc (examples) | Chi |
| `labstack/echo` | — | Echo |
| `gofiber/fiber` | — | Fiber |
| `gorilla/mux` | — | Gorilla Mux |
| `ent/ent` | Ent | — |
| `volatiletech/sqlboiler` | SQLBoiler | — |
| `uptrace/bun` | Bun ORM | — |
| `kyleconroy/sqlc` | sqlc | — |

Primary test repo: **`gin-gonic/gin`** — exercises Gin API analyzer; GORM entities appear in examples.

---

#### Java

| Repository | Entity Analyzers Expected | API Analyzers Expected |
|------------|--------------------------|------------------------|
| `spring-projects/spring-petclinic` | JPA/Hibernate, Spring Data JDBC | Spring MVC |
| `jooq/jOOQ` | jOOQ | — |
| `mybatis/mybatis-3` | MyBatis | — |
| `micronaut-projects/micronaut-core` | JPA/Hibernate | Micronaut |
| `eclipse-vertx/vert.x` | — | Vert.x Web |
| `Netflix/dgs-framework` | — | Netflix DGS |

Primary test repo: **`spring-projects/spring-petclinic`** — canonical Spring MVC + JPA example.

---

#### Kotlin

| Repository | Entity Analyzers Expected | API Analyzers Expected |
|------------|--------------------------|------------------------|
| `JetBrains/Exposed` | Exposed | — |
| `ctripcorp/kotlin-exposed-starter` | Exposed | Ktor |
| `ktorio/ktor` | Ktorm (examples) | Ktor |
| `kotlin-orm/ktorm` | Ktorm | — |

Primary test repo: **`ktorio/ktor`** — exercises Ktor API and includes ORM examples.

---

#### Ruby

| Repository | Entity Analyzers Expected | API Analyzers Expected |
|------------|--------------------------|------------------------|
| `rails/rails` | ActiveRecord, Sequel | Rails Routes |
| `sinatra/sinatra` | — | Sinatra |
| `ruby-grape/grape` | — | Grape |
| `mongoid/mongoid` | Mongoid | — |
| `rom-rb/rom` | ROM | — |
| `jeremyevans/sequel` | Sequel | — |

Primary test repo: **`sinatra/sinatra`** — small, fast to clone; exercises Sinatra API analyzer.
Secondary repo: **`rails/rails`** — exercises ActiveRecord entity and Rails Routes API analyzers.

---

#### Rust

| Repository | Entity Analyzers Expected | API Analyzers Expected |
|------------|--------------------------|------------------------|
| `tokio-rs/axum` | SQLx (examples) | Axum |
| `actix/actix-web` | — | Actix Web |
| `SergioBenitez/Rocket` | — | Rocket |
| `poem-web/poem` | — | Poem |
| `seanmonstar/warp` | — | Warp |
| `diesel-rs/diesel` | Diesel | — |
| `SeaQL/sea-orm` | SeaORM | — |
| `launchbadge/sqlx` | SQLx | — |

Primary test repo: **`tokio-rs/axum`** — exercises Axum API and SQLx entity analyzers.

---

#### PHP

| Repository | Entity Analyzers Expected | API Analyzers Expected |
|------------|--------------------------|------------------------|
| `laravel/laravel` | Eloquent | Laravel |
| `symfony/symfony` | Doctrine | Symfony |
| `slimphp/Slim` | — | Slim |
| `illuminate/database` | Eloquent | — |
| `doctrine/orm` | Doctrine | — |
| `propelorm/propel` | Propel | — |
| `cycle/orm` | Cycle ORM | — |

Primary test repo: **`laravel/laravel`** — covers Eloquent entity and Laravel API analyzers.

---

#### Scala

| Repository | Entity Analyzers Expected | API Analyzers Expected |
|------------|--------------------------|------------------------|
| `slick/slick` | Slick | — |
| `tpolecat/doobie` | Doobie | — |
| `getquill/quill` | Quill | — |
| `playframework/playframework` | Slick | Play |
| `akka/akka-http` | — | Akka HTTP |
| `http4s/http4s` | — | http4s |

Primary test repo: **`playframework/playframework`** — covers Play API and Slick entity analyzers.

---

#### Elixir

| Repository | Entity Analyzers Expected | API Analyzers Expected |
|------------|--------------------------|------------------------|
| `phoenixframework/phoenix` | Ecto | Phoenix |
| `elixir-ecto/ecto` | Ecto | — |
| `elixir-plug/plug` | — | Plug Router |

Primary test repo: **`phoenixframework/phoenix`** — covers Phoenix API and Ecto entity analyzers.

---

#### C#

| Repository | Entity Analyzers Expected | API Analyzers Expected |
|------------|--------------------------|------------------------|
| `dotnet/eShopOnWeb` | EF Core, Dapper | ASP.NET Core, Minimal API |
| `dotnet/efcore` | EF Core | — |
| `NHibernate/NHibernate-Core` | NHibernate | — |
| `dotnet/aspnetcore` | EF Core | ASP.NET Core, gRPC |

Primary test repo: **`dotnet/eShopOnWeb`** — small reference app covering EF Core + ASP.NET Core.

---

#### Swift

| Repository | Entity Analyzers Expected | API Analyzers Expected |
|------------|--------------------------|------------------------|
| `vapor/vapor` | Fluent | Vapor |
| `vapor/fluent-kit` | Fluent | — |
| `hummingbird-project/hummingbird` | — | Hummingbird |
| `groue/GRDB.swift` | GRDB | — |

Primary test repo: **`vapor/vapor`** — covers Vapor API and Fluent entity analyzers.

---

#### Cross-Language / Shared Analyzers

| Analyzer | Repository | Notes |
|----------|-----------|-------|
| **gRPC Proto** (API) | `grpc/grpc-go` | Rich .proto files |
| **Proto Messages** (entity) | `grpc/grpc-go` | Same repo |
| **GraphQL Schema** (API) | `graphql/graphql-js` | Schema definition files |
| **OpenAPI / Swagger** (API) | `OAI/OpenAPI-Specification` | YAML/JSON spec files |
| **Thrift IDL** (API) | `apache/thrift` | .thrift definition files |
| **SQL DDL** (entity) | `spring-projects/spring-petclinic` | SQL migration files |
| **Migration Files** (entity) | `prisma/prisma-examples` | Migration SQL files |

---

## 5. E2E Test Files

| File | Coverage |
|------|----------|
| `e2e/navigation.spec.ts` | App routing and nav links |
| `e2e/start-job-modal.spec.ts` | Job creation modal UI |
| `e2e/apache-org.spec.ts` | Org exploration workflow |
| `e2e/repository-page.spec.ts` | Repository detail page features |
| `e2e/search-and-pagination.spec.ts` | Search and pagination |
| `e2e/settings.spec.ts` | Settings page |
| `e2e/packages.spec.ts` | Packages list and detail pages |
| `e2e/orgs.spec.ts` | Orgs list and detail pages |
| `e2e/job-detail.spec.ts` | Job detail page |
| `e2e/analyzers.spec.ts` | Full analysis pipeline per language family |
| `e2e/helpers/analysis.ts` | Shared helpers for job submission and polling |

---

## 6. Test Execution

### Quick smoke run (UI only, no analysis)
```bash
npm test -- --grep "Navigation|Repository detail|Search|Settings|Packages|Orgs|Job detail"
```

### Full UI + lightweight analysis (language detection only)
```bash
npm test -- --grep "navigation|start-job|repository-page|search|settings|packages|orgs|job-detail"
```

### Full analyzer suite (slow — 2–4 hours for all repos)
```bash
npm test -- e2e/analyzers.spec.ts
```

### Single language
```bash
npm test -- --grep "Python analyzers"
```

### Dependency analysis only (very slow, run nightly)
```bash
npm test -- --grep "dependency"
```
