/**
 * Objective (what-if scoring) byte-identical baseline harness — Scheduling S1.3 Commit-0.
 *
 * **The second proof S1.3 needs, and the one the plan digest CANNOT provide.** `solve()` never calls
 * `scorePlan`; `scorePlan` is the WHAT-IF objective — it produces every option score, rationale factor,
 * `ConstraintBinding`, and KPI the demo narrates. S1.3 (D-S1-6 Option B) reshapes the objective into one
 * registry-driven keyed structure, so an Option-B regression can change every what-if score/rationale while
 * the 1043-op plan digest stays perfectly green. This harness pins the FULL scoring surface so that
 * regression is caught.
 *
 * Why a fixed in-code fixture (not a DB/app run): `scorePlan` is a PURE function
 * `(placements, ScoreContext) → ScoredPlan` — the exact thing Option B reshapes. A fixed set of scenarios
 * that exercises the whole surface (every factor incl. the infeasible-firm sentinel, the null-cost path,
 * displacement-vs-base, overtime, operator labor; multiple weight sets incl. a dominance-edge set) isolates
 * `scorePlan` completely and is **date-insensitive** — unlike the committed-plan digest, this reference is a
 * fixed target every S1.3 commit must reproduce EXACTLY (no same-clock caveat). If `scorePlan` is numerically
 * identical here across the reshape, it is identical for the demo scenarios too (same function).
 *
 * Surface captured per scenario: every `RationaleFactor` (key, rawValue, unit, weight, contribution,
 * direction, detailKey, detailParams), the `score`, the `ConstraintBinding[]`, the `CostedKpis`, and the
 * resolved weight-set version token. Canonical (key-sorted) SHA-256 over the whole array.
 *
 * Usage:
 *   tsx src/db/objective-baseline.ts               # print scenario count + per-scenario score + digest
 *   tsx src/db/objective-baseline.ts --save <path> # also write the reference JSON (the diff target)
 *   tsx src/db/objective-baseline.ts --check <path># diff against a saved reference; exit 1 on any mismatch
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { OBJECTIVE_DEFAULTS, OBJECTIVE_DEFAULT_VERSION, type ObjectiveWeights } from '@perduraflow/contracts'
import type { Placement } from '../modules/scheduling/sequencer'
import { scorePlan, type ResourceRate, type ScoreContext } from '../modules/scheduling/whatif.scoring'

const H = 3_600_000

/** A Placement factory — sane on-time firm defaults; each scenario overrides only what it exercises. */
const pl = (o: Partial<Placement>): Placement => ({
  demandLineId: 'D-0001',
  partId: 'PA',
  routingOperationId: 'RO-1',
  resourceId: 'R1',
  opSeq: 1,
  sequencePosition: 1,
  plannedStartMs: 0,
  plannedEndMs: 8 * H,
  qty: 100,
  setupTime: 30,
  cycleTime: 2,
  setupSource: 'standard',
  cycleSource: 'standard',
  setupConfidence: null,
  cycleConfidence: null,
  atRisk: false,
  atRiskReason: null,
  placedFeasible: true,
  bindingKind: 'origin',
  bindingBlockerDemandLineId: null,
  bindingBlockerOpSeq: null,
  bindingDowntimeId: null,
  bindingOperatorId: null,
  operatorLaborRate: null,
  requiredDateMs: 1000 * H,
  firmness: 'firm',
  changeoverValue: null,
  ...o,
})

const RATES = new Map<string, ResourceRate>([
  ['R1', { setupCost: 50, runCostPerHour: 60, overheadPerUnit: 0.5 }],
  ['R2', { setupCost: 40, runCostPerHour: 80, overheadPerUnit: 0.25 }],
  // R3 intentionally unrated → the uncosted (null costPerUnit) path.
])

/** A rich mixed plan: two resources, a changeover on R1, a late firm op, an early op, operator labor. */
const MIXED: Placement[] = [
  pl({ demandLineId: 'D-0001', resourceId: 'R1', sequencePosition: 1, changeoverValue: 'A', plannedEndMs: 6 * H, requiredDateMs: 20 * H }),
  pl({ demandLineId: 'D-0002', resourceId: 'R1', sequencePosition: 2, changeoverValue: 'B', plannedEndMs: 30 * H, requiredDateMs: 20 * H, atRisk: true }), // firm late 10h
  pl({ demandLineId: 'D-0003', resourceId: 'R1', sequencePosition: 3, changeoverValue: 'B', plannedEndMs: 12 * H, requiredDateMs: 40 * H }), // early 28h (inventory)
  pl({ demandLineId: 'D-0004', resourceId: 'R2', sequencePosition: 1, qty: 50, operatorLaborRate: 45, plannedEndMs: 5 * H, requiredDateMs: 20 * H }), // operator labor
]

/** MIXED rerouted: D-0002 moved to R2 + a sequence shuffle → displacement vs MIXED as base. */
const REROUTED: Placement[] = [
  pl({ demandLineId: 'D-0001', resourceId: 'R1', sequencePosition: 1, changeoverValue: 'A', plannedEndMs: 6 * H, requiredDateMs: 20 * H }),
  pl({ demandLineId: 'D-0002', resourceId: 'R2', sequencePosition: 2, changeoverValue: 'B', plannedEndMs: 18 * H, requiredDateMs: 20 * H }), // now on time, moved
  pl({ demandLineId: 'D-0003', resourceId: 'R1', sequencePosition: 2, changeoverValue: 'B', plannedEndMs: 12 * H, requiredDateMs: 40 * H }),
  pl({ demandLineId: 'D-0004', resourceId: 'R2', sequencePosition: 1, qty: 50, operatorLaborRate: 45, plannedEndMs: 5 * H, requiredDateMs: 20 * H }),
]

