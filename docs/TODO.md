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
- [ ] **Tortoise ORM** — detect `class Foo(Model)`, `fields.*Field`
- [ ] **Peewee** — detect `class Foo(Model)`, `*Field` column definitions

---

## TypeScript / JavaScript

### API Extractors
- [ ] **Express** — detect `router.get/post/put/delete/patch`, `app.get/post/…`; extract path and middleware chain
- [ ] **NestJS** — detect `@Controller`, `@Get`, `@Post`, `@Body`, `@Param`, `@Query`; similar shape to Spring MVC
- [ ] **Fastify** — detect `fastify.get/post/…`, `fastify.route()`
- [ ] **Hono** — detect `app.get/post/…` with Hono-style routing
- [ ] **Apollo Server / TypeGraphQL / Pothos** — detect GraphQL resolvers and schema definitions
- [ ] **gRPC-node / @grpc/grpc-js** — detect service implementations; defer to proto extractor for schema

### Entity Extractors
- [ ] **Prisma** — parse `schema.prisma`: `model`, `@@map`, field types and attributes
- [ ] **TypeORM** — detect `@Entity`, `@Column`, `@PrimaryGeneratedColumn`, `@ManyToOne` etc.
- [ ] **Drizzle ORM** — detect `pgTable`/`mysqlTable`/`sqliteTable` schema definitions
- [ ] **Sequelize** — detect `Model.init()`, `sequelize.define()`, field type maps
- [ ] **Mongoose** — detect `new Schema({…})`, extract field names and types

---

## Go

### API Extractors
- [ ] **net/http** — detect `http.HandleFunc`, `mux.HandleFunc`, `ServeMux` patterns
- [ ] **Gin** — detect `router.GET/POST/…`, `gin.RouterGroup`
- [ ] **Echo** — detect `e.GET/POST/…`, `g.GET/POST/…` group patterns
- [ ] **Chi** — detect `r.Get/Post/…`, `chi.NewRouter`
- [ ] **Fiber** — detect `app.Get/Post/…`
- [ ] **gqlgen** — detect resolver implementations from generated `ResolverRoot` interface
- [ ] **gRPC-Go** — detect service server implementations; defer to proto extractor for schema

### Entity Extractors
- [ ] **GORM** — detect `gorm.Model` embedding, struct tags `gorm:"column:…"`, `AutoMigrate` calls
- [ ] **Ent** — parse generated `ent/schema/*.go` files: `Fields()`, `Edges()`
- [ ] **sqlc** — parse `sqlc.yaml` + `*.sql` query files; extract named queries and result types

---

## Cross-language

### API Extractors
- [ ] **OpenAPI / Swagger spec** — parse `openapi.yaml`/`swagger.json`; extract paths, methods, parameters, response schemas; highest fidelity source of truth when present
- [ ] **GraphQL schema files** — parse `*.graphql`/`*.gql`; extract `type Query`, `type Mutation`, `type Subscription` operations and their arguments
- [ ] **Thrift** — parse `.thrift` files; extract services, methods, argument/return types (similar shape to proto extractor)

### Entity Extractors
- [ ] **Protobuf messages** — cross-language proto extractor already detects services; extend to also extract `message` definitions as entity surfaces

---

## Ruby

### API Extractors
- [ ] **Rails routes** — parse `config/routes.rb`; extract `resources`, `get/post/…`, `namespace`, `scope`
- [ ] **Grape** — detect `desc`, `params`, `get/post/…` inside `Grape::API` subclasses

### Entity Extractors
- [ ] **ActiveRecord** — detect `class Foo < ApplicationRecord`, parse schema migrations for column definitions
- [ ] **Sequel** — detect `class Foo < Sequel::Model`, `DB.create_table` calls

---

## C#

### API Extractors
- [ ] **ASP.NET Core** — detect `[ApiController]`, `[HttpGet]`, `[HttpPost]`, `[Route]`; similar shape to Spring MVC extractor
- [ ] **Hot Chocolate / GraphQL.NET** — detect GraphQL resolver class patterns

### Entity Extractors
- [ ] **EF Core** — detect `DbContext`, `DbSet<T>`, `[Table]`, `[Column]`, `OnModelCreating` fluent API
- [ ] **Dapper** — detect `Query<T>`, `Execute` calls; extract DTO types used as results

---

## Rust

### API Extractors
- [ ] **Axum** — detect `Router::new().route(…)`, handler function signatures with `axum::extract::*`
- [ ] **Actix-web** — detect `web::get().to(…)`, `#[get("…")]`, `App::new().service(…)`
- [ ] **tonic** — detect gRPC service trait implementations; defer to proto extractor for schema

### Entity Extractors
- [ ] **Diesel** — parse `diesel::table!` macros and `schema.rs`; extract table and column definitions
- [ ] **SeaORM** — detect `DeriveEntityModel`, `ColumnTrait` enums
- [ ] **sqlx** — detect `query_as!`, `query!` macros; extract result struct types

---

## PHP

### API Extractors
- [ ] **Laravel** — parse `routes/api.php`; extract `Route::get/post/…`, resource controllers
- [ ] **Symfony** — detect `#[Route(…)]` attributes or `@Route` annotations on controller methods

### Entity Extractors
- [ ] **Eloquent** — detect `class Foo extends Model`, `protected $fillable`, `$casts`; parse migration `Schema::create` calls
- [ ] **Doctrine** — detect `#[Entity]`, `#[Column]`, `#[ORM\ManyToOne]` attributes

---

## Infrastructure / Quality

- [ ] **Concurrent clone locking** — git 128 errors occur when multiple analysis jobs clone the same repo simultaneously; add a per-repo lock so only one job clones/pulls at a time
- [ ] **Rebuild shared dist automatically** — the shared package dist must be manually rebuilt (`npm run build`) before new job types become available to the server; wire this into the dev workflow
- [x] **Python API detection signals** — add Tier A/B/C signals for FastAPI, Flask, Django REST to `apiAnalysis/detector.ts` so they appear in `api-approaches` before the extractor is built
- [ ] **TypeScript/JavaScript API detection signals** — add signals for Express, NestJS, Fastify, Apollo to `apiAnalysis/detector.ts`
- [ ] **Go API/entity detection signals** — add signals for Gin, Echo, GORM, Ent, sqlc to both detectors
