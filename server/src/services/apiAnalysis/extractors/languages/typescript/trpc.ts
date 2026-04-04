import { BaseApiExtractor, ApiExtractorResult, RawApiSurface, RawEndpoint } from '../../base'

/**
 * Extracts API surfaces from tRPC routers.
 *
 * tRPC patterns:
 *   const appRouter = router({
 *     getUser: publicProcedure.input(z.object({id: z.string()})).query(async ({ input }) => ...),
 *     createUser: publicProcedure.input(z.object({...})).mutation(async ({ input }) => ...),
 *   })
 *
 *   t.procedure.query(...)
 *   t.procedure.mutation(...)
 *   t.procedure.subscription(...)
 */
export class TrpcExtractor extends BaseApiExtractor {
  readonly extractorId = 'typescript.trpc'

  async extract(): Promise<ApiExtractorResult> {
    const start = Date.now()
    const warnings: string[] = []
    const surfaces: RawApiSurface[] = []

    const hits = await this.grep(
      '**/*.{ts,js,mts,mjs}',
      /(?:require\s*\(\s*['"]@trpc\/server['"]|from\s+['"]@trpc\/server['"])/,
      2000,
    )
    const uniqueFiles = [...new Set(hits.map((h) => h.file))]

    for (const file of uniqueFiles) {
      try {
        const content = await this.readFile(file)
        const parsed = parseTrpcFile(content, file)
        if (parsed) surfaces.push(parsed)
      } catch (err) {
        warnings.push(`Failed to parse ${file}: ${(err as Error).message}`)
      }
    }

    const endpointsFound = surfaces.reduce((sum, s) => sum + s.endpoints.length, 0)
    return {
      surfaces,
      warnings,
      stats: { filesScanned: uniqueFiles.length, surfacesFound: surfaces.length, endpointsFound, extractionTimeMs: Date.now() - start },
    }
  }
}

// ---- File parser ----

// Matches a procedure definition start: name: publicProcedure / name: t.procedure / name: authedProcedure
// The procedure value can be `t.procedure`, `publicProcedure`, `protectedProcedure`, etc.
const PROC_START_RE = /^\s*(\w+)\s*:\s*(?:(?:\w+\.)*\w*[Pp]rocedure\b)/
// Matches the type of a procedure in a chained call: .query( .mutation( .subscription(
const PROC_TYPE_RE = /\.(query|mutation|subscription)\s*\(/
// Matches a single-line procedure: name: procedure.input(...).query(
const PROC_INLINE_RE = /^\s*(\w+)\s*:\s*(?:(?:\w+\.)*\w*[Pp]rocedure\b).*?\.(query|mutation|subscription)\s*\(/

const SKIP_NAMES = new Set(['then', 'catch', 'finally', 'input', 'output', 'use', 'middleware'])

function parseTrpcFile(content: string, file: string): RawApiSurface | null {
  const stripped = stripComments(content)
  const lines = stripped.split('\n')
  const endpoints: RawEndpoint[] = []
  const seen = new Set<string>()

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Case 1: inline — name: procedure.query( on same line
    const inline = line.match(PROC_INLINE_RE)
    if (inline) {
      const name = inline[1]
      const procedureType = inline[2] as 'query' | 'mutation' | 'subscription'
      if (!SKIP_NAMES.has(name) && !seen.has(name)) {
        seen.add(name)
        endpoints.push({
          httpMethod: procedureType === 'mutation' ? 'POST' : 'GET',
          path: `/${name}`,
          rpcMethodName: name,
          parameters: [],
          metadata: { procedureType },
        })
      }
      continue
    }

    // Case 2: multi-line — name: procedure on this line, .query/.mutation on a later line
    const start = line.match(PROC_START_RE)
    if (start) {
      const name = start[1]
      if (SKIP_NAMES.has(name) || seen.has(name)) continue

      // Look ahead up to 10 lines for the procedure type
      for (let j = i; j < Math.min(i + 10, lines.length); j++) {
        const typeMatch = lines[j].match(PROC_TYPE_RE)
        if (typeMatch) {
          const procedureType = typeMatch[1] as 'query' | 'mutation' | 'subscription'
          seen.add(name)
          endpoints.push({
            httpMethod: procedureType === 'mutation' ? 'POST' : 'GET',
            path: `/${name}`,
            rpcMethodName: name,
            parameters: [],
            metadata: { procedureType },
          })
          break
        }
      }
    }
  }

  if (endpoints.length === 0) return null

  return {
    name: file.split('/').pop()?.replace(/\.[^.]+$/, '') ?? file,
    file,
    framework: 'trpc',
    endpoints,
  }
}

function stripComments(code: string): string {
  return code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}
