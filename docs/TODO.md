# Inspector Pika — Analysis TODO

Items are ordered by priority. Languages already implemented (Java, Python) come first.

---

## Java

### API Extractors
- [x] **Spring GraphQL** — detect `@QueryMapping`, `@MutationMapping`, `@SchemaMapping`; detector signal exists, no extractor
- [x] **Netflix DGS** — detect `@DgsQuery`, `@DgsMutation`, `@DgsSubscription`; detector signal exists, no extractor
- [x] **gRPC (generated Java stubs)** — detect server implementations that extend `*Grpc.ImplBase`; complements the proto-file extractor
- [x] **Micronaut HTTP** — detect `@Controller`, `@Get`, `@Post`, `@Put`, `@Delete`, `@Patch` from `io.micronaut.http.annotation`; similar shape to Spring MVC
- [ ] **Quarkus REST / MicroProfile JAX-RS** — detect `@Path`, `@GET`, `@POST` from `jakarta.ws.rs` / `javax.ws.rs`; can reuse JAX-RS extractor with Quarkus detection signal
- [ ] **Vert.x Web** — detect `router.get(…).handler(…)`, `router.route(…)` in Java/Kotlin source files

### Entity Extractors
- [x] **Spring Data JDBC** — detect `@Table`, `@Column`, `@MappedCollection`; detector signal exists, no extractor

---

## Python

### API Extractors
- [x] **FastAPI** — detect `@app.get/post/put/delete/patch`, `APIRouter`, extract path params, query params, Pydantic body types
- [x] **Flask** — detect `@app.route`, `@blueprint.route`, extract URL rules and methods from `add_url_rule`
- [x] **Django REST Framework** — detect `ViewSet`, `APIView`, `@action`, routers; extract serializer types as request/response
- [ ] **Starlette** — detect `Route(path, endpoint)` in `routes=[…]` lists and `@app.route` middleware-style registration
- [ ] **Sanic** — detect `@app.get/post/put/delete/patch`, `Blueprint` route decorators
- [ ] **aiohttp** — detect `app.router.add_get/post/…`, `web.RouteTableDef` `@routes.get/post/…` decorators

### Entity Extractors
- [x] **Tortoise ORM** — detect `class Foo(Model)`, `fields.*Field`
- [x] **Peewee** — detect `class Foo(Model)`, `*Field` column definitions
- [x] **SQLModel** — detect `class Foo(SQLModel, table=True)`, Pydantic-style field definitions; SQLAlchemy-backed but distinct schema syntax
- [ ] **Beanie** — detect `class Foo(Document)`, `class Settings` inner class; MongoDB ODM for async Python

---

## TypeScript / JavaScript

### API Extractors
- [x] **Express** — detect `router.get/post/put/delete/patch`, `app.get/post/…`; extract path and middleware chain
- [x] **NestJS** — detect `@Controller`, `@Get`, `@Post`, `@Body`, `@Param`, `@Query`; similar shape to Spring MVC
- [x] **Fastify** — detect `fastify.get/post/…`, `fastify.route()`
- [x] **Hono** — detect `app.get/post/…` with Hono-style routing
- [x] **Apollo Server / TypeGraphQL / Pothos** — detect GraphQL resolvers and schema definitions
- [x] **gRPC-node / @grpc/grpc-js** — detect service implementations; defer to proto extractor for schema
- [x] **Koa** — detect `router.get/post/put/delete/patch` from `koa-router` / `@koa/router`; `ctx.path` and `ctx.method` in middleware
- [x] **tRPC** — detect `router.query/mutation/subscription`, `t.procedure.input(…).query/mutation`; extract input/output Zod schemas
- [x] **Next.js API routes** — detect `pages/api/**/*.ts` files with default export handlers; detect `app/api/**/route.ts` files with exported `GET`, `POST`, etc. functions (App Router)

### Entity Extractors
- [x] **Prisma** — parse `schema.prisma`: `model`, `@@map`, field types and attributes
- [x] **TypeORM** — detect `@Entity`, `@Column`, `@PrimaryGeneratedColumn`, `@ManyToOne` etc.
- [x] **Drizzle ORM** — detect `pgTable`/`mysqlTable`/`sqliteTable` schema definitions
- [x] **Sequelize** — detect `Model.init()`, `sequelize.define()`, field type maps
- [x] **Mongoose** — detect `new Schema({…})`, extract field names and types
- [x] **MikroORM** — detect `@Entity()`, `@Property()`, `@ManyToOne()` decorators from `@mikro-orm/core`; similar shape to TypeORM

---

## Go

