import { BaseApiExtractor, ApiExtractorContext, DetectedApiApproach } from './extractors/base'
import { SpringMvcExtractor } from './extractors/languages/java/springMvc'
import { JaxRsExtractor } from './extractors/languages/java/jaxRs'
import { SpringGraphqlExtractor } from './extractors/languages/java/springGraphql'
import { NetflixDgsExtractor } from './extractors/languages/java/netflixDgs'
import { GrpcProtoExtractor } from './extractors/shared/grpcProto'
import { OpenApiSpecExtractor } from './extractors/shared/openApiSpec'
import { GraphQLSchemaExtractor } from './extractors/shared/graphqlSchema'
import { ThriftExtractor } from './extractors/shared/thrift'
import { GrpcJavaStubExtractor } from './extractors/languages/java/grpcJavaStub'
import { MicronautExtractor } from './extractors/languages/java/micronaut'
import { VertxWebExtractor } from './extractors/languages/java/vertxWeb'
import { KtorExtractor } from './extractors/languages/kotlin/ktor'
import { FastApiExtractor } from './extractors/languages/python/fastapi'
import { FlaskExtractor } from './extractors/languages/python/flask'
import { DjangoRestFrameworkExtractor } from './extractors/languages/python/djangoRestFramework'
import { StarletteExtractor } from './extractors/languages/python/starlette'
import { SanicExtractor } from './extractors/languages/python/sanic'
import { AiohttpExtractor } from './extractors/languages/python/aiohttp'
import { ExpressExtractor } from './extractors/languages/typescript/express'
import { NestJsExtractor } from './extractors/languages/typescript/nestjs'
import { FastifyExtractor } from './extractors/languages/typescript/fastify'
import { HonoExtractor } from './extractors/languages/typescript/hono'
import { KoaExtractor } from './extractors/languages/typescript/koa'
import { TrpcExtractor } from './extractors/languages/typescript/trpc'
import { NextJsApiExtractor } from './extractors/languages/typescript/nextjs'
import { GinExtractor } from './extractors/languages/go/gin'
import { EchoExtractor } from './extractors/languages/go/echo'
import { ChiExtractor } from './extractors/languages/go/chi'
import { FiberExtractor } from './extractors/languages/go/fiber'
import { NetHttpExtractor } from './extractors/languages/go/netHttp'
import { GorillaMuxExtractor } from './extractors/languages/go/gorillaMux'
import { BeegoExtractor } from './extractors/languages/go/beego'
import { RailsRoutesExtractor } from './extractors/languages/ruby/railsRoutes'
import { GrapeExtractor } from './extractors/languages/ruby/grape'
import { SinatraExtractor } from './extractors/languages/ruby/sinatra'
import { AspNetCoreExtractor } from './extractors/languages/csharp/aspNetCore'
import { MinimalApiExtractor } from './extractors/languages/csharp/minimalApi'
import { CsharpGrpcExtractor } from './extractors/languages/csharp/grpc'
import { AxumExtractor } from './extractors/languages/rust/axum'
import { ActixWebExtractor } from './extractors/languages/rust/actixWeb'
import { RocketExtractor } from './extractors/languages/rust/rocket'
import { WarpExtractor } from './extractors/languages/rust/warp'
import { PoemExtractor } from './extractors/languages/rust/poem'
import { PlayExtractor } from './extractors/languages/scala/play'
import { AkkaHttpExtractor } from './extractors/languages/scala/akkaHttp'
import { Http4sExtractor } from './extractors/languages/scala/http4s'
import { PhoenixExtractor } from './extractors/languages/elixir/phoenix'
import { PlugRouterExtractor } from './extractors/languages/elixir/plugRouter'
import { VaporExtractor } from './extractors/languages/swift/vapor'
import { HummingbirdExtractor } from './extractors/languages/swift/hummingbird'
import { LaravelExtractor } from './extractors/languages/php/laravel'
import { SymfonyExtractor } from './extractors/languages/php/symfony'
import { SlimExtractor } from './extractors/languages/php/slim'
import { LumenExtractor } from './extractors/languages/php/lumen'

type ApiExtractorClass = new (ctx: ApiExtractorContext) => BaseApiExtractor

const registry = new Map<string, ApiExtractorClass>()

function register(language: string, approach: string, cls: ApiExtractorClass) {
  registry.set(`${language}:${approach}`, cls)
}

// ── Java ──────────────────────────────────────────────────────────────────────
register('Java',   'spring_mvc',  SpringMvcExtractor)
register('Kotlin', 'spring_mvc',  SpringMvcExtractor)  // same annotations
register('Java',   'jax_rs',      JaxRsExtractor)
register('Kotlin', 'jax_rs',      JaxRsExtractor)
register('Java',   'spring_graphql', SpringGraphqlExtractor)
register('Kotlin', 'spring_graphql', SpringGraphqlExtractor)
register('Java',   'netflix_dgs',   NetflixDgsExtractor)
register('Kotlin', 'netflix_dgs',   NetflixDgsExtractor)
register('Java',   'grpc_java_stub', GrpcJavaStubExtractor)
register('Kotlin', 'grpc_java_stub', GrpcJavaStubExtractor)
register('Java',   'micronaut',      MicronautExtractor)
register('Kotlin', 'micronaut',      MicronautExtractor)
register('Java',   'vertx_web',      VertxWebExtractor)
register('Kotlin', 'vertx_web',      VertxWebExtractor)
register('Kotlin', 'ktor',           KtorExtractor)

