# API Extractor Architecture — Phase 2

This document describes the Phase 2 extraction system for API analysis. Phase 1 detection is described in [api-detection-plan.md](./api-detection-plan.md).

---

## Overview

For each approach detected at `medium` or `high` confidence, the system runs the corresponding **extractor**. Extractors parse source files to produce structured `RawApi` objects containing endpoint/operation lists.

The extraction pipeline is:

```
DetectedApiApproach[]
    → ApiExtractorRegistry.getExtractors(approach)
    → extractor.extract()           → RawApi[]
    → normalize(RawApi[])           → ApiRecord[]
    → deduplicate(ApiRecord[])      → ApiRecord[]  (cross-approach merge)
    → persist to DB
```

---

## Core Interfaces

### RawEndpoint

A single operation — one HTTP endpoint, one GraphQL field, or one RPC method.

```ts
interface RawEndpoint {
  // HTTP
  httpMethod?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS'
  path?: string                  // e.g. "/api/v1/users/{id}" — full resolved path

  // GraphQL
  operationType?: 'Query' | 'Mutation' | 'Subscription'
  operationName?: string         // e.g. "getUser"

  // RPC
  rpcMethodName?: string         // e.g. "GetUser"
  requestType?: string           // message/class name, e.g. "GetUserRequest"
  responseType?: string          // message/class name, e.g. "GetUserResponse"

  // Common
  summary?: string               // brief description from docstring or annotation
  parameters?: RawApiParameter[]
  tags?: string[]                // grouping tags (controller name, blueprint prefix, etc.)
  source: SourceLocation
}
```

### RawApiParameter

A parameter or field on an endpoint.

```ts
interface RawApiParameter {
  name: string
  location: 'path' | 'query' | 'body' | 'header' | 'field'
  type?: string                  // type name from annotation or type hint
  required?: boolean
  description?: string
}
```

### RawApi

A collection of related endpoints — one controller, one blueprint, one service, or one schema file.

```ts
interface RawApi {
  name: string                   // e.g. "UserController", "auth_bp", "UserService"
  apiStyle: 'http' | 'graphql' | 'rpc'
  protocol?: string              // for rpc: "grpc", "thrift", "xmlrpc"
  basePath?: string              // base route prefix, if any
  packageOrModule?: string       // Java package, Python module path, etc.
  endpoints: RawEndpoint[]
  schemaTypes?: RawSchemaType[]  // for graphql: Object/Input/Enum/Interface types
  source: SourceLocation
}
```

### RawSchemaType

For GraphQL schema files — type definitions beyond just operations.

```ts
interface RawSchemaType {
  typeName: string               // e.g. "User"
  typeKind: 'object' | 'input' | 'enum' | 'interface' | 'union' | 'scalar'
  fields?: RawApiParameter[]
  source: SourceLocation
}
```

### ExtractorResult (ApiExtractorResult)

```ts
interface ApiExtractorResult {
  apis: RawApi[]
  warnings: string[]
  stats: {
    filesScanned: number
    apisFound: number
    endpointsFound: number
    extractionTimeMs: number
  }
}
```

---

## BaseApiExtractor

All extractors extend a common `BaseApiExtractor` abstract class, itself extending `BaseExtractor` (the existing entity extractor base):

```ts
// server/src/services/apiAnalysis/extractors/base.ts

export abstract class BaseApiExtractor extends BaseExtractor {
  abstract readonly extractorId: string
  abstract extract(): Promise<ApiExtractorResult>
}
```

`BaseExtractor` already provides:
- `this.glob(pattern)` — glob files relative to `sourceDir`
- `this.readFile(path)` — read a file
- `this.grep(fileGlob, pattern)` — grep for patterns

---

## Extractor Registry

```ts
// server/src/services/apiAnalysis/registry.ts

type ExtractorConstructor = new (ctx: ExtractorContext) => BaseApiExtractor

const registry = new Map<string, ExtractorConstructor>()

function register(language: string, approach: string, cls: ExtractorConstructor) {
  registry.set(`${language}::${approach}`, cls)
}

export function getApiExtractors(
  approaches: DetectedApiApproach[],
  ctx: ExtractorContext
): BaseApiExtractor[] {
  return approaches
    .filter((a) => a.confidence !== 'low')
    .flatMap((a) => {
      const key = `${a.language}::${a.approach}`
      const Cls = registry.get(key)
      return Cls ? [new Cls(ctx)] : []
    })
}

// ── Registrations ──────────────────────────────────────────────────────────

// Java / Kotlin
register('Java',   'spring_mvc',       SpringMvcExtractor)
register('Kotlin', 'spring_mvc',       SpringMvcExtractor)
register('Java',   'jax_rs',           JaxRsExtractor)
register('Java',   'spring_graphql',   SpringGraphQLExtractor)
register('Java',   'netflix_dgs',      NetflixDgsExtractor)
register('Java',   'grpc_java',        GrpcJavaExtractor)
register('Kotlin', 'ktor',             KtorExtractor)

// Python
register('Python', 'flask',                    FlaskExtractor)
register('Python', 'fastapi',                  FastApiExtractor)
register('Python', 'django_views',             DjangoViewsExtractor)
register('Python', 'django_rest_framework',    DjangoRestFrameworkExtractor)
register('Python', 'graphene',                 GrapheneExtractor)
register('Python', 'strawberry',               StrawberryExtractor)
register('Python', 'grpc_python',              GrpcPythonExtractor)

// Cross-language (always run if detected)
register('cross-language', 'openapi_spec',     OpenApiSpecExtractor)
register('cross-language', 'grpc_proto',       GrpcProtoExtractor)
register('cross-language', 'graphql_schema',   GraphQLSchemaExtractor)
register('cross-language', 'thrift_idl',       ThriftIdlExtractor)
```

