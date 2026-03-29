# Entity Analysis — Job Plan

This document describes the `analyze_entities` job type: its input schema, execution flow, API endpoints, re-analysis handling, error strategy, and performance considerations.

---

## 1. Job Input Schema

```ts
// In shared/src/schemas.ts (alongside existing CreateJobInput union)

type AnalyzeEntitiesInput = {
  type: 'analyze_entities'
  repoId: number       // ID from the repositories table
  repo: string         // fullName, e.g. "vercel/next.js" — used to resolve the clone path
  forceReanalysis?: boolean  // default false; if true, delete existing results and re-run even if data exists
}
```

The `repo` field follows the same convention as `analyze_dependencies` and `analyze_languages`: it is the repository's `owner/name` string, passed to `repoDirs()` from `ortAnalyzer.ts` to resolve the `source` directory path at `/data/{owner}/{name}/source`.

The `CreateJobInput` union type in `shared` must be extended to include `AnalyzeEntitiesInput`.

---

## 2. Job Execution Flow

The job is handled in `jobRunner.ts` as a new branch in `runJob()`, delegating to `runAnalyzeEntities()`.

```ts
async function runAnalyzeEntities(
  input: Extract<CreateJobInput, { type: 'analyze_entities' }>
): Promise<Record<string, unknown>>
```

### Step a — Look up repository record

```ts
const [repo] = await db
  .select()
  .from(repositories)
  .where(eq(repositories.id, input.repoId))
if (!repo) throw new Error(`Repository ${input.repoId} not found`)
```

### Step b — Resolve the clone path

```ts
const { source } = repoDirs(input.repo)
// Resolves to: /data/{owner}/{name}/source
// Same function used by ortAnalyzer.ts for analyze_dependencies
```

### Step c — Ensure the repo is cloned

```ts
await cloneOrUpdate(input.repo, source)
// Reuses cloneOrUpdate() from ortAnalyzer.ts.
// If already cloned (from a previous analyze_dependencies or analyze_languages run),
// this does a fast git pull --ff-only.
// If not cloned yet, performs a shallow clone (--depth 1).
```

### Step d — Look up detected languages from repoLanguages

```ts
const languages = await db
  .select()
  .from(repoLanguages)
  .where(eq(repoLanguages.repoId, input.repoId))
  .orderBy(desc(repoLanguages.bytes))

if (languages.length === 0) {
  // Warn but do not abort.
  // Cross-language approaches (SQL DDL, Protobuf, OpenAPI, GraphQL) do not need
  // language data. Per-language extractors simply won't run.
  console.warn(
    `[EntityAnalysis] No language data for repo ${input.repoId}. ` +
    `Run analyze_languages first for best results.`
  )
}
```

### Step e — Check for existing results (skip logic)

```ts
if (!input.forceReanalysis) {
  const existing = await db
    .select({ id: repoEntityApproaches.id })
    .from(repoEntityApproaches)
    .where(eq(repoEntityApproaches.repoId, input.repoId))
    .limit(1)

  if (existing.length > 0) {
    // Data already exists and forceReanalysis is not set — return early
    const [{ count: entityCount }] = await db
      .select({ count: count() })
      .from(repoEntities)
      .where(eq(repoEntities.repoId, input.repoId))

    return {
      skipped: true,
      reason: 'Data already exists. Use forceReanalysis: true to re-run.',
      entityCount,
    }
  }
}
```

### Step f — Clear previous results if forceReanalysis

```ts
if (input.forceReanalysis) {
  // Delete in reverse dependency order.
  // repoEntityFields and repoEntityRelationships are deleted via CASCADE on repoEntities.
  // repoEntities.sourceApproachId is set to NULL via SET NULL on repoEntityApproaches deletion.
  await db.delete(repoEntityApproaches).where(eq(repoEntityApproaches.repoId, input.repoId))
  await db.delete(repoEntities).where(eq(repoEntities.repoId, input.repoId))
}
```

### Step g — Run Phase 1 detection + Phase 2 extraction

```ts
const analysisResult = await analyzeEntities({
  repoId: input.repoId,
  sourceDir: source,
  repoFullName: input.repo,
  detectedLanguages: languages,
  forceReanalysis: input.forceReanalysis,
})
// analyzeEntities() is the orchestrator from server/src/services/entityAnalysis/index.ts
// It returns: { approaches, entities, stats }
```

### Step h — Persist detected approaches