// ── Python ────────────────────────────────────────────────────────────────────
register('Python', 'fastapi',                FastApiExtractor)
register('Python', 'flask',                  FlaskExtractor)
register('Python', 'django_rest_framework',  DjangoRestFrameworkExtractor)
register('Python', 'starlette',              StarletteExtractor)
register('Python', 'sanic',                  SanicExtractor)
register('Python', 'aiohttp',                AiohttpExtractor)

// ── TypeScript / JavaScript ───────────────────────────────────────────────────
register('TypeScript', 'express',  ExpressExtractor)
register('JavaScript', 'express',  ExpressExtractor)
register('TypeScript', 'nestjs',   NestJsExtractor)
register('TypeScript', 'fastify',  FastifyExtractor)
register('JavaScript', 'fastify',  FastifyExtractor)
register('TypeScript', 'hono',     HonoExtractor)
register('JavaScript', 'hono',     HonoExtractor)
register('TypeScript', 'koa',      KoaExtractor)
register('JavaScript', 'koa',      KoaExtractor)
register('TypeScript', 'trpc',       TrpcExtractor)
register('TypeScript', 'nextjs_api', NextJsApiExtractor)

// ── Go ────────────────────────────────────────────────────────────────────────
register('Go', 'gin',      GinExtractor)
register('Go', 'echo',     EchoExtractor)
register('Go', 'chi',      ChiExtractor)
register('Go', 'fiber',    FiberExtractor)
register('Go', 'net_http',    NetHttpExtractor)
register('Go', 'gorilla_mux', GorillaMuxExtractor)
register('Go', 'beego',       BeegoExtractor)

// ── Ruby ──────────────────────────────────────────────────────────────────────
register('Ruby', 'rails_routes', RailsRoutesExtractor)
register('Ruby', 'grape',        GrapeExtractor)
register('Ruby', 'sinatra',      SinatraExtractor)

// ── C# ────────────────────────────────────────────────────────────────────────
register('C#', 'aspnet_core',  AspNetCoreExtractor)
register('C#', 'minimal_api', MinimalApiExtractor)
register('C#', 'grpc',        CsharpGrpcExtractor)

// ── Rust ──────────────────────────────────────────────────────────────────────
register('Rust', 'axum',      AxumExtractor)
register('Rust', 'actix_web', ActixWebExtractor)
register('Rust', 'rocket',    RocketExtractor)
register('Rust', 'warp',      WarpExtractor)
register('Rust', 'poem',      PoemExtractor)

// ── PHP ───────────────────────────────────────────────────────────────────────
register('PHP', 'laravel', LaravelExtractor)
register('PHP', 'symfony', SymfonyExtractor)
register('PHP', 'slim',    SlimExtractor)
register('PHP', 'lumen',   LumenExtractor)

// ── Scala ─────────────────────────────────────────────────────────────────────
register('Scala', 'play',      PlayExtractor)
register('Scala', 'akka_http', AkkaHttpExtractor)
register('Scala', 'http4s',    Http4sExtractor)

// ── Elixir ────────────────────────────────────────────────────────────────────
register('Elixir', 'phoenix',     PhoenixExtractor)
register('Elixir', 'plug_router', PlugRouterExtractor)

// ── Swift ─────────────────────────────────────────────────────────────────────
register('Swift', 'vapor',       VaporExtractor)
register('Swift', 'hummingbird', HummingbirdExtractor)

// ── Cross-language ────────────────────────────────────────────────────────────
register('cross-language', 'grpc_proto',      GrpcProtoExtractor)
register('cross-language', 'openapi_spec',    OpenApiSpecExtractor)
register('cross-language', 'graphql_schema',  GraphQLSchemaExtractor)
register('cross-language', 'thrift',          ThriftExtractor)

// ── Future extractors (not yet implemented) ───────────────────────────────────
// Java
// register('Java',   'spring_graphql',  SpringGraphqlExtractor)  // ✓ implemented
// register('Java',   'netflix_dgs',     NetflixDgsExtractor)  // ✓ implemented
// Python
// register('Python', 'flask',                    FlaskExtractor)
// register('Python', 'fastapi',                  FastApiExtractor)
// register('Python', 'django_rest_framework',    DjangoRestFrameworkExtractor)
// TypeScript/JavaScript
// register('TypeScript', 'nestjs',       NestJsExtractor)
// register('TypeScript', 'express',      ExpressExtractor)
// Cross-language
// register('cross-language', 'openapi_spec',    OpenApiSpecExtractor)
// register('cross-language', 'graphql_schema',  GraphQLSchemaExtractor)

export function getApiExtractor(
  language: string,
  approach: string,
  ctx: ApiExtractorContext,
): BaseApiExtractor | null {
  const cls = registry.get(`${language}:${approach}`)
  if (!cls) return null
  return new cls(ctx)
}

export function hasApiExtractor(language: string, approach: string): boolean {
  return registry.has(`${language}:${approach}`)
}

export function getApiExtractors(
  approaches: DetectedApiApproach[],
  ctx: ApiExtractorContext,
): BaseApiExtractor[] {
  return approaches
    .filter((a) => a.confidence !== 'low')
    .flatMap((a) => {
      const extractor = getApiExtractor(a.language, a.approach, ctx)
      return extractor ? [extractor] : []
    })
}
