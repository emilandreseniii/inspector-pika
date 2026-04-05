/**
 * Direct SQL migration script — applies schema changes that drizzle-kit push:pg
 * would apply but requires interactive TTY confirmation for.
 *
 * Run from the server/ directory: node scripts/migrate.mjs
 */
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Load .env from repo root
const dotenv = require('dotenv')
dotenv.config({ path: path.join(__dirname, '../../.env') })

const { default: postgres } = await import('file:///C:/dev/inspector-pika/node_modules/postgres/cjs/src/index.js')

const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} })
console.log('Connected to database.')

async function run(label, statement) {
  console.log(`\n→ ${label}`)
  try {
    await sql.unsafe(statement)
    console.log('  ✓ done')
  } catch (err) {
    if (err.message.includes('already exists') || err.message.includes('duplicate column')) {
      console.log(`  ℹ already exists, skipping`)
    } else {
      console.error(`  ✗ ERROR: ${err.message}`)
    }
  }
}

// 1. Create packages table
await run('Create packages table', `
  CREATE TABLE IF NOT EXISTS packages (
    id          SERIAL PRIMARY KEY,
    type        TEXT NOT NULL,
    namespace   TEXT NOT NULL DEFAULT '',
    name        TEXT NOT NULL,
    description TEXT,
    homepage_url TEXT,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
  )
`)

// 2. Unique constraint on packages (type, namespace, name)
await run('Add packages unique constraint', `
  ALTER TABLE packages
    ADD CONSTRAINT packages_type_namespace_name_uniq
    UNIQUE (type, namespace, name)
`)

// 3. Index on packages.name
await run('Add packages name index', `
  CREATE INDEX IF NOT EXISTS packages_name_idx ON packages (name)
`)

// 4. Add canon_package_id to repo_packages
await run('Add canon_package_id column to repo_packages', `
  ALTER TABLE repo_packages
    ADD COLUMN IF NOT EXISTS canon_package_id INTEGER
    REFERENCES packages(id) ON DELETE SET NULL
`)

// 5. Add unique constraint to repo_entity_fields (entity_id, normalized_name)
await run('Add repo_entity_fields unique constraint', `
  ALTER TABLE repo_entity_fields
    ADD CONSTRAINT repo_entity_fields_entity_normalized_name_uniq
    UNIQUE (entity_id, normalized_name)
`)

await sql.end()
console.log('\nMigration complete.')
