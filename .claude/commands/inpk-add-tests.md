---
description: Inspect all changes in the working tree and staged index, then add any unit tests (Vitest) and/or E2E tests (Playwright) that are needed to cover those changes. Use when you want test coverage added after implementing a feature or fix.
---

You are adding tests for Inspector Pika. Analyse the current changes and write the tests that are missing.

## Step 1 — Understand what changed

Run `git diff HEAD` and `git status` to see what files were added or modified. Focus on:
- New or changed server-side logic in `server/src/` → needs **unit tests**
- New or changed API routes in `server/src/routes/` → needs **unit or integration tests**
- New or changed React pages/components in `client/src/` → needs **E2E tests**
- New or changed shared Zod schemas in `shared/src/` → consider unit tests if validation logic is non-trivial

Read each changed file carefully before deciding what tests to write.

## Step 2 — Unit tests (Vitest, server only)

Unit tests live alongside source files in `__tests__/` subdirectories and use the `.test.ts` extension.

**Existing patterns to follow:**
- `server/src/services/apiAnalysis/extractors/languages/**/__tests__/*.test.ts`
- `server/src/services/entityAnalysis/extractors/languages/**/__tests__/*.test.ts`

**How the mock pattern works:**
```typescript
import { describe, it, expect, vi } from 'vitest'
import { MyExtractor } from '../myExtractor'
import type { ApiExtractorContext } from '../../../base'

function makeExtractor(files: Record<string, string>): MyExtractor {
  const ctx: ApiExtractorContext = {
    sourceDir: '/repo',
    approach: { language: 'X', approach: 'y', apiStyle: 'http', confidence: 'high', signals: [] },
    repoFullName: 'test/repo',
  }
  const extractor = new MyExtractor(ctx)
  vi.spyOn(extractor as any, 'grep').mockImplementation(async (_glob: string, pattern: RegExp) => {
    const hits: Array<{ file: string; line: number; text: string }> = []
    for (const [file, content] of Object.entries(files)) {
      const lines = content.split('\n')
      lines.forEach((text, i) => {
        if (pattern.test(text)) hits.push({ file, line: i + 1, text })
      })
    }
    return hits
  })
  vi.spyOn(extractor as any, 'readFile').mockImplementation(async (path: string) => {
    if (files[path] === undefined) throw new Error(`File not found: ${path}`)
    return files[path]
  })
  return extractor
}
```

**RawApiSurface / RawEndpoint shape** (important — do not use wrong field names):
- Surface: `{ name, apiStyle: ApiStyle, endpoints: RawEndpoint[], sourceFile: string }`
- Endpoint: `{ httpMethod?, path?, operationName?, parameters: RawApiParameter[], tags: string[], sourceFile: string }`
- Parameter: `{ name, location: 'path'|'query'|'header'|'body', required: boolean }`
- No `framework:`, no `in:`, no `metadata:` fields — these do not exist on the types

**Run unit tests** to confirm they pass:
```bash
cd server && npx vitest run
```

## Step 3 — E2E tests (Playwright)

E2E tests live in `e2e/` at the repo root and use the `.spec.ts` extension.

**Pattern:**
```typescript
import { test, expect } from '@playwright/test'

test.describe('Feature name', () => {
  test('does something visible in the UI', async ({ page }) => {
    await page.goto('/route')
    await expect(page.getByRole('heading', { name: 'Title' })).toBeVisible()
    // use getByRole, getByText, getByPlaceholder — prefer accessible selectors
  })
})
```

**When to add E2E tests:**
- A new page or major section was added to the React client
- A new user workflow was introduced (e.g. a new job type with a modal)
- Existing E2E coverage is absent for a feature that changed

**Do not** add E2E tests for:
- Pure server-side logic (use unit tests instead)
- Trivial UI changes (text copy, style tweaks)

E2E tests require the full stack running. Note this in a comment at the top of the spec file if the test depends on specific database state.

## Step 4 — Review and confirm

After writing the tests:
1. Run `cd server && npx vitest run` — all unit tests must pass
2. List any new E2E specs you created and explain what each one covers
3. Flag any gaps where you chose *not* to write a test and explain why (e.g. pure UI polish, already covered by existing tests, or requires live database state that makes E2E impractical)