/** A plan with a window-overflow-infeasible FIRM op (placedFeasible=false) → the infeasible-lateness sentinel. */
const INFEASIBLE: Placement[] = [
  pl({ demandLineId: 'D-0001', resourceId: 'R1', sequencePosition: 1, plannedEndMs: 6 * H, requiredDateMs: 20 * H }),
  pl({ demandLineId: 'D-0009', resourceId: 'R1', sequencePosition: 2, placedFeasible: false, atRisk: true, plannedEndMs: 50 * H, requiredDateMs: 20 * H }),
]

/** An uncosted plan: unrated resource R3 + no operator → costPerUnit null → cost factor contributes 0. */
const UNCOSTED: Placement[] = [
  pl({ demandLineId: 'D-0001', resourceId: 'R3', sequencePosition: 1, plannedEndMs: 6 * H, requiredDateMs: 20 * H }),
  pl({ demandLineId: 'D-0002', resourceId: 'R3', sequencePosition: 2, plannedEndMs: 10 * H, requiredDateMs: 40 * H }),
]

/** A second VALID weight set (passes firm-lateness dominance: lateness ≥ 2 × every other) — exercises weight variation. */
const ALT_WEIGHTS: ObjectiveWeights = { lateness: 20, changeover: 2, overtime: 8, inventory: 0.5, displacement: 3, cost: 5 }

interface Scenario {
  label: string
  weightSetVersion: string
  placements: Placement[]
  ctx: ScoreContext
}

/** The fixed scenario set — deterministic, surface-covering. Order is part of the reference. */
const SCENARIOS: Scenario[] = [
  { label: 'mixed-default', weightSetVersion: OBJECTIVE_DEFAULT_VERSION, placements: MIXED, ctx: { rateByResource: RATES, basePlacements: MIXED, overtimeHours: 0, weights: OBJECTIVE_DEFAULTS } },
  { label: 'rerouted-displaced-ot', weightSetVersion: OBJECTIVE_DEFAULT_VERSION, placements: REROUTED, ctx: { rateByResource: RATES, basePlacements: MIXED, overtimeHours: 5, weights: OBJECTIVE_DEFAULTS } },
  { label: 'infeasible-firm', weightSetVersion: OBJECTIVE_DEFAULT_VERSION, placements: INFEASIBLE, ctx: { rateByResource: RATES, basePlacements: INFEASIBLE, overtimeHours: 0, weights: OBJECTIVE_DEFAULTS } },
  { label: 'uncosted', weightSetVersion: OBJECTIVE_DEFAULT_VERSION, placements: UNCOSTED, ctx: { rateByResource: RATES, basePlacements: UNCOSTED, overtimeHours: 0, weights: OBJECTIVE_DEFAULTS } },
  { label: 'mixed-alt-weights', weightSetVersion: 'test-w-alt', placements: MIXED, ctx: { rateByResource: RATES, basePlacements: MIXED, overtimeHours: 0, weights: ALT_WEIGHTS } },
  { label: 'mixed-default-weights-omitted', weightSetVersion: OBJECTIVE_DEFAULT_VERSION, placements: MIXED, ctx: { rateByResource: RATES, basePlacements: MIXED, overtimeHours: 0 } }, // weights?: undefined → OBJECTIVE_DEFAULTS fallback
]

/** Recursively key-sorted JSON so the digest is field-order-independent. */
const canon = (v: unknown): unknown =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
    : Array.isArray(v)
      ? v.map(canon)
      : v
const sha = (o: unknown) => createHash('sha256').update(JSON.stringify(canon(o))).digest('hex')

function capture() {
  return SCENARIOS.map((s) => {
    const scored = scorePlan(s.placements, s.ctx)
    return { label: s.label, weightSetVersion: s.weightSetVersion, score: scored.score, factors: scored.factors, constraints: scored.constraints, kpis: scored.kpis }
  })
}

function main(): void {
  const surface = capture()
  const digest = sha(surface)

  const saveIdx = process.argv.indexOf('--save')
  const checkIdx = process.argv.indexOf('--check')

  console.log('objective (what-if scoring) baseline')
  console.log(`  scenarios : ${surface.length}`)
  console.log(`  digest    : ${digest}`)
  for (const s of surface) console.log(`    ${s.label.padEnd(30)} score=${s.score}  factors=${s.factors.length}  constraints=${s.constraints.length}  (${s.weightSetVersion})`)

  if (saveIdx !== -1) {
    const path = process.argv[saveIdx + 1]!
    writeFileSync(path, JSON.stringify({ digest, surface }, null, 2))
    console.log(`  ✓ saved reference → ${path}`)
  }
  if (checkIdx !== -1) {
    const path = process.argv[checkIdx + 1]!
    const ref = JSON.parse(readFileSync(path, 'utf8')) as { digest: string }
    if (ref.digest !== digest) {
      console.error(`  ✗ OBJECTIVE BASELINE MISMATCH — the what-if scoring surface changed`)
      console.error(`    digest: ${ref.digest} (ref) vs ${digest} (now)`)
      process.exit(1)
    }
    console.log(`  ✓ scoring surface byte-identical to the reference (${path})`)
  }
}

main()
