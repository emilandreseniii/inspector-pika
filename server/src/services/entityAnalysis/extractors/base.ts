import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

// ---- Core types ----

export type RelationshipCardinality = 'one_to_one' | 'one_to_many' | 'many_to_one' | 'many_to_many'
export type EntityType = 'table' | 'collection' | 'document' | 'view' | 'procedure' | 'index' | 'schema'
export type Confidence = 'high' | 'medium' | 'low'

export interface DetectedApproach {
  language: string
  approach: string
  confidence: Confidence
  signals: string[]
}

export interface SourceLocation {
  file: string           // relative to repo root
  startLine: number | null
  endLine: number | null
  format: string
  extractorId: string
}

export interface RawField {
  name: string
  type: string
  nullable: boolean | null
  isPrimaryKey: boolean
  isForeignKey: boolean
  isUnique: boolean
  defaultValue: string | null
  ordinalPosition: number | null
  metadata: Record<string, unknown>
}

export interface RawRelationship {
  type: RelationshipCardinality
  targetEntity: string
  sourceField: string | null
  targetField: string | null
  metadata: Record<string, unknown>
}

export interface RawEntity {
  name: string
  entityType: EntityType
  fields: RawField[]
  relationships: RawRelationship[]
  source: SourceLocation
  extractorId: string
  confidence: Confidence
  metadata: Record<string, unknown>
}

export interface ExtractorContext {
  sourceDir: string
  approach: DetectedApproach
  repoFullName: string
}

export interface ExtractorResult {
  entities: RawEntity[]
  warnings: string[]
  stats: {
    filesScanned: number
    entitiesFound: number
    extractionTimeMs: number
  }
}

// ---- Excluded directories ----

const EXCLUDED_DIRS = new Set([
  'node_modules', 'vendor', '.git', 'build', 'dist', 'target',
  '.gradle', '__pycache__', 'venv', '.venv', '.tox', 'coverage',
  '.nyc_output', 'out', 'bin', 'obj', '.idea', '.vscode',
])

// ---- BaseExtractor ----

export abstract class BaseExtractor {
  abstract readonly extractorId: string

  constructor(protected ctx: ExtractorContext) {}

  abstract extract(): Promise<ExtractorResult>

  protected async readFile(relativePath: string): Promise<string> {
    const fullPath = join(this.ctx.sourceDir, relativePath)
    return readFile(fullPath, 'utf-8')
  }

  /** Recursive glob supporting patterns like **\/*.java, **\/*.{java,kt}, **\/pom.xml */
  protected async glob(pattern: string): Promise<string[]> {
    const results: string[] = []
    const matchFn = buildMatcher(pattern)

    async function walk(dir: string): Promise<void> {
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
    // Return paths relative to sourceDir with forward slashes
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
  // Handle **/*.{ext1,ext2}
  const multiExtMatch = pattern.match(/\*\*\/\*\.\{([^}]+)\}$/)
  if (multiExtMatch) {
    const exts = multiExtMatch[1].split(',').map((e) => e.trim())
    return (filename) => exts.some((ext) => filename.endsWith(`.${ext}`))
  }

  // Handle **/*.ext
  const singleExtMatch = pattern.match(/\*\*\/\*\.(\w+)$/)
  if (singleExtMatch) {
    const ext = `.${singleExtMatch[1]}`
    return (filename) => filename.endsWith(ext)
  }

  // Handle **/filename.ext (exact filename anywhere)
  const filenameMatch = pattern.match(/\*\*\/([^*]+)$/)
  if (filenameMatch) {
    const target = filenameMatch[1]
    if (!target.includes('*')) {
      return (filename) => filename === target
    }
    // Handle **/filename*.ext
    const prefix = target.split('*')[0]
    const suffix = target.split('*').pop() ?? ''
    return (filename) => filename.startsWith(prefix) && filename.endsWith(suffix)
  }

  // Fallback: match everything
  return () => true
}