```ts
const approachIdMap = new Map<string, number>()  // "language:approach" → DB id

for (const approach of analysisResult.approaches) {
  const [row] = await db
    .insert(repoEntityApproaches)
    .values({
      repoId: input.repoId,
      language: approach.language,
      approach: approach.approach,
      confidence: approach.confidence,
      signals: approach.signals,
      detectedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [repoEntityApproaches.repoId, repoEntityApproaches.language, repoEntityApproaches.approach],
      set: {
        confidence: approach.confidence,
        signals: approach.signals,
        detectedAt: new Date(),
      },
    })
    .returning()

  approachIdMap.set(`${approach.language}:${approach.approach}`, row.id)
}
```

### Step i — Upsert entities, fields, and relationships

```ts
// First pass: upsert entities and their fields
for (const entity of analysisResult.entities) {
  // Determine the sourceApproachId from the primary source's extractor
  const primarySource = entity.primarySources[0]
  const sourceApproachId = primarySource
    ? approachIdMap.get(primarySource.extractorId.replace('.', ':')) ?? null
    : null

  const [entityRow] = await db
    .insert(repoEntities)
    .values({
      repoId: input.repoId,
      name: entity.name,
      normalizedName: entity.normalizedName,
      sourceApproachId,
      entityType: entity.entityType,
      confidence: entity.confidence,
      primarySources: entity.primarySources,
    })
    .onConflictDoUpdate({
      target: [repoEntities.repoId, repoEntities.normalizedName],
      set: {
        name: entity.name,
        sourceApproachId,
        entityType: entity.entityType,
        confidence: entity.confidence,
        primarySources: entity.primarySources,
        updatedAt: new Date(),
      },
    })
    .returning()

  // Upsert fields for this entity
  for (const field of entity.fields) {
    await db
      .insert(repoEntityFields)
      .values({
        entityId: entityRow.id,
        name: field.name,
        normalizedName: field.normalizedName,
        dataType: field.dataType,
        nativeType: field.nativeType,
        isNullable: field.isNullable === null ? null : String(field.isNullable),
        isPrimaryKey: String(field.isPrimaryKey),
        isForeignKey: String(field.isForeignKey),
        isUnique: String(field.isUnique),
        defaultValue: field.defaultValue,
        ordinalPosition: field.ordinalPosition,
        metadata: field.metadata,
      })
      .onConflictDoUpdate({
        target: [repoEntityFields.entityId, repoEntityFields.normalizedName],
        set: {
          name: field.name,
          dataType: field.dataType,
          nativeType: field.nativeType,
          isNullable: field.isNullable === null ? null : String(field.isNullable),
          isPrimaryKey: String(field.isPrimaryKey),
          isForeignKey: String(field.isForeignKey),
          isUnique: String(field.isUnique),
          defaultValue: field.defaultValue,
          ordinalPosition: field.ordinalPosition,
          metadata: field.metadata,
        },
      })
  }
}

// Second pass: resolve and insert relationships
// Done after all entities are inserted so targetEntityId can be resolved.
for (const entity of analysisResult.entities) {
  const [sourceRow] = await db
    .select({ id: repoEntities.id })
    .from(repoEntities)
    .where(and(
      eq(repoEntities.repoId, input.repoId),
      eq(repoEntities.normalizedName, entity.normalizedName),
    ))

  for (const rel of entity.relationships) {
    const [targetRow] = await db
      .select({ id: repoEntities.id })
      .from(repoEntities)
      .where(and(
        eq(repoEntities.repoId, input.repoId),
        eq(repoEntities.normalizedName, toSnakeCase(rel.targetEntityName)),
      ))
      .limit(1)

    await db
      .insert(repoEntityRelationships)
      .values({
        repoId: input.repoId,
        sourceEntityId: sourceRow.id,
        targetEntityId: targetRow?.id ?? null,
        targetEntityName: rel.targetEntityName,
        relationshipType: rel.type,
        sourceField: rel.sourceField,
        targetField: rel.targetField,
        metadata: rel.metadata,
      })
      .onConflictDoUpdate({
        target: [
          repoEntityRelationships.repoId,
          repoEntityRelationships.sourceEntityId,
          repoEntityRelationships.targetEntityName,
          repoEntityRelationships.relationshipType,
        ],
        set: {
          targetEntityId: targetRow?.id ?? null,
          sourceField: rel.sourceField,
          targetField: rel.targetField,
          metadata: rel.metadata,
        },
      })
  }
}
```

### Step j — Return summary and update job status to completed

