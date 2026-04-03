# API Job Plan

This document describes the `analyze_apis` job type: execution flow, new API endpoints, and error handling.

---

## Job Type Registration

Add `analyze_apis` to the `JobType` union in `shared/src/index.ts`:

```ts
export const JobTypeSchema = z.enum([
  'explore_github_repo',
  'explore_github_org',
  'analyze_dependencies',
  'analyze_languages',
  'analyze_entities',
  'analyze_apis',          // ← new
])
```

Input schema:

```ts
z.object({
  type: z.literal('analyze_apis'),
  repoId: z.number().int().positive(),
  repo: z.string(),                         // fullName, e.g. "apache/airflow"
  forceReanalysis: z.boolean().optional(),
})
```

---

## Execution Flow

`runAnalyzeApis(input, jobId)` in `server/src/services/apiAnalysis/index.ts`:

```
1. Resolve repo source directory
   └── cloneOrUpdate(repo.fullName, repo.cloneUrl) → sourceDir

2. Load repo languages from DB
   └── SELECT * FROM repo_languages WHERE repo_id = input.repoId

3. Check for existing results (skip if already done)
   └── SELECT COUNT(*) FROM repo_api_approaches WHERE repo_id = input.repoId
   └── If count > 0 AND !input.forceReanalysis → return { skipped: true }

4. If forceReanalysis: delete existing results
   └── DELETE FROM repo_api_approaches WHERE repo_id = input.repoId
       (cascades to repo_apis → repo_api_endpoints → repo_api_parameters)

5. Phase 1: Detection
   └── detectApiApproaches(sourceDir, languages) → DetectedApiApproach[]

6. Persist detected approaches to repo_api_approaches
   └── INSERT ... ON CONFLICT DO NOTHING

7. Phase 2: Extraction
   └── getApiExtractors(approaches, { sourceDir, repoId }) → BaseApiExtractor[]
   └── Promise.allSettled(extractors.map(e => e.extract())) → ApiExtractorResult[]

8. Collect RawApi[] from all successful results
   └── Accumulate warnings from failed extractors

9. Normalize RawApi[] → ApiRecord[]
   └── normalizeApis(rawApis) → ApiRecord[]

10. Deduplicate ApiRecord[]
    └── deduplicateApis(apiRecords) → ApiRecord[]

11. Persist to DB (in a transaction)
    a. INSERT repo_apis (batch)
    b. INSERT repo_api_endpoints (batch, keyed to repo_apis.id)
    c. INSERT repo_api_parameters (batch, keyed to repo_api_endpoints.id)
    d. UPDATE repo_api_approaches SET endpoint_count = ... for each approach

12. Update job status to 'completed'
    └── Store summary stats in job.output JSONB
        { approachesFound, apisFound, endpointsFound, warnings }
```

---

## New API Endpoints

Add to `server/src/routes/repositories.ts`:

### GET `/api/v1/repositories/:id/api-approaches`

Returns detected API frameworks and their confidence.

```json
{
  "data": [
    {
      "id": 12,
      "language": "Java",
      "approach": "spring_mvc",
      "apiStyle": "http",
      "confidence": "high",
      "signals": ["Tier A: spring-boot-starter-web in pom.xml", "..."],
      "endpointCount": 47,
      "detectedAt": "2026-03-29T12:00:00Z"
    }
  ]
}
```

### GET `/api/v1/repositories/:id/apis`

Returns all API surfaces, optionally filtered by `apiStyle` query param.

```
GET /api/v1/repositories/42/apis?style=http
```

```json
{
  "data": [
    {
      "id": 5,
      "name": "UserController",
      "apiStyle": "http",
      "basePath": "/api/v1/users",
      "packageOrModule": "com.example.controller",
      "confidence": "high",
      "endpointCount": 6,
      "primarySource": { "file": "src/main/java/com/example/controller/UserController.java", "startLine": 12 }
    }
  ]
}
```

### GET `/api/v1/repositories/:id/api-endpoints`

Returns all endpoints, optionally filtered by `apiId`, `style`, or `method`.

```
GET /api/v1/repositories/42/api-endpoints?apiId=5
```

```json
{
  "data": [
    {
      "id": 23,
      "apiId": 5,
      "httpMethod": "GET",
      "path": "/api/v1/users/{id}",
      "returnType": "UserResponse",
      "tags": ["UserController"],
      "confidence": "high",
      "sourceFile": "src/main/java/com/example/controller/UserController.java",
      "sourceLine": 38,
      "parameters": [
        { "name": "id", "location": "path", "type": "Long", "required": true }
      ]
    }
  ]
}
```

