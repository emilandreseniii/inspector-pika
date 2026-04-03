# API Database Schema Plan

This document describes the new Drizzle ORM schema tables required for the API analysis feature.

---

## Overview

Four new tables are added to the existing Inspector Pika PostgreSQL schema:

| Table | Purpose |
|-------|---------|
| `repo_api_approaches` | One row per detected API framework per repo (Phase 1 output) |
| `repo_apis` | One row per distinct API surface (controller, router, service, schema file) |
| `repo_api_endpoints` | One row per operation (HTTP endpoint, GraphQL field, RPC method) |
| `repo_api_parameters` | One row per parameter, argument, or message field on an endpoint |

These tables parallel the existing entity analysis tables (`repo_entity_approaches`, `repo_entities`, `repo_entity_fields`, `repo_entity_relationships`) in structure and conventions.

---

## Schema Definitions (Drizzle ORM)

```ts
import {
  pgTable, serial, integer, text, boolean, timestamp,
  uniqueIndex, index, jsonb, pgEnum
} from 'drizzle-orm/pg-core'

// ── Enums ─────────────────────────────────────────────────────────────────

export const apiStyleEnum = pgEnum('api_style', ['http', 'graphql', 'rpc'])

export const httpMethodEnum = pgEnum('http_method', [
  'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'
])

export const graphqlOperationEnum = pgEnum('graphql_operation', [
  'Query', 'Mutation', 'Subscription'
])

export const paramLocationEnum = pgEnum('param_location', [
  'path', 'query', 'body', 'header', 'field'
])

// ── repo_api_approaches ───────────────────────────────────────────────────
// One row per detected API framework per repo.

export const repoApiApproaches = pgTable(
  'repo_api_approaches',
  {
    id:          serial('id').primaryKey(),
    repoId:      integer('repo_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),
    language:    text('language').notNull(),           // "Java", "Python", "cross-language"
    approach:    text('approach').notNull(),           // "spring_mvc", "fastapi", "grpc_proto", etc.
    apiStyle:    apiStyleEnum('api_style').notNull(),  // "http", "graphql", "rpc"
    confidence:  text('confidence').notNull(),         // "high" | "medium" | "low"
    signals:     jsonb('signals').$type<string[]>(),   // human-readable signal descriptions
    endpointCount: integer('endpoint_count'),          // populated after extraction
    detectedAt:  timestamp('detected_at').defaultNow().notNull(),
  },
  (t) => ({
    repoIdx:     index().on(t.repoId),
    uniqueApproach: uniqueIndex().on(t.repoId, t.language, t.approach),
  })
)

// ── repo_apis ─────────────────────────────────────────────────────────────
// One row per distinct API surface found in the repo.
// Examples: a Spring controller class, a Flask Blueprint, a gRPC service, a .graphql schema file.

export const repoApis = pgTable(
  'repo_apis',
  {
    id:              serial('id').primaryKey(),
    repoId:          integer('repo_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),
    sourceApproachId: integer('source_approach_id').references(() => repoApiApproaches.id, { onDelete: 'set null' }),
    name:            text('name').notNull(),           // e.g. "UserController", "auth_bp", "UserService"
    normalizedName:  text('normalized_name').notNull(),// lowercase, snake_case
    apiStyle:        apiStyleEnum('api_style').notNull(),
    protocol:        text('protocol'),                 // for rpc: "grpc", "thrift", "xmlrpc"
    basePath:        text('base_path'),                // base route prefix, if applicable
    packageOrModule: text('package_or_module'),        // Java package or Python module path
    confidence:      text('confidence').notNull(),     // "high" | "medium" | "low"
    primarySource:   jsonb('primary_source')
                       .$type<{ file: string; startLine: number; endLine: number; format: string }>(),
    createdAt:       timestamp('created_at').defaultNow().notNull(),
    updatedAt:       timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    repoIdx:        index().on(t.repoId),
    normalizedIdx:  index().on(t.repoId, t.normalizedName),
    approachIdx:    index().on(t.sourceApproachId),
    styleIdx:       index().on(t.repoId, t.apiStyle),
  })
)

// ── repo_api_endpoints ────────────────────────────────────────────────────
// One row per individual operation.
//   HTTP:      one row per (method, path) pair
//   GraphQL:   one row per field on Query/Mutation/Subscription type
//   RPC:       one row per service method

export const repoApiEndpoints = pgTable(
  'repo_api_endpoints',
  {
    id:               serial('id').primaryKey(),
    repoId:           integer('repo_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),
    apiId:            integer('api_id').notNull().references(() => repoApis.id, { onDelete: 'cascade' }),

    // HTTP fields
    httpMethod:       httpMethodEnum('http_method'),
    path:             text('path'),                    // e.g. "/api/v1/users/{id}"
    normalizedPath:   text('normalized_path'),         // lowercase, normalized {param}

    // GraphQL fields
    operationType:    graphqlOperationEnum('operation_type'),
    operationName:    text('operation_name'),

    // RPC fields
    rpcMethodName:    text('rpc_method_name'),
    requestType:      text('request_type'),
    responseType:     text('response_type'),
    rpcStreaming:     text('rpc_streaming'),           // "none", "client", "server", "bidirectional"

    // Common fields
    summary:          text('summary'),                 // from docstring or annotation
    tags:             jsonb('tags').$type<string[]>(), // controller name, group tags
    returnType:       text('return_type'),             // response model/class name
    confidence:       text('confidence').notNull(),

    // Source
    sourceFile:       text('source_file'),
    sourceLine:       integer('source_line'),

    createdAt:        timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    repoIdx:          index().on(t.repoId),
    apiIdx:           index().on(t.apiId),
    httpPathIdx:      index().on(t.repoId, t.httpMethod, t.normalizedPath),
    graphqlIdx:       index().on(t.repoId, t.operationType, t.operationName),
    rpcIdx:           index().on(t.apiId, t.rpcMethodName),
  })
)

// ── repo_api_parameters ───────────────────────────────────────────────────
// One row per parameter, argument, or message field on an endpoint.
//   HTTP path params, query params, request body fields
//   GraphQL operation arguments
//   gRPC message fields (from .proto message definitions)

export const repoApiParameters = pgTable(
  'repo_api_parameters',
  {
    id:           serial('id').primaryKey(),
    endpointId:   integer('endpoint_id').notNull().references(() => repoApiEndpoints.id, { onDelete: 'cascade' }),
    name:         text('name').notNull(),
    location:     paramLocationEnum('location').notNull(),  // path | query | body | header | field
    type:         text('type'),                             // type name from annotation / type hint
    required:     boolean('required'),
    description:  text('description'),
    ordinalPosition: integer('ordinal_position'),
  },
  (t) => ({
    endpointIdx:  index().on(t.endpointId),
  })
)
```

