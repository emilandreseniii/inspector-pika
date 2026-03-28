# Inspector Pika — Agent Instructions

## Project Overview
Inspector Pika is a GitHub repository explorer built with TypeScript, React, and Express. Users can explore repos for a GitHub user or org, then run background analysis jobs to detect dependencies (via ORT) or programming languages (via enry).

## Stack
- **Frontend**: React + TypeScript (Vite) — served at `localhost:5173` in dev
- **Backend**: Express + TypeScript — served at `localhost:3000` in dev
- **Database**: PostgreSQL via Drizzle ORM (`drizzle-kit push` — no migration files)
- **GitHub data**: GitHub REST API (Octokit)
- **Validation**: Zod (schemas defined in `shared/`, used by both client and server)
- **Dep analysis**: ORT (OSS Review Toolkit) v83 — `tools/ort/ort-83.0.0/` (not in git)
- **Lang detection**: enry v1.2.0 — `tools/enry/enry.exe` (not in git)

## Project Structure
```
inspector-pika/
  client/              # React frontend (Vite + TypeScript)
    src/
      App.tsx          # Root component + routing
      pages/           # RepositoryPage.tsx, MainPage.tsx
      components/      # ExploreTab, JobsTab, StartJobModal, etc.
  server/              # Express backend (TypeScript)
    src/
      index.ts         # Server entry point
      routes/          # repositories.ts, jobs.ts (thin handlers)
      services/        # github.ts, jobRunner.ts, ortAnalyzer.ts, enryAnalyzer.ts
      db/              # schema.ts (Drizzle), index.ts (db client)
      middleware/      # errorHandler.ts
    drizzle.config.ts
  shared/              # @inspector-pika/shared — Zod schemas + inferred TS types
    src/index.ts       # All schemas: Repository, Job, RepoPackage, RepoLanguage, etc.
  tools/               # Downloaded binaries — not in git (add to .gitignore)
  data/                # Cloned repos + ORT output — not in git (add to .gitignore)
  e2e/                 # Playwright end-to-end tests
  .env.example         # Required environment variables
```

## API Routes
All routes are prefixed `/api/v1`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/repositories` | List all repositories |
| GET | `/repositories/:id` | Get a single repository |
| GET | `/repositories/:id/packages` | ORT-detected packages for a repo |
| GET | `/repositories/:id/languages` | enry-detected languages for a repo (includes `analyzed: bool`) |
| GET | `/jobs` | List all jobs |
| GET | `/jobs/:id` | Get a single job (for status polling) |
| POST | `/jobs` | Create and immediately start a job |

## Job Types
Defined in `shared/src/index.ts` as a Zod discriminated union (`CreateJobSchema`):

| type | Input fields | What it does |
|------|-------------|--------------|
| `explore_github_repo` | `repo: "owner/name"` | Fetches repo metadata from GitHub and upserts into `repositories` |
| `explore_github_org` | `org: string` | Fetches all repos for a GitHub org |
| `analyze_dependencies` | `repoId`, `repo` | Clones repo, runs ORT analyze, stores results in `repoPackages` |
| `analyze_languages` | `repoId`, `repo` | Clones repo, runs enry, stores results in `repoLanguages` |

Jobs are created via `POST /jobs`, run immediately (non-blocking), and polled via `GET /jobs/:id`.

## Conventions
- Use TypeScript strict mode throughout
- Use Drizzle ORM for all database access — no raw SQL
- Keep route handlers thin; put logic in `services/`
- All GitHub API calls go through `server/src/services/github.ts`
- Shared Zod schemas live in `shared/src/index.ts` — import from `@inspector-pika/shared`
- All API responses follow `{ data: T }` on success and `{ error: string }` on failure
- `shared/` must be built (`npm run build --workspace=shared`) before server/client can use it in CI

## Local Development Setup
```bash
# 1. Copy and fill in env (PostgreSQL must be running)
cp .env.example .env

# 2. Install dependencies
npm install

# 3. Push schema to the database
npm run db:migrate

# 4. Start dev servers
npm run dev
```

## Key Implementation Notes
- ORT exits with code 1 when it has unresolved issues but still writes a valid result file — `ortAnalyzer.ts` treats this as a warning, not a failure, as long as `analyzer-result.json` exists
- The `languages` endpoint returns `analyzed: true` if a completed `analyze_languages` job exists for that repo — the client uses this to distinguish "never run" from "run but no languages found"
- `enry` stores percentage×100 as the `bytes` field (e.g. 8311 = 83.11%) since the CLI only reports proportions
- Vite proxies `/api` to `localhost:3000` in dev — no CORS issues in the browser
- `yarn` must be globally installed (`npm install -g yarn`) for ORT to analyze Node.js/Yarn projects
