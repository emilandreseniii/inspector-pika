# Inspector Pika

A GitHub repository explorer that helps you understand any repo at a glance.

## What it does

- **Dependency analysis** — detect all packages a repo depends on using [ORT](https://github.com/oss-review-toolkit/ort)
- **Language detection** — identify programming languages using [enry](https://github.com/go-enry/enry)
- **Repo exploration** — browse and search repositories for a GitHub user or org
- **Job queue** — long-running analyses run as background jobs with live status polling
- **Persistent cache** — explored repos and analysis results are stored in PostgreSQL

## Tech Stack

| Layer     | Technology                          |
|-----------|-------------------------------------|
| Frontend  | React, TypeScript, Vite             |
| Backend   | Express, TypeScript                 |
| Database  | PostgreSQL + Drizzle ORM            |
| GitHub    | Octokit (GitHub REST API)           |
| Dep scan  | ORT (OSS Review Toolkit) v83        |
| Lang scan | enry v1.2.0                         |

## Getting Started

### Prerequisites
- Node.js 20+
- PostgreSQL (running and accessible)
- A GitHub personal access token (for higher API rate limits)
- Java 17+ (required by ORT)
- `yarn` globally installed (`npm install -g yarn`) — required by ORT for Node.js projects

### Install & run

```bash
# Install dependencies
npm install

# Copy env template and fill in your values
cp .env.example .env

# Push schema to the database
npm run db:migrate

# Start dev servers (client + server)
npm run dev
```

The app will be available at `http://localhost:5173` (frontend) and the API at `http://localhost:3000`.

## Environment Variables

| Variable       | Description                                                   |
|----------------|---------------------------------------------------------------|
| `GITHUB_TOKEN` | GitHub personal access token                                  |
| `DATABASE_URL` | PostgreSQL connection string (e.g. `postgresql://user:pw@localhost:5432/inspector_pika`) |
| `PORT`         | Express server port (default: `3000`)                         |

## Project Structure

```
inspector-pika/
  client/          # React + Vite frontend
  server/          # Express API backend
    src/
      routes/      # API endpoints
      services/    # GitHub API, ORT, enry, job runner
      db/          # Drizzle schema
  shared/          # Zod schemas + TypeScript types (used by both client and server)
  tools/           # Downloaded analysis tools (ORT, enry) — not committed to git
  data/            # Cloned repos and analysis output — not committed to git
  e2e/             # Playwright end-to-end tests
```
