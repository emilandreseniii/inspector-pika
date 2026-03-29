import { DetectedApproach, ExtractorContext, RawEntity } from './extractors/base'
import { detectApproaches } from './detector'
import { getExtractor, hasExtractor } from './registry'
import { normalizeEntities, EntityRecord } from './normalizer'
import { deduplicateEntities } from './deduplicator'

export interface EntityAnalysisInput {
  repoId: number
  sourceDir: string
  repoFullName: string
  detectedLanguages: Array<{ language: string; bytes: number | null }>
  forceReanalysis?: boolean
}

export interface EntityAnalysisResult {
  approaches: DetectedApproach[]
  entities: EntityRecord[]
  stats: {
    approachesDetected: number
    extractorsRun: number
    rawEntitiesFound: number
    entitiesAfterDedup: number
    warnings: string[]
    totalTimeMs: number
  }
}

export async function analyzeEntities(input: EntityAnalysisInput): Promise<EntityAnalysisResult> {
  const start = Date.now()
  const allWarnings: string[] = []

  // Phase 1: detect approaches
  const approaches = await detectApproaches(
    input.sourceDir,
    input.detectedLanguages.map((l) => ({ language: l.language, bytes: l.bytes ?? 0 })),
  )

  // Phase 2: run extractors for medium/high confidence approaches
  const runnable = approaches.filter((a) => a.confidence !== 'low' || input.forceReanalysis)
  const notImplemented = runnable.filter((a) => !hasExtractor(a.language, a.approach))
  for (const a of notImplemented) {
    allWarnings.push(`No extractor implemented yet for ${a.language}:${a.approach} — skipping`)
  }
  const toRun = runnable.filter((a) => hasExtractor(a.language, a.approach))

  const allRawEntities: RawEntity[] = []

  const extractorResults = await Promise.allSettled(
    toRun.map(async (approach) => {
      const ctx: ExtractorContext = {
        sourceDir: input.sourceDir,
        approach,
        repoFullName: input.repoFullName,
      }
      const extractor = getExtractor(approach.language, approach.approach, ctx)
      if (!extractor) return
      const result = await extractor.extract()
      allRawEntities.push(...result.entities)
      allWarnings.push(...result.warnings)
    }),
  )

  for (const r of extractorResults) {
    if (r.status === 'rejected') {
      allWarnings.push(`Extractor failed: ${(r.reason as Error).message}`)
    }
  }

  // Phase 3: normalize and deduplicate
  const normalizedEntities = normalizeEntities(allRawEntities)
  const finalEntities = deduplicateEntities(normalizedEntities)

  return {
    approaches,
    entities: finalEntities,
    stats: {
      approachesDetected: approaches.length,
      extractorsRun: toRun.length,
      rawEntitiesFound: allRawEntities.length,
      entitiesAfterDedup: finalEntities.length,
      warnings: allWarnings,
      totalTimeMs: Date.now() - start,
    },
  }
}

export type { EntityRecord, DetectedApproach }
