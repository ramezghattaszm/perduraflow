import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'
import { env } from '../config/env'

/**
 * Custom SQL migration runner (API-ARCHITECTURE §13 / api-spec §2). Applies the raw-SQL
 * migrations Drizzle can't model — GiST `EXCLUDE` constraints, generated columns, extensions —
 * from `drizzle/migrations/custom/*.sql`, in filename order, over the same `DATABASE_URL`.
 *
 * There is no separate applied-ledger: each file MUST be idempotent (`CREATE ... IF NOT EXISTS`,
 * `ADD CONSTRAINT` wrapped in a `duplicate_object` catch) so the runner is safe to re-run. A file
 * that fails for a real reason (e.g. an `EXCLUDE` rejected by existing overlapping data) surfaces
 * the error and exits non-zero — it is never forced or swallowed.
 */
// cwd is the api package root for these scripts (same basis as drizzle.config's `./drizzle/migrations`).
const CUSTOM_DIR = join(process.cwd(), 'drizzle/migrations/custom')

async function migrateCustom(): Promise<void> {
  if (!existsSync(CUSTOM_DIR)) {
    console.log('No custom SQL migrations directory.')
    return
  }
  const files = readdirSync(CUSTOM_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  if (files.length === 0) {
    console.log('No custom SQL migrations found.')
    return
  }
  const pool = new Pool({ connectionString: env.DATABASE_URL })
  try {
    for (const file of files) {
      const sql = readFileSync(join(CUSTOM_DIR, file), 'utf8')
      process.stdout.write(`Applying custom migration ${file} ... `)
      await pool.query(sql)
      console.log('ok')
    }
    console.log(`Custom migrations applied: ${files.length}.`)
  } finally {
    await pool.end()
  }
}

migrateCustom().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
