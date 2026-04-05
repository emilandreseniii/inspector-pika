import { sql } from 'drizzle-orm'
import { db } from '../db'

/**
 * One-time backfill: populate the `packages` table from existing `repo_packages` rows
 * that predate the packages registry and set `canon_package_id` on those rows.
 * Safe to call on every startup — it only touches rows without a canon_package_id.
 */
export async function backfillPackages(): Promise<void> {
  // Step 1: insert canonical package rows for any repo_package not yet linked
  await db.execute(sql`
    INSERT INTO packages (type, namespace, name, description, homepage_url, created_at, updated_at)
    SELECT
      COALESCE(type, 'unknown'),
      COALESCE(namespace, ''),
      name,
      MAX(description),
      MAX(homepage_url),
      NOW(),
      NOW()
    FROM repo_packages
    WHERE canon_package_id IS NULL
      AND name IS NOT NULL
    GROUP BY COALESCE(type, 'unknown'), COALESCE(namespace, ''), name
    ON CONFLICT (type, namespace, name) DO NOTHING
  `)

  // Step 2: link repo_packages rows to their canonical package
  await db.execute(sql`
    UPDATE repo_packages rp
    SET canon_package_id = p.id
    FROM packages p
    WHERE COALESCE(rp.type, 'unknown') = p.type
      AND COALESCE(rp.namespace, '')   = p.namespace
      AND rp.name                      = p.name
      AND rp.canon_package_id IS NULL
  `)
}
