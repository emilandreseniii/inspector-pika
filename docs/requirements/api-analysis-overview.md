# API Analysis — Overview

Inspector Pika is a code analysis tool that catalogs metadata about software repositories. The API analysis feature extends this with the ability to **detect and catalog API surfaces** — HTTP/REST endpoints, GraphQL operations, and RPC service methods — directly from a repository's source code, without requiring a running application or build.

---

## Goal

Given a cloned source code repository, determine:

1. **Which API frameworks or patterns are in use** (Spring MVC, FastAPI, gRPC, GraphQL, etc.)
2. **What API surfaces those frameworks define** — controllers, routers, services, schema types
3. **What individual operations each surface exposes** — endpoint paths, HTTP methods, RPC method names, query/mutation names, input and output types

Results are stored in the database and surfaced in the Inspector Pika UI on the Repository page, with display modes tailored to each API style.

---

## Two-Phase Approach

### Phase 1: Detection

Before extracting endpoints, the system determines *which* extraction strategies apply to the repository. Running every extractor on every repo would be expensive and noisy. Instead, a lightweight **detector** scans the repo for signals — dependency file contents, file extensions, directory names, and code patterns — and produces a list of detected approaches with confidence scores.

Detection is fast (grep-based, no parsing) and runs over the cloned source directory.

**Output:** An array of `DetectedApiApproach` records, each identifying a language + framework/approach combination and a confidence level (`high`, `medium`, `low`).

See [api-detection-plan.md](../design/api-detection-plan.md) for the full detection signal table and confidence scoring rules.

### Phase 2: Extraction

For each detected approach with confidence >= `medium`, the system runs the corresponding **extractor**. Extractors parse source files to identify API surfaces and their operations, using regex/AST techniques appropriate to each framework.

Each extractor produces a list of `RawApi` objects containing `RawEndpoint` arrays. The raw results from all extractors are **normalized** into a common `ApiRecord` format and **deduplicated** — if two extractors find overlapping routes (e.g., an OpenAPI spec and Spring annotations describing the same paths), they are merged with multiple source locations.

See [api-extractor-architecture.md](../design/api-extractor-architecture.md) for the full module structure, interfaces, and extractor registry.

---

## API Styles

The system recognizes three distinct API styles, each with its own information model and display approach:

### HTTP / REST

Endpoints identified by an HTTP method + URL path pattern. Extracted information:

- Method (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `HEAD`, `OPTIONS`)
- Path pattern (e.g., `/api/v1/users/{id}`)
- Path parameters (named segments in the path)
- Query parameters (where statically declared)
- Request body type (class name or schema reference, where determinable)
- Response type (where determinable from return annotations or type hints)
- Group / tag (controller class name, blueprint name, router prefix)
- Source location (file, line number)

### GraphQL

Operations defined in a schema or in resolver code. Extracted information:

- Operation type (`Query`, `Mutation`, `Subscription`)
- Operation name
- Arguments with types
- Return type
- Defined in: schema file path or resolver source file
- Schema types (Object, Input, Enum, Interface, Union — from `.graphql` files)

### RPC (gRPC / Thrift / other)

Service-oriented method calls. Extracted information:

- Protocol (`grpc`, `thrift`, `xmlrpc`, etc.)
- Service name
- Package / namespace
- RPC method names with request and response message types
- Message definitions (field names and types from `.proto` / `.thrift` files)
- Source location (`.proto` file path, line number)

---

## Supported Languages and Frameworks

| Language | REST/HTTP | GraphQL | RPC |
|----------|-----------|---------|-----|
| Java | Spring MVC, JAX-RS, Micronaut, Quarkus | Netflix DGS, Spring for GraphQL, Graphql-Java | gRPC-Java, Apache Thrift, Apache Avro RPC |
| Python | Flask, FastAPI, Django REST Framework, Django views, Tornado, Sanic | Graphene, Strawberry, Ariadne | gRPC (grpcio), Thrift (thrift), xmlrpc |
| TypeScript/JS | Express, Fastify, NestJS, Hono, Koa | Apollo Server, TypeGraphQL, Pothos | gRPC-node, Connect-RPC |
| Go | net/http, Gin, Echo, Chi, Fiber | gqlgen, graphql-go | gRPC-Go, Twirp |
| Kotlin | Spring MVC, Ktor, JAX-RS | Netflix DGS, Ktor GraphQL | gRPC-Kotlin |
| Ruby | Rails routes, Grape, Sinatra | graphql-ruby | gRPC |
| C# | ASP.NET Core (Controller / Minimal API), NancyFx | Hot Chocolate, GraphQL.NET | gRPC, WCF |
| Rust | Actix-web, Axum, Warp, Rocket | async-graphql, Juniper | tonic (gRPC) |
| PHP | Laravel routes, Symfony routing, Slim | Lighthouse, Webonyx GraphQL | gRPC-PHP, Thrift |
| Go | (see above) | | |
| — (cross-language) | OpenAPI / Swagger specs | `.graphql` / `.graphqls` schema files | `.proto` files, `.thrift` files |

