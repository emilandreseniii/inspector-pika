import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

// ---- Core types ----

export type ApiStyle = 'http' | 'graphql' | 'rpc'
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS'
export type ParamLocation = 'path' | 'query' | 'body' | 'header' | 'field'
export type GraphQLOperationType = 'Query' | 'Mutation' | 'Subscription'
export type RpcStreaming = 'none' | 'client' | 'server' | 'bidirectional'
export type Confidence = 'high' | 'medium' | 'low'

export interface DetectedApiApproach {
  language: string
  approach: string
  apiStyle: ApiStyle
  confidence: Confidence
  signals: string[]
}

export interface RawApiParameter {
  name: string
  location: ParamLocation
  type?: string
  required?: boolean
  description?: string
}

export interface RawEndpoint {
  // HTTP
  httpMethod?: HttpMethod
  path?: string

  // GraphQL
  operationType?: GraphQLOperationType
  operationName?: string

  // RPC
  rpcMethodName?: string
  requestType?: string
  responseType?: string
  rpcStreaming?: RpcStreaming

  // Common
  summary?: string
  parameters: RawApiParameter[]
  tags: string[]
  returnType?: string
  sourceFile: string
  sourceLine?: number
}

export interface RawApiSurface {
  name: string
  apiStyle: ApiStyle
  protocol?: string            // for rpc: "grpc", "thrift"
  basePath?: string
  packageOrModule?: string
  endpoints: RawEndpoint[]
  sourceFile: string
  sourceLine?: number
}

export interface ApiExtractorContext {
  sourceDir: string
  approach: DetectedApiApproach
  repoFullName: string
}

export interface ApiExtractorResult {
  surfaces: RawApiSurface[]
  warnings: string[]
  stats: {
    filesScanned: number
    surfacesFound: number
    endpointsFound: number
    extractionTimeMs: number
  }
}

// ---- Excluded directories ----

const EXCLUDED_DIRS = new Set([
  'node_modules', 'vendor', '.git', 'build', 'dist', 'target',
  '.gradle', '__pycache__', 'venv', '.venv', '.tox', 'coverage',
  '.nyc_output', 'out', 'bin', 'obj', '.idea', '.vscode', 'generated', 'gen',
])

// ---- BaseApiExtractor ----

export abstract class BaseApiExtractor {
  abstract readonly extractorId: string

  constructor(protected ctx: ApiExtractorContext) {}

  abstract extract(): Promise<ApiExtractorResult>

  protected async readFile(relativePath: string): Promise<string> {
    const fullPath = join(this.ctx.sourceDir, relativePath)
    return readFile(fullPath, 'utf-8')
  }

  /** Recursive glob supporting patterns like **\/*.java, **\/*.proto */
  protected async glob(pattern: string): Promise<string[]> {
    const results: string[] = []
    const matchFn = buildMatcher(pattern)

    const walk = async (dir: string): Promise<void> => {
      let entries: string[]
      try { entries = await readdir(dir) } catch { return }

      for (const entry of entries) {
        if (EXCLUDED_DIRS.has(entry)) continue
        const fullPath = join(dir, entry)
        let s: Awaited<ReturnType<typeof stat>>
        try { s = await stat(fullPath) } catch { continue }

        if (s.isDirectory()) {
          await walk(fullPath)
        } else if (matchFn(entry, fullPath)) {
          results.push(fullPath)
        }
      }
    }

    await walk(this.ctx.sourceDir)
    return results.map((f) => relative(this.ctx.sourceDir, f).replace(/\\/g, '/'))
  }

  /** Grep lines in files matching a glob pattern */
  protected async grep(
    fileGlob: string,
    pattern: RegExp,
    limit = 5000,
  ): Promise<Array<{ file: string; line: number; text: string }>> {
    const files = await this.glob(fileGlob)
    const hits: Array<{ file: string; line: number; text: string }> = []

    for (const file of files) {
      if (hits.length >= limit) break
      try {
        const content = await this.readFile(file)
        const lines = content.split('\n')
        for (let i = 0; i < lines.length && hits.length < limit; i++) {
          if (pattern.test(lines[i])) {
            hits.push({ file, line: i + 1, text: lines[i] })
          }
        }
      } catch { /* skip unreadable files */ }
    }

    return hits
  }
}

// ---- Glob pattern → matcher function ----

function buildMatcher(pattern: string): (filename: string, fullPath: string) => boolean {
  const multiExtMatch = pattern.match(/\*\*\/\*\.\{([^}]+)\}$/)
  if (multiExtMatch) {
    const exts = multiExtMatch[1].split(',').map((e) => e.trim())
    return (filename) => exts.some((ext) => filename.endsWith(`.${ext}`))
  }

  const singleExtMatch = pattern.match(/\*\*\/\*\.(\w+)$/)
  if (singleExtMatch) {
    const ext = `.${singleExtMatch[1]}`
    return (filename) => filename.endsWith(ext)
  }

  const filenameMatch = pattern.match(/\*\*\/([^*]+)$/)
  if (filenameMatch) {
    const target = filenameMatch[1]
    if (!target.includes('*')) {
      return (filename) => filename === target
    }
    const prefix = target.split('*')[0]
    const suffix = target.split('*').pop() ?? ''
    return (filename) => filename.startsWith(prefix) && filename.endsWith(suffix)
  }

  return () => true
}
