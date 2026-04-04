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

The root `AGENTS.md` contains project context for general-purpose coding agents (Codex, GitHub Copilot Workspace, etc.). This file documents the project-specific agent tooling built on top of Claude Code.

---

## Skills

Skills are Claude Code slash commands stored in `.claude/commands/`. Invoke them with `/skill-name` in a Claude Code session.

| Skill | Command | Description |
|-------|---------|-------------|
| Add Tests | `/inpk-add-tests` | Inspects all current changes and adds appropriate Vitest unit tests and/or Playwright E2E tests |

---

## Testing Conventions (for agents)

### Unit tests — Vitest (server only)

- Location: `server/src/**/__tests__/*.test.ts`
- Runner: `cd server && npx vitest run`
- Watch mode: `cd server && npx vitest`
- The `include` glob is scoped to `src/**/*.{test,spec}.{ts,js}` — tests outside `server/src/` are not picked up

Key patterns:
- Mock `grep` and `readFile` via `vi.spyOn(extractor as any, 'method')` — do not hit the filesystem
- `RawEndpoint` uses `location:` (not `in:`), `sourceFile:`, `tags: []` — see type definitions in `server/src/services/apiAnalysis/types.ts`
- `RawApiSurface` uses `apiStyle:` (not `framework:`)

### E2E tests — Playwright

- Location: `e2e/*.spec.ts`
- Runner: `npm test` (requires both dev servers running)
- Interactive: `npm run test:ui`
- Base URL: `http://localhost:5173`
- Prefer accessible selectors: `getByRole`, `getByText`, `getByPlaceholder`

---

## Workflow Conventions (for agents)

- **Always run unit tests** after modifying server-side code: `cd server && npx vitest run`
- **Check TypeScript** before committing: `cd server && npx tsc --noEmit`
- **Do not commit** unless explicitly asked
- **Branch**: work on `main`; the remote is `origin/main`
- **Commit style**: imperative subject line, Co-Authored-By trailer with model name

### Extractor pattern

New API/entity extractors follow the pattern:
1. Implement class extending `BaseApiExtractor` or `BaseEntityExtractor` in `server/src/services/{api,entity}Analysis/extractors/languages/<lang>/<framework>.ts`
2. Write tests in the adjacent `__tests__/<framework>.test.ts`
3. Register in `server/src/services/{api,entity}Analysis/registry.ts`
4. Add detection signals in `server/src/services/{api,entity}Analysis/detector.ts`
