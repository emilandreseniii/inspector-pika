import { z } from 'zod'

// ---- Repository ----

export const RepositorySchema = z.object({
  id: z.number(),
  provider: z.string(),
  owner: z.string(),
  name: z.string(),
  fullName: z.string(),
  description: z.string().nullable(),
  defaultBranch: z.string().nullable(),
  stars: z.number().nullable(),
  forks: z.number().nullable(),
  isPrivate: z.boolean(),
  url: z.string().nullable(),
  fetchedAt: z.string(),
  createdAt: z.string(),
})

export type Repository = z.infer<typeof RepositorySchema>

// ---- Jobs ----

export const JobType = {
  EXPLORE_GITHUB_REPO: 'explore_github_repo',
  EXPLORE_GITHUB_ORG: 'explore_github_org',
  ANALYZE_DEPENDENCIES: 'analyze_dependencies',
  ANALYZE_LANGUAGES: 'analyze_languages',
  ANALYZE_ENTITIES: 'analyze_entities',
} as const

export const JobStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const

export const JobSchema = z.object({
  id: z.number(),
  type: z.string(),
  status: z.string(),
  input: z.record(z.unknown()),
  result: z.record(z.unknown()).nullable(),
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
})

export type Job = z.infer<typeof JobSchema>

export const CreateJobSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('explore_github_repo'),
    repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'Must be in owner/repo format'),
  }),
  z.object({
    type: z.literal('explore_github_org'),
    org: z.string().min(1, 'Organization name is required'),
  }),
  z.object({
    type: z.literal('analyze_dependencies'),
    repoId: z.number().int().positive(),
    repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'Must be in owner/repo format'),
  }),
  z.object({
    type: z.literal('analyze_languages'),
    repoId: z.number().int().positive(),
    repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'Must be in owner/repo format'),
  }),
  z.object({
    type: z.literal('analyze_entities'),
    repoId: z.number().int().positive(),
    repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'Must be in owner/repo format'),
    forceReanalysis: z.boolean().optional(),
  }),
])

export type CreateJobInput = z.infer<typeof CreateJobSchema>

// ---- Repository child types ----

export const RepoLanguageSchema = z.object({
  id: z.number(),
  repoId: z.number(),
  language: z.string(),
  bytes: z.number().nullable(),
})
export type RepoLanguage = z.infer<typeof RepoLanguageSchema>

export const RepoDependencySchema = z.object({
  id: z.number(),
  repoId: z.number(),
  name: z.string(),
  version: z.string().nullable(),
  ecosystem: z.string().nullable(),
  isDevDependency: z.boolean(),
  githubRepo: z.string().nullable(),
})
export type RepoDependency = z.infer<typeof RepoDependencySchema>

export const RepoComponentSchema = z.object({
  id: z.number(),
  repoId: z.number(),
  name: z.string(),
  type: z.string().nullable(),
  filePath: z.string().nullable(),
  description: z.string().nullable(),
})
export type RepoComponent = z.infer<typeof RepoComponentSchema>

export const RepoApiEndpointSchema = z.object({
  id: z.number(),
  repoId: z.number(),
  method: z.string().nullable(),
  path: z.string(),
  filePath: z.string().nullable(),
  description: z.string().nullable(),
})
export type RepoApiEndpoint = z.infer<typeof RepoApiEndpointSchema>

export const RepoDocSchema = z.object({
  id: z.number(),
  repoId: z.number(),
  title: z.string(),
  content: z.string(),
  generatedAt: z.string(),
})
export type RepoDoc = z.infer<typeof RepoDocSchema>

export const RepoPackageSchema = z.object({
  id: z.number(),
  repoId: z.number(),
  packageId: z.string(),
  purl: z.string().nullable(),
  type: z.string().nullable(),
  namespace: z.string().nullable(),
  name: z.string(),
  version: z.string().nullable(),
  declaredLicenses: z.array(z.string()).nullable(),
  description: z.string().nullable(),
  homepageUrl: z.string().nullable(),
  createdAt: z.string(),
})
export type RepoPackage = z.infer<typeof RepoPackageSchema>

// ---- Entity analysis types ----

export const RepoEntityApproachSchema = z.object({
  id: z.number(),
  repoId: z.number(),
  language: z.string(),
  approach: z.string(),
  confidence: z.string(),
  signals: z.array(z.string()),
  detectedAt: z.string(),
  entityCount: z.number().optional(),
})
export type RepoEntityApproach = z.infer<typeof RepoEntityApproachSchema>

export const RepoEntityFieldSchema = z.object({
  id: z.number(),
  entityId: z.number(),
  name: z.string(),
  normalizedName: z.string(),
  dataType: z.string(),
  nativeType: z.string().nullable(),
  isNullable: z.string().nullable(),
  isPrimaryKey: z.string(),
  isForeignKey: z.string(),
  isUnique: z.string(),
  defaultValue: z.string().nullable(),
  ordinalPosition: z.number().nullable(),
})
export type RepoEntityField = z.infer<typeof RepoEntityFieldSchema>

export const RepoEntitySchema = z.object({
  id: z.number(),
  repoId: z.number(),
  name: z.string(),
  normalizedName: z.string(),
  entityType: z.string(),
  confidence: z.string(),
  primarySources: z.array(z.record(z.unknown())),
  sourceApproach: RepoEntityApproachSchema.omit({ entityCount: true }).nullable().optional(),
  fields: z.array(RepoEntityFieldSchema).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type RepoEntity = z.infer<typeof RepoEntitySchema>

// ---- API response wrappers ----

export type ApiSuccess<T> = { data: T }
export type ApiError = { error: string }
export type ApiResponse<T> = ApiSuccess<T> | ApiError