### API Extractors
- [x] **net/http** — detect `http.HandleFunc`, `mux.HandleFunc`, `ServeMux` patterns
- [x] **Gin** — detect `router.GET/POST/…`, `gin.RouterGroup`
- [x] **Echo** — detect `e.GET/POST/…`, `g.GET/POST/…` group patterns
- [x] **Chi** — detect `r.Get/Post/…`, `chi.NewRouter`
- [x] **Fiber** — detect `app.Get/Post/…`
- [x] **gqlgen** — detect resolver implementations from generated `ResolverRoot` interface
- [x] **gRPC-Go** — detect service server implementations; defer to proto extractor for schema
- [x] **gorilla/mux** — detect `r.HandleFunc(path, handler).Methods(…)`, `r.PathPrefix(…).Subrouter()`
- [ ] **Beego** — detect `beego.Router(path, &Controller{})`, `web.Router`; controller method naming convention (Get/Post/Put/Delete)

### Entity Extractors
- [x] **GORM** — detect `gorm.Model` embedding, struct tags `gorm:"column:…"`, `AutoMigrate` calls
- [x] **Ent** — parse generated `ent/schema/*.go` files: `Fields()`, `Edges()`
- [x] **sqlc** — parse `sqlc.yaml` + `*.sql` query files; extract named queries and result types
- [ ] **sqlboiler** — parse generated `models/*.go` files from sqlboiler output; extract table structs and column boil tags
- [ ] **Bun ORM** — detect `bun.BaseModel` embedding, struct tags `bun:"table:…,column:…"`; similar shape to GORM

---

## Cross-language

### API Extractors
- [x] **OpenAPI / Swagger spec** — parse `openapi.yaml`/`swagger.json`; extract paths, methods, parameters, response schemas; highest fidelity source of truth when present
- [x] **GraphQL schema files** — parse `*.graphql`/`*.gql`; extract `type Query`, `type Mutation`, `type Subscription` operations and their arguments
- [x] **Thrift** — parse `.thrift` files; extract services, methods, argument/return types (similar shape to proto extractor)

### Entity Extractors
- [x] **Protobuf messages** — cross-language proto extractor already detects services; extend to also extract `message` definitions as entity surfaces

---

## Ruby

### API Extractors
- [x] **Rails routes** — parse `config/routes.rb`; extract `resources`, `get/post/…`, `namespace`, `scope`
- [x] **Grape** — detect `desc`, `params`, `get/post/…` inside `Grape::API` subclasses
- [x] **Sinatra** — detect `get/post/put/delete/patch '…' do` route blocks in `Sinatra::Base` subclasses and top-level DSL files

### Entity Extractors
- [x] **ActiveRecord** — detect `class Foo < ApplicationRecord`, parse schema migrations for column definitions
- [x] **Sequel** — detect `class Foo < Sequel::Model`, `DB.create_table` calls
- [ ] **Mongoid** — detect `class Foo`, `include Mongoid::Document`, `field :name, type: String`; MongoDB ODM for Ruby
- [ ] **ROM (Ruby Object Mapper)** — detect `class Foo < ROM::Relation`, `schema(:table_name)` blocks with `attribute` definitions

---

## C#

### API Extractors
- [x] **ASP.NET Core** — detect `[ApiController]`, `[HttpGet]`, `[HttpPost]`, `[Route]`; similar shape to Spring MVC extractor
- [x] **Hot Chocolate / GraphQL.NET** — detect GraphQL resolver class patterns
- [x] **Minimal APIs (.NET 6+)** — detect `app.MapGet/MapPost/MapPut/MapDelete(path, handler)` in `Program.cs` / top-level statements
- [ ] **gRPC (Grpc.AspNetCore)** — detect `public override … MethodName(Request req, ServerCallContext ctx)` in classes that inherit generated `*Base` service stubs

### Entity Extractors
- [x] **EF Core** — detect `DbContext`, `DbSet<T>`, `[Table]`, `[Column]`, `OnModelCreating` fluent API
- [x] **Dapper** — detect `Query<T>`, `Execute` calls; extract DTO types used as results
- [x] **NHibernate** — detect `*.hbm.xml` mapping files or `ClassMap<T>` fluent mapping classes; extract entity names, properties, and relationships

---

## Rust

### API Extractors
- [x] **Axum** — detect `Router::new().route(…)`, handler function signatures with `axum::extract::*`
- [x] **Actix-web** — detect `web::get().to(…)`, `#[get("…")]`, `App::new().service(…)`
- [x] **tonic** — detect gRPC service trait implementations; defer to proto extractor for schema
- [x] **Rocket** — detect `#[get("…")]`, `#[post("…")]` proc-macro attributes from the `rocket` crate; extract path params `<param>` and query params `<param..>`
- [ ] **warp** — detect `warp::path(…).and(warp::get()/post()/…)` filter chain compositions
- [ ] **poem** — detect `#[handler]` attribute functions registered via `Route::new().at(path, get/post/…(handler))`