The cross-language category applies to any repo regardless of primary language, since OpenAPI specs, `.proto` files, and GraphQL schemas frequently appear alongside any server-side project.

**Initial implementation targets Java and Python first**, with the cross-language extractors (OpenAPI, proto, GraphQL schema files) applying universally.

---

## How Results Are Stored

API analysis results are stored in four new PostgreSQL tables:

| Table | Purpose |
|-------|---------|
| `repo_api_approaches` | One row per detected framework per repo (Phase 1 output) |
| `repo_apis` | One row per distinct API surface (controller, router, service) |
| `repo_api_endpoints` | One row per operation (HTTP endpoint, GraphQL field, RPC method) |
| `repo_api_parameters` | One row per parameter or field on an endpoint |

See [api-database-schema-plan.md](../design/api-database-schema-plan.md) for the full Drizzle ORM schema definitions.

---

## How Results Are Displayed

API analysis results appear on the **Repository page** in the Inspector Pika UI, in a new "API Surfaces" section. The display adapts to the API style:

### REST / HTTP display (Swagger-style)

- Method badge in color (green=GET, blue=POST, orange=PUT, red=DELETE, purple=PATCH)
- Path pattern next to the badge
- Endpoints grouped by controller/router/blueprint name
- Expandable panel per endpoint: path params, query params, request body type, response type, source file link
- Sortable by path, method, or group

### GraphQL display

- Tabs for Query / Mutation / Subscription
- Each operation shown as `operationName(arg: Type, ...): ReturnType`
- Schema types listed separately (Object types, Input types, Enums)
- Source file shown for each type/resolver

### RPC display

- Grouped by service name and package
- Each RPC method shown as `MethodName(RequestType): ResponseType`
- Message type definitions expandable (fields with types)
- Protocol badge (gRPC, Thrift, etc.)

See [api-ui-plan.md](../design/api-ui-plan.md) for the full component hierarchy and state management plan.

---

## How the Job Is Triggered

API analysis runs as a new job type: `analyze_apis`. It follows the same pattern as `analyze_entities`:

1. A `POST /api/v1/jobs` call creates the job record with `status: 'pending'`
2. `jobRunner.ts` picks it up asynchronously and calls `runAnalyzeApis()`
3. The job updates the DB with results and sets `status: 'completed'` or `'failed'`

The job requires the repository to already be cloned. The `analyze_languages` job should run first for best results (enables language-gated detection), though cross-language approaches (OpenAPI, proto files, GraphQL schemas) fire regardless.

See [api-job-plan.md](../design/api-job-plan.md) for the full job execution flow, API additions, and error handling plan.

---

## Related Documents

| Document | Description |
|----------|-------------|
| [api-detection-plan.md](../design/api-detection-plan.md) | Phase 1: signal tables, confidence scoring, detection module design |
| [api-extractor-architecture.md](../design/api-extractor-architecture.md) | Phase 2: extractor module structure, interfaces, registry |
| [api-database-schema-plan.md](../design/api-database-schema-plan.md) | New Drizzle ORM schema tables and index definitions |
| [api-job-plan.md](../design/api-job-plan.md) | `analyze_apis` job type: flow, API endpoints, error handling |
| [api-ui-plan.md](../design/api-ui-plan.md) | React component hierarchy and UI state plan |
| [languages/java/api-definition-methods.md](./languages/java/api-definition-methods.md) | Detailed Java API framework inventory |
| [languages/python/api-definition-methods.md](./languages/python/api-definition-methods.md) | Detailed Python API framework inventory |
