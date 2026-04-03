import { BaseApiExtractor, ApiExtractorContext, DetectedApiApproach } from './extractors/base'
import { SpringMvcExtractor } from './extractors/languages/java/springMvc'
import { JaxRsExtractor } from './extractors/languages/java/jaxRs'
import { SpringGraphqlExtractor } from './extractors/languages/java/springGraphql'
import { NetflixDgsExtractor } from './extractors/languages/java/netflixDgs'
import { GrpcProtoExtractor } from './extractors/shared/grpcProto'
import { GrpcJavaStubExtractor } from './extractors/languages/java/grpcJavaStub'
import { FastApiExtractor } from './extractors/languages/python/fastapi'
import { FlaskExtractor } from './extractors/languages/python/flask'
import { DjangoRestFrameworkExtractor } from './extractors/languages/python/djangoRestFramework'
import { ExpressExtractor } from './extractors/languages/typescript/express'
import { NestJsExtractor } from './extractors/languages/typescript/nestjs'
import { FastifyExtractor } from './extractors/languages/typescript/fastify'
import { HonoExtractor } from './extractors/languages/typescript/hono'

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

// ── Python ────────────────────────────────────────────────────────────────────
register('Python', 'fastapi',                FastApiExtractor)
register('Python', 'flask',                  FlaskExtractor)
register('Python', 'django_rest_framework',  DjangoRestFrameworkExtractor)

// ── TypeScript / JavaScript ───────────────────────────────────────────────────
register('TypeScript', 'express',  ExpressExtractor)
register('JavaScript', 'express',  ExpressExtractor)
register('TypeScript', 'nestjs',   NestJsExtractor)
register('TypeScript', 'fastify',  FastifyExtractor)
register('JavaScript', 'fastify',  FastifyExtractor)
register('TypeScript', 'hono',     HonoExtractor)
register('JavaScript', 'hono',     HonoExtractor)

// ── Cross-language ────────────────────────────────────────────────────────────
register('cross-language', 'grpc_proto', GrpcProtoExtractor)

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
