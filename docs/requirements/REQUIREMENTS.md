# Inspector Pika — Requirements

This is the canonical requirements index. Every planned and implemented feature of Inspector Pika is recorded here. When adding a new feature, add its requirement here first, then design, then implement.

See also the detailed feature requirements:
- [api-analysis-overview.md](api-analysis-overview.md) — API analysis feature requirements
- [entity-analysis-overview.md](entity-analysis-overview.md) — Entity analysis feature requirements

---

## Contents

1. [Purpose & Scope](#1-purpose--scope)
2. [User Roles](#2-user-roles)
3. [Functional Requirements](#3-functional-requirements)
   - [FR-1 Repository Exploration](#fr-1-repository-exploration)
   - [FR-2 Language Detection](#fr-2-language-detection)
   - [FR-3 Dependency Analysis](#fr-3-dependency-analysis)
   - [FR-4 Entity Analysis](#fr-4-entity-analysis)
   - [FR-5 API Analysis](#fr-5-api-analysis)
   - [FR-6 Job Management](#fr-6-job-management)
   - [FR-7 User Interface](#fr-7-user-interface)
   - [FR-8 Organisation Browser](#fr-8-organisation-browser)
   - [FR-9 Package Catalog](#fr-9-package-catalog)
   - [FR-10 Settings](#fr-10-settings)
   - [FR-11 Disk Space Management](#fr-11-disk-space-management)
4. [Non-Functional Requirements](#4-non-functional-requirements)
5. [Constraints & Assumptions](#5-constraints--assumptions)
6. [Glossary](#6-glossary)

---

## 1. Purpose & Scope

Inspector Pika is a GitHub repository analysis tool that helps developers and teams understand any code repository at a glance — without cloning it locally or running the application. It statically analyses source code to answer:

- **What languages** does this repository use?
- **What packages** does it depend on?
- **What data models** does it define?
- **What API surfaces** does it expose?

Results are stored persistently and surfaced through a web UI with background job management.

**In scope:**
- GitHub repository exploration and metadata ingestion
- Static analysis of cloned source code (language detection, dependency scanning, entity extraction, API extraction)
- Background job execution and status tracking
- Web UI for browsing results

**Out of scope:**
- Live application instrumentation or runtime analysis
- Executing or building the analysed code
- Security vulnerability scanning (use ORT's vulnerability features separately)
- Code search / semantic code navigation

---

## 2. User Roles

| Role | Description |
|------|-------------|
| **Developer** | Explores repos and runs analysis jobs to understand a codebase |
| **Tech Lead / Architect** | Reviews entity and API surfaces to assess architectural patterns across multiple repos |
| **Admin / Operator** | Manages the Inspector Pika instance (env config, DB, tool binaries) |

All roles interact through the same web UI. There is no authentication — Inspector Pika is intended for trusted internal use.

---

## 3. Functional Requirements

### FR-1 Repository Exploration

**FR-1.1** The system shall allow a user to explore a single GitHub repository by providing its `owner/repo` path.

**FR-1.2** The system shall allow a user to explore all repositories for a GitHub organisation by providing the organisation name.

**FR-1.3** Repository metadata fetched from GitHub shall include: full name, description, default branch, star count, fork count, visibility (public/private), clone URL, and provider.

**FR-1.4** Repository records shall be upserted on each exploration — re-running an explore job updates metadata rather than creating duplicates.

**FR-1.5** The repository list page shall display all explored repositories sorted by most recently fetched, paginated at 25 per page.

**FR-1.6** The repository list shall support filtering by organisation name or full `owner/repo` path with live suggestions (up to 10 autocomplete matches).

**FR-1.7** Each repository row shall show: full name (as a link to the repository detail page), provider badge, star count, fork count, and last fetched timestamp (relative, e.g. "3 days ago").

**FR-1.8** The system shall support the GitHub provider. The architecture shall be extensible to GitLab and Bitbucket without requiring a rewrite.

---

### FR-2 Language Detection

**FR-2.1** The system shall detect programming languages present in a repository using the `enry` tool (v1.2.0 or compatible).

**FR-2.2** Language results shall record language name and relative code volume (bytes of code).

**FR-2.3** Re-running language analysis shall replace the previous results for that repository.

**FR-2.4** The repository detail page shall display detected languages sorted by code volume descending, with a visual percentage bar.

**FR-2.5** The language analysis status (idle / running / completed / failed) and timestamp of the last completed analysis shall be visible on the repository page.

---

### FR-3 Dependency Analysis

**FR-3.1** The system shall detect all third-party packages a repository depends on using ORT (OSS Review Toolkit) v83 or compatible.

**FR-3.2** Dependency results shall record for each package: identifier, PURL, ecosystem/type (NPM, Maven, PyPI, Go, Cargo, Composer, etc.), namespace, name, version, declared licences, description, and homepage URL.

**FR-3.3** Each dependency shall be flagged as a production or development dependency where determinable.

**FR-3.4** Where available, the GitHub repository URL for the dependency shall be recorded and linked in the UI.

**FR-3.5** Re-running dependency analysis shall upsert packages — new packages are added, existing packages are updated, packages no longer detected are left in place.

**FR-3.6** ORT exit code 1 (unresolved issues with valid result) shall be treated as a warning, not a failure, provided the result file is present.

**FR-3.7** The repository detail page shall display all detected packages with filtering by type and ecosystem.

---

### FR-4 Entity Analysis

See [entity-analysis-overview.md](entity-analysis-overview.md) for full detail.

**FR-4.1** The system shall detect data entities (tables, collections, documents, ORM models) defined in a repository's source code without executing the code.

**FR-4.2** Entity detection shall support a minimum of 30 ORM and database frameworks spanning Java, Python, TypeScript/JavaScript, Go, Kotlin, Ruby, PHP, C#, Rust, Scala, Elixir, and Swift.

**FR-4.3** Detection shall be two-phase: a fast grep-based **detector** identifies which frameworks are present, followed by framework-specific **extractors** that parse source files.

**FR-4.4** Each detected approach shall be assigned a confidence level: `high`, `medium`, or `low`. Only `high` and `medium` confidence approaches shall run extractors by default.

**FR-4.5** Extracted entities shall include: name, normalised name, entity type (table / collection / document / model / type / message), source file, and confidence.

**FR-4.6** Extracted entity fields shall include: name, normalised name, data type, native type, nullability, primary key flag, foreign key flag, unique constraint flag, default value, and ordinal position.

**FR-4.7** Entity relationships (has_many, belongs_to, one_to_one, one_to_many, many_to_many) shall be extracted where detectable.

**FR-4.8** When multiple extractors detect the same entity (same normalised name within a repository), results shall be merged — the entity record is updated and all source locations are preserved in `primarySources`.

**FR-4.9** If entity data already exists for a repository, re-running `analyze_entities` without `forceReanalysis: true` shall skip analysis and return `skipped: true` with the existing entity count.

**FR-4.10** With `forceReanalysis: true`, all existing entity data for the repository shall be deleted before re-analysis.

**FR-4.11** The repository detail page shall display detected approaches (with confidence badges), total entity count, and a filterable entity table. Expanding an entity row shall show its fields.

---

### FR-5 API Analysis

See [api-analysis-overview.md](api-analysis-overview.md) for full detail.

**FR-5.1** The system shall detect API surfaces (HTTP/REST endpoints, GraphQL operations, RPC service methods) defined in a repository's source code without executing the code.

**FR-5.2** API detection shall support a minimum of 40 frameworks across Java, Python, TypeScript/JavaScript, Go, Kotlin, Ruby, PHP, C#, Rust, Scala, Elixir, and Swift.

**FR-5.3** Three API styles shall be supported: `http` (REST/HTTP), `graphql`, and `rpc` (gRPC, Thrift, etc.).

**FR-5.4** Detection shall be two-phase: fast grep-based detector followed by framework-specific extractors. Confidence levels shall be assigned as in FR-4.4.

**FR-5.5** For HTTP endpoints, the system shall extract: HTTP method, path pattern, path parameters, query parameters, request body type, response type, summary, tags, and source location.

**FR-5.6** For GraphQL operations, the system shall extract: operation type (Query / Mutation / Subscription), operation name, arguments, and return type.

**FR-5.7** For RPC methods, the system shall extract: service name, method name, request message type, response message type, streaming mode, and protocol (grpc / thrift / xmlrpc).

**FR-5.8** OpenAPI / Swagger specification files (`.openapi.yaml`, `swagger.json`, etc.) shall be parsed as a cross-language extractor and treated as authoritative when present.

**FR-5.9** Proto (`.proto`) and Thrift (`.thrift`) schema files shall be parsed as cross-language RPC extractors.

**FR-5.10** GraphQL schema files (`.graphql`, `.gql`) shall be parsed as a cross-language GraphQL extractor.

**FR-5.11** Skip and force-reanalysis behaviour shall match FR-4.9 and FR-4.10.

**FR-5.12** The repository detail page shall display detected API approaches, surfaces grouped by style (HTTP / GraphQL / RPC), and expandable operation panels showing full endpoint detail.

---

### FR-6 Job Management

**FR-6.1** All long-running analysis tasks shall execute as background jobs. The HTTP response to a job creation request shall return immediately with the job record in `pending` state.

**FR-6.2** Job status shall follow the lifecycle: `pending` → `running` → `completed` | `failed` | `cancelled`.

**FR-6.3** A job may be cancelled only if its status is `pending` or `running`. Cancelling a terminal-state job shall return HTTP 409.

**FR-6.4** The jobs list page shall show all jobs sorted by creation date (newest first), paginated at 20 per page, with search filtering.

**FR-6.5** Each job row shall show: job ID, descriptive type label, status badge, input (collapsed), result (collapsed, completed only), error (failed only), and timestamps.

**FR-6.6** The job detail page shall show all job fields, a cancel button (if cancellable), and a back link to the jobs list.

**FR-6.7** The repository detail page shall show the current status, last-run timestamp, and an "Analyse" button for each analysis type (Languages, Dependencies, Entities, APIs).

**FR-6.8** Concurrent clone/pull operations for the same repository shall be serialised (per-repository lock) to avoid race conditions on the local clone directory.

**FR-6.9** Job errors shall be captured in the `error` field and displayed in the UI. Analysis jobs that encounter partial extractor failures shall record warnings in the result without failing the overall job.

---

### FR-7 User Interface

**FR-7.1** The application shall be a single-page React application served from `http://localhost:5173` in development.

**FR-7.2** The application header shall contain **Explore** and **Jobs** navigation tabs rendered inside the dark banner bar (not in a separate white nav bar). Active and inactive tab styles shall be adapted for the dark background.

**FR-7.3** Navigation between tabs shall update the browser URL. Explore routes: `/orgs`, `/repos`, `/packages` (and their detail pages). Jobs routes: `/jobs`, `/jobs/:id`. Unknown routes shall redirect to `/repos`.

**FR-7.4** The repository detail page shall be accessible at `/repositories/:id`.

**FR-7.5** The job detail page shall be accessible at `/jobs/:id`.

**FR-7.6** All API requests from the client shall be proxied through Vite to the Express backend at `http://localhost:3000` in development (no CORS configuration required in the browser).

**FR-7.7** Status badges shall use colour coding: pending=grey, running=blue, completed=green, failed=red, cancelled=orange.

**FR-7.8** Timestamps shall display as relative time (e.g. "2 hours ago") with the absolute time available on hover.

**FR-7.9** The "Start a Job" modal shall expose all job types with appropriate input fields and validation.

---

### FR-8 Organisation Browser

**FR-8.1** The **Orgs** sub-tab (under Explore) shall list all distinct repository owners derived from explored repositories, showing the owner name and repository count, sorted alphabetically.

**FR-8.2** Clicking an organisation shall navigate to `/orgs/:owner`, which shows the organisation name, total repository count, and the list of its repositories with the same columns as the Repos list.

**FR-8.3** Repositories on the organisation page shall be clickable links to the repository detail page.

---

### FR-9 Package Catalog

**FR-9.1** The **Packages** sub-tab (under Explore) shall list all distinct packages discovered across all dependency analyses, deduplicated by `(type, namespace, name)`. The list shall show: type badge, namespace/name, description, number of distinct versions, and number of repos using it.

**FR-9.2** Package identity shall be stored in a dedicated `packages` table keyed by `(type, namespace, name)`. This table is populated and updated each time a dependency analysis completes.

**FR-9.3** The `repo_packages` table shall reference `packages.id` via a `canonPackageId` foreign key so that each per-repo package record is linked to its canonical package.

**FR-9.4** Clicking a package shall navigate to `/packages/:id`, which shows the package header (type, namespace, name, description, homepage) and two sub-tabs:
- **Versions** — all distinct versions of this package found across repos, with repo count per version.
- **Repos** — all repositories that depend on this package, showing the repo full name and the version it uses; each row is a link to the repository detail page.

**FR-9.5** The Explore section (Orgs, Repos, Packages) shall show sub-navigation tabs below the header banner on all Explore-section pages, including detail pages, with the appropriate sub-tab active.

---

### FR-10 Settings

**FR-10.1** The application shall provide a **Settings** page accessible via a Settings tab in the main navigation header, alongside Explore and Jobs.

**FR-10.2** Settings shall be persisted in the database (`settings` table, key-value store) so they survive server restarts.

**FR-10.3** The Settings page shall allow the user to configure:
- **Maximum data directory size** (bytes; UI shows GB; default 20 GB)
- **Disk check interval** (minutes; default 10; used for the periodic background check)
- **Check on operation** toggle (boolean; default on) — when enabled, a space check runs before any clone/pull operation

**FR-10.4** Changes to settings shall take effect immediately without a server restart. The periodic interval shall restart with the new value as soon as the setting is saved.

---

### FR-11 Disk Space Management

**FR-11.1** The system shall maintain a **disk cache registry** — a database table (`disk_cache`) that tracks each cached entry's type, path, size in bytes, and last-used timestamp.

**FR-11.2** Two entry types shall be tracked:
- `repo` — a cloned repository directory (`data/repos/<owner>/<name>`)
- `logs` — the job log directory (`data/jobs/`)

**FR-11.3** When a repository is cloned or updated (git clone / git pull), its `disk_cache` entry shall be upserted: the path, size (measured after the operation), and `lastUsedAt` timestamp shall be recorded.

**FR-11.4** When any analysis job runs on a repository (language detection, dependency analysis, entity analysis, API analysis), the repo's `lastUsedAt` shall be updated — even if no clone/pull occurs.

**FR-11.5** A **space check** shall determine the current total disk usage (sum of all `disk_cache` sizes) and compare it to the configured maximum. If usage exceeds the maximum, the system shall evict entries in least-recently-used order until usage falls below the maximum.

**FR-11.6** Evicting a `repo` entry shall delete the repository's clone directory from disk and remove the `disk_cache` row. The repository's metadata and analysis results in the database shall be preserved.

**FR-11.7** The space check shall be triggered in two ways:
- **On operation** (if the setting is enabled): before each `cloneOrUpdate` call, synchronously evict if necessary.
- **Periodically**: a background `setInterval` runs the space check at the configured interval (default 10 minutes). The interval restarts when the setting changes.

**FR-11.8** If a repo's clone directory has been evicted and is needed again, the next clone/pull job shall re-download it transparently.

**FR-11.9** The Settings page shall display a **Disk Usage** panel showing:
- Total tracked usage vs. the configured maximum (progress bar)
- A table of all `disk_cache` entries with: type, key, size (human-readable), and last-used timestamp
- A manual **Run Space Check** button that triggers an immediate eviction pass

**FR-11.10** Disk size shall be computed by recursively summing file sizes in the tracked directory. Size measurements shall be cached in `disk_cache` and refreshed each time an operation touches the directory, not on every read.

---

## 4. Non-Functional Requirements

### Performance

**NFR-P.1** The repository list, job list, and repository detail page shall load within 2 seconds under normal database load.

**NFR-P.2** Language detection (`analyze_languages`) for a typical repository (< 500k files) shall complete within 60 seconds.

**NFR-P.3** Entity and API extractors for a given approach shall run concurrently (parallel `Promise.allSettled`), not sequentially.

**NFR-P.4** Database inserts for large analysis results shall use batch upsert operations.

### Reliability

**NFR-R.1** A job that fails (exception, tool error) shall set status to `failed` and record the error message. The failure of one job shall not affect other jobs.

**NFR-R.2** ORT returning exit code 1 with a valid result file shall not cause a job failure (see FR-3.6).

**NFR-R.3** If a single extractor throws during entity or API analysis, its error shall be recorded as a warning and analysis shall continue with the remaining extractors.

### Security

**NFR-S.1** The GitHub personal access token shall be read from an environment variable (`GITHUB_TOKEN`) and never committed to source control.

**NFR-S.2** The database connection string shall be read from `DATABASE_URL` and never committed.

**NFR-S.3** Inspector Pika is intended for trusted internal networks. It does not implement authentication or authorisation.

### Maintainability

**NFR-M.1** Adding support for a new ORM or API framework shall require only: one new extractor file, one test file, one registry entry, and detection signal additions — no changes to the job runner or persistence layer.

**NFR-M.2** All shared types and Zod validation schemas shall live in the `shared/` workspace and be imported by both server and client.

**NFR-M.3** Unit test coverage shall be maintained for all extractor logic. Each extractor shall have at least one positive test case and one negative (no-match) test case.

---

## 5. Constraints & Assumptions

| # | Constraint / Assumption |
|---|------------------------|
| C-1 | The analysed repository must be cloneable via HTTPS. Private repos require a GitHub token with `repo` scope. |
| C-2 | ORT v83 must be present at `tools/ort/ort-83.0.0/` and `yarn` must be globally installed for ORT to analyse Node.js projects. |
| C-3 | `enry` v1.2.0 must be present at `tools/enry/enry.exe` (Windows) or equivalent. |
| C-4 | PostgreSQL 12+ must be running and accessible via `DATABASE_URL`. |
| C-5 | Node.js 20+ is required. |
| C-6 | Analysis runs on the host machine; there is no sandboxing or containerisation of the cloned repository. |
| C-7 | Inspector Pika reads source code only — it does not execute, build, or install dependencies of the analysed repository. |
| C-8 | The `data/` directory (cloned repos) and `tools/` directory are not committed to source control. |

---

## 6. Glossary

| Term | Definition |
|------|-----------|
| **Approach** | A specific framework or pattern used for data storage or API definition within a repository (e.g. "spring_mvc", "prisma", "grpc_proto") |
| **Confidence** | The certainty with which a framework was detected: `high`, `medium`, or `low` |
| **Detector** | The first analysis phase — fast grep-based scans that identify which approaches are present |
| **Extractor** | The second analysis phase — framework-specific parsers that produce structured `RawEntity` or `RawApiSurface` objects |
| **Entity** | A named data model defined in source code: a database table, ORM model, document schema, Protobuf message, or GraphQL type |
| **API Surface** | A named grouping of related API operations: an HTTP controller, GraphQL schema, or RPC service |
| **Operation / Endpoint** | A single API operation: an HTTP route, GraphQL query/mutation/subscription, or RPC method |
| **Signal** | A file name, directory name, import statement, or code pattern that indicates a particular framework is in use |
| **PURL** | Package URL — a standard identifier for software packages (e.g. `pkg:npm/express@4.18.2`) |
| **ORT** | OSS Review Toolkit — open-source tool for detecting and auditing software dependencies |
| **enry** | A Go-based programming language detection library (used by GitHub Linguist) |
| **forceReanalysis** | A job input flag that bypasses the skip-if-exists check and deletes existing results before re-analysing |