```ts
return {
  repo: input.repo,
  approachesDetected: analysisResult.stats.approachesDetected,
  entitiesFound: analysisResult.stats.entitiesAfterDedup,
  fieldsFound: analysisResult.entities.reduce((sum, e) => sum + e.fields.length, 0),
  relationshipsFound: analysisResult.entities.reduce((sum, e) => sum + e.relationships.length, 0),
  warnings: analysisResult.stats.warnings,
  totalTimeMs: analysisResult.stats.totalTimeMs,
}
// jobRunner.ts stores this object in jobs.result (jsonb) and sets jobs.status = 'completed'
```

The existing `runJob()` wrapper in `jobRunner.ts` handles the `jobs.status` update to `'completed'` or `'failed'` around this function, matching the pattern for `analyze_languages` and `analyze_dependencies`.

---

## 3. API Endpoint Additions

These are added to `server/src/routes/repositories.ts`, following the same patterns as the existing `/packages` and `/languages` endpoints.

### `GET /api/v1/repositories/:id/entities`

Returns all entities for a repo with their fields inline and source approach.

**Query parameters:**
- `type` — filter by entityType (e.g., `?type=table`)
- `approach` — filter by approach identifier (e.g., `?approach=django_orm`)
- `search` — filter by name prefix, case-insensitive

**Response shape:**
```json
{
  "data": [
    {
      "id": 42,
      "name": "UserAccount",
      "normalizedName": "user_account",
      "entityType": "table",
      "confidence": "high",
      "fieldCount": 8,
      "sourceApproach": {
        "id": 7,
        "language": "Python",
        "approach": "django_orm",
        "confidence": "high"
      },
      "primarySources": [
        {
          "file": "src/users/models.py",
          "startLine": 12,
          "endLine": 34,
          "format": "python_class",
          "extractorId": "python.django_orm"
        }
      ],
      "fields": [
        {
          "id": 101,
          "name": "id",
          "normalizedName": "id",
          "dataType": "integer",
          "nativeType": "AutoField",
          "isPrimaryKey": "true",
          "isForeignKey": "false",
          "isUnique": "true",
          "isNullable": "false",
          "defaultValue": null,
          "ordinalPosition": 1
        },
        {
          "id": 102,
          "name": "email",
          "normalizedName": "email",
          "dataType": "string",
          "nativeType": "EmailField(max_length=254)",
          "isPrimaryKey": "false",
          "isForeignKey": "false",
          "isUnique": "true",
          "isNullable": "false",
          "defaultValue": null,
          "ordinalPosition": 2
        }
      ]
    }
  ],
  "total": 24
}
```

Fields are included inline in the entity response to minimize round-trips. The primary use case is rendering the entity list with expandable field panels in the UI.

### `GET /api/v1/repositories/:id/entity-approaches`

Returns the detected approaches for a repo, with entity count per approach.

**Response shape:**
```json
{
  "data": [
    {
      "id": 7,
      "language": "Python",
      "approach": "django_orm",
      "confidence": "high",
      "signals": [
        "Tier A: 'Django' found in requirements.txt",
        "Tier B: app/models.py files found (3 files)",
        "Tier C: 'from django.db import models' found in src/users/models.py"
      ],
      "detectedAt": "2026-03-27T10:00:00.000Z",
      "entityCount": 18
    }
  ]
}
```

The `entityCount` field is computed as a join count with `repoEntities` on `sourceApproachId`.

### `GET /api/v1/repositories/:id/entity-relationships`

Returns all relationships for a repo. Used by the optional relationship graph view.

**Response shape:**
```json
{
  "data": [
    {
      "id": 55,
      "sourceEntityId": 42,
      "sourceEntityName": "UserAccount",
      "targetEntityId": 43,
      "targetEntityName": "Order",
      "relationshipType": "one_to_many",
      "sourceField": "id",
      "targetField": "user_id"
    }
  ]
}
```

---

## 4. Job Triggering

The `analyze_entities` job is added to the "Start A Job" dropdown menu in `RepositoryPage.tsx`, alongside the existing `analyze_languages` and `analyze_dependencies` options.

It appears as: **"Detect Data Entities"**

The menu item should appear after "Analyze Languages" in the dropdown. It is not disabled when languages are absent (since cross-language approaches always fire), but if `languages.length === 0` and `langStatus === 'idle'`, the menu item can display a muted sub-label: *"Run Analyze Languages first for full results"*.

**Job creation POST body:**
```json
{
  "type": "analyze_entities",
  "repoId": 12,
  "repo": "django/django",
  "forceReanalysis": false
}
```

