# API Detection Plan — Phase 1

This document describes how Inspector Pika determines which API frameworks are present in a cloned repository. This is Phase 1 of the API analysis pipeline. Phase 2 (extraction) is described in [api-extractor-architecture.md](./api-extractor-architecture.md).

---

## Overview

Phase 1 detection is a **lightweight, fast scan** that runs before any expensive parsing. It answers the question: "Which API extractors should we run?"

Detection avoids spawning language runtimes or build tools. It works entirely by:
- Reading known dependency manifest files
- Globbing for file extensions and directory names
- Running grep patterns over source files

The output is an array of `DetectedApiApproach` objects, each with a language, approach identifier, confidence level, and the list of signals that triggered the detection.

---

## Step 1: Language Identification

Language detection is **already complete** by the time `analyze_apis` runs. The `repoLanguages` table is populated by the `analyze_languages` job (which runs `enry`). The API detection step reads from this table at the start of execution.

```ts
// In runAnalyzeApis():
const languages = await db
  .select()
  .from(repoLanguages)
  .where(eq(repoLanguages.repoId, input.repoId))
  .orderBy(desc(repoLanguages.bytes))
```

This drives which per-language detection modules are invoked.

Cross-language approaches (OpenAPI specs, raw `.proto` files, `.graphql` schema files, `.thrift` files) are always checked regardless of detected languages.

---

## Step 2: Per-Language Signal Checks

For each language present in `repoLanguages`, the detector runs a set of signal checks grouped into three tiers:

- **Tier A — Dependency file match**: The framework appears as a named dependency in a package manifest. Strongest signal — it is explicit and intentional.
- **Tier B — File/directory pattern match**: Known framework-specific files or directory structures exist (e.g., `app/controllers/`, `resources/openapi.yaml`).
- **Tier C — Code pattern match**: A grep over source files finds an import, annotation, or decorator specific to the framework.

Signals are checked in parallel using `Promise.all`.

---

## Step 3: Confidence Scoring

Each detected approach receives a confidence score based on how many signal tiers confirmed it:

| Signals Present | Confidence |
|-----------------|-----------|
| Tier A only | `medium` |
| Tier B only | `low` |
| Tier C only | `low` |
| Tier A + Tier B | `high` |
| Tier A + Tier C | `high` |
| Tier B + Tier C | `medium` |
| All three tiers | `high` |

A `low` confidence detection is written to `repo_api_approaches` but extractors are not run for it unless `forceReanalysis: true` is passed.

---

## Step 4: Output Format

The detector outputs an array of `DetectedApiApproach` objects:

```ts
interface DetectedApiApproach {
  language: string           // e.g. "Java", "Python", or "cross-language"
  approach: string           // e.g. "spring_mvc", "fastapi", "grpc_proto"
  apiStyle: 'http' | 'graphql' | 'rpc'
  confidence: 'high' | 'medium' | 'low'
  signals: string[]          // human-readable description of each matched signal
}
```

Example output for a Spring Boot + gRPC project:

```json
[
  {
    "language": "Java",
    "approach": "spring_mvc",
    "apiStyle": "http",
    "confidence": "high",
    "signals": [
      "Tier A: 'spring-boot-starter-web' found in pom.xml",
      "Tier B: src/main/java/com/example/controller/ directory exists",
      "Tier C: '@RestController' found in UserController.java"
    ]
  },
  {
    "language": "cross-language",
    "approach": "grpc_proto",
    "apiStyle": "rpc",
    "confidence": "high",
    "signals": [
      "Tier B: 3 .proto files found in src/main/proto/",
      "Tier C: 'service ' keyword found in user.proto"
    ]
  }
]
```

---

## Step 5: Implementation

The detector is implemented as `server/src/services/apiAnalysis/detector.ts`.

```ts
export async function detectApiApproaches(
  sourceDir: string,
  languages: Array<{ language: string; bytes: number }>
): Promise<DetectedApiApproach[]>
```

Internally it delegates to per-language detector functions and always runs the cross-language detector:

```ts
const detectorMap: Record<string, ApiLanguageDetector> = {
  'Java':       detectJavaApiApproaches,
  'Kotlin':     detectKotlinApiApproaches,
  'Python':     detectPythonApiApproaches,
  'TypeScript': detectTypeScriptApiApproaches,
  'JavaScript': detectJavaScriptApiApproaches,
  'Go':         detectGoApiApproaches,
  'Ruby':       detectRubyApiApproaches,
  'C#':         detectCSharpApiApproaches,
  'Rust':       detectRustApiApproaches,
  'PHP':        detectPhpApiApproaches,
}

const crossLanguageResults = await detectCrossLanguageApiApproaches(sourceDir)
```

