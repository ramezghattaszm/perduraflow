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
 * (2) re-seed the baseline (a today-anchored **rolling window**: N completed past
 * days + today + future); (3) build each plant's baseline through the **real
 * running API** (solve + commit), then (4) execute the committed version's PAST
 * days via the simulator (backdated actuals) — the **warm-start**: completed history
 * + execution variance, and Press Line A worn to JUST BELOW the threshold so a live
 * wear **prediction** shows (the board stays `std` at reset; the drift demo is where it
 * crosses and ADOPTS `ml`). Schema/migrations are untouched — DATA only.
 *
 * Requires the API to be running (baseline + warm-start go through the real engine).
 * If the API is unreachable, the data baseline is still restored and the schedule
 * appears on the planner's first Re-solve (cold, until the next reset with the API up).
 */
const APP_SCHEMAS = ['tenant', 'auth', 'org', 'master_data', 'binding', 'scheduling', 'learning']
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

async function login(): Promise<Record<string, string>> {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(ADMIN),
  })
  if (!res.ok) throw new Error(`login ${res.status}`)
  const token = (await res.json()).data.accessToken as string
  return { 'content-type': 'application/json', authorization: `Bearer ${token}` }
}

/** Solve + commit a plant's baseline through the real API (deterministic engine). Returns the committed version id. */
async function buildBaseline(h: Record<string, string>, plantId: string): Promise<string> {
  const solve = await fetch(`${API}/admin/scheduling/solve`, { method: 'POST', headers: h, body: JSON.stringify({ plantId }) })
  if (!solve.ok) throw new Error(`solve ${solve.status}`)
  const version = (await solve.json()).data as { id: string }
  const commit = await fetch(`${API}/admin/scheduling/versions/${version.id}/commit`, { method: 'POST', headers: h })
  if (!commit.ok) throw new Error(`commit ${commit.status}`)
  return version.id
}

/**
 * Execute the committed version's PAST days via the simulator — backdated actuals for every op whose
 * planned end is before today (today/future stay planned). This is the rolling window's warm-start:
 * the actuals are the completed history on the board's past-day nav AND the fuel for learning (the
 * `drift` resource's cycle creeps → a live, advisory wear prediction — not yet adopted) and execution OEE.
 */
