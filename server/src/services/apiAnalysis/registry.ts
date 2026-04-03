import { BaseApiExtractor, ApiExtractorContext, DetectedApiApproach } from './extractors/base'
import { SpringMvcExtractor } from './extractors/languages/java/springMvc'
import { JaxRsExtractor } from './extractors/languages/java/jaxRs'
import { GrpcProtoExtractor } from './extractors/shared/grpcProto'

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

// ── Cross-language ────────────────────────────────────────────────────────────
register('cross-language', 'grpc_proto', GrpcProtoExtractor)

// ── Future extractors (not yet implemented) ───────────────────────────────────
// Java
// register('Java',   'spring_graphql',  SpringGraphqlExtractor)
// register('Java',   'netflix_dgs',     NetflixDgsExtractor)
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