---

## Detection Signal Tables

### Java

| Approach | Tier A: Dependency File | Key Package Names | Tier B: File Patterns | Tier C: Code Patterns |
|----------|------------------------|-------------------|-----------------------|-----------------------|
| `spring_mvc` | `pom.xml`, `build.gradle`, `build.gradle.kts` | `spring-boot-starter-web`, `spring-webmvc`, `spring-boot-starter-webflux` | `**/controller/*.java`, `**/controllers/*.java` | `@RestController`, `@Controller`, `@RequestMapping`, `@GetMapping`, `@PostMapping` |
| `jax_rs` | same | `jakarta.ws.rs-api`, `javax.ws.rs-api`, `jersey-server`, `resteasy-core`, `quarkus-resteasy-reactive` | `**/resource/*.java`, `**/resources/*.java` | `@Path(`, `@GET`, `@POST`, `@PUT`, `@DELETE`, `import jakarta.ws.rs`, `import javax.ws.rs` |
| `micronaut_http` | same | `io.micronaut:micronaut-http-server`, `micronaut-http` | `**/controller/*.java` | `@Controller`, `import io.micronaut.http.annotation` |
| `spring_graphql` | same | `spring-boot-starter-graphql`, `graphql-java-spring-boot-starter` | `**/resolver/*.java`, `resources/**/*.graphqls` | `@QueryMapping`, `@MutationMapping`, `@SchemaMapping`, `@SubscriptionMapping` |
| `netflix_dgs` | same | `com.netflix.graphql.dgs:graphql-dgs-spring-boot-starter` | `**/datafetcher/*.java`, `**/fetcher/*.java` | `@DgsComponent`, `@DgsQuery`, `@DgsMutation`, `@DgsSubscription` |
| `grpc_java` | same | `io.grpc:grpc-protobuf`, `io.grpc:grpc-stub`, `grpc-java` | `**/proto/*.proto`, `src/main/proto/**/*.proto` | `extends.*ImplBase`, `StreamObserver<`, `import io.grpc` |

### Kotlin

| Approach | Tier A: Dependency File | Key Package Names | Tier B: File Patterns | Tier C: Code Patterns |
|----------|------------------------|-------------------|-----------------------|-----------------------|
| `spring_mvc` | `pom.xml`, `build.gradle.kts` | `spring-boot-starter-web`, `spring-webmvc` | `**/controller/*.kt`, `**/controllers/*.kt` | `@RestController`, `@GetMapping`, `@PostMapping`, `@RequestMapping` |
| `ktor` | `build.gradle.kts` | `io.ktor:ktor-server-core`, `ktor-server-netty` | `**/routing/*.kt`, `Application.kt` | `routing {`, `get(`, `post(`, `install(Routing`, `import io.ktor.server` |
| `grpc_kotlin` | `build.gradle.kts` | `io.grpc:grpc-kotlin-stub` | `src/main/proto/**/*.proto` | `extends.*ImplBase`, `CoroutineScope` |

### Python

| Approach | Tier A: Dependency File | Key Package Names | Tier B: File Patterns | Tier C: Code Patterns |
|----------|------------------------|-------------------|-----------------------|-----------------------|
| `flask` | `requirements*.txt`, `Pipfile`, `pyproject.toml` | `Flask`, `flask` | `app.py`, `wsgi.py`, `**/views.py`, `**/routes.py` | `@app.route(`, `@bp.route(`, `Blueprint(`, `from flask import`, `flask.Flask(` |
| `fastapi` | same | `fastapi`, `uvicorn[standard]`, `uvicorn` | `main.py`, `**/routers/*.py`, `**/api/*.py` | `@app.get(`, `@app.post(`, `@router.get(`, `@router.post(`, `APIRouter(`, `from fastapi import` |
| `django_views` | same | `Django`, `django` | `**/urls.py`, `**/views.py` | `urlpatterns`, `path(`, `re_path(`, `include(`, `def get(self`, `def post(self` |
| `django_rest_framework` | same | `djangorestframework`, `rest_framework` | `**/serializers.py`, `**/viewsets.py` | `from rest_framework`, `@api_view(`, `class.*APIView`, `ModelViewSet`, `router.register(` |
| `graphene` | same | `graphene`, `graphene-django` | `**/schema.py`, `**/graphql/*.py` | `import graphene`, `graphene.ObjectType`, `graphene.Schema(`, `class Query(` |
| `strawberry` | same | `strawberry-graphql` | `**/schema.py`, `**/graphql/*.py` | `import strawberry`, `@strawberry.type`, `@strawberry.field`, `strawberry.Schema(` |
| `grpc_python` | same | `grpcio`, `grpcio-tools` | `*_pb2_grpc.py`, `**/proto/*.proto` | `import grpc`, `grpc.server(`, `add_.*Servicer_to_server`, `class.*Servicer` |
| `tornado` | same | `tornado` | `**/handlers/*.py`, `app.py` | `from tornado`, `tornado.web.RequestHandler`, `class.*RequestHandler`, `def get(self`, `def post(self` |

