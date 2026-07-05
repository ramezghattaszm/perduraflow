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

/**
 * Applies the custom SQL migrations over an EXISTING pool (does not open/close it). Reusable so the
 * fresh-DB flows — `demo:reset` (reset.ts) and `db:setup` — always land the exclusion constraints, not
 * only a manual `db:migrate:custom`. Idempotent (each file guards its own DDL); re-runs are safe.
 */
export async function applyCustomMigrations(pool: Pool): Promise<number> {
  if (!existsSync(CUSTOM_DIR)) return 0
  const files = readdirSync(CUSTOM_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  for (const file of files) {
    await pool.query(readFileSync(join(CUSTOM_DIR, file), 'utf8'))
  }
  return files.length
}

/** CLI entry (`db:migrate:custom`): owns its own connection. */
async function main(): Promise<void> {
  const pool = new Pool({ connectionString: env.DATABASE_URL })
  try {
    const n = await applyCustomMigrations(pool)
    console.log(n === 0 ? 'No custom SQL migrations found.' : `Custom migrations applied: ${n}.`)
  } finally {
    await pool.end()
  }
}

// Only run as a script, not when imported (reset.ts imports `applyCustomMigrations`).
if (process.argv[1]?.endsWith('migrate-custom.ts') || process.argv[1]?.endsWith('migrate-custom.js')) {
  main().catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })
}
