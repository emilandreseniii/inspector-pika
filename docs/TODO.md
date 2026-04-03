# Inspector Pika — Analysis TODO

Items are ordered by priority. Languages already implemented (Java, Python) come first.

---

## Java

### API Extractors
- [x] **Spring GraphQL** — detect `@QueryMapping`, `@MutationMapping`, `@SchemaMapping`; detector signal exists, no extractor
- [x] **Netflix DGS** — detect `@DgsQuery`, `@DgsMutation`, `@DgsSubscription`; detector signal exists, no extractor
- [x] **gRPC (generated Java stubs)** — detect server implementations that extend `*Grpc.ImplBase`; complements the proto-file extractor

### Entity Extractors
- [x] **Spring Data JDBC** — detect `@Table`, `@Column`, `@MappedCollection`; detector signal exists, no extractor

---

## Python

### API Extractors
- [x] **FastAPI** — detect `@app.get/post/put/delete/patch`, `APIRouter`, extract path params, query params, Pydantic body types
- [x] **Flask** — detect `@app.route`, `@blueprint.route`, extract URL rules and methods from `add_url_rule`
- [x] **Django REST Framework** — detect `ViewSet`, `APIView`, `@action`, routers; extract serializer types as request/response

### Entity Extractors
- [x] **Tortoise ORM** — detect `class Foo(Model)`, `fields.*Field`
- [x] **Peewee** — detect `class Foo(Model)`, `*Field` column definitions

---

## TypeScript / JavaScript

### API Extractors
- [x] **Express** — detect `router.get/post/put/delete/patch`, `app.get/post/…`; extract path and middleware chain
- [x] **NestJS** — detect `@Controller`, `@Get`, `@Post`, `@Body`, `@Param`, `@Query`; similar shape to Spring MVC
- [x] **Fastify** — detect `fastify.get/post/…`, `fastify.route()`
- [x] **Hono** — detect `app.get/post/…` with Hono-style routing
- [ ] **Apollo Server / TypeGraphQL / Pothos** — detect GraphQL resolvers and schema definitions
- [ ] **gRPC-node / @grpc/grpc-js** — detect service implementations; defer to proto extractor for schema

### Entity Extractors
- [x] **Prisma** — parse `schema.prisma`: `model`, `@@map`, field types and attributes
- [x] **TypeORM** — detect `@Entity`, `@Column`, `@PrimaryGeneratedColumn`, `@ManyToOne` etc.
- [x] **Drizzle ORM** — detect `pgTable`/`mysqlTable`/`sqliteTable` schema definitions
- [x] **Sequelize** — detect `Model.init()`, `sequelize.define()`, field type maps
- [x] **Mongoose** — detect `new Schema({…})`, extract field names and types

---

## Go

### API Extractors
- [x] **net/http** — detect `http.HandleFunc`, `mux.HandleFunc`, `ServeMux` patterns
- [x] **Gin** — detect `router.GET/POST/…`, `gin.RouterGroup`
- [x] **Echo** — detect `e.GET/POST/…`, `g.GET/POST/…` group patterns
- [x] **Chi** — detect `r.Get/Post/…`, `chi.NewRouter`
- [x] **Fiber** — detect `app.Get/Post/…`
- [ ] **gqlgen** — detect resolver implementations from generated `ResolverRoot` interface
- [ ] **gRPC-Go** — detect service server implementations; defer to proto extractor for schema

### Entity Extractors
- [x] **GORM** — detect `gorm.Model` embedding, struct tags `gorm:"column:…"`, `AutoMigrate` calls
- [x] **Ent** — parse generated `ent/schema/*.go` files: `Fields()`, `Edges()`
- [x] **sqlc** — parse `sqlc.yaml` + `*.sql` query files; extract named queries and result types

---

## Cross-language

### API Extractors
- [x] **OpenAPI / Swagger spec** — parse `openapi.yaml`/`swagger.json`; extract paths, methods, parameters, response schemas; highest fidelity source of truth when present
- [x] **GraphQL schema files** — parse `*.graphql`/`*.gql`; extract `type Query`, `type Mutation`, `type Subscription` operations and their arguments
- [ ] **Thrift** — parse `.thrift` files; extract services, methods, argument/return types (similar shape to proto extractor)

### Entity Extractors
- [ ] **Protobuf messages** — cross-language proto extractor already detects services; extend to also extract `message` definitions as entity surfaces

---

## Ruby

### API Extractors
- [x] **Rails routes** — parse `config/routes.rb`; extract `resources`, `get/post/…`, `namespace`, `scope`
- [x] **Grape** — detect `desc`, `params`, `get/post/…` inside `Grape::API` subclasses

### Entity Extractors
- [x] **ActiveRecord** — detect `class Foo < ApplicationRecord`, parse schema migrations for column definitions
- [x] **Sequel** — detect `class Foo < Sequel::Model`, `DB.create_table` calls

---

## C#

### API Extractors
- [x] **ASP.NET Core** — detect `[ApiController]`, `[HttpGet]`, `[HttpPost]`, `[Route]`; similar shape to Spring MVC extractor
- [ ] **Hot Chocolate / GraphQL.NET** — detect GraphQL resolver class patterns

### Entity Extractors
- [x] **EF Core** — detect `DbContext`, `DbSet<T>`, `[Table]`, `[Column]`, `OnModelCreating` fluent API
- [ ] **Dapper** — detect `Query<T>`, `Execute` calls; extract DTO types used as results

---

## Rust

### API Extractors
- [x] **Axum** — detect `Router::new().route(…)`, handler function signatures with `axum::extract::*`
- [x] **Actix-web** — detect `web::get().to(…)`, `#[get("…")]`, `App::new().service(…)`
- [ ] **tonic** — detect gRPC service trait implementations; defer to proto extractor for schema

### Entity Extractors
- [x] **Diesel** — parse `diesel::table!` macros and `schema.rs`; extract table and column definitions
- [x] **SeaORM** — detect `DeriveEntityModel`, `ColumnTrait` enums
- [x] **sqlx** — detect `query_as!`, `query!` macros; extract result struct types

---

## PHP

### API Extractors
- [x] **Laravel** — parse `routes/api.php`; extract `Route::get/post/…`, resource controllers
- [x] **Symfony** — detect `#[Route(…)]` attributes or `@Route` annotations on controller methods

### Entity Extractors
- [x] **Eloquent** — detect `class Foo extends Model`, `protected $fillable`, `$casts`; parse migration `Schema::create` calls
- [x] **Doctrine** — detect `#[Entity]`, `#[Column]`, `#[ORM\ManyToOne]` attributes

---

## Infrastructure / Quality

- [ ] **Concurrent clone locking** — git 128 errors occur when multiple analysis jobs clone the same repo simultaneously; add a per-repo lock so only one job clones/pulls at a time
- [ ] **Rebuild shared dist automatically** — the shared package dist must be manually rebuilt (`npm run build`) before new job types become available to the server; wire this into the dev workflow
- [x] **Python API detection signals** — add Tier A/B/C signals for FastAPI, Flask, Django REST to `apiAnalysis/detector.ts` so they appear in `api-approaches` before the extractor is built
- [ ] **TypeScript/JavaScript API detection signals** — add signals for Express, NestJS, Fastify, Apollo to `apiAnalysis/detector.ts`
- [x] **Go API/entity detection signals** — add signals for Gin, Echo, GORM, Ent, sqlc to both detectors