Parameters are inlined in the endpoint response (no separate fetch needed).

### GET `/api/v1/repositories/:id/api-endpoints/:endpointId`

Returns a single endpoint with all parameters. Used when navigating to a detail view.

---

## Job Integration in jobRunner.ts

```ts
case 'analyze_apis': {
  const { runAnalyzeApis } = await import('./apiAnalysis/index.js')
  await runAnalyzeApis(validatedInput, job.id)
  break
}
```

---

## Re-Analysis

The `analyze_apis` job respects the existing `forceReanalysis` pattern:

```ts
// Via POST /api/v1/jobs
{
  "type": "analyze_apis",
  "repoId": 42,
  "repo": "spring-projects/spring-petclinic",
  "forceReanalysis": true
}
```

The UI "Analyze" button always passes `forceReanalysis: false` (or omits it). A future "Re-analyze" option could pass `true`.

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Repo not yet cloned | `cloneOrUpdate` runs automatically; slow but not an error |
| `analyze_languages` not yet run | Proceed — cross-language detectors (OpenAPI, proto, GraphQL) run regardless; language-specific detectors have no languages to check |
| Individual extractor throws | Caught by `Promise.allSettled`; warning added; other extractors continue |
| Normalization error for one API | Skip that API, add warning; continue persisting valid APIs |
| DB write fails mid-batch | Transaction rolls back; job status set to `failed` with error detail |
| Repo has zero detectable APIs | Job completes successfully with 0 results; not an error |

---

## Performance Considerations

- Detection is fast: grep-based, no parsing. Typically < 5 seconds even for large repos.
- Extraction is heavier: regex over potentially hundreds of source files. Typically 5–30 seconds.
- Proto parsing (cross-language) is very fast; files are small and structured.
- OpenAPI spec parsing is nearly instant (single file JSON/YAML parse).
- For very large monorepos (10,000+ source files), the per-file scan may be slow. Mitigations:
  - Glob is scoped to specific directories (e.g., `**/controller/*.java` not `**/*.java`)
  - Consider a file count limit with a warning when exceeded
- All extractor work is CPU-only (no network, no subprocess). Can run in parallel with other jobs.

---

## Shared Types (additions to `shared/src/index.ts`)

```ts
export const RepoApiApproachSchema = z.object({
  id:             z.number(),
  language:       z.string(),
  approach:       z.string(),
  apiStyle:       z.enum(['http', 'graphql', 'rpc']),
  confidence:     z.enum(['high', 'medium', 'low']),
  signals:        z.array(z.string()).optional(),
  endpointCount:  z.number().nullable(),
  detectedAt:     z.string(),
})

export const RepoApiParameterSchema = z.object({
  id:           z.number(),
  name:         z.string(),
  location:     z.enum(['path', 'query', 'body', 'header', 'field']),
  type:         z.string().nullable(),
  required:     z.boolean().nullable(),
  description:  z.string().nullable(),
  ordinalPosition: z.number().nullable(),
})

export const RepoApiEndpointSchema = z.object({
  id:             z.number(),
  apiId:          z.number(),
  httpMethod:     z.string().nullable(),
  path:           z.string().nullable(),
  operationType:  z.string().nullable(),
  operationName:  z.string().nullable(),
  rpcMethodName:  z.string().nullable(),
  requestType:    z.string().nullable(),
  responseType:   z.string().nullable(),
  rpcStreaming:   z.string().nullable(),
  summary:        z.string().nullable(),
  tags:           z.array(z.string()).nullable(),
  returnType:     z.string().nullable(),
  confidence:     z.string(),
  sourceFile:     z.string().nullable(),
  sourceLine:     z.number().nullable(),
  parameters:     z.array(RepoApiParameterSchema).optional(),
})

export const RepoApiSchema = z.object({
  id:               z.number(),
  name:             z.string(),
  normalizedName:   z.string(),
  apiStyle:         z.enum(['http', 'graphql', 'rpc']),
  protocol:         z.string().nullable(),
  basePath:         z.string().nullable(),
  packageOrModule:  z.string().nullable(),
  confidence:       z.string(),
  primarySource:    z.object({ file: z.string(), startLine: z.number() }).nullable(),
  createdAt:        z.string(),
})

export type RepoApiApproach = z.infer<typeof RepoApiApproachSchema>
export type RepoApiEndpoint  = z.infer<typeof RepoApiEndpointSchema>
export type RepoApiParameter = z.infer<typeof RepoApiParameterSchema>
export type RepoApi          = z.infer<typeof RepoApiSchema>
```
