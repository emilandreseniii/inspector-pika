# Inspector Pika — Documentation

Welcome to the Inspector Pika documentation. This file is your starting point for navigating all project docs.

---

## Documentation Map

```
docs/
  DOCS.md                   ← you are here
  TODO.md                   ← active work items and backlog
  requirements/
    REQUIREMENTS.md         ← canonical requirements index (start here for any new feature)
    api-analysis-overview.md
    entity-analysis-overview.md
  design/
    DESIGN.md               ← architecture overview and design index
    api-detection-plan.md
    api-extractor-architecture.md
    api-database-schema-plan.md
    api-job-plan.md
    api-ui-plan.md
    entity-detection-plan.md
    entity-extractor-architecture.md
    entity-database-schema-plan.md
    entity-job-plan.md
    entity-ui-plan.md
  research/
    code-structure-chat.txt
    languages/              ← per-language ORM and API framework surveys
  screenshots/
    screenshots.md          ← annotated screenshots of all major pages
```

---

## Where to Start

| I want to… | Go to… |
|-----------|-------|
| Understand what Inspector Pika does | [requirements/REQUIREMENTS.md](requirements/REQUIREMENTS.md) |
| Add a new feature | [requirements/REQUIREMENTS.md](requirements/REQUIREMENTS.md) → write requirement → then design |
| Understand the architecture | [design/DESIGN.md](design/DESIGN.md) |
| Add a new ORM or API framework extractor | [design/DESIGN.md](design/DESIGN.md) → extractor architecture docs |
| See what's planned or in progress | [TODO.md](TODO.md) |
| See screenshots of the live app | [screenshots/screenshots.md](screenshots/screenshots.md) |
| Understand how a language was researched | [research/languages/](research/languages/) |

---

## Development Workflow

New features follow this sequence:

```
1. Requirements  →  docs/requirements/REQUIREMENTS.md
                    Add numbered FR-x requirement(s)

2. Design        →  docs/design/DESIGN.md or a new design doc
                    Describe the technical approach

3. Tests (red)   →  Write failing tests first (unit + E2E as appropriate)

4. Implement     →  Make the tests pass

5. Refactor      →  Clean up with tests staying green

6. Pre-commit    →  Run all quality checks (see .claude/CLAUDE.md)

7. Commit & push
```

See [.claude/CLAUDE.md](../.claude/CLAUDE.md) for the full agent and pre-commit conventions.
