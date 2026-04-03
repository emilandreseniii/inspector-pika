import { pgTable, serial, text, integer, boolean, jsonb, timestamp, unique, index } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// ---- Repositories (provider-agnostic) ----

export const repositories = pgTable('repositories', {
  id: serial('id').primaryKey(),
  provider: text('provider').notNull().default('github'), // github, gitlab, bitbucket, etc.
  owner: text('owner').notNull(),
  name: text('name').notNull(),
  fullName: text('full_name').notNull(),
  description: text('description'),
  defaultBranch: text('default_branch'),
  stars: integer('stars'),
  forks: integer('forks'),
  isPrivate: boolean('is_private').default(false).notNull(),
  url: text('url'),
  metadata: jsonb('metadata'),
  fetchedAt: timestamp('fetched_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  uniqueProviderRepo: unique().on(table.provider, table.fullName),
}))

// ---- Jobs ----

export const jobs = pgTable('jobs', {
  id: serial('id').primaryKey(),
  type: text('type').notNull(), // explore_github_repo | explore_github_org
  status: text('status').notNull().default('pending'), // pending | running | completed | failed
  input: jsonb('input').notNull(),
  result: jsonb('result'),
  error: text('error'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ---- Repository child tables ----

export const repoLanguages = pgTable('repo_languages', {
  id: serial('id').primaryKey(),
  repoId: integer('repo_id').references(() => repositories.id, { onDelete: 'cascade' }).notNull(),
  language: text('language').notNull(),
  bytes: integer('bytes'),
})

export const repoDependencies = pgTable('repo_dependencies', {
  id: serial('id').primaryKey(),
  repoId: integer('repo_id').references(() => repositories.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  version: text('version'),
  ecosystem: text('ecosystem'),
  isDevDependency: boolean('is_dev_dependency').default(false).notNull(),
  githubRepo: text('github_repo'),
})

export const repoComponents = pgTable('repo_components', {
  id: serial('id').primaryKey(),
  repoId: integer('repo_id').references(() => repositories.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  type: text('type'),
  filePath: text('file_path'),
  description: text('description'),
})

export const repoApiEndpoints = pgTable('repo_api_endpoints', {
  id: serial('id').primaryKey(),
  repoId: integer('repo_id').references(() => repositories.id, { onDelete: 'cascade' }).notNull(),
  method: text('method'),
  path: text('path').notNull(),
  filePath: text('file_path'),
  description: text('description'),
})

export const repoDocs = pgTable('repo_docs', {
  id: serial('id').primaryKey(),
  repoId: integer('repo_id').references(() => repositories.id, { onDelete: 'cascade' }).notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  generatedAt: timestamp('generated_at').defaultNow().notNull(),
})

export const repoPackages = pgTable('repo_packages', {
  id: serial('id').primaryKey(),
  repoId: integer('repo_id').references(() => repositories.id, { onDelete: 'cascade' }).notNull(),
  packageId: text('package_id').notNull(),   // ORT identifier: "NPM::express:4.18.2"
  purl: text('purl'),                         // pkg:npm/express@4.18.2
  type: text('type'),                         // NPM, Maven, PyPI, Go, etc.
  namespace: text('namespace'),
  name: text('name').notNull(),
  version: text('version'),
  declaredLicenses: text('declared_licenses').array(),
  description: text('description'),
  homepageUrl: text('homepage_url'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  uniqueRepoPackage: unique().on(table.repoId, table.packageId),
}))

// ---- Entity analysis tables ----

export const repoEntityApproaches = pgTable('repo_entity_approaches', {
  id: serial('id').primaryKey(),
  repoId: integer('repo_id').references(() => repositories.id, { onDelete: 'cascade' }).notNull(),
  language: text('language').notNull(),
  approach: text('approach').notNull(),
  confidence: text('confidence').notNull(),
  signals: jsonb('signals').notNull().$type<string[]>().default([]),
  detectedAt: timestamp('detected_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  repoIdIdx: index('repo_entity_approaches_repo_id_idx').on(table.repoId),
  repoApproachUniq: unique('repo_entity_approaches_repo_approach_uniq').on(table.repoId, table.language, table.approach),
}))

export const repoEntities = pgTable('repo_entities', {
  id: serial('id').primaryKey(),
  repoId: integer('repo_id').references(() => repositories.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  sourceApproachId: integer('source_approach_id').references(() => repoEntityApproaches.id, { onDelete: 'set null' }),
  entityType: text('entity_type').notNull(),
  confidence: text('confidence').notNull(),
  primarySources: jsonb('primary_sources').notNull().$type<SourceLocation[]>().default([]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  repoIdIdx: index('repo_entities_repo_id_idx').on(table.repoId),
  repoNormalizedNameUniq: unique('repo_entities_repo_normalized_name_uniq').on(table.repoId, table.normalizedName),
  repoEntityTypeIdx: index('repo_entities_repo_entity_type_idx').on(table.repoId, table.entityType),
}))

export const repoEntityFields = pgTable('repo_entity_fields', {
  id: serial('id').primaryKey(),
  entityId: integer('entity_id').references(() => repoEntities.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  dataType: text('data_type').notNull(),
  nativeType: text('native_type'),
  isNullable: text('is_nullable'),
  isPrimaryKey: text('is_primary_key').notNull().default('false'),
  isForeignKey: text('is_foreign_key').notNull().default('false'),
  isUnique: text('is_unique').notNull().default('false'),
  defaultValue: text('default_value'),
  ordinalPosition: integer('ordinal_position'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  entityIdIdx: index('repo_entity_fields_entity_id_idx').on(table.entityId),
  entityNormalizedNameUniq: unique('repo_entity_fields_entity_normalized_name_uniq').on(table.entityId, table.normalizedName),
}))

export const repoEntityRelationships = pgTable('repo_entity_relationships', {
  id: serial('id').primaryKey(),
  repoId: integer('repo_id').references(() => repositories.id, { onDelete: 'cascade' }).notNull(),
  sourceEntityId: integer('source_entity_id').references(() => repoEntities.id, { onDelete: 'cascade' }).notNull(),
  targetEntityId: integer('target_entity_id').references(() => repoEntities.id, { onDelete: 'set null' }),
  targetEntityName: text('target_entity_name').notNull(),
  relationshipType: text('relationship_type').notNull(),
  sourceField: text('source_field'),
  targetField: text('target_field'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  repoIdIdx: index('repo_entity_relationships_repo_id_idx').on(table.repoId),
  sourceEntityIdIdx: index('repo_entity_relationships_source_entity_id_idx').on(table.sourceEntityId),
  targetEntityIdIdx: index('repo_entity_relationships_target_entity_id_idx').on(table.targetEntityId),
  relUniq: unique('repo_entity_relationships_uniq').on(table.repoId, table.sourceEntityId, table.targetEntityName, table.relationshipType),
}))

// ---- API analysis tables ----

export const repoApiApproaches = pgTable('repo_api_approaches', {
  id: serial('id').primaryKey(),
  repoId: integer('repo_id').references(() => repositories.id, { onDelete: 'cascade' }).notNull(),
  language: text('language').notNull(),           // "Java", "Python", "cross-language"
  approach: text('approach').notNull(),           // "spring_mvc", "fastapi", "grpc_proto"
  apiStyle: text('api_style').notNull(),          // "http" | "graphql" | "rpc"
  confidence: text('confidence').notNull(),
  signals: jsonb('signals').notNull().$type<string[]>().default([]),
  endpointCount: integer('endpoint_count'),
  detectedAt: timestamp('detected_at').defaultNow().notNull(),
}, (table) => ({
  repoIdIdx: index('repo_api_approaches_repo_id_idx').on(table.repoId),
  repoApproachUniq: unique('repo_api_approaches_uniq').on(table.repoId, table.language, table.approach),
}))

export const repoApiSurfaces = pgTable('repo_api_surfaces', {
  id: serial('id').primaryKey(),
  repoId: integer('repo_id').references(() => repositories.id, { onDelete: 'cascade' }).notNull(),
  sourceApproachId: integer('source_approach_id').references(() => repoApiApproaches.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  apiStyle: text('api_style').notNull(),          // "http" | "graphql" | "rpc"
  protocol: text('protocol'),                     // for rpc: "grpc", "thrift"
  basePath: text('base_path'),
  packageOrModule: text('package_or_module'),
  confidence: text('confidence').notNull(),
  sourceFile: text('source_file'),
  sourceLine: integer('source_line'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  repoIdIdx: index('repo_api_surfaces_repo_id_idx').on(table.repoId),
  styleIdx: index('repo_api_surfaces_style_idx').on(table.repoId, table.apiStyle),
}))

export const repoApiOps = pgTable('repo_api_ops', {
  id: serial('id').primaryKey(),
  repoId: integer('repo_id').references(() => repositories.id, { onDelete: 'cascade' }).notNull(),
  surfaceId: integer('surface_id').references(() => repoApiSurfaces.id, { onDelete: 'cascade' }).notNull(),
  // HTTP fields
  httpMethod: text('http_method'),
  path: text('path'),
  normalizedPath: text('normalized_path'),
  // GraphQL fields
  operationType: text('operation_type'),
  operationName: text('operation_name'),
  // RPC fields
  rpcMethodName: text('rpc_method_name'),
  requestType: text('request_type'),
  responseType: text('response_type'),
  rpcStreaming: text('rpc_streaming'),
  // Common
  summary: text('summary'),
  tags: jsonb('tags').$type<string[]>(),
  returnType: text('return_type'),
  confidence: text('confidence').notNull(),
  sourceFile: text('source_file'),
  sourceLine: integer('source_line'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  repoIdIdx: index('repo_api_ops_repo_id_idx').on(table.repoId),
  surfaceIdx: index('repo_api_ops_surface_id_idx').on(table.surfaceId),
  httpPathIdx: index('repo_api_ops_http_path_idx').on(table.repoId, table.httpMethod, table.normalizedPath),
}))

export const repoApiOpParams = pgTable('repo_api_op_params', {
  id: serial('id').primaryKey(),
  opId: integer('op_id').references(() => repoApiOps.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  location: text('location').notNull(),           // "path" | "query" | "body" | "header" | "field"
  type: text('type'),
  required: boolean('required'),
  description: text('description'),
  ordinalPosition: integer('ordinal_position'),
}, (table) => ({
  opIdIdx: index('repo_api_op_params_op_id_idx').on(table.opId),
}))

// ---- Relations ----

export const repositoriesRelations = relations(repositories, ({ many }) => ({
  languages: many(repoLanguages),
  dependencies: many(repoDependencies),
  components: many(repoComponents),
  apiEndpoints: many(repoApiEndpoints),
  docs: many(repoDocs),
  entityApproaches: many(repoEntityApproaches),
  entities: many(repoEntities),
  apiApproaches: many(repoApiApproaches),
  apiSurfaces: many(repoApiSurfaces),
}))

export const repoLanguagesRelations = relations(repoLanguages, ({ one }) => ({
  repository: one(repositories, { fields: [repoLanguages.repoId], references: [repositories.id] }),
}))

export const repoDependenciesRelations = relations(repoDependencies, ({ one }) => ({
  repository: one(repositories, { fields: [repoDependencies.repoId], references: [repositories.id] }),
}))

export const repoComponentsRelations = relations(repoComponents, ({ one }) => ({
  repository: one(repositories, { fields: [repoComponents.repoId], references: [repositories.id] }),
}))

export const repoApiEndpointsRelations = relations(repoApiEndpoints, ({ one }) => ({
  repository: one(repositories, { fields: [repoApiEndpoints.repoId], references: [repositories.id] }),
}))

export const repoDocsRelations = relations(repoDocs, ({ one }) => ({
  repository: one(repositories, { fields: [repoDocs.repoId], references: [repositories.id] }),
}))

export const repoPackagesRelations = relations(repoPackages, ({ one }) => ({
  repository: one(repositories, { fields: [repoPackages.repoId], references: [repositories.id] }),
}))

export const repoEntityApproachesRelations = relations(repoEntityApproaches, ({ one, many }) => ({
  repository: one(repositories, { fields: [repoEntityApproaches.repoId], references: [repositories.id] }),
  entities: many(repoEntities),
}))

export const repoEntitiesRelations = relations(repoEntities, ({ one, many }) => ({
  repository: one(repositories, { fields: [repoEntities.repoId], references: [repositories.id] }),
  sourceApproach: one(repoEntityApproaches, { fields: [repoEntities.sourceApproachId], references: [repoEntityApproaches.id] }),
  fields: many(repoEntityFields),
  outgoingRelationships: many(repoEntityRelationships, { relationName: 'source' }),
  incomingRelationships: many(repoEntityRelationships, { relationName: 'target' }),
}))

export const repoEntityFieldsRelations = relations(repoEntityFields, ({ one }) => ({
  entity: one(repoEntities, { fields: [repoEntityFields.entityId], references: [repoEntities.id] }),
}))

export const repoEntityRelationshipsRelations = relations(repoEntityRelationships, ({ one }) => ({
  repository: one(repositories, { fields: [repoEntityRelationships.repoId], references: [repositories.id] }),
  sourceEntity: one(repoEntities, { fields: [repoEntityRelationships.sourceEntityId], references: [repoEntities.id], relationName: 'source' }),
  targetEntity: one(repoEntities, { fields: [repoEntityRelationships.targetEntityId], references: [repoEntities.id], relationName: 'target' }),
}))

export const repoApiApproachesRelations = relations(repoApiApproaches, ({ one, many }) => ({
  repository: one(repositories, { fields: [repoApiApproaches.repoId], references: [repositories.id] }),
  surfaces: many(repoApiSurfaces),
}))

export const repoApiSurfacesRelations = relations(repoApiSurfaces, ({ one, many }) => ({
  repository: one(repositories, { fields: [repoApiSurfaces.repoId], references: [repositories.id] }),
  sourceApproach: one(repoApiApproaches, { fields: [repoApiSurfaces.sourceApproachId], references: [repoApiApproaches.id] }),
  ops: many(repoApiOps),
}))

export const repoApiOpsRelations = relations(repoApiOps, ({ one, many }) => ({
  repository: one(repositories, { fields: [repoApiOps.repoId], references: [repositories.id] }),
  surface: one(repoApiSurfaces, { fields: [repoApiOps.surfaceId], references: [repoApiSurfaces.id] }),
  params: many(repoApiOpParams),
}))

export const repoApiOpParamsRelations = relations(repoApiOpParams, ({ one }) => ({
  op: one(repoApiOps, { fields: [repoApiOpParams.opId], references: [repoApiOps.id] }),
}))

// Type alias used in JSONB columns above (declared after tables to avoid hoisting issues)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SourceLocation = any
