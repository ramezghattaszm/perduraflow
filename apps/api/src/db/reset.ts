import { Pool } from 'pg'
import { env } from '../config/env'
import { seed } from './seed'

/**
 * `demo:reset` — restore the deterministic baseline demo state in one step.
 * **Idempotent** (run any number of times → identical clean state) and
 * **deterministic** (same plants, parts, demand, operators, rates, and — via the
 * reproducible sequencer, D2 — the same baseline schedule every time).
 *
 * Steps: (1) TRUNCATE every app-schema table (wipes learned values, execution
 * actuals, and all schedule versions — including post-drift / committed ones);
 * (2) re-seed the baseline; (3) build the demo plant's baseline schedule through
 * the **real running API** (solve + commit — no logic duplicated here), so the
 * board opens with **all operations `std`**, **0 learned parameters**, and **no
 * variance** (no actuals yet). Schema/migrations are untouched — DATA only.
 *
 * Requires the API to be running (it builds the baseline via the real engine). If
 * the API is unreachable, the data baseline is still restored and the schedule
 * appears on the planner's first Re-solve.
 */
const APP_SCHEMAS = ['tenant', 'auth', 'org', 'master_data', 'binding', 'scheduling', 'learning']
const DEMO_PLANT_PREFIX = 'Saltillo'
const API = `http://localhost:${env.PORT}/api/v1`
const ADMIN = { email: 'admin@perduraflow.test', password: 'Password123' }

async function truncateAll(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ schemaname: string; tablename: string }>(
    `SELECT schemaname, tablename FROM pg_tables WHERE schemaname = ANY($1)`,
    [APP_SCHEMAS],
  )
  if (rows.length === 0) return 0
  const list = rows.map((r) => `"${r.schemaname}"."${r.tablename}"`).join(', ')
  await pool.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`)
  return rows.length
}

/** Build the committed baseline through the real API (deterministic engine). */
async function buildBaseline(plantId: string): Promise<boolean> {
  try {
    const login = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ADMIN),
    })
    if (!login.ok) throw new Error(`login ${login.status}`)
    const token = (await login.json()).data.accessToken as string
    const h = { 'content-type': 'application/json', authorization: `Bearer ${token}` }
    const solve = await fetch(`${API}/admin/scheduling/solve`, { method: 'POST', headers: h, body: JSON.stringify({ plantId }) })
    if (!solve.ok) throw new Error(`solve ${solve.status}`)
    const version = (await solve.json()).data as { id: string }
    const commit = await fetch(`${API}/admin/scheduling/versions/${version.id}/commit`, { method: 'POST', headers: h })
    if (!commit.ok) throw new Error(`commit ${commit.status}`)
    return true
  } catch (e) {
    console.warn(`  ⚠ baseline schedule not built via API (${(e as Error).message}). Start the API and Re-solve once.`)
    return false
  }
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: env.DATABASE_URL })

  console.log('demo:reset — restoring the deterministic baseline')
  const truncated = await truncateAll(pool)
  console.log(`  ✓ wiped ${truncated} tables (learned values, actuals, schedule versions)`)

  await seed() // re-creates the deterministic baseline (own connection)

  const plant = (
    await pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM org.plant WHERE name LIKE $1 ORDER BY name LIMIT 1`,
      [`${DEMO_PLANT_PREFIX}%`],
    )
  ).rows[0]
  if (!plant) throw new Error('reset: seeded demo plant not found')

  const built = await buildBaseline(plant.id)
  if (built) console.log(`  ✓ committed baseline schedule for ${plant.name} (via the real engine)`)

  // Confirm the post-reset state from the DB (computed, not asserted).
  const count = async (sql: string): Promise<number> => Number((await pool.query<{ n: string }>(sql)).rows[0]!.n)
  const ops = await count(`SELECT count(*) n FROM scheduling.scheduled_operation`)
  const ml = await count(`SELECT count(*) n FROM scheduling.scheduled_operation WHERE cycle_source = 'ml_adjusted' OR setup_source = 'ml_adjusted'`)
  const committed = await count(`SELECT count(*) n FROM scheduling.schedule_version WHERE status = 'committed'`)
  const learned = await count(`SELECT count(*) n FROM learning.learned_parameter`)
  const actuals = await count(`SELECT count(*) n FROM learning.execution_actual`)
  const demand = await count(`SELECT count(*) n FROM scheduling.demand_input WHERE is_active = true`)

  console.log('\nPost-reset state:')
  console.log(`  • active demand lines  : ${demand}`)
  console.log(`  • committed versions   : ${committed}`)
  console.log(`  • scheduled operations : ${ops} (ml_adjusted = ${ml}, learned = ${learned} of ${ops})`)
  console.log(`  • execution actuals    : ${actuals}`)
  console.log(`  • variance             : none (no actuals)`)
  console.log('\nBaseline: all operations std, 0 learned, no variance. Log in as admin@perduraflow.test / "Password123".')

  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
