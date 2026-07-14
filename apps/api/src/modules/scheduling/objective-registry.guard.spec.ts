import { OBJECTIVE_DEFAULTS, OBJECTIVE_FACTORS, OBJECTIVE_WEIGHT_KEYS } from '@perduraflow/contracts'
import { describe, expect, it } from 'vitest'
import { scorePlan } from './whatif.scoring'
import type { Placement } from './sequencer'

/**
 * S1.3 close-out — the runtime guarantees that RECOVER what Option B gave up at the type level.
 * `RationaleFactorKey` is now literally `string` (zero compile-time safety), and `OBJECTIVE_DOMINANT_KEY`
 * uses a non-null `.find(dominant)!` at module load. These permanent tests restore the closed-set + single-
 * dominant guarantees at RUNTIME, so a future registry edit can't silently emit an unregistered factor key,
 * or ship two (or zero) dominant factors.
 */

const REGISTERED = new Set(OBJECTIVE_FACTORS.map((f) => f.key))

const pl = (over: Partial<Placement>): Placement =>
  ({ demandLineId: 'D', partId: 'p', routingOperationId: 'ro', resourceId: 'R1', opSeq: 1, sequencePosition: 1, plannedStartMs: 0, plannedEndMs: 30 * 3_600_000, qty: 100, setupTime: 30, cycleTime: 2, setupSource: 'standard', cycleSource: 'standard', setupConfidence: null, cycleConfidence: null, atRisk: true, atRiskReason: null, placedFeasible: true, bindingKind: 'origin', bindingBlockerDemandLineId: null, bindingBlockerOpSeq: null, bindingDowntimeId: null, bindingOperatorId: null, operatorLaborRate: 45, requiredDateMs: 20 * 3_600_000, firmness: 'firm', changeoverValue: 'A', ...over }) as Placement

describe('objective registry runtime invariants (S1.3 close-out — Option B safety net)', () => {
  it('exactly ONE factor is dominant (OBJECTIVE_DOMINANT_KEY’s .find(...)! can never throw or be ambiguous)', () => {
    expect(OBJECTIVE_FACTORS.filter((f) => f.dominant)).toHaveLength(1)
  })

  it('the registry is internally consistent — keys, defaults, and the key list agree', () => {
    expect(OBJECTIVE_WEIGHT_KEYS).toEqual(OBJECTIVE_FACTORS.map((f) => f.key)) // key list is registry-derived
    expect(Object.keys(OBJECTIVE_DEFAULTS).sort()).toEqual([...REGISTERED].sort()) // defaults cover exactly the registry
    expect(REGISTERED.size).toBe(OBJECTIVE_FACTORS.length) // no duplicate keys
  })

  it('every config-resolved weight key is a REGISTERED factor (the closed-set guarantee, at runtime)', () => {
    for (const k of Object.keys(OBJECTIVE_DEFAULTS)) expect(REGISTERED.has(k)).toBe(true)
  })

  it('every factor key scorePlan EMITS is a REGISTERED factor (no unregistered key escapes the scorer)', () => {
    // Exercise the full factor surface (lateness incl. sentinel, changeover, overtime, inventory, cost);
    // with no soft constraint (S1.3) the emitted set is exactly the six built-ins — all registered.
    const scored = scorePlan(
      [pl({}), pl({ demandLineId: 'E', placedFeasible: false, plannedEndMs: 50 * 3_600_000 })],
      { rateByResource: new Map([['R1', { setupCost: 50, runCostPerHour: 60, overheadPerUnit: 0.5 }]]), basePlacements: [pl({})], overtimeHours: 3 },
    )
    for (const f of scored.factors) expect(REGISTERED.has(f.key), `scorePlan emitted an unregistered factor key: ${f.key}`).toBe(true)
    expect(scored.factors).toHaveLength(OBJECTIVE_FACTORS.length) // exactly the six, nothing extra (inert)
  })
})
