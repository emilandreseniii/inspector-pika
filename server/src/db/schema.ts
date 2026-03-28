import { pgTable, serial, text, integer, boolean, jsonb, timestamp, unique } from 'drizzle-orm/pg-core'
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

// ---- Relations ----

export const repositoriesRelations = relations(repositories, ({ many }) => ({
  languages: many(repoLanguages),
  dependencies: many(repoDependencies),
  components: many(repoComponents),
  apiEndpoints: many(repoApiEndpoints),
  docs: many(repoDocs),
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
