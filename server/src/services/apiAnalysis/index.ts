import { DetectedApiApproach, ApiExtractorContext, RawApiSurface } from './extractors/base'
import { detectApiApproaches } from './detector'
import { getApiExtractors, hasApiExtractor } from './registry'

export interface ApiAnalysisInput {
  repoId: number
  sourceDir: string
  repoFullName: string
  detectedLanguages: Array<{ language: string; bytes: number | null }>
  forceReanalysis?: boolean
}

export interface ApiAnalysisResult {
  approaches: DetectedApiApproach[]
  surfaces: RawApiSurface[]
  stats: {
    approachesDetected: number
    extractorsRun: number
    rawSurfacesFound: number
    endpointsFound: number
    warnings: string[]
    totalTimeMs: number
  }
}

export async function analyzeApis(input: ApiAnalysisInput): Promise<ApiAnalysisResult> {
  const start = Date.now()
  const allWarnings: string[] = []

  // Phase 1: detect approaches
  const approaches = await detectApiApproaches(
    input.sourceDir,
    input.detectedLanguages.map((l) => ({ language: l.language, bytes: l.bytes ?? 0 })),
  )

  // Phase 2: run extractors for medium/high confidence approaches
  const runnable = approaches.filter((a) => a.confidence !== 'low' || input.forceReanalysis)

  for (const a of runnable.filter((a) => !hasApiExtractor(a.language, a.approach))) {
    allWarnings.push(`No extractor implemented yet for ${a.language}:${a.approach} — skipping`)
  }
  const toRun = runnable.filter((a) => hasApiExtractor(a.language, a.approach))

  const ctx: ApiExtractorContext = {
    sourceDir: input.sourceDir,
    approach: approaches[0] ?? { language: 'unknown', approach: 'unknown', apiStyle: 'http', confidence: 'low', signals: [] },
    repoFullName: input.repoFullName,
  }

  const allSurfaces: RawApiSurface[] = []

  const extractorResults = await Promise.allSettled(
    toRun.map(async (approach) => {
      // Each extractor gets its own context with the correct approach
      const extractorCtx: ApiExtractorContext = { ...ctx, approach }
      const extractors = getApiExtractors([approach], extractorCtx)
      for (const extractor of extractors) {
        const result = await extractor.extract()
        allSurfaces.push(...result.surfaces)
        allWarnings.push(...result.warnings)
      }
    }),
  )

  for (const r of extractorResults) {
    if (r.status === 'rejected') {
      allWarnings.push(`Extractor failed: ${(r.reason as Error).message}`)
    }
  }

  const endpointsFound = allSurfaces.reduce((sum, s) => sum + s.endpoints.length, 0)

  return {
    approaches,
    surfaces: allSurfaces,
    stats: {
      approachesDetected: approaches.length,
      extractorsRun: toRun.length,
      rawSurfacesFound: allSurfaces.length,
      endpointsFound,
      warnings: allWarnings,
      totalTimeMs: Date.now() - start,
    },
  }
}

export type { DetectedApiApproach, RawApiSurface }