---

## Drizzle Relations

```ts
export const repoApiApproachesRelations = relations(repoApiApproaches, ({ one, many }) => ({
  repo:      one(repositories, { fields: [repoApiApproaches.repoId], references: [repositories.id] }),
  apis:      many(repoApis),
}))

export const repoApisRelations = relations(repoApis, ({ one, many }) => ({
  repo:           one(repositories, { fields: [repoApis.repoId], references: [repositories.id] }),
  sourceApproach: one(repoApiApproaches, { fields: [repoApis.sourceApproachId], references: [repoApiApproaches.id] }),
  endpoints:      many(repoApiEndpoints),
}))

export const repoApiEndpointsRelations = relations(repoApiEndpoints, ({ one, many }) => ({
  repo:       one(repositories, { fields: [repoApiEndpoints.repoId], references: [repositories.id] }),
  api:        one(repoApis, { fields: [repoApiEndpoints.apiId], references: [repoApis.id] }),
  parameters: many(repoApiParameters),
}))

export const repoApiParametersRelations = relations(repoApiParameters, ({ one }) => ({
  endpoint: one(repoApiEndpoints, { fields: [repoApiParameters.endpointId], references: [repoApiEndpoints.id] }),
}))
```

---

## Index Strategy

| Index | Rationale |
|-------|-----------|
| `repo_api_approaches(repo_id)` | Load all approaches for a repo in one query |
| `repo_api_approaches(repo_id, language, approach)` UNIQUE | Prevent duplicate approach records |
| `repo_apis(repo_id)` | Load all API surfaces for a repo |
| `repo_apis(repo_id, normalized_name)` | Deduplicate by name during merge |
| `repo_apis(repo_id, api_style)` | Filter by style (HTTP/GraphQL/RPC) for UI tabs |
| `repo_api_endpoints(repo_id)` | Load all endpoints for a repo |
| `repo_api_endpoints(api_id)` | Load all endpoints for a specific API surface |
| `repo_api_endpoints(repo_id, http_method, normalized_path)` | Deduplicate HTTP endpoints across extractors |
| `repo_api_endpoints(repo_id, operation_type, operation_name)` | Deduplicate GraphQL operations |
| `repo_api_endpoints(api_id, rpc_method_name)` | Deduplicate RPC methods |
| `repo_api_parameters(endpoint_id)` | Load params for an endpoint |

---

## Re-Analysis Handling

When `analyze_apis` runs with `forceReanalysis: true`:
1. Delete all `repo_api_parameters` where `endpoint_id` in (endpoints for this repo) — cascade handles this
2. Delete all `repo_api_endpoints` for the repo — cascade removes parameters
3. Delete all `repo_apis` for the repo — cascade removes endpoints
4. Delete all `repo_api_approaches` for the repo
5. Re-run detection and extraction from scratch

When `forceReanalysis` is false (default):
- Skip if any `repo_api_approaches` rows exist for the repo
- Return `{ skipped: true }` immediately

---

## Data Volume Estimates

For a typical mid-size backend service (e.g., a Spring Boot monolith):
- `repo_api_approaches`: 2–5 rows
- `repo_apis`: 10–50 rows (one per controller)
- `repo_api_endpoints`: 50–500 rows
- `repo_api_parameters`: 100–2,000 rows

For large projects (e.g., a comprehensive API gateway or Django REST Framework app with many views):
- `repo_api_endpoints`: up to ~2,000 rows
- `repo_api_parameters`: up to ~10,000 rows

These are within comfortable PostgreSQL range without partitioning.