### TypeScript / JavaScript

| Approach | Tier A: Dependency File | Key Package Names | Tier B: File Patterns | Tier C: Code Patterns |
|----------|------------------------|-------------------|-----------------------|-----------------------|
| `express` | `package.json` | `express` | `**/routes/*.ts`, `**/routes/*.js` | `router.get(`, `router.post(`, `app.get(`, `app.use(`, `express.Router(` |
| `fastify` | `package.json` | `fastify` | `**/routes/*.ts`, `**/plugins/*.ts` | `fastify.get(`, `fastify.post(`, `fastify.register(`, `import fastify` |
| `nestjs` | `package.json` | `@nestjs/core`, `@nestjs/common` | `**/controllers/*.ts`, `**/*.controller.ts` | `@Controller(`, `@Get(`, `@Post(`, `@Put(`, `@Delete(`, `@Module(` |
| `apollo_server` | `package.json` | `@apollo/server`, `apollo-server`, `apollo-server-express` | `**/schema.ts`, `**/resolvers/*.ts` | `ApolloServer(`, `gql\``, `typeDefs`, `resolvers`, `Query:`, `Mutation:` |
| `type_graphql` | `package.json` | `type-graphql` | `**/resolvers/*.ts` | `@Resolver(`, `@Query(`, `@Mutation(`, `@ObjectType(` |
| `grpc_node` | `package.json` | `@grpc/grpc-js`, `grpc` | `*.proto`, `**/proto/` | `grpc.loadPackageDefinition(`, `server.addService(` |

### Go

| Approach | Tier A: Dependency File | Key Package Names | Tier B: File Patterns | Tier C: Code Patterns |
|----------|------------------------|-------------------|-----------------------|-----------------------|
| `gin` | `go.mod` | `github.com/gin-gonic/gin` | `**/routes/*.go`, `**/handlers/*.go` | `gin.Default()`, `r.GET(`, `r.POST(`, `gin.Context` |
| `echo` | `go.mod` | `github.com/labstack/echo` | `**/handlers/*.go` | `echo.New()`, `e.GET(`, `e.POST(`, `echo.Context` |
| `net_http` | `go.mod` or std lib | (stdlib) | any `.go` | `http.HandleFunc(`, `http.Handle(`, `mux.HandleFunc(`, `ServeMux` |
| `grpc_go` | `go.mod` | `google.golang.org/grpc` | `*.proto`, `**/proto/` | `grpc.NewServer()`, `pb.Register.*Server(`, `import google.golang.org/grpc` |
| `gqlgen` | `go.mod` | `github.com/99designs/gqlgen` | `graph/schema.graphqls`, `gqlgen.yml` | `graphql.NewSchema(`, `schema.graphqls` file exists |

### Ruby

| Approach | Tier A | Tier B | Tier C |
|----------|--------|--------|--------|
| `rails_routes` | `Gemfile`: `rails` | `config/routes.rb`, `app/controllers/*.rb` | `resources :`, `get '`, `post '`, `ActionController::API`, `ApplicationController` |
| `grape` | `Gemfile`: `grape` | `**/api/*.rb`, `**/v1/*.rb` | `class.*Grape::API`, `get '`, `post '`, `resource '`, `namespace '` |
| `sinatra` | `Gemfile`: `sinatra` | `app.rb`, `**/app/*.rb` | `get '`, `post '`, `require 'sinatra'`, `Sinatra::Application` |
| `graphql_ruby` | `Gemfile`: `graphql` | `app/graphql/**/*.rb` | `class.*GraphQL::Schema`, `field :`, `argument :`, `mutation :` |

### C# (.NET)

| Approach | Tier A | Tier B | Tier C |
|----------|--------|--------|--------|
| `aspnet_controller` | `*.csproj`: `Microsoft.AspNetCore` | `**/Controllers/*.cs` | `[ApiController]`, `[Route(`, `[HttpGet`, `[HttpPost`, `ControllerBase` |
| `aspnet_minimal` | `*.csproj`: `Microsoft.AspNetCore` | `Program.cs` | `app.MapGet(`, `app.MapPost(`, `app.MapPut(`, `app.MapDelete(`, `WebApplication.Create` |
| `hot_chocolate` | `*.csproj`: `HotChocolate` | `**/Queries/*.cs`, `**/Mutations/*.cs` | `[QueryType]`, `[MutationType]`, `[ObjectType]`, `IQueryable` |
| `grpc_csharp` | `*.csproj`: `Grpc.AspNetCore`, `Grpc.Tools` | `**/*.proto`, `**/Protos/` | `using Grpc.Core`, `AppContext.SetSwitch`, `MapGrpcService` |

