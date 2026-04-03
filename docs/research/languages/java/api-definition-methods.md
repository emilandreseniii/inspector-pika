# Java API Definition Methods

This document is a detailed inventory of how APIs are defined in Java projects. It covers REST/HTTP, GraphQL, and RPC patterns detected by Inspector Pika's API analysis feature.

---

## REST / HTTP

### Spring MVC / Spring Boot (most common)

**Dependency signals:**
- `pom.xml`: `spring-boot-starter-web`, `spring-webmvc`
- `build.gradle`: `implementation 'org.springframework.boot:spring-boot-starter-web'`
- `build.gradle.kts`: `implementation("org.springframework.boot:spring-boot-starter-web")`

**Class-level annotations:**
- `@RestController` — marks a class as an HTTP controller that returns JSON/text body (combines `@Controller` + `@ResponseBody`)
- `@Controller` — traditional MVC controller (may return views; only useful for API detection when methods have `@ResponseBody`)
- `@RequestMapping("/base/path")` — base path applied to all methods in the class

**Method-level annotations:**
```java
@GetMapping("/path")          // HTTP GET
@PostMapping("/path")         // HTTP POST
@PutMapping("/path")          // HTTP PUT
@DeleteMapping("/path")       // HTTP DELETE
@PatchMapping("/path")        // HTTP PATCH
@RequestMapping(value = "/path", method = RequestMethod.GET)  // generic form
```

**Parameter annotations:**
```java
@PathVariable("id") Long id          // path parameter → location: "path"
@RequestParam("filter") String f     // query parameter → location: "query"
@RequestBody UserRequest body        // JSON body → location: "body"
@RequestHeader("Authorization") ...  // header → location: "header"
```

**Full path resolution:**
The full path is the concatenation of the class-level `@RequestMapping` value and the method-level mapping value. Examples:

```java
@RestController
@RequestMapping("/api/v1/users")
public class UserController {
    @GetMapping                    // → GET /api/v1/users
    @GetMapping("/{id}")           // → GET /api/v1/users/{id}
    @PostMapping                   // → POST /api/v1/users
    @DeleteMapping("/{id}")        // → DELETE /api/v1/users/{id}
}
```

**Spring WebFlux:**
Identical annotation model to Spring MVC. `@RestController`, `@GetMapping`, etc. work the same way but the handlers return `Mono<T>` or `Flux<T>`. No special extraction handling needed.

**Router function style (functional API):**
```java
RouterFunction<ServerResponse> route = RouterFunctions.route()
    .GET("/users", handler::list)
    .POST("/users", handler::create)
    .GET("/users/{id}", handler::get)
    .build();
```
This form is harder to statically analyze. Detection: Tier C grep for `RouterFunctions.route()`. Extraction: limited — record the base path from the chain if determinable, flag as `confidence: 'medium'`.

**OpenAPI integration (springdoc-openapi):**
If `springdoc-openapi-starter-webmvc-ui` is in the dependencies, the project likely generates an OpenAPI spec at `/v3/api-docs`. The extractor should look for a pre-generated `openapi.yaml`/`openapi.json` in `src/main/resources/` or `docs/` and prefer it as the source of truth (richer metadata).

---

### JAX-RS (Jersey, RESTEasy, Quarkus RESTEasy)

**Dependency signals:**
- `jakarta.ws.rs-api` (Jakarta EE)
- `javax.ws.rs-api` (older Java EE)
- `jersey-server`, `jersey-media-json-jackson`
- `org.jboss.resteasy:resteasy-core`
- `io.quarkus:quarkus-resteasy`, `io.quarkus:quarkus-resteasy-reactive`

**Class-level annotations:**
- `@Path("/base/path")` — base path for the resource class
- `@ApplicationPath("/api")` — global prefix for all resources (defined on an `Application` subclass)

**Method-level annotations:**
```java
@GET    @Path("/{id}")       // → GET /base/{id}
@POST                        // → POST /base
@PUT    @Path("/{id}")       // → PUT /base/{id}
@DELETE @Path("/{id}")       // → DELETE /base/{id}
@PATCH  @Path("/{id}")       // → PATCH /base/{id}
@HEAD                        // → HEAD /base
@OPTIONS                     // → OPTIONS /base
```

**Parameter annotations:**
```java
@PathParam("id") Long id           // path parameter
@QueryParam("page") int page       // query parameter
@FormParam("name") String name     // form body field
@HeaderParam("X-Trace") String t   // header
@BeanParam SomeParams params       // compound params — hard to analyze statically
```