### Entity Extractors
- [x] **Diesel** — parse `diesel::table!` macros and `schema.rs`; extract table and column definitions
- [x] **SeaORM** — detect `DeriveEntityModel`, `ColumnTrait` enums
- [x] **sqlx** — detect `query_as!`, `query!` macros; extract result struct types

---

## PHP

### API Extractors
- [x] **Laravel** — parse `routes/api.php`; extract `Route::get/post/…`, resource controllers
- [x] **Symfony** — detect `#[Route(…)]` attributes or `@Route` annotations on controller methods
- [x] **Slim Framework** — detect `$app->get/post/put/delete/patch(path, callable)` and `RouteCollectorProxy` group routes
- [ ] **Lumen** — detect `$router->get/post/put/delete/patch(path, …)` and `$router->group(…)` in `routes/web.php`

### Entity Extractors
- [x] **Eloquent** — detect `class Foo extends Model`, `protected $fillable`, `$casts`; parse migration `Schema::create` calls
- [x] **Doctrine** — detect `#[Entity]`, `#[Column]`, `#[ORM\ManyToOne]` attributes
- [ ] **Cycle ORM** — detect `#[Entity]`, `#[Column]` attributes from `cycle/annotated`; parse `schema/…` cycle schema definitions
- [ ] **Propel** — parse `schema.xml` ORM definition files; extract `<table>`, `<column>`, `<foreign-key>` elements

---

## Kotlin

### API Extractors
- [x] **Ktor** — detect `routing { get(path) {…} }`, `route(path) { get {…} }` DSL in `Application.module` blocks
- [ ] **Spring MVC (Kotlin)** — already covered by the Java Spring MVC extractor; add detection signal for Kotlin + Spring Boot

### Entity Extractors
- [x] **Exposed** — detect `object Foo : Table("table_name")` and `IntIdTable`/`LongIdTable`; parse `Column<T>` property definitions
- [x] **KTorm** — detect `object Foo : Table<Bar>("table_name")`, `val col = int("col_name").bindTo {…}` column definitions

---

## Scala

### API Extractors
- [ ] **Play Framework** — parse `conf/routes` file for `GET /path controller.Method` entries; detect `Action {…}` in controller files
- [ ] **Akka HTTP** — detect `path(…) { get { complete {…} } }` directive DSL; `pathPrefix`, `pathEnd` nesting
- [ ] **http4s** — detect `HttpRoutes.of { case GET -> Root / "path" => … }` partial function routing

### Entity Extractors
- [ ] **Slick** — detect `class Foo(tag: Tag) extends Table[Bar](tag, "table_name")`, `def * = (…) <> (…)` projection
- [ ] **Doobie** — detect `sql"SELECT …".query[Foo]` and `sql"INSERT …".update` fragments; extract result types
- [ ] **Quill** — detect `ctx.run(query[Foo])`, `quote { query[Foo].filter(…) }` quoted DSL

---

## Elixir

### API Extractors
- [ ] **Phoenix** — parse `lib/*_web/router.ex`; extract `get/post/put/patch/delete`, `resources`, `scope`, `pipeline` blocks
- [ ] **Plug.Router** — detect `plug :match` / `match "/path" do` routing blocks in `Plug.Router` modules

### Entity Extractors
- [ ] **Ecto** — detect `schema "table_name" do … end` blocks; extract `field :name, :type` and `belongs_to/has_many/has_one/many_to_many` associations

---

## Swift

### API Extractors
- [ ] **Vapor** — detect `app.get("path") { req in … }`, `app.post(…)`, grouped routes via `app.grouped(…)`
- [ ] **Hummingbird** — detect `app.router.get("/path") {…}`, `HBRouterGroup`

### Entity Extractors
- [ ] **Fluent (Vapor ORM)** — detect `final class Foo: Model`, `@ID`, `@Field(key: "col")`, `@Parent`, `@Children` property wrappers
- [ ] **GRDB** — detect `struct Foo: Codable, FetchableRecord, PersistableRecord`, `static let databaseTableName`

---

## Infrastructure / Quality

- [x] **Concurrent clone locking** — git 128 errors occur when multiple analysis jobs clone the same repo simultaneously; add a per-repo lock so only one job clones/pulls at a time
- [x] **Rebuild shared dist automatically** — the shared package dist must be manually rebuilt (`npm run build`) before new job types become available to the server; wire this into the dev workflow
- [x] **Python API detection signals** — add Tier A/B/C signals for FastAPI, Flask, Django REST to `apiAnalysis/detector.ts` so they appear in `api-approaches` before the extractor is built
- [x] **TypeScript/JavaScript API detection signals** — add signals for Express, NestJS, Fastify, Apollo to `apiAnalysis/detector.ts`
- [x] **Go API/entity detection signals** — add signals for Gin, Echo, GORM, Ent, sqlc to both detectors