### Rust

| Approach | Tier A | Tier B | Tier C |
|----------|--------|--------|--------|
| `actix_web` | `Cargo.toml`: `actix-web` | `src/handlers/*.rs`, `src/routes*.rs` | `#[get(`, `#[post(`, `web::get().to(`, `HttpServer::new(`, `use actix_web` |
| `axum` | `Cargo.toml`: `axum` | any `.rs` | `Router::new()`, `.route(`, `get(`, `post(`, `use axum` |
| `async_graphql` | `Cargo.toml`: `async-graphql` | any `.rs` | `#[Object]`, `#[SimpleObject]`, `Schema::build(`, `async_graphql::` |
| `tonic_grpc` | `Cargo.toml`: `tonic` | `proto/*.proto`, `build.rs` | `tonic::transport::Server`, `tonic::include_proto!`, `tonic_build` |

### PHP

| Approach | Tier A | Tier B | Tier C |
|----------|--------|--------|--------|
| `laravel_routes` | `composer.json`: `laravel/framework` | `routes/api.php`, `routes/web.php` | `Route::get(`, `Route::post(`, `Route::apiResource(`, `extends Controller` |
| `symfony_routing` | `composer.json`: `symfony/routing`, `symfony/framework-bundle` | `config/routes.yaml`, `src/Controller/*.php` | `#[Route(`, `@Route(`, `AbstractController`, `use Symfony\Component\Routing` |
| `lighthouse_graphql` | `composer.json`: `nuwave/lighthouse` | `graphql/*.graphql`, `routes/graphql.php` | `type Query`, `type Mutation` in `.graphql`, `lighthouse.php` config |

### Cross-Language (always checked)

| Approach | API Style | Tier B: File Patterns | Tier C: Code Patterns |
|----------|-----------|-----------------------|-----------------------|
| `openapi_spec` | `http` | `openapi.yaml`, `openapi.json`, `swagger.yaml`, `swagger.json`, `**/api-spec*.yaml`, `docs/openapi/**` | `openapi:`, `swagger:`, `paths:`, `info:` together |
| `grpc_proto` | `rpc` | `*.proto`, `**/proto/**/*.proto`, `**/protos/**/*.proto` | `service ` + `{`, `rpc ` in `.proto` files |
| `graphql_schema` | `graphql` | `*.graphql`, `*.graphqls`, `schema.graphql`, `**/graphql/schema*` | `type Query`, `type Mutation`, `schema {` |
| `thrift_idl` | `rpc` | `*.thrift` | `service ` + `{`, `exception ` in `.thrift` files |

---

## Edge Cases

### Multiple API Styles in One Repo

Many repos expose both a REST API and a gRPC API (common in Java microservices). The detector runs all checks independently and emits one `DetectedApiApproach` per framework. The UI displays each style in its appropriate tab.

### Generated Code

Some frameworks generate boilerplate that looks like API definitions but is not the source of truth:

- gRPC Java generates `*Grpc.java` and `*OuterClass.java` from `.proto` files — scan `.proto` files, not the generated stubs
- Spring Boot may have OpenAPI specs auto-generated by springdoc-openapi — these are still useful to extract from if present as static files
- NestJS decorators on generated DTO classes should be ignored; scan controller files only

Generated directories to exclude from Tier C scans: `generated/`, `gen/`, `build/`, `dist/`, `target/`, `node_modules/`, `.gradle/`.

### Monorepos

A monorepo may contain multiple services each exposing different APIs. The detector emits all detected approaches at the repo level, with file paths in signals indicating which subdirectory each signal came from. A future enhancement would group by service root.

### Framework Aliases and Wrappers

Many teams wrap frameworks (e.g., a custom `BaseController` extending Spring's `@RestController`). If the base annotation is not visible, Tier C may miss some controllers. The Tier A dependency signal still fires, setting confidence to `medium` and running the extractor, which can then discover subclasses.

### URL Prefix Aggregation

REST frameworks often define a base path at the controller or blueprint level (e.g., `@RequestMapping("/api/v1/users")` on the class, then `@GetMapping("/{id}")` on the method). Extractors must concatenate these to produce the full path — e.g., `/api/v1/users/{id}`. The detection phase does not need to handle this; it is extraction logic.
