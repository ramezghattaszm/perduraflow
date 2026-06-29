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
 * Execute the committed version's PAST work via the simulator — backdated actuals for every op whose
 * planned end is before **now** (so THIS MORNING's ops are executed; this afternoon / future stay planned).
 * Anchoring the cutoff on `nowMs` (not start-of-day) keeps the warm-start's LAST actual recent — this
 * morning — so the wear forecast's working-time crossing projects to THIS AFTERNOON (a not-yet-crossed,
 * near-future forecast at demo time), not days stale. The board reads "this morning executed, this
 * afternoon upcoming." On a closed day (weekend reset) `nowMs` finds no open ops past Friday, so the last
 * actual is Friday and the crossing projects to the next working day — degrades sanely, no clamp needed.
 * The actuals are the completed history AND the fuel for learning (the `drift` lane's cycle creeps → a live
 * wear prediction) and execution OEE.
 */
async function simulatePast(
  h: Record<string, string>,
  versionId: string,
  completedBeforeMs: number,
  drifts: { resourceId: string; magnitude: number; rampOverEvents: number; curve: number }[],
): Promise<number> {
  const body = {
    scheduleVersionId: versionId,
    cyclesPerOp: 2,
    completedBeforeMs,
    // Seed deterministic execution misses into the historical window so warm-start Schedule
    // Adherence isn't a fake 100% (a thin slice of past orders ran off their planned window).
    injectMisses: true,
    // Multi-lane wear, one pass (resCycleIdx is per-resource so each lane ramps independently):
    //  • Press A — convex (accelerating) wear with COMFORTABLE MARGIN below the +5% adopt threshold
    //    (window mean ~+1.8%) so it does NOT adopt, while the steeper RECENT slope projects a crossing
    //    ~2 DAYS out → a live, advisory (QUEUED) prediction: "predicting, awaiting you."
    //  • Press B — worn FURTHER so the projected crossing lands inside the Tier-1 confidence horizon
    //    (≥ the seeded 0.85 gate) → the forecast AUTO-COMMITS (disposition auto_committed; ml_predicted
    //    overlay pre-adopted for next solve) → the Exception Queue shows it AUTO-HANDLED.
    // Deterministic noise → both land identically every reset. (The live drift demo is the DEFINED step
    // that actually crosses the band and ADOPTS ml.)
    ...(drifts.length ? { drifts: drifts.map((d) => ({ resourceId: d.resourceId, param: 'cycle' as const, magnitude: d.magnitude, rampOverEvents: d.rampOverEvents, curve: d.curve })) } : {}),
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
  // The wear lines — Press A drifts to a QUEUED prediction (proposing); Press B drifts further so its
  // forecast clears the Tier-1 confidence gate → AUTO-COMMITTED (the auto-handled beat). Both in Saltillo.
  const pressA = (await pool.query<{ id: string }>(`SELECT id FROM master_data.resource WHERE name = 'Press Line A' LIMIT 1`)).rows[0]?.id
  const pressB = (await pool.query<{ id: string }>(`SELECT id FROM master_data.resource WHERE name = 'Press Line B' LIMIT 1`)).rows[0]?.id
  try {
    const h = await login()
    // Press Line A's cycle is tuned to climb to JUST BELOW the +5% wear threshold over the past
    // window — enough for a live wear PREDICTION (rising trailing slope, crossing within horizon) but
    // NOT enough to step to `ml_adjusted`. Adoption is the live-drift demo's payoff (collision 2):
    // trigger drift and watch it cross the threshold and adopt. So one pass: solve + commit + execute
    // the past (actuals = history + variance + the prediction's fuel; the board stays std at reset).
    const drifts = [
      ...(pressA ? [{ resourceId: pressA, magnitude: 0.11, rampOverEvents: 300, curve: 3 }] : []),
      // Press B: with the now-anchored warm-start, the last actual is THIS MORNING, so the tool sits just
      // below the band there and a SHORT, high-confidence horizon (~2 h) projects the crossing to THIS
      // AFTERNOON — auto_committed (conf ~0.90 ≥ 0.85) and not-yet-crossed at a 17:00 demo. The crossing
      // tracks the reset clock (rolls); a weekend reset falls back to the Friday actual → next working day.
      // Lighter than A's-counterpart history (mag dropped 0.46→0.27) because the extra morning events ramp
      // it to the band faster; tuned to stay BELOW the band at the window mean (forecast-and-adopt, not crossed).
      ...(pressB ? [{ resourceId: pressB, magnitude: 0.27, rampOverEvents: 215, curve: 6 }] : []),
    ]
    for (const p of plants) {
      const v = await buildBaseline(h, p.id)
      const emitted = await simulatePast(h, v, nowMs, drifts)
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