async function simulatePast(
  h: Record<string, string>,
  versionId: string,
  todayStartMs: number,
  drift: { resourceId: string; magnitude: number } | null,
): Promise<number> {
  const body = {
    scheduleVersionId: versionId,
    cyclesPerOp: 2,
    completedBeforeMs: todayStartMs,
    // Seed deterministic execution misses into the historical window so warm-start Schedule
    // Adherence isn't a fake 100% (a thin slice of past orders ran off their planned window).
    injectMisses: true,
    // Convex (accelerating) wear that leaves Press A's cycle with COMFORTABLE MARGIN below the +5%
    // adopt threshold (window mean ~+1.8%) — so it does NOT adopt — while the steeper RECENT slope
    // reads clearly above the (now tight, deterministic) noise floor and projects a threshold-crossing
    // ~2 DAYS out → a live, advisory (queued) wear PREDICTION on the cycle param. No knife's edge: the
    // noise is deterministic so this lands identically every reset. (The live drift demo is where a
    // DEFINED injected step actually crosses the band and the rule ADOPTS ml.)
    ...(drift ? { drift: { resourceId: drift.resourceId, param: 'cycle' as const, magnitude: drift.magnitude, rampOverEvents: 300, curve: 3 } } : {}),
  }
  const res = await fetch(`${API}/dev/scheduling/simulate`, { method: 'POST', headers: h, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`simulate ${res.status}`)
  return (await res.json()).data.emitted as number
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: env.DATABASE_URL })

  console.log('demo:reset — restoring the deterministic baseline')
  const truncated = await truncateAll(pool)
  console.log(`  ✓ wiped ${truncated} tables (learned values, actuals, schedule versions)`)

  // One shared clock for the whole reset (SEED-SPEC §8 check #9): the seed's rolling window
  // and the simulator's past/future cutoff must agree on "today" — sampling Date.now() twice
  // could straddle a UTC day boundary. Inject it; the builder takes no wall-clock of its own.
  const nowMs = Date.now()
  await seed(nowMs) // re-creates the deterministic baseline (own connection)

  // Build a committed baseline for every plant that has demand (Saltillo + Ramos), then execute its
  // PAST days via the simulator (the rolling window's warm-start). Requires the API running.
  const plants = (
    await pool.query<{ id: string; name: string }>(
      `SELECT DISTINCT p.id, p.name FROM org.plant p
       JOIN scheduling.demand_input d ON d.plant_id = p.id
       WHERE d.tenant_id = p.tenant_id AND d.is_active = true
       ORDER BY p.name`,
    )
  ).rows
  if (plants.length === 0) throw new Error('reset: no plants with seeded demand found')
  // The wear line (Press Line A) — its cycle drifts in the past window → adopted ml + a live prediction.
  const pressA = (await pool.query<{ id: string }>(`SELECT id FROM master_data.resource WHERE name = 'Press Line A' LIMIT 1`)).rows[0]?.id
  const todayStartMs = Math.floor(nowMs / 86_400_000) * 86_400_000
  try {
    const h = await login()
    // Press Line A's cycle is tuned to climb to JUST BELOW the +5% wear threshold over the past
    // window — enough for a live wear PREDICTION (rising trailing slope, crossing within horizon) but
    // NOT enough to step to `ml_adjusted`. Adoption is the live-drift demo's payoff (collision 2):
    // trigger drift and watch it cross the threshold and adopt. So one pass: solve + commit + execute
    // the past (actuals = history + variance + the prediction's fuel; the board stays std at reset).
    const drift = pressA ? { resourceId: pressA, magnitude: 0.11 } : null
    for (const p of plants) {
      const v = await buildBaseline(h, p.id)
      const emitted = await simulatePast(h, v, todayStartMs, drift)
      console.log(`  ✓ ${p.name}: warm-start baseline committed + ${emitted} past actuals`)
    }
  } catch (e) {
    console.warn(`  ⚠ baseline/warm-start not built via API (${(e as Error).message}). Start the API and Re-solve once.`)
  }

  // Confirm the post-reset state from the DB (computed, not asserted).
  const count = async (sql: string): Promise<number> => Number((await pool.query<{ n: string }>(sql)).rows[0]!.n)
  const ops = await count(`SELECT count(*) n FROM scheduling.scheduled_operation`)
  const ml = await count(`SELECT count(*) n FROM scheduling.scheduled_operation WHERE cycle_source = 'ml_adjusted' OR setup_source = 'ml_adjusted'`)
  const committed = await count(`SELECT count(*) n FROM scheduling.schedule_version WHERE status = 'committed'`)
  const learned = await count(`SELECT count(*) n FROM learning.learned_parameter`)
  const actuals = await count(`SELECT count(*) n FROM learning.execution_actual`)
  const demand = await count(`SELECT count(*) n FROM scheduling.demand_input WHERE is_active = true`)

  const predictions = await count(`SELECT count(*) n FROM learning.parameter_prediction WHERE superseded_by IS NULL AND disposition IN ('queued','auto_committed','approved')`)

  console.log('\nPost-reset state (warm-start rolling window):')
  console.log(`  • active demand lines  : ${demand}`)
  console.log(`  • committed versions   : ${committed}`)
  console.log(`  • scheduled operations : ${ops} (ml_adjusted = ${ml}, learned = ${learned})`)
  console.log(`  • execution actuals    : ${actuals} (past days, backdated)`)
  console.log(`  • live predictions     : ${predictions}`)
  console.log('\nWarm-start: completed past days with variance + a live wear prediction on Press Line A')
  console.log('(climbing toward threshold; the drift demo crosses + adopts). Log in as admin@perduraflow.test / "Password123".')

  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
