import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DetectedApiApproach, Confidence } from './extractors/base'

interface DetectedLanguage {
  language: string
  bytes: number
}

/**
 * Phase 1: detect which API frameworks are used in a repository.
 * Returns a list of DetectedApiApproach objects with confidence scores.
 */
export async function detectApiApproaches(
  sourceDir: string,
  languages: DetectedLanguage[],
): Promise<DetectedApiApproach[]> {
  const detectedLanguages = new Set(languages.map((l) => l.language))
  const approaches: DetectedApiApproach[] = []

  const detectorPromises: Promise<DetectedApiApproach[]>[] = [
    // Cross-language detectors always run
    detectGrpcProto(sourceDir),
    detectOpenApiSpec(sourceDir),
    detectGraphQLSchema(sourceDir),
    detectThrift(sourceDir),
  ]

  if (detectedLanguages.has('Java') || detectedLanguages.has('Kotlin')) {
    detectorPromises.push(detectJavaApiApproaches(sourceDir))
  }

  if (detectedLanguages.has('Kotlin')) {
    detectorPromises.push(detectKotlinApiApproaches(sourceDir))
  }

  if (detectedLanguages.has('Python')) {
    detectorPromises.push(detectPythonApiApproaches(sourceDir))
  }

  if (detectedLanguages.has('TypeScript') || detectedLanguages.has('JavaScript')) {
    detectorPromises.push(detectJsApiApproaches(sourceDir))
  }

  if (detectedLanguages.has('Go')) {
    detectorPromises.push(detectGoApiApproaches(sourceDir))
  }

  if (detectedLanguages.has('Ruby')) {
    detectorPromises.push(detectRubyApiApproaches(sourceDir))
  }

  if (detectedLanguages.has('C#')) {
    detectorPromises.push(detectCsharpApiApproaches(sourceDir))
  }

  if (detectedLanguages.has('Rust')) {
    detectorPromises.push(detectRustApiApproaches(sourceDir))
  }

  if (detectedLanguages.has('PHP')) {
    detectorPromises.push(detectPhpApiApproaches(sourceDir))
  }

  if (detectedLanguages.has('Scala')) {
    detectorPromises.push(detectScalaApiApproaches(sourceDir))
  }

  if (detectedLanguages.has('Elixir')) {
    detectorPromises.push(detectElixirApiApproaches(sourceDir))
  }

  if (detectedLanguages.has('Swift')) {
    detectorPromises.push(detectSwiftApiApproaches(sourceDir))
  }

  const results = await Promise.allSettled(detectorPromises)
  for (const result of results) {
    if (result.status === 'fulfilled') approaches.push(...result.value)
  }

  return approaches
}

// ---- Java / Kotlin API detector ----

