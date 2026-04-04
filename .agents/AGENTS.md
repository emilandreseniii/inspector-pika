# Inspector Pika — Agent & AI Assistant Setup

This directory contains prompt definitions, skill specs, and conventions for AI coding agents working in this repository.

---

## Directory Layout

```
.agents/
  AGENTS.md              # This file — agent overview and conventions
.claude/
  commands/
    inpk-add-tests.md    # Claude Code skill: add missing unit + E2E tests
```

The root `AGENTS.md` contains project context for general-purpose coding agents (Codex, GitHub Copilot Workspace, etc.). This file documents the project-specific agent tooling and workflow conventions built on top of Claude Code.

---

## Skills

Skills are Claude Code slash commands stored in `.claude/commands/`. Invoke them with `/skill-name` in a Claude Code session.

| Skill | Command | Description |
|-------|---------|-------------|
| Add Tests | `/inpk-add-tests` | Inspects all current changes and adds appropriate Vitest unit tests and/or Playwright E2E tests |

---

## Development Workflow

All new features and changes follow **red-green-refactor** and a strict **requirements → design → implementation** sequence:

### 1. Requirements first
Before writing any code, add or update the relevant requirement in `docs/requirements/REQUIREMENTS.md`. Assign it a numbered identifier (e.g. `FR-5.13`). If the feature is large, create or update a feature-level requirements doc in `docs/requirements/`.

### 2. Design next
Add or update a design document in `docs/design/`. For a new extractor this may be a section in an existing architecture doc. For a new subsystem, create a new design doc and link it from `docs/design/DESIGN.md`.

### 3. Red — write failing tests
Write the unit tests (and E2E tests if applicable) **before** writing the implementation. All new tests should fail at this point. Use `/inpk-add-tests` for guidance on the correct patterns.

### 4. Green — implement
Write the minimum implementation needed to make the failing tests pass.

### 5. Refactor
Clean up the implementation — improve naming, remove duplication, simplify logic — while keeping all tests green.

### 6. Pre-commit checks
Run all of the following before committing. Do not commit if any check fails.

---

## Pre-Commit Checklist

Run these from the repo root (or the `server/` directory where indicated):

```bash
# 1. Unit tests — all 530+ must pass
cd server && npx vitest run

# 2. TypeScript type check — zero errors in new/changed files
#    (pre-existing errors in untouched files are acceptable)
cd server && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "node_modules"

# 3. Dependency audit — zero HIGH vulnerabilities
npm audit --audit-level=high

# 4. Confirm no secrets or local config are staged
git diff --cached --name-only | grep -E "\.env$|settings\.local\."
```

If any check fails, fix the issue before committing. Do **not** use `--no-verify` or skip checks.

### Commit format

```
<imperative subject line, ≤72 chars>

<optional body — explain the why, not the what>

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

Examples of good subject lines:
- `Add Hono API extractor with route chaining support`
- `Fix warp path parser stripping quotes before literal check`
- `Upgrade Vite to 6.2 to resolve esbuild CORS advisory`

---

## Testing Conventions

### Unit tests — Vitest (server only)

- Location: `server/src/**/__tests__/*.test.ts`
- Runner: `cd server && npx vitest run`
- Watch mode: `cd server && npx vitest`
- The `include` glob is scoped to `src/**/*.{test,spec}.{ts,js}` — tests outside `server/src/` are not picked up

Key patterns:
- Mock `grep` and `readFile` via `vi.spyOn(extractor as any, 'method')` — do not hit the filesystem
- `RawEndpoint` uses `location:` (not `in:`), `sourceFile:`, `tags: []` — see type definitions in `server/src/services/apiAnalysis/types.ts`
- `RawApiSurface` uses `apiStyle:` (not `framework:`)
- Each extractor needs at minimum: one positive test (finds expected endpoints) and one negative test (returns empty for non-matching files)

### E2E tests — Playwright

- Location: `e2e/*.spec.ts`
- Runner: `npm test` (requires both dev servers running)
- Interactive: `npm run test:ui`
- Base URL: `http://localhost:5173`
- Prefer accessible selectors: `getByRole`, `getByText`, `getByPlaceholder`

---

## Extractor Pattern

New API/entity extractors follow the pattern:

1. **Implement** class extending `BaseApiExtractor` or `BaseEntityExtractor` in `server/src/services/{api,entity}Analysis/extractors/languages/<lang>/<framework>.ts`
2. **Write tests** in the adjacent `__tests__/<framework>.test.ts` (failing first — see red-green-refactor above)
3. **Register** in `server/src/services/{api,entity}Analysis/registry.ts`
4. **Add detection signals** in `server/src/services/{api,entity}Analysis/detector.ts`
5. **Add requirement** (if new framework support) to `docs/requirements/REQUIREMENTS.md`

---

## Branch & Commit Conventions

- Work on `main`; the remote is `origin/main`
- Do **not** push unless explicitly asked
- Do **not** amend published commits
- Create a new commit rather than amending if a pre-commit hook fails