The `forceReanalysis` option is not exposed in the initial UI — it defaults to `false`. If entity data already exists and the user clicks the menu item again, the job will return early with a `skipped: true` result and the UI will remain showing the existing data unchanged. Future enhancement: show a "Re-analyze" variant that sets `forceReanalysis: true`.

---

## 5. Re-Analysis Handling

| Scenario | Behavior |
|----------|----------|
| First run, no existing data | Full detection + extraction, insert all results |
| Re-run, data exists, `forceReanalysis: false` | Job completes immediately with `skipped: true`, no DB changes |
| Re-run, `forceReanalysis: true` | Delete all existing entity results for repo, then full re-run |
| Repo cloned but `repoLanguages` empty | Continue with cross-language approaches only; emit a warning in `jobs.result` |
| Repo not yet cloned | `cloneOrUpdate` performs a shallow clone; adds network time but is not an error |
| Extraction partially fails | Partial results are written; job completes with warnings in `jobs.result` |
| Catastrophic failure before any writes | `jobRunner.ts` sets `jobs.status = 'failed'`; no partial data written |

When `forceReanalysis: true` deletes existing data and the extraction then fails partway through, the repo is left with partial or zero entity results. The job status is set to `failed` with error details. The user can re-trigger to recover.

---

## 6. Error Handling

### Extractor-level partial failures

The orchestrator uses `Promise.allSettled` so a crash in one extractor does not abort the others. Failed extractors add a warning string to `analysisResult.stats.warnings`. The job stores the full warnings array in `jobs.result`. The API response for the entity-approaches endpoint also surfaces these as part of the job result.

### Whole-job failure

If a catastrophic error occurs before any results are persisted (e.g., `cloneOrUpdate` fails, DB connection drops), `jobRunner.ts` catches the error in the outer `try/catch` (the same wrapper used by all job types) and sets `jobs.status = 'failed'` with the error message. No partial data is written.

### Timeout

Long-running extractors scanning large repos may exceed a reasonable time limit. Each extractor should implement its own soft timeout using `Promise.race` with a `setTimeout` fallback. If an extractor times out, it returns whatever entities have been collected so far plus a timeout warning.

Recommended per-extractor soft timeout: **60 seconds**
Recommended total job soft timeout: **10 minutes**

### Unknown approach

If the registry has no extractor registered for a detected `(language, approach)` pair (e.g., a new approach was detected but no extractor has been written yet), the orchestrator emits a warning and continues. This handles the case where detection is ahead of the extractor implementation schedule.

---

## 7. Performance Considerations

### Repo cloning

`analyze_entities` reuses `cloneOrUpdate()`, which performs a fast `git pull --ff-only` if the repo is already cloned. If the repo was previously cloned by `analyze_languages` or `analyze_dependencies`, no network I/O is incurred.

### Large repos

For repos with thousands of source files, the Tier C grep scans in the detector can be slow. Mitigations:
- Exclude `node_modules/`, `vendor/`, `build/`, `dist/`, `.git/` from all glob and grep operations (enforced in `BaseExtractor.glob()`).
- Cap grep results at a limit (e.g., 5000 hits) — finding 5000 instances of `@Entity` is sufficient to confirm the approach.
- Run all per-language detectors in parallel (`Promise.all`).
- Run all extractors in parallel (`Promise.allSettled`).

### Many extractors (polyglot monorepos)

In a polyglot monorepo, 5–10 extractors may run concurrently. Extractors that work on the same files may redundantly read the same file from disk. A future optimization is a shared file cache (`Map<relativePath, string>`) scoped to a single job run, deduplicating `fs.readFile` calls across extractors.

### DB upserts for large entity sets

Writing hundreds of entities with dozens of fields each results in many individual upsert calls. For repos with more than 200 entities, batch inserts should be used to reduce round-trips:

```ts
// Instead of one insert per entity/field, batch in chunks of 100
const CHUNK_SIZE = 100
for (let i = 0; i < fieldValues.length; i += CHUNK_SIZE) {
  await db
    .insert(repoEntityFields)
    .values(fieldValues.slice(i, i + CHUNK_SIZE))
    .onConflictDoUpdate({ ... })
}
```

### Incremental analysis (future enhancement)

The current design is a full re-run per job execution. A future enhancement is incremental analysis: record the git commit SHA at analysis time in a `lastAnalyzedCommit` field on the repo, and on subsequent runs, skip files that haven't changed between the stored SHA and HEAD. This would make re-runs much faster for active repos.
