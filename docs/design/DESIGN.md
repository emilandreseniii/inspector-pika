# Inspector Pika — Design Index

This document is the entry point for all technical design documentation. It describes the high-level architecture and links to detailed design documents for each subsystem.

---

## Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Technology Stack](#2-technology-stack)
3. [Key Design Decisions](#3-key-design-decisions)
4. [Design Documents](#4-design-documents)

---

## 1. Architecture Overview

Inspector Pika is a three-tier web application:

```
┌─────────────────────────────────────────────┐
│  Browser (React + Vite)   localhost:5173     │
│  - Repository list & detail                  │
│  - Job list & detail                         │
│  - Analysis result panels                    │
└───────────────────┬─────────────────────────┘
                    │ HTTP (proxied in dev)
┌───────────────────▼─────────────────────────┐
│  Express API Server           localhost:3000 │
│  /api/v1/repositories                        │
│  /api/v1/jobs                                │
│  /api/v1/repositories/:id/...                │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │  Job Runner (in-process async)       │   │
│  │  - explore_github_repo/org           │   │
│  │  - analyze_languages                 │   │
│  │  - analyze_dependencies              │   │
│  │  - analyze_entities                  │   │
│  │  - analyze_apis                      │   │
│  └───────────────────────────┬──────────┘   │
│                               │              │
│  ┌────────────────────────────▼──────────┐  │
│  │  Analysis Services                    │  │
│  │  ├── entityAnalysis/                  │  │
│  │  │   ├── detector.ts                  │  │
│  │  │   ├── registry.ts                  │  │
│  │  │   ├── extractors/languages/**      │  │
│  │  │   ├── normalizer.ts                │  │
│  │  │   └── deduplicator.ts              │  │
│  │  └── apiAnalysis/                     │  │
│  │      ├── detector.ts                  │  │
│  │      ├── registry.ts                  │  │
│  │      └── extractors/languages/**      │  │
│  └───────────────────────────────────────┘  │
└───────────────────┬─────────────────────────┘
                    │ Drizzle ORM
┌───────────────────▼─────────────────────────┐
│  PostgreSQL                                  │
│  repositories, jobs, repoLanguages,          │
│  repoPackages, repoEntityApproaches,         │
│  repoEntities, repoEntityFields,             │
│  repoEntityRelationships, repoApiApproaches, │
│  repoApiSurfaces, repoApiOps, repoApiOpParams│
└─────────────────────────────────────────────┘

External tools (run as child processes):
  enry      → language detection
  ORT       → dependency scanning
  git       → clone / pull
```

---

## 2. Technology Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | React 18, TypeScript, Vite 6 | SPA, no SSR |
| API Server | Express 4, TypeScript | Thin route handlers |
| Database ORM | Drizzle ORM + drizzle-kit | Schema-first, no migration files — `drizzle-kit push` |
| Database | PostgreSQL 12+ | |
| Validation | Zod (shared workspace) | Schemas shared between client and server |
| GitHub API | Octokit REST | |
| Language detection | enry v1.2.0 | Binary, run as child process |
| Dependency scanning | ORT v83 | Binary, run as child process |
| Unit testing | Vitest 3 | Scoped to `server/src/**` |
| E2E testing | Playwright | Full-stack, `e2e/` directory |

---

## 3. Key Design Decisions

### Two-phase detection + extraction
Analysis is split into a **detector** (fast, grep-based, no AST parsing) and **extractors** (framework-specific parsers). This avoids running expensive parsing on repositories that don't use a given framework. See the individual design docs for signal tables and confidence scoring.

### Extractor registry pattern
Extractors are registered by `language:approach` key. Adding a new framework requires only one new file + one registry entry. The job runner and persistence layer are oblivious to individual extractors.

### Shared Zod schemas
All data shapes are defined once in `shared/src/index.ts` as Zod schemas with inferred TypeScript types. Both the Express server and the React client import from `@inspector-pika/shared`. This eliminates type drift between API and UI.

### In-process job runner
Jobs run as async functions in the same Node.js process as the Express server. This avoids the operational overhead of a separate queue service (Redis, BullMQ, etc.) at the cost of losing in-flight jobs on server restart. Acceptable for a developer tool used internally.

### Drizzle push (no migration files)
The schema is pushed directly to the database with `drizzle-kit push --force`. There are no migration files. This is intentional for a dev tool where schema evolution doesn't require zero-downtime deploys. For a production system, migration files would be added.

### forceReanalysis flag
Entity and API analysis jobs check for existing data and skip if results already exist. Callers must explicitly pass `forceReanalysis: true` to re-run. This prevents accidental data overwrites and keeps job re-runs cheap for repositories that haven't changed.

---

## 4. Design Documents

### Entity Analysis
| Document | Description |
|----------|-------------|
| [entity-extractor-architecture.md](entity-extractor-architecture.md) | Extractor base class, registry, RawEntity types, normaliser and deduplicator |
| [entity-detection-plan.md](entity-detection-plan.md) | Phase 1 — signal tables, confidence scoring, per-language detection rules |
| [entity-database-schema-plan.md](entity-database-schema-plan.md) | Drizzle schema for entity analysis tables |
| [entity-job-plan.md](entity-job-plan.md) | `analyze_entities` job flow, API additions, error handling |
| [entity-ui-plan.md](entity-ui-plan.md) | React component hierarchy and state for the Data Entities section |

### Disk Space Management & Settings
| Document | Description |
|----------|-------------|
| [disk-management.md](disk-management.md) | LRU disk cache, settings store, DiskManager service, Settings page |

### API Analysis
| Document | Description |
|----------|-------------|
| [api-extractor-architecture.md](api-extractor-architecture.md) | Extractor base class, registry, RawApiSurface / RawEndpoint types |
| [api-detection-plan.md](api-detection-plan.md) | Phase 1 — signal tables, confidence scoring, per-language detection rules |
| [api-database-schema-plan.md](api-database-schema-plan.md) | Drizzle schema for API analysis tables |
| [api-job-plan.md](api-job-plan.md) | `analyze_apis` job flow, API additions, error handling |
| [api-ui-plan.md](api-ui-plan.md) | React component hierarchy and state for the API Surfaces section |