**Content type:**
```java
@Consumes(MediaType.APPLICATION_JSON)  // request content type
@Produces(MediaType.APPLICATION_JSON)  // response content type
```

**Application path resolution:**
Look for `@ApplicationPath` on a class extending `Application`:
```java
@ApplicationPath("/api")
public class MyApplication extends Application {}
// Prepend "/api" to all resource paths
```

---

### Micronaut HTTP

**Dependency signals:**
- `io.micronaut:micronaut-http-server-netty`
- `io.micronaut:micronaut-http`
- `io.micronaut.starter` in build plugins

**Annotations (from `io.micronaut.http.annotation`):**
```java
@Controller("/users")          // class-level base path
@Get("/{id}")                  // GET
@Post                          // POST
@Put("/{id}")                  // PUT
@Delete("/{id}")               // DELETE
@Patch("/{id}")                // PATCH
```

**Parameter annotations:**
```java
@PathVariable Long id          // path parameter
@QueryValue String filter      // query parameter
@Body UserCreateRequest body   // JSON body
@Header("Authorization") ...   // header
```

Nearly identical structure to Spring MVC from an extraction standpoint.

---

### Quarkus (with RESTEasy Reactive)

Uses JAX-RS annotations (see above) plus Quarkus-specific reactive annotations:
```java
@Path("/users")
@Produces(MediaType.APPLICATION_JSON)
public class UserResource {
    @GET
    public Uni<List<User>> list() { ... }       // Quarkus reactive return

    @GET @Path("/{id}")
    public Uni<User> get(@PathParam("id") Long id) { ... }
}
```
Extract same as JAX-RS. The `Uni<T>` / `Multi<T>` return type wrapping can be stripped to get the actual response type: e.g., `Uni<User>` → response type `User`.

---

## GraphQL

### Netflix DGS (Domain Graph Service)

**Dependency:** `com.netflix.graphql.dgs:graphql-dgs-spring-boot-starter`

Netflix DGS is a Spring Boot-based GraphQL framework. Schema is typically defined in `.graphqls` files in `src/main/resources/schema/`.

**Annotations:**
```java
@DgsComponent
public class UserDataFetcher {
    @DgsQuery                            // → Query type resolver
    public User user(@InputArgument Long id) { ... }

    @DgsMutation                         // → Mutation type resolver
    public User createUser(@InputArgument UserInput input) { ... }

    @DgsSubscription                     // → Subscription type resolver
    public Publisher<User> userUpdated() { ... }

    @DgsData(parentType = "User", field = "posts")  // → field resolver
    public List<Post> posts(DgsDataFetchingEnvironment env) { ... }
}
```

**Extraction strategy:**
1. Find classes annotated `@DgsComponent`
2. For each `@DgsQuery` method, extract method name as operation name
3. For each `@DgsMutation` method, extract operation name
4. Use `@InputArgument` parameters for argument list
5. Cross-reference with `.graphqls` schema files for type info (prefer the schema file for type details)

---

### Spring for GraphQL

**Dependency:** `org.springframework.boot:spring-boot-starter-graphql`

**Annotations:**
```java
@Controller
public class UserController {
    @QueryMapping                                   // maps to type Query, field name = method name
    public User user(@Argument Long id) { ... }

    @QueryMapping("userList")                       // explicit name override
    public List<User> listUsers() { ... }

    @MutationMapping
    public User createUser(@Argument UserInput input) { ... }

    @SubscriptionMapping
    public Flux<User> userUpdated() { ... }

    @SchemaMapping(typeName = "User", field = "posts")  // field resolver
    public List<Post> posts(User user) { ... }
}
```

**Schema files** are in `src/main/resources/graphql/*.graphqls`. Always extract from schema files as primary source; controller annotations fill in source file locations.

---

### graphql-java (low-level, less common)

**Dependency:** `com.graphql-java:graphql-java`

Low-level; operations are registered programmatically via `DataFetcher`. Static extraction is limited. Detect via dependency signal; extract from co-located `.graphqls` schema files.

---

## RPC

### gRPC (grpc-java)

**Dependency signals:**
- `io.grpc:grpc-protobuf`
- `io.grpc:grpc-stub`
- `io.grpc:grpc-netty` or `io.grpc:grpc-netty-shaded`
- Build plugin: `com.google.protobuf` (applies protobuf compilation)