async function detectJavaApiApproaches(sourceDir: string): Promise<DetectedApiApproach[]> {
  const approaches: DetectedApiApproach[] = []

  // Read build files for Tier A signals
  const [pomContent, gradleContent, gradleKtsContent] = await Promise.all([
    readSafe(join(sourceDir, 'pom.xml')),
    readSafe(join(sourceDir, 'build.gradle')),
    readSafe(join(sourceDir, 'build.gradle.kts')),
  ])
  const buildContent = (pomContent ?? '') + (gradleContent ?? '') + (gradleKtsContent ?? '')

  // ── Spring MVC / Spring WebFlux ──────────────────────────────────────────

  const springSignals: string[] = []

  if (/spring-boot-starter-web\b|spring-webmvc\b|spring-boot-starter-webflux\b/.test(buildContent)) {
    springSignals.push('Tier A: spring-boot-starter-web / spring-webmvc found in build file')
  }

  const controllerFiles = await globCount(sourceDir, '**/controller/*.java') +
                          await globCount(sourceDir, '**/controllers/*.java') +
                          await globCount(sourceDir, '**/controller/*.kt')
  if (controllerFiles > 0) {
    springSignals.push(`Tier B: ${controllerFiles} file(s) in controller/ directory`)
  }

  const restControllerHits = await grepFirst(sourceDir, '**/*.{java,kt}', /@RestController\b/, 3)
  if (restControllerHits.length > 0) {
    springSignals.push(`Tier C: @RestController found in ${restControllerHits[0]}`)
  } else {
    const controllerHits = await grepFirst(sourceDir, '**/*.{java,kt}', /@Controller\b/, 3)
    if (controllerHits.length > 0) {
      springSignals.push(`Tier C: @Controller found in ${controllerHits[0]}`)
    }
  }

  if (springSignals.length > 0) {
    approaches.push({
      language: 'Java',
      approach: 'spring_mvc',
      apiStyle: 'http',
      confidence: scoreConfidence(springSignals),
      signals: springSignals,
    })
  }

  // ── JAX-RS (Jersey / RESTEasy / Quarkus) ────────────────────────────────

  const jaxRsSignals: string[] = []

  if (/jakarta\.ws\.rs|javax\.ws\.rs|jersey-server|resteasy-core|quarkus-resteasy/.test(buildContent)) {
    jaxRsSignals.push('Tier A: JAX-RS dependency (jakarta.ws.rs / jersey / resteasy) found in build file')
  }

  const resourceFiles = await globCount(sourceDir, '**/resource/*.java') +
                        await globCount(sourceDir, '**/resources/*.java')
  if (resourceFiles > 0) {
    jaxRsSignals.push(`Tier B: ${resourceFiles} file(s) in resource/ directory`)
  }

  const pathHits = await grepFirst(sourceDir, '**/*.{java,kt}', /import\s+(?:jakarta|javax)\.ws\.rs\./, 3)
  if (pathHits.length > 0) {
    jaxRsSignals.push(`Tier C: JAX-RS import found in ${pathHits[0]}`)
  }

  if (jaxRsSignals.length > 0) {
    approaches.push({
      language: 'Java',
      approach: 'jax_rs',
      apiStyle: 'http',
      confidence: scoreConfidence(jaxRsSignals),
      signals: jaxRsSignals,
    })
  }

  // ── Spring GraphQL ───────────────────────────────────────────────────────

  const springGqlSignals: string[] = []

  if (/spring-boot-starter-graphql|graphql-java-spring-boot/.test(buildContent)) {
    springGqlSignals.push('Tier A: spring-boot-starter-graphql found in build file')
  }

  const gqlsFiles = await globCount(sourceDir, '**/*.graphqls') + await globCount(sourceDir, '**/*.graphql')
  if (gqlsFiles > 0) springGqlSignals.push(`Tier B: ${gqlsFiles} GraphQL schema file(s) found`)

  const queryMappingHits = await grepFirst(sourceDir, '**/*.{java,kt}', /@QueryMapping\b|@MutationMapping\b/, 3)
  if (queryMappingHits.length > 0) {
    springGqlSignals.push(`Tier C: @QueryMapping/@MutationMapping found in ${queryMappingHits[0]}`)
  }

  if (springGqlSignals.length > 0) {
    approaches.push({
      language: 'Java',
      approach: 'spring_graphql',
      apiStyle: 'graphql',
      confidence: scoreConfidence(springGqlSignals),
      signals: springGqlSignals,
    })
  }

  // ── Netflix DGS ──────────────────────────────────────────────────────────

  const dgsSignals: string[] = []

  if (/graphql-dgs/.test(buildContent)) {
    dgsSignals.push('Tier A: com.netflix.graphql.dgs dependency found in build file')
  }

  const dgsFetcherFiles = await globCount(sourceDir, '**/datafetcher/*.java') +
                          await globCount(sourceDir, '**/fetcher/*.java')
  if (dgsFetcherFiles > 0) dgsSignals.push(`Tier B: ${dgsFetcherFiles} file(s) in datafetcher/ directory`)

  const dgsHits = await grepFirst(sourceDir, '**/*.{java,kt}', /@DgsComponent\b|@DgsQuery\b/, 3)
  if (dgsHits.length > 0) dgsSignals.push(`Tier C: @DgsComponent/@DgsQuery found in ${dgsHits[0]}`)

  if (dgsSignals.length > 0) {
    approaches.push({
      language: 'Java',
      approach: 'netflix_dgs',
      apiStyle: 'graphql',
      confidence: scoreConfidence(dgsSignals),
      signals: dgsSignals,
    })
  }

  // ── gRPC Java ────────────────────────────────────────────────────────────
  // Detection here confirms Java is using gRPC; the actual proto extraction
  // is handled by the cross-language grpc_proto detector/extractor.
  // We add a Java-specific signal set but only if grpc_proto is NOT already detected
  // (to avoid duplicate surfaces). We skip this and let grpc_proto cover it.

  // ── Micronaut HTTP ───────────────────────────────────────────────────────

  const micronautSignals: string[] = []

  if (/micronaut-http-server|micronaut-runtime|io\.micronaut:micronaut/.test(buildContent)) {
    micronautSignals.push('Tier A: Micronaut HTTP dependency found in build file')
  }

  const micronautAnnotHits = await grepFirst(sourceDir, '**/*.{java,kt}', /import\s+io\.micronaut\.http\.annotation\./, 3)
  if (micronautAnnotHits.length > 0) {
    micronautSignals.push(`Tier C: io.micronaut.http.annotation import found in ${micronautAnnotHits[0]}`)
  }

  if (micronautSignals.length > 0) {
    approaches.push({
      language: 'Java',
      approach: 'micronaut',
      apiStyle: 'http',
      confidence: scoreConfidence(micronautSignals),
      signals: micronautSignals,
    })
  }

  // ── Vert.x Web ───────────────────────────────────────────────────────────
  const vertxSignals: string[] = []
  if (/io\.vertx:vertx-web|vertx-core/.test(buildContent)) vertxSignals.push('Tier A: vertx-web found in build file')
  const vertxHits = await grepFirst(sourceDir, '**/*.{java,kt}', /import\s+io\.vertx\.ext\.web\.|Router\.router\s*\(/, 3)
  if (vertxHits.length > 0) vertxSignals.push(`Tier C: Vert.x Web usage found in ${vertxHits[0]}`)
  if (vertxSignals.length > 0) {
    approaches.push({ language: 'Java', approach: 'vertx_web', apiStyle: 'http', confidence: scoreConfidence(vertxSignals), signals: vertxSignals })
  }

  return approaches
}

// ── Python API detector ──────────────────────────────────────────────────────

async function detectPythonApiApproaches(sourceDir: string): Promise<DetectedApiApproach[]> {
  const approaches: DetectedApiApproach[] = []

  // Read common Python dependency files for Tier A signals
  const [reqContent, pyprojectContent, setupContent] = await Promise.all([
    readSafe(join(sourceDir, 'requirements.txt')),
    readSafe(join(sourceDir, 'pyproject.toml')),
    readSafe(join(sourceDir, 'setup.py')),
  ])
  const depContent = (reqContent ?? '') + (pyprojectContent ?? '') + (setupContent ?? '')

  // ── FastAPI ──────────────────────────────────────────────────────────────
  const fastapiSignals: string[] = []

  if (/\bfastapi\b/i.test(depContent)) {
    fastapiSignals.push('Tier A: fastapi dependency found')
  }

  const fastapiHits = await grepFirst(sourceDir, '**/*.py', /from\s+fastapi\s+import|FastAPI\s*\(/, 3)
  if (fastapiHits.length > 0) {
    fastapiSignals.push(`Tier C: FastAPI usage found in ${fastapiHits[0]}`)
  }

  if (fastapiSignals.length > 0) {
    approaches.push({ language: 'Python', approach: 'fastapi', apiStyle: 'http', confidence: scoreConfidence(fastapiSignals), signals: fastapiSignals })
  }

  // ── Flask ────────────────────────────────────────────────────────────────
  const flaskSignals: string[] = []

  if (/\bflask\b/i.test(depContent)) {
    flaskSignals.push('Tier A: flask dependency found')
  }

  const flaskAppFiles = await globCount(sourceDir, '**/app.py') + await globCount(sourceDir, '**/application.py')
  if (flaskAppFiles > 0) flaskSignals.push(`Tier B: ${flaskAppFiles} app.py/application.py file(s) found`)

  const flaskHits = await grepFirst(sourceDir, '**/*.py', /from\s+flask\s+import|Flask\s*\(__name__\)/, 3)
  if (flaskHits.length > 0) {
    flaskSignals.push(`Tier C: Flask usage found in ${flaskHits[0]}`)
  }

  if (flaskSignals.length > 0) {
    approaches.push({ language: 'Python', approach: 'flask', apiStyle: 'http', confidence: scoreConfidence(flaskSignals), signals: flaskSignals })
  }

  // ── Django REST Framework ────────────────────────────────────────────────
  const drfSignals: string[] = []

  if (/djangorestframework|rest_framework/i.test(depContent)) {
    drfSignals.push('Tier A: djangorestframework dependency found')
  }

  const drfHits = await grepFirst(sourceDir, '**/*.py', /from\s+rest_framework|ModelViewSet|APIView/, 3)
  if (drfHits.length > 0) {
    drfSignals.push(`Tier C: DRF usage found in ${drfHits[0]}`)
  }

  if (drfSignals.length > 0) {
    approaches.push({ language: 'Python', approach: 'django_rest_framework', apiStyle: 'http', confidence: scoreConfidence(drfSignals), signals: drfSignals })
  }

  // ── Starlette ────────────────────────────────────────────────────────────
  const starletteSignals: string[] = []
  if (/\bstarlette\b/i.test(depContent)) starletteSignals.push('Tier A: starlette dependency found')
  const starletteHits = await grepFirst(sourceDir, '**/*.py', /from\s+starlette\s+import|Starlette\s*\(/, 3)
  if (starletteHits.length > 0) starletteSignals.push(`Tier C: Starlette usage found in ${starletteHits[0]}`)
  if (starletteSignals.length > 0) {
    approaches.push({ language: 'Python', approach: 'starlette', apiStyle: 'http', confidence: scoreConfidence(starletteSignals), signals: starletteSignals })
  }

  // ── Sanic ────────────────────────────────────────────────────────────────
  const sanicSignals: string[] = []
  if (/\bsanic\b/i.test(depContent)) sanicSignals.push('Tier A: sanic dependency found')
  const sanicHits = await grepFirst(sourceDir, '**/*.py', /from\s+sanic\s+import|Sanic\s*\(/, 3)
  if (sanicHits.length > 0) sanicSignals.push(`Tier C: Sanic usage found in ${sanicHits[0]}`)
  if (sanicSignals.length > 0) {
    approaches.push({ language: 'Python', approach: 'sanic', apiStyle: 'http', confidence: scoreConfidence(sanicSignals), signals: sanicSignals })
  }

  // ── aiohttp ──────────────────────────────────────────────────────────────
  const aiohttpSignals: string[] = []
  if (/\baiohttp\b/i.test(depContent)) aiohttpSignals.push('Tier A: aiohttp dependency found')
  const aiohttpHits = await grepFirst(sourceDir, '**/*.py', /from\s+aiohttp\s+import|web\.Application\s*\(/, 3)
  if (aiohttpHits.length > 0) aiohttpSignals.push(`Tier C: aiohttp usage found in ${aiohttpHits[0]}`)
  if (aiohttpSignals.length > 0) {
    approaches.push({ language: 'Python', approach: 'aiohttp', apiStyle: 'http', confidence: scoreConfidence(aiohttpSignals), signals: aiohttpSignals })
  }

  return approaches
}

// ── TypeScript/JavaScript API detector ──────────────────────────────────────

async function detectJsApiApproaches(sourceDir: string): Promise<DetectedApiApproach[]> {
  const approaches: DetectedApiApproach[] = []

  const pkgContent = await readSafe(join(sourceDir, 'package.json')) ?? ''

  // ── Express ──────────────────────────────────────────────────────────────
  const expressSignals: string[] = []
  if (/["']express["']/i.test(pkgContent)) expressSignals.push('Tier A: express found in package.json')
  const expressHits = await grepFirst(sourceDir, '**/*.{ts,js,mts,mjs}', /require\s*\(\s*['"]express['"]|from\s+['"]express['"]/, 3)
  if (expressHits.length > 0) expressSignals.push(`Tier C: express import found in ${expressHits[0]}`)
  if (expressSignals.length > 0) {
    approaches.push({ language: 'TypeScript', approach: 'express', apiStyle: 'http', confidence: scoreConfidence(expressSignals), signals: expressSignals })
  }

  // ── NestJS ───────────────────────────────────────────────────────────────
  const nestSignals: string[] = []
  if (/["']@nestjs\/core["']|["']@nestjs\/common["']/i.test(pkgContent)) nestSignals.push('Tier A: @nestjs/core found in package.json')
  const nestControllerFiles = await globCount(sourceDir, '**/*.controller.ts') + await globCount(sourceDir, '**/*.controller.js')
  if (nestControllerFiles > 0) nestSignals.push(`Tier B: ${nestControllerFiles} *.controller.{ts,js} file(s) found`)
  const nestHits = await grepFirst(sourceDir, '**/*.{ts,mts}', /@Controller\s*\(/, 3)
  if (nestHits.length > 0) nestSignals.push(`Tier C: @Controller found in ${nestHits[0]}`)
  if (nestSignals.length > 0) {
    approaches.push({ language: 'TypeScript', approach: 'nestjs', apiStyle: 'http', confidence: scoreConfidence(nestSignals), signals: nestSignals })
  }

  // ── Fastify ───────────────────────────────────────────────────────────────
  const fastifySignals: string[] = []
  if (/["']fastify["']/i.test(pkgContent)) fastifySignals.push('Tier A: fastify found in package.json')
  const fastifyHits = await grepFirst(sourceDir, '**/*.{ts,js,mts,mjs}', /require\s*\(\s*['"]fastify['"]|from\s+['"]fastify['"]|Fastify\s*\(/, 3)
  if (fastifyHits.length > 0) fastifySignals.push(`Tier C: fastify import found in ${fastifyHits[0]}`)
  if (fastifySignals.length > 0) {
    approaches.push({ language: 'TypeScript', approach: 'fastify', apiStyle: 'http', confidence: scoreConfidence(fastifySignals), signals: fastifySignals })
  }

  // ── Hono ──────────────────────────────────────────────────────────────────
  const honoSignals: string[] = []
  if (/["']hono["']/i.test(pkgContent)) honoSignals.push('Tier A: hono found in package.json')
  const honoHits = await grepFirst(sourceDir, '**/*.{ts,js,mts,mjs}', /from\s+['"]hono['"]|new\s+Hono\s*\(/, 3)
  if (honoHits.length > 0) honoSignals.push(`Tier C: hono import found in ${honoHits[0]}`)
  if (honoSignals.length > 0) {
    approaches.push({ language: 'TypeScript', approach: 'hono', apiStyle: 'http', confidence: scoreConfidence(honoSignals), signals: honoSignals })
  }

  // ── Koa ───────────────────────────────────────────────────────────────────
  const koaSignals: string[] = []
  if (/["']koa-router["']|["']@koa\/router["']/i.test(pkgContent)) koaSignals.push('Tier A: koa-router or @koa/router found in package.json')
  const koaHits = await grepFirst(sourceDir, '**/*.{ts,js,mts,mjs}', /require\s*\(\s*['"](?:koa-router|@koa\/router)['"]|from\s+['"](?:koa-router|@koa\/router)['"]/, 3)
  if (koaHits.length > 0) koaSignals.push(`Tier C: koa-router import found in ${koaHits[0]}`)
  if (koaSignals.length > 0) {
    approaches.push({ language: 'TypeScript', approach: 'koa', apiStyle: 'http', confidence: scoreConfidence(koaSignals), signals: koaSignals })
  }

  // ── Next.js API routes ────────────────────────────────────────────────────
  const nextSignals: string[] = []
  if (/["']next["']/i.test(pkgContent)) nextSignals.push('Tier A: next found in package.json')
  const nextPagesHits = await grepFirst(sourceDir, 'pages/api/**/*.{ts,js,tsx,jsx}', /export\s+default/, 3)
  if (nextPagesHits.length > 0) nextSignals.push(`Tier B: Next.js Pages Router API file found: ${nextPagesHits[0]}`)
  const nextAppRouteHits = await grepFirst(sourceDir, 'app/**/route.{ts,js,tsx,jsx}', /export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|DELETE|PATCH)/, 3)
  if (nextAppRouteHits.length > 0) nextSignals.push(`Tier B: Next.js App Router route file found: ${nextAppRouteHits[0]}`)
  if (nextSignals.length > 0) {
    approaches.push({ language: 'TypeScript', approach: 'nextjs_api', apiStyle: 'http', confidence: scoreConfidence(nextSignals), signals: nextSignals })
  }

  // ── tRPC ──────────────────────────────────────────────────────────────────
  const trpcSignals: string[] = []
  if (/["']@trpc\/server["']/i.test(pkgContent)) trpcSignals.push('Tier A: @trpc/server found in package.json')
  const trpcHits = await grepFirst(sourceDir, '**/*.{ts,js,mts,mjs}', /@trpc\/server/, 3)
  if (trpcHits.length > 0) trpcSignals.push(`Tier C: @trpc/server import found in ${trpcHits[0]}`)
  if (trpcSignals.length > 0) {
    approaches.push({ language: 'TypeScript', approach: 'trpc', apiStyle: 'rpc', confidence: scoreConfidence(trpcSignals), signals: trpcSignals })
  }

  // ── gRPC-node / @grpc/grpc-js ────────────────────────────────────────────
  const grpcNodeSignals: string[] = []
  if (/["']@grpc\/grpc-js["']|["']grpc["']/i.test(pkgContent)) {
    grpcNodeSignals.push('Tier A: @grpc/grpc-js or grpc found in package.json')
    // Defer to proto extractor for schema — just register the approach
    approaches.push({ language: 'cross-language', approach: 'grpc_proto', apiStyle: 'rpc', confidence: 'high', signals: grpcNodeSignals })
  }

  // ── Apollo Server ─────────────────────────────────────────────────────────
  const apolloSignals: string[] = []
  if (/["']@apollo\/server["']|["']apollo-server["']|["']apollo-server-express["']/i.test(pkgContent)) {
    apolloSignals.push('Tier A: Apollo Server found in package.json')
  }
  const apolloHits = await grepFirst(sourceDir, '**/*.{ts,js,mts,mjs}', /new\s+ApolloServer\s*\(|ApolloServer\s*\{/, 3)
  if (apolloHits.length > 0) apolloSignals.push(`Tier C: ApolloServer instantiation found in ${apolloHits[0]}`)
  if (apolloSignals.length > 0) {
    approaches.push({ language: 'TypeScript', approach: 'graphql_schema', apiStyle: 'graphql', confidence: scoreConfidence(apolloSignals), signals: apolloSignals })
  }

  return approaches
}

// ── Go API approaches ─────────────────────────────────────────────────────────

async function detectGoApiApproaches(sourceDir: string): Promise<DetectedApiApproach[]> {
  const approaches: DetectedApiApproach[] = []

  const goModContent = await readSafe(join(sourceDir, 'go.mod')) ?? ''

  // ── net/http ──────────────────────────────────────────────────────────────
  const httpSignals: string[] = []
  if (/^module\s/m.test(goModContent)) httpSignals.push('Tier A: go.mod found (Go project)')
  const httpHits = await grepFirst(sourceDir, '**/*.go', /http\.HandleFunc\s*\(|http\.NewServeMux\s*\(/, 3)
  if (httpHits.length > 0) httpSignals.push(`Tier C: net/http route registration found in ${httpHits[0]}`)
  if (httpSignals.length > 1) {  // require both Tier A and Tier C
    approaches.push({ language: 'Go', approach: 'net_http', apiStyle: 'http', confidence: scoreConfidence(httpSignals), signals: httpSignals })
  }

  // ── Gin ───────────────────────────────────────────────────────────────────
  const ginSignals: string[] = []
  if (/gin-gonic\/gin/.test(goModContent)) ginSignals.push('Tier A: gin-gonic/gin found in go.mod')
  const ginHits = await grepFirst(sourceDir, '**/*.go', /gin\.Default\s*\(\s*\)|gin\.New\s*\(\s*\)/, 3)
  if (ginHits.length > 0) ginSignals.push(`Tier C: gin.Default/New found in ${ginHits[0]}`)
  if (ginSignals.length > 0) {
    approaches.push({ language: 'Go', approach: 'gin', apiStyle: 'http', confidence: scoreConfidence(ginSignals), signals: ginSignals })
  }

  // ── Echo ──────────────────────────────────────────────────────────────────
  const echoSignals: string[] = []
  if (/labstack\/echo/.test(goModContent)) echoSignals.push('Tier A: labstack/echo found in go.mod')
  const echoHits = await grepFirst(sourceDir, '**/*.go', /echo\.New\s*\(\s*\)/, 3)
  if (echoHits.length > 0) echoSignals.push(`Tier C: echo.New found in ${echoHits[0]}`)
  if (echoSignals.length > 0) {
    approaches.push({ language: 'Go', approach: 'echo', apiStyle: 'http', confidence: scoreConfidence(echoSignals), signals: echoSignals })
  }

  // ── Chi ───────────────────────────────────────────────────────────────────
  const chiSignals: string[] = []
  if (/go-chi\/chi/.test(goModContent)) chiSignals.push('Tier A: go-chi/chi found in go.mod')
  const chiHits = await grepFirst(sourceDir, '**/*.go', /chi\.NewRouter\s*\(\s*\)/, 3)
  if (chiHits.length > 0) chiSignals.push(`Tier C: chi.NewRouter found in ${chiHits[0]}`)
  if (chiSignals.length > 0) {
    approaches.push({ language: 'Go', approach: 'chi', apiStyle: 'http', confidence: scoreConfidence(chiSignals), signals: chiSignals })
  }

  // ── Fiber ─────────────────────────────────────────────────────────────────
  const fiberSignals: string[] = []
  if (/gofiber\/fiber/.test(goModContent)) fiberSignals.push('Tier A: gofiber/fiber found in go.mod')
  const fiberHits = await grepFirst(sourceDir, '**/*.go', /fiber\.New\s*\(\s*\)/, 3)
  if (fiberHits.length > 0) fiberSignals.push(`Tier C: fiber.New found in ${fiberHits[0]}`)
  if (fiberSignals.length > 0) {
    approaches.push({ language: 'Go', approach: 'fiber', apiStyle: 'http', confidence: scoreConfidence(fiberSignals), signals: fiberSignals })
  }

  // ── gorilla/mux ──────────────────────────────────────────────────────────
  const gorillaMuxSignals: string[] = []
  if (/gorilla\/mux/.test(goModContent)) gorillaMuxSignals.push('Tier A: gorilla/mux found in go.mod')
  const gorillaMuxHits = await grepFirst(sourceDir, '**/*.go', /mux\.NewRouter\s*\(\s*\)/, 3)
  if (gorillaMuxHits.length > 0) gorillaMuxSignals.push(`Tier C: mux.NewRouter found in ${gorillaMuxHits[0]}`)
  if (gorillaMuxSignals.length > 0) {
    approaches.push({ language: 'Go', approach: 'gorilla_mux', apiStyle: 'http', confidence: scoreConfidence(gorillaMuxSignals), signals: gorillaMuxSignals })
  }

  // ── Beego ────────────────────────────────────────────────────────────────
  const beegoSignals: string[] = []
  if (/beego\/beego|beego\/v2/.test(goModContent)) beegoSignals.push('Tier A: beego found in go.mod')
  const beegoHits = await grepFirst(sourceDir, '**/*.go', /(?:beego|web)\.Router\s*\(/, 3)
  if (beegoHits.length > 0) beegoSignals.push(`Tier C: beego.Router found in ${beegoHits[0]}`)
  if (beegoSignals.length > 0) {
    approaches.push({ language: 'Go', approach: 'beego', apiStyle: 'http', confidence: scoreConfidence(beegoSignals), signals: beegoSignals })
  }

  // ── gqlgen (GraphQL) ────────────────────────────────────────────────────────
  if (/99designs\/gqlgen/.test(goModContent)) {
    approaches.push({ language: 'cross-language', approach: 'graphql_schema', apiStyle: 'graphql', confidence: 'high', signals: ['Tier A: 99designs/gqlgen found in go.mod'] })
  }

  // ── gRPC-Go — defer to proto extractor ────────────────────────────────────
  if (/google\.golang\.org\/grpc/.test(goModContent)) {
    approaches.push({ language: 'cross-language', approach: 'grpc_proto', apiStyle: 'rpc', confidence: 'high', signals: ['Tier A: google.golang.org/grpc found in go.mod'] })
  }

  return approaches
}

// ── Ruby API detector ─────────────────────────────────────────────────────────

async function detectRubyApiApproaches(sourceDir: string): Promise<DetectedApiApproach[]> {
  const approaches: DetectedApiApproach[] = []

  // Rails routes
  const routesFiles = await globCount(sourceDir, '**/config/routes.rb')
  if (routesFiles > 0) {
    const signals: string[] = [`Tier B: config/routes.rb found`]
    const resourceHits = await grepFirst(sourceDir, '**/config/routes.rb', /\bresources?\s+:/, 3)
    if (resourceHits.length > 0) signals.push('Tier C: resources/resource routes found')
    approaches.push({ language: 'Ruby', approach: 'rails_routes', apiStyle: 'http', confidence: 'high', signals })
  }

  // Grape
  const grapeHits = await grepFirst(sourceDir, '**/*.rb', /Grape::API/, 3)
  if (grapeHits.length > 0) {
    const signals: string[] = [`Tier C: Grape::API subclass found in ${grapeHits[0]}`]
    approaches.push({ language: 'Ruby', approach: 'grape', apiStyle: 'http', confidence: 'high', signals })
  }

  // Sinatra
  const sinatraSignals: string[] = []
  const gemfileContent = await readSafe(join(sourceDir, 'Gemfile')) ?? ''
  if (/\bsinatra\b/i.test(gemfileContent)) sinatraSignals.push('Tier A: sinatra gem found in Gemfile')
  const sinatraHits = await grepFirst(sourceDir, '**/*.rb', /Sinatra::(?:Base|Application)|require\s+['"]sinatra['"]/, 3)
  if (sinatraHits.length > 0) sinatraSignals.push(`Tier C: Sinatra usage found in ${sinatraHits[0]}`)
  if (sinatraSignals.length > 0) {
    approaches.push({ language: 'Ruby', approach: 'sinatra', apiStyle: 'http', confidence: scoreConfidence(sinatraSignals), signals: sinatraSignals })
  }

  return approaches
}

// ── C# API detector ───────────────────────────────────────────────────────────

async function detectCsharpApiApproaches(sourceDir: string): Promise<DetectedApiApproach[]> {
  const approaches: DetectedApiApproach[] = []

  // ASP.NET Core — [ApiController] attribute
  const apiControllerHits = await grepFirst(sourceDir, '**/*.cs', /\[ApiController\]/, 5)
  if (apiControllerHits.length > 0) {
    const signals = [`Tier C: [ApiController] found in ${apiControllerHits[0]}`]
    const routeHits = await grepFirst(sourceDir, '**/*.cs', /\[Http(?:Get|Post|Put|Delete|Patch)\]/, 5)
    if (routeHits.length > 0) signals.push('Tier C: [HttpGet/Post/…] verb attributes found')
    approaches.push({ language: 'C#', approach: 'aspnet_core', apiStyle: 'http', confidence: 'high', signals })
  }

  // Minimal APIs (.NET 6+)
  const minimalApiHits = await grepFirst(sourceDir, '**/*.cs', /\.(MapGet|MapPost|MapPut|MapDelete|MapPatch)\s*\(/, 5)
  if (minimalApiHits.length > 0) {
    approaches.push({ language: 'C#', approach: 'minimal_api', apiStyle: 'http', confidence: 'high', signals: [`Tier C: app.Map* route method found in ${minimalApiHits[0]}`] })
  }

  // Hot Chocolate / GraphQL.NET — detect GraphQL resolver patterns, route to graphql_schema
  const hotChocolateHits = await grepFirst(sourceDir, '**/*.cs', /\[QueryType\]|\[MutationType\]|\[ExtendObjectType\]|IQueryResolver/, 3)
  if (hotChocolateHits.length > 0) {
    approaches.push({ language: 'cross-language', approach: 'graphql_schema', apiStyle: 'graphql', confidence: 'high', signals: [`Tier C: Hot Chocolate/GraphQL.NET resolver pattern found in ${hotChocolateHits[0]}`] })
  }

  // gRPC (Grpc.AspNetCore) — detect *Base subclasses
  const grpcHits = await grepFirst(sourceDir, '**/*.cs', /:\s*\w+\.[\w]+Base\b|ServerCallContext/, 3)
  if (grpcHits.length > 0) {
    approaches.push({ language: 'C#', approach: 'grpc', apiStyle: 'rpc', confidence: 'high', signals: [`Tier C: gRPC *Base subclass or ServerCallContext found in ${grpcHits[0]}`] })
  }

  return approaches
}

// ── PHP API detector ──────────────────────────────────────────────────────────

async function detectPhpApiApproaches(sourceDir: string): Promise<DetectedApiApproach[]> {
  const approaches: DetectedApiApproach[] = []
  const composerContent = await readSafe(join(sourceDir, 'composer.json')) ?? ''

  // Laravel
  if (/laravel\/framework/i.test(composerContent)) {
    approaches.push({ language: 'PHP', approach: 'laravel', apiStyle: 'http', confidence: 'high', signals: ['Tier A: laravel/framework found in composer.json'] })
  } else {
    const routeFiles = await globCount(sourceDir, '**/routes/*.php')
    if (routeFiles > 0) {
      approaches.push({ language: 'PHP', approach: 'laravel', apiStyle: 'http', confidence: 'medium', signals: [`Tier B: ${routeFiles} routes/*.php file(s) found`] })
    }
  }

  // Slim Framework
  const slimSignals: string[] = []
  if (/slim\/slim/i.test(composerContent)) slimSignals.push('Tier A: slim/slim found in composer.json')
  const slimHits = await grepFirst(sourceDir, '**/*.php', /AppFactory::create|new\s+(?:\\?Slim\\)?App\s*\(/, 3)
  if (slimHits.length > 0) slimSignals.push(`Tier C: Slim app creation found in ${slimHits[0]}`)
  if (slimSignals.length > 0) {
    approaches.push({ language: 'PHP', approach: 'slim', apiStyle: 'http', confidence: scoreConfidence(slimSignals), signals: slimSignals })
  }

  // Symfony
  if (/symfony\/framework-bundle/i.test(composerContent)) {
    approaches.push({ language: 'PHP', approach: 'symfony', apiStyle: 'http', confidence: 'high', signals: ['Tier A: symfony/framework-bundle found in composer.json'] })
  } else {
    const routeHits = await grepFirst(sourceDir, '**/*.php', /#\[Route\s*\(|@Route\s*\(/, 3)
    if (routeHits.length > 0) {
      approaches.push({ language: 'PHP', approach: 'symfony', apiStyle: 'http', confidence: 'medium', signals: [`Tier C: #[Route] attribute found in ${routeHits[0]}`] })
    }
  }

  // Lumen
  const lumenSignals: string[] = []
  if (/laravel\/lumen-framework/i.test(composerContent)) lumenSignals.push('Tier A: laravel/lumen-framework found in composer.json')
  const lumenHits = await grepFirst(sourceDir, '**/*.php', /\$router->(get|post|put|delete|patch)\s*\(/, 3)
  if (lumenHits.length > 0) lumenSignals.push(`Tier C: $router-> route registration found in ${lumenHits[0]}`)
  if (lumenSignals.length > 0) {
    approaches.push({ language: 'PHP', approach: 'lumen', apiStyle: 'http', confidence: scoreConfidence(lumenSignals), signals: lumenSignals })
  }

  return approaches
}

// ── Rust API detector ─────────────────────────────────────────────────────────

async function detectRustApiApproaches(sourceDir: string): Promise<DetectedApiApproach[]> {
  const approaches: DetectedApiApproach[] = []
  const cargoContent = await readSafe(join(sourceDir, 'Cargo.toml')) ?? ''

  // Axum
  if (/\baxum\b/.test(cargoContent)) {
    approaches.push({ language: 'Rust', approach: 'axum', apiStyle: 'http', confidence: 'high', signals: ['Tier A: axum found in Cargo.toml'] })
  } else {
    const axumHits = await grepFirst(sourceDir, '**/*.rs', /axum::routing|Router::new/, 3)
    if (axumHits.length > 0) {
      approaches.push({ language: 'Rust', approach: 'axum', apiStyle: 'http', confidence: 'medium', signals: [`Tier C: axum routing found in ${axumHits[0]}`] })
    }
  }

  // Actix-web
  if (/\bactix-web\b/.test(cargoContent)) {
    approaches.push({ language: 'Rust', approach: 'actix_web', apiStyle: 'http', confidence: 'high', signals: ['Tier A: actix-web found in Cargo.toml'] })
  } else {
    const actixHits = await grepFirst(sourceDir, '**/*.rs', /#\[(?:get|post|put|delete)\s*\(|HttpServer::new/, 3)
    if (actixHits.length > 0) {
      approaches.push({ language: 'Rust', approach: 'actix_web', apiStyle: 'http', confidence: 'medium', signals: [`Tier C: actix-web patterns found in ${actixHits[0]}`] })
    }
  }

  // tonic (gRPC-Rust) — defer to proto extractor for schema
  if (/\btonic\b/.test(cargoContent)) {
    approaches.push({ language: 'cross-language', approach: 'grpc_proto', apiStyle: 'rpc', confidence: 'high', signals: ['Tier A: tonic found in Cargo.toml'] })
  }

  // Rocket
  const rocketSignals: string[] = []
  if (/\brocket\b/.test(cargoContent)) rocketSignals.push('Tier A: rocket found in Cargo.toml')
  const rocketHits = await grepFirst(sourceDir, '**/*.rs', /Rocket::build\s*\(\s*\)|#\[launch\]/, 3)
  if (rocketHits.length > 0) rocketSignals.push(`Tier C: Rocket::build/#[launch] found in ${rocketHits[0]}`)
  if (rocketSignals.length > 0) {
    approaches.push({ language: 'Rust', approach: 'rocket', apiStyle: 'http', confidence: scoreConfidence(rocketSignals), signals: rocketSignals })
  }

  // warp
  const warpSignals: string[] = []
  if (/\bwarp\b/.test(cargoContent)) warpSignals.push('Tier A: warp found in Cargo.toml')
  const warpHits = await grepFirst(sourceDir, '**/*.rs', /warp::(?:path|get|post|put|delete|filter)/, 3)
  if (warpHits.length > 0) warpSignals.push(`Tier C: warp filter usage found in ${warpHits[0]}`)
  if (warpSignals.length > 0) {
    approaches.push({ language: 'Rust', approach: 'warp', apiStyle: 'http', confidence: scoreConfidence(warpSignals), signals: warpSignals })
  }

  // poem
  const poemSignals: string[] = []
  if (/\bpoem\b/.test(cargoContent)) poemSignals.push('Tier A: poem found in Cargo.toml')
  const poemHits = await grepFirst(sourceDir, '**/*.rs', /use\s+poem::|Route::new\s*\(/, 3)
  if (poemHits.length > 0) poemSignals.push(`Tier C: poem usage found in ${poemHits[0]}`)
  if (poemSignals.length > 0) {
    approaches.push({ language: 'Rust', approach: 'poem', apiStyle: 'http', confidence: scoreConfidence(poemSignals), signals: poemSignals })
  }

  return approaches
}

// ── Kotlin API detector ───────────────────────────────────────────────────────

async function detectKotlinApiApproaches(sourceDir: string): Promise<DetectedApiApproach[]> {
  const approaches: DetectedApiApproach[] = []

  const gradleContent = await readSafe(join(sourceDir, 'build.gradle.kts'))
    ?? await readSafe(join(sourceDir, 'build.gradle')) ?? ''

  // Spring MVC (Kotlin) — same annotations as Java, needs Kotlin-language approach
  const kotlinSpringSignals: string[] = []
  if (/spring-boot-starter-web\b|spring-webmvc\b/.test(gradleContent)) kotlinSpringSignals.push('Tier A: spring-boot-starter-web found in build file')
  const kotlinControllerHits = await grepFirst(sourceDir, '**/*.kt', /@RestController\b|@Controller\b/, 3)
  if (kotlinControllerHits.length > 0) kotlinSpringSignals.push(`Tier C: @RestController/@Controller found in ${kotlinControllerHits[0]}`)
  if (kotlinSpringSignals.length > 0) {
    approaches.push({ language: 'Kotlin', approach: 'spring_mvc', apiStyle: 'http', confidence: scoreConfidence(kotlinSpringSignals), signals: kotlinSpringSignals })
  }

  // Ktor
  const ktorSignals: string[] = []
  if (/io\.ktor:ktor-server/.test(gradleContent)) ktorSignals.push('Tier A: io.ktor:ktor-server found in build file')
  const ktorHits = await grepFirst(sourceDir, '**/*.kt', /\brouting\s*\{/, 3)
  if (ktorHits.length > 0) ktorSignals.push(`Tier C: routing { } block found in ${ktorHits[0]}`)
  if (ktorSignals.length > 0) {
    approaches.push({ language: 'Kotlin', approach: 'ktor', apiStyle: 'http', confidence: scoreConfidence(ktorSignals), signals: ktorSignals })
  }

  return approaches
}

// ── Cross-language: gRPC proto ───────────────────────────────────────────────

async function detectGrpcProto(sourceDir: string): Promise<DetectedApiApproach[]> {
  const signals: string[] = []

  const protoFiles = await globCount(sourceDir, '**/*.proto')
  if (protoFiles === 0) return []

  signals.push(`Tier B: ${protoFiles} .proto file(s) found`)

  const serviceHits = await grepFirst(sourceDir, '**/*.proto', /^\s*service\s+\w+\s*\{/, 3)
  if (serviceHits.length > 0) {
    signals.push(`Tier C: 'service' block found in ${serviceHits[0]}`)
  }

  if (signals.length === 0) return []

  return [{
    language: 'cross-language',
    approach: 'grpc_proto',
    apiStyle: 'rpc',
    confidence: serviceHits.length > 0 ? 'high' : 'medium',
    signals,
  }]
}

// ── Cross-language: Thrift ───────────────────────────────────────────────────

async function detectThrift(sourceDir: string): Promise<DetectedApiApproach[]> {
  const thriftFiles = await globCount(sourceDir, '**/*.thrift')
  if (thriftFiles === 0) return []

  const signals = [`Tier B: ${thriftFiles} .thrift file(s) found`]
  const serviceHits = await grepFirst(sourceDir, '**/*.thrift', /^\s*service\s+\w+/, 3)
  if (serviceHits.length > 0) signals.push(`Tier C: service block found in ${serviceHits[0]}`)

  return [{ language: 'cross-language', approach: 'thrift', apiStyle: 'rpc', confidence: 'high', signals }]
}

// ── Cross-language: OpenAPI spec ─────────────────────────────────────────────

async function detectOpenApiSpec(sourceDir: string): Promise<DetectedApiApproach[]> {
  const candidates = [
    'openapi.yaml', 'openapi.json', 'swagger.yaml', 'swagger.json',
    'api-spec.yaml', 'api-spec.json',
  ]

  for (const name of candidates) {
    const content = await readSafe(join(sourceDir, name))
    if (content && /openapi:|swagger:|paths:/.test(content)) {
      return [{
        language: 'cross-language',
        approach: 'openapi_spec',
        apiStyle: 'http',
        confidence: 'high',
        signals: [`Tier B+C: ${name} found with openapi/swagger/paths content`],
      }]
    }
  }

  // Also check docs/ subdirectory
  const docsHits = await globCountPaths(sourceDir, '**/openapi.yaml')
  if (docsHits.length > 0) {
    const content = await readSafe(join(sourceDir, docsHits[0]))
    if (content && /openapi:|swagger:|paths:/.test(content)) {
      return [{
        language: 'cross-language',
        approach: 'openapi_spec',
        apiStyle: 'http',
        confidence: 'high',
        signals: [`Tier B+C: ${docsHits[0]} found with openapi content`],
      }]
    }
  }

  return []
}

// ── Cross-language: GraphQL schema ───────────────────────────────────────────

async function detectGraphQLSchema(sourceDir: string): Promise<DetectedApiApproach[]> {
  const count = await globCount(sourceDir, '**/*.graphql') + await globCount(sourceDir, '**/*.graphqls')
  if (count === 0) return []

  const schemaHits = await grepFirst(sourceDir, '**/*.{graphql,graphqls}', /type\s+Query\b|type\s+Mutation\b|schema\s*\{/, 3)
  if (schemaHits.length === 0) return []

  return [{
    language: 'cross-language',
    approach: 'graphql_schema',
    apiStyle: 'graphql',
    confidence: 'high',
    signals: [
      `Tier B: ${count} GraphQL schema file(s) found`,
      `Tier C: Query/Mutation/schema type found in ${schemaHits[0]}`,
    ],
  }]
}

// ---- Confidence scoring ----

function scoreConfidence(signals: string[]): Confidence {
  const hasA = signals.some((s) => s.startsWith('Tier A'))
  const hasB = signals.some((s) => s.startsWith('Tier B'))
  const hasC = signals.some((s) => s.startsWith('Tier C'))

  if ((hasA && hasB) || (hasA && hasC) || (hasB && hasC) || (hasA && hasB && hasC)) return 'high'
  if (hasA) return 'medium'
  if (hasB || hasC) return 'low'
  return 'low'
}

// ---- File system helpers ----

async function readSafe(path: string): Promise<string | null> {
  try { return await readFile(path, 'utf-8') } catch { return null }
}

async function globCount(sourceDir: string, pattern: string): Promise<number> {
  return (await globCountPaths(sourceDir, pattern)).length
}

async function globCountPaths(sourceDir: string, pattern: string): Promise<string[]> {
  const { readdir, stat } = await import('node:fs/promises')
  const { join: pathJoin, relative } = await import('node:path')

  const EXCLUDED = new Set(['node_modules', 'vendor', '.git', 'build', 'dist', 'target', '.gradle', 'generated', 'gen'])
  const results: string[] = []
  const matchFn = buildFileMatcher(pattern)

  const walk = async (dir: string): Promise<void> => {
    let entries: string[]
    try { entries = await readdir(dir) } catch { return }
    for (const entry of entries) {
      if (EXCLUDED.has(entry)) continue
      const full = pathJoin(dir, entry)
      let s: Awaited<ReturnType<typeof stat>>
      try { s = await stat(full) } catch { continue }
      if (s.isDirectory()) await walk(full)
      else if (matchFn(entry)) results.push(relative(sourceDir, full).replace(/\\/g, '/'))
    }
  }

  await walk(sourceDir)
  return results
}

async function grepFirst(sourceDir: string, fileGlob: string, pattern: RegExp, limit: number): Promise<string[]> {
  const paths = await globCountPaths(sourceDir, fileGlob)
  const hits: string[] = []
  for (const file of paths) {
    if (hits.length >= limit) break
    try {
      const content = await readFile(join(sourceDir, file), 'utf-8')
      if (pattern.test(content)) hits.push(file)
    } catch { /* skip */ }
  }
  return hits
}

// ── Scala API detector ────────────────────────────────────────────────────────

async function detectScalaApiApproaches(sourceDir: string): Promise<DetectedApiApproach[]> {
  const approaches: DetectedApiApproach[] = []
  const buildContent = await readSafe(join(sourceDir, 'build.sbt')) ?? ''
  const playConf = await globCount(sourceDir, '**/conf/routes')

  // Play Framework
  if (playConf > 0) {
    approaches.push({ language: 'Scala', approach: 'play', apiStyle: 'http', confidence: 'high', signals: [`Tier B: conf/routes file found`] })
  } else if (/com\.typesafe\.play/.test(buildContent)) {
    approaches.push({ language: 'Scala', approach: 'play', apiStyle: 'http', confidence: 'medium', signals: ['Tier A: play found in build.sbt'] })
  }

  // Akka HTTP
  const akkaSignals: string[] = []
  if (/akka-http/.test(buildContent)) akkaSignals.push('Tier A: akka-http found in build.sbt')
  const akkaHits = await grepFirst(sourceDir, '**/*.scala', /import\s+akka\.http\.scaladsl/, 3)
  if (akkaHits.length > 0) akkaSignals.push(`Tier C: akka.http.scaladsl import in ${akkaHits[0]}`)
  if (akkaSignals.length > 0) {
    approaches.push({ language: 'Scala', approach: 'akka_http', apiStyle: 'http', confidence: scoreConfidence(akkaSignals), signals: akkaSignals })
  }

  // http4s
  const http4sSignals: string[] = []
  if (/http4s/.test(buildContent)) http4sSignals.push('Tier A: http4s found in build.sbt')
  const http4sHits = await grepFirst(sourceDir, '**/*.scala', /import\s+org\.http4s|HttpRoutes\.of/, 3)
  if (http4sHits.length > 0) http4sSignals.push(`Tier C: http4s usage found in ${http4sHits[0]}`)
  if (http4sSignals.length > 0) {
    approaches.push({ language: 'Scala', approach: 'http4s', apiStyle: 'http', confidence: scoreConfidence(http4sSignals), signals: http4sSignals })
  }

  return approaches
}

// ── Elixir API detector ───────────────────────────────────────────────────────

async function detectElixirApiApproaches(sourceDir: string): Promise<DetectedApiApproach[]> {
  const approaches: DetectedApiApproach[] = []
  const mixContent = await readSafe(join(sourceDir, 'mix.exs')) ?? ''

  // Phoenix
  const phoenixSignals: string[] = []
  if (/:phoenix\b/.test(mixContent)) phoenixSignals.push('Tier A: :phoenix found in mix.exs')
  const routerHits = await grepFirst(sourceDir, '**/router.ex', /use\s+\w+,\s*:router|Phoenix\.Router/, 3)
  if (routerHits.length > 0) phoenixSignals.push(`Tier C: Phoenix router found in ${routerHits[0]}`)
  if (phoenixSignals.length > 0) {
    approaches.push({ language: 'Elixir', approach: 'phoenix', apiStyle: 'http', confidence: scoreConfidence(phoenixSignals), signals: phoenixSignals })
  }

  // Plug.Router
  const plugSignals: string[] = []
  if (/:plug\b/.test(mixContent)) plugSignals.push('Tier A: :plug found in mix.exs')
  const plugHits = await grepFirst(sourceDir, '**/*.ex', /use\s+Plug\.Router|plug\s+:match/, 3)
  if (plugHits.length > 0) plugSignals.push(`Tier C: Plug.Router usage found in ${plugHits[0]}`)
  if (plugSignals.length > 0) {
    approaches.push({ language: 'Elixir', approach: 'plug_router', apiStyle: 'http', confidence: scoreConfidence(plugSignals), signals: plugSignals })
  }

  return approaches
}

// ── Swift API detector ────────────────────────────────────────────────────────

async function detectSwiftApiApproaches(sourceDir: string): Promise<DetectedApiApproach[]> {
  const approaches: DetectedApiApproach[]= []
  const packageContent = await readSafe(join(sourceDir, 'Package.swift')) ?? ''

  // Vapor
  const vaporSignals: string[] = []
  if (/\.package.*vapor\/vapor|"vapor"/.test(packageContent)) vaporSignals.push('Tier A: vapor found in Package.swift')
  const vaporHits = await grepFirst(sourceDir, '**/*.swift', /import\s+Vapor|app\.get\s*\(|app\.post\s*\(/, 3)
  if (vaporHits.length > 0) vaporSignals.push(`Tier C: Vapor usage found in ${vaporHits[0]}`)
  if (vaporSignals.length > 0) {
    approaches.push({ language: 'Swift', approach: 'vapor', apiStyle: 'http', confidence: scoreConfidence(vaporSignals), signals: vaporSignals })
  }

  // Hummingbird
  const hbSignals: string[] = []
  if (/hummingbird/.test(packageContent)) hbSignals.push('Tier A: hummingbird found in Package.swift')
  const hbHits = await grepFirst(sourceDir, '**/*.swift', /import\s+Hummingbird|HBApplication|app\.router\.(?:get|post)/, 3)
  if (hbHits.length > 0) hbSignals.push(`Tier C: Hummingbird usage found in ${hbHits[0]}`)
  if (hbSignals.length > 0) {
    approaches.push({ language: 'Swift', approach: 'hummingbird', apiStyle: 'http', confidence: scoreConfidence(hbSignals), signals: hbSignals })
  }

  return approaches
}

function buildFileMatcher(pattern: string): (filename: string) => boolean {
  const multiExtMatch = pattern.match(/\*\*\/\*\.\{([^}]+)\}$/)
  if (multiExtMatch) {
    const exts = multiExtMatch[1].split(',').map((e) => `.${e.trim()}`)
    return (f) => exts.some((ext) => f.endsWith(ext))
  }
  const singleExtMatch = pattern.match(/\*\*\/\*\.(\w+)$/)
  if (singleExtMatch) { const ext = `.${singleExtMatch[1]}`; return (f) => f.endsWith(ext) }
  const filenameMatch = pattern.match(/\*\*\/([^*]+)$/)
  if (filenameMatch) {
    const target = filenameMatch[1]
    if (!target.includes('*')) return (f) => f === target
    const [pre, ...rest] = target.split('*')
    const suf = rest.join('')
    return (f) => f.startsWith(pre) && f.endsWith(suf)
  }
  return () => true
}