---

## Extractor Module Structure

```
server/src/services/apiAnalysis/
├── index.ts                — main orchestrator (runAnalyzeApis)
├── detector.ts             — Phase 1: approach detection
├── normalizer.ts           — RawApi[] → ApiRecord[]
├── deduplicator.ts         — merge overlapping ApiRecord entries
├── registry.ts             — extractor registry
└── extractors/
    ├── base.ts             — BaseApiExtractor
    ├── languages/
    │   ├── java/
    │   │   ├── springMvc.ts
    │   │   ├── jaxRs.ts
    │   │   ├── springGraphql.ts
    │   │   ├── netflixDgs.ts
    │   │   ├── grpcJava.ts
    │   │   └── __tests__/
    │   ├── kotlin/
    │   │   ├── ktor.ts
    │   │   └── __tests__/
    │   └── python/
    │       ├── flask.ts
    │       ├── fastapi.ts
    │       ├── djangoViews.ts
    │       ├── djangoRestFramework.ts
    │       ├── graphene.ts
    │       ├── strawberry.ts
    │       ├── grpcPython.ts
    │       └── __tests__/
    └── shared/
        ├── openApiSpec.ts      — parse openapi.yaml / swagger.json
        ├── grpcProto.ts        — parse .proto files
        ├── graphqlSchema.ts    — parse .graphql schema files
        ├── thriftIdl.ts        — parse .thrift files
        └── __tests__/
```

---

## Key Extractor Implementations

### Spring MVC Extractor (Java)

**Strategy:**
1. Glob for `*.java` files
2. Find classes annotated with `@RestController` or `@Controller`
3. For each class, extract the class-level `@RequestMapping` base path
4. For each method, extract `@GetMapping`, `@PostMapping`, `@PutMapping`, `@DeleteMapping`, `@PatchMapping`, `@RequestMapping` annotations
5. Concatenate class path + method path to produce the full route
6. Extract `@RequestParam`, `@PathVariable`, `@RequestBody` for parameter info

**Path resolution example:**

```java
@RestController
@RequestMapping("/api/v1/users")
public class UserController {
    @GetMapping("/{id}")       // → GET /api/v1/users/{id}
    @PostMapping               // → POST /api/v1/users
    @DeleteMapping("/{id}")    // → DELETE /api/v1/users/{id}
}
```

**Regex patterns (applied to logical-line-joined source):**
- Class level: `/^@RequestMapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/`
- Method level: `/^@(Get|Post|Put|Delete|Patch)Mapping\s*(?:\(\s*(?:value\s*=\s*)?["']([^"']*?)["']\s*\))?/`
- `@PathVariable String (\w+)` → path parameter
- `@RequestParam(?: .*?) (\w+)` → query parameter

### JAX-RS Extractor (Java)

**Strategy:**
1. Find classes annotated with `@Path`
2. Extract class-level `@Path` value as base path
3. For each method, extract `@Path` (sub-path) + `@GET`/`@POST`/`@PUT`/`@DELETE`/`@PATCH`
4. Extract `@PathParam`, `@QueryParam`, `@FormParam` for parameters
5. Extract `@Consumes` / `@Produces` for content type info

### FastAPI Extractor (Python)

**Strategy:**
1. Use `joinLogicalLines` (same as SQLAlchemy extractor) to handle multi-line decorators
2. Find `APIRouter()` and `FastAPI()` assignments to identify router objects
3. Track `@router.get(...)`, `@app.get(...)`, etc. on function definitions
4. Extract path from decorator first arg, operation name from function name
5. Extract `include_router(router, prefix=...)` calls to resolve prefix chains
6. For path parameters: match `{param_name}` in the path string
7. For query/body parameters: scan function signature for `Query(...)`, `Body(...)`, `Path(...)` and simple typed params

**Prefix resolution:**
```python
router = APIRouter(prefix="/users")
app.include_router(router, prefix="/api/v1")
# → full base path: /api/v1/users
```