**Source of truth:** `.proto` files (usually in `src/main/proto/`). The generated Java classes are not the source to parse — they are artifacts. Always extract from `.proto` files via the cross-language `GrpcProtoExtractor`.

**Proto file structure:**
```proto
syntax = "proto3";
package com.example.user.v1;
option java_package = "com.example.grpc.user.v1";
option java_outer_classname = "UserProto";

service UserService {
    rpc GetUser    (GetUserRequest)    returns (GetUserResponse);
    rpc ListUsers  (ListUsersRequest)  returns (stream ListUsersResponse);  // server streaming
    rpc CreateUser (CreateUserRequest) returns (CreateUserResponse);
    rpc UpdateUser (stream UpdateUserRequest) returns (UpdateUserResponse); // client streaming
    rpc Chat       (stream ChatRequest) returns (stream ChatResponse);       // bidirectional
}

message GetUserRequest  { string user_id = 1; }
message GetUserResponse { User user = 1; }
message User { string id = 1; string name = 2; string email = 3; }
```

**Streaming classification:**
- No `stream` keyword: `rpcStreaming: "none"`
- `returns (stream T)`: `rpcStreaming: "server"`
- `(stream T) returns (T)`: `rpcStreaming: "client"`
- `(stream T) returns (stream T)`: `rpcStreaming: "bidirectional"`

**Java service implementation (for finding source location):**
```java
public class UserServiceImpl extends UserServiceGrpc.UserServiceImplBase {
    @Override
    public void getUser(GetUserRequest req, StreamObserver<GetUserResponse> resp) { ... }
}
```
Grep for `extends.*ImplBase` and `StreamObserver<` to confirm gRPC usage. Source location for the implementation is secondary — the `.proto` file is the canonical reference.

---

### Apache Thrift

**Dependency signals:**
- `org.apache.thrift:libthrift`

**Source of truth:** `.thrift` IDL files.

```thrift
namespace java com.example.thrift

service UserService {
    User getUser(1: i64 id)
    list<User> listUsers(1: string filter)
    void deleteUser(1: i64 id) throws (1: UserNotFoundException e)
}

struct User {
    1: i64 id,
    2: string name,
    3: string email,
}

exception UserNotFoundException {
    1: string message,
}
```

**Extraction:** Parse `.thrift` files for `service`, `struct`, and `exception` blocks. Produce `RawApi` with `protocol: "thrift"`.

---

### Apache Avro RPC

**Dependency signals:**
- `org.apache.avro:avro`
- `org.apache.avro:avro-ipc`

**Source of truth:** `.avdl` (Avro IDL) or `.avpr` (protocol JSON) files.

```idl
@namespace("com.example")
protocol UserService {
    record User { string id; string name; }

    User getUser(string id);
    void deleteUser(string id);
}
```

**Extraction:** Parse `.avdl`/`.avpr` files for `protocol` blocks and method definitions.

---

## Extraction Notes and Edge Cases

### Controller Inheritance

A common pattern is a shared `BaseController` that defines common paths:
```java
@RequestMapping("/api/v1")
public abstract class BaseController {}

@RestController
public class UserController extends BaseController {
    @GetMapping("/users")   // → GET /api/v1/users
    public List<User> list() { ... }
}
```
The extractor must follow the inheritance chain to find the base class `@RequestMapping`. When the base class is in a different file, use grep to find it. If not found, emit the partial path with a warning.

### Multiple `@RequestMapping` Values

```java
@RequestMapping({"/users", "/members"})
```
Emit one endpoint per path value.

### Consumes / Produces in JAX-RS

`@Consumes(MediaType.APPLICATION_JSON)` tells us the request content type. Store in `summary` or as metadata — not currently a first-class field, but useful for display.

### Swagger / OpenAPI Annotations

If `springdoc-openapi` or `swagger-core` annotations are present, they provide additional metadata:
```java
@Operation(summary = "Get user by ID", description = "Returns a single user")
@ApiResponse(responseCode = "200", content = @Content(schema = @Schema(implementation = UserResponse.class)))
```
Extract `summary` from `@Operation(summary=...)` when present.

### Package-Private or Inner Classes

Inner class controllers are uncommon but valid. Extractor should handle `static` inner classes annotated with `@RestController`. Confidence is `medium` for inner class controllers.