**Decorator pattern:**
```python
@router.get("/{user_id}", response_model=UserResponse)
async def get_user(user_id: int, db: Session = Depends(get_db)):
    ...
# → GET /api/v1/users/{user_id}, path param: user_id (int)
```

### Flask Extractor (Python)

**Strategy:**
1. Find `Flask(__name__)` and `Blueprint(...)` assignments
2. Find `app.route(...)` and `blueprint.route(...)` decorators
3. Extract path from first arg, HTTP methods from `methods=[...]` kwarg (default: GET)
4. Track `url_prefix` on Blueprint registration to resolve full paths
5. Extract `<type:name>` path parameters from route strings

**Blueprint prefix resolution:**
```python
auth_bp = Blueprint('auth', __name__, url_prefix='/auth')
@auth_bp.route('/login', methods=['POST'])
def login(): ...
# → POST /auth/login
app.register_blueprint(auth_bp, url_prefix='/api/v1')
# → POST /api/v1/auth/login
```

Note: Flask prefix resolution requires tracking `register_blueprint` calls across files. When the prefix chain cannot be resolved statically, emit the known sub-path and note the unresolved prefix in warnings.

### Django REST Framework Extractor (Python)

**Strategy:**
1. Find `ViewSet` subclasses — extract the model name and generate standard CRUD routes via `router.register()`
2. Find `APIView` subclasses — extract `get()`, `post()`, `put()`, `patch()`, `delete()` methods
3. Parse `urls.py` files to find `router.register(prefix, ViewSet)` mappings
4. For `@api_view(['GET', 'POST'])` function-based views, extract from `urls.py`

**Standard ViewSet route expansion:**
A `router.register('users', UserViewSet)` produces:
- `GET /users/` — list
- `POST /users/` — create
- `GET /users/{id}/` — retrieve
- `PUT /users/{id}/` — update
- `PATCH /users/{id}/` — partial_update
- `DELETE /users/{id}/` — destroy

### gRPC Proto Extractor (Cross-Language)

**Strategy:**
1. Glob all `*.proto` files
2. Parse `syntax`, `package`, and `option java_package` / `option go_package` declarations
3. Extract `service ServiceName { ... }` blocks
4. Within each service, extract `rpc MethodName (RequestType) returns (ResponseType)` declarations
5. Extract `message MessageType { ... }` definitions with their fields
6. Resolve field types (scalar vs. message references)

**Proto parsing example:**
```proto
package user.v1;
service UserService {
  rpc GetUser (GetUserRequest) returns (GetUserResponse);
  rpc ListUsers (ListUsersRequest) returns (stream ListUsersResponse);
}
message GetUserRequest {
  string user_id = 1;
}
```
→ RawApi { name: "UserService", apiStyle: "rpc", protocol: "grpc", endpoints: [ { rpcMethodName: "GetUser", requestType: "GetUserRequest", responseType: "GetUserResponse" }, ... ] }

### OpenAPI Spec Extractor (Cross-Language)

**Strategy:**
1. Glob for `openapi.yaml`, `openapi.json`, `swagger.yaml`, `swagger.json`, `**/api-spec*.yaml`
2. Parse YAML/JSON (using `js-yaml` or `JSON.parse`)
3. Walk the `paths` object: for each path key and each HTTP method, create a `RawEndpoint`
4. Extract `parameters` (path, query, header), `requestBody`, and `responses[200].content` for type info
5. Resolve `$ref` references within the same document for inline type names
6. Extract top-level `info.title` as the API name

---

## Normalization

`normalizer.ts` converts `RawApi[]` into `ApiRecord[]` for storage:

- Assigns stable `normalizedPath` (lowercase, strip trailing slash, normalize `{param}` → `{param}`)
- For gRPC: normalizedPath = `package/ServiceName/MethodName`
- For GraphQL: normalizedPath = `Query/operationName`, `Mutation/operationName`
- Converts `RawEndpoint` → `ApiEndpointRecord` with all DB-storable fields
- Converts `RawApiParameter` → `ApiParameterRecord`

---

## Deduplication

`deduplicator.ts` merges overlapping records from different extractors:

- Dedup key for HTTP: `(httpMethod, normalizedPath)`
- Dedup key for GraphQL: `(operationType, operationName)`
- Dedup key for RPC: `(protocol, service, rpcMethodName)`

When two extractors produce the same endpoint (e.g., a Spring controller and an OpenAPI spec both describe `GET /users/{id}`), the records are merged: the OpenAPI spec may contribute richer type information while the Spring extractor contributes the source file location. Both source locations are preserved in a `sources` JSONB array.

---

## Error Handling

Each extractor runs in isolation via `Promise.allSettled`. A single extractor failure:
- Is caught and logged as a warning
- Does not block other extractors from running
- Results in a warning entry in `repo_api_approaches.signals`

Partial results from a partially-failed extractor are still persisted — if the extractor extracted 40 endpoints before throwing, those 40 are kept.
