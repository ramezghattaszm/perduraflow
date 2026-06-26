import { describe, expect, it } from 'vitest'
import { firmLatenessDominates, OBJECTIVE_DEFAULTS, type ObjectiveWeights } from '@perduraflow/contracts'
import type { Placement } from './sequencer'
import { INFEASIBLE_LATENESS_HOURS, scorePlan, type ResourceRate } from './whatif.scoring'

const HOUR = 3_600_000
const REQ = Date.UTC(2024, 0, 1, 12) // the firm order's required date

/** A firm op for the same demand line, placed on `resourceId`, finishing at `endMs`. */
const firmOp = (resourceId: string, endMs: number): Placement => ({
  demandLineId: 'DL-1',
  partId: 'P-1',
  routingOperationId: 'RO-1',
  resourceId,
  opSeq: 1,
  sequencePosition: 1,
  plannedStartMs: endMs - HOUR,
  plannedEndMs: endMs,
  qty: 100,
  setupTime: 0,
  cycleTime: 0,
  setupSource: 'standard',
  cycleSource: 'standard',
  setupConfidence: null,
  cycleConfidence: null,
  atRisk: endMs > REQ,
  placedFeasible: true,
  atRiskReason: endMs > REQ ? 'late' : null,
  bindingKind: endMs > REQ ? 'release' : 'origin',
  bindingBlockerDemandLineId: null,
  bindingBlockerOpSeq: null,
  bindingDowntimeId: null,
  bindingOperatorId: null,
  operatorLaborRate: null,
  requiredDateMs: REQ,
  firmness: 'firm',
  changeoverValue: null,
})

// Rates chosen so costPerUnit == overheadPerUnit (setup/run zero): a clean per-unit cost knob.
const rate = (perUnit: number): ResourceRate => ({ setupCost: 0, runCostPerHour: 0, overheadPerUnit: perUnit })

describe('scorePlan — cost factor (C6) & firm-lateness dominance lock', () => {
  it('does NOT prefer a cheaper plan that makes a firm order late (dominance invariant)', () => {
    // On-time but pricier: firm op finishes exactly on time on an EXPENSIVE line (costPerUnit 2.0).
    const onTime = [firmOp('EXP', REQ)]
    // Cheaper but 1h firm-late: same op on a CHEAP line (costPerUnit 1.5), finishing 1h past due.
    const late = [firmOp('CHEAP', REQ + HOUR)]
    const rateByResource = new Map<string, ResourceRate>([
      ['EXP', rate(2.0)],
      ['CHEAP', rate(1.5)],
    ])
    const onTimeScore = scorePlan(onTime, { rateByResource, basePlacements: onTime, overtimeHours: 0 })
    const lateScore = scorePlan(late, { rateByResource, basePlacements: late, overtimeHours: 0 })

    // The cost factor is actually wired, and the late plan IS genuinely cheaper.
    expect(onTimeScore.kpis.costPerUnit).toBe(2)
    expect(lateScore.kpis.costPerUnit).toBe(1.5)
    expect(onTimeScore.factors.find((f) => f.key === 'cost')!.contribution).toBe(8) // 2.0 × 4
    expect(lateScore.factors.find((f) => f.key === 'cost')!.contribution).toBe(6) // 1.5 × 4

    // INVARIANT: lateness wins — the on-time plan scores strictly better (lower) than the
    // cheaper-but-late plan. Cost can never pull a firm order late. This locks the calibration:
    // if a future weight re-tune lets cost override firm lateness, this test fails.
    expect(onTimeScore.score).toBeLessThan(lateScore.score)

    // …and the margin is driven by firm lateness, not erased by the cost saving (10 > 2).
    const latenessPenalty = lateScore.factors.find((f) => f.key === 'lateness')!.contribution
    const costSaving =
      onTimeScore.factors.find((f) => f.key === 'cost')!.contribution -
      lateScore.factors.find((f) => f.key === 'cost')!.contribution
    expect(latenessPenalty).toBeGreaterThan(costSaving)

    // beat-2 legibility lock: firm-late HOURS is a first-class KPI and equals the lateness factor's
    // RAW (scored) quantity — so the option tile's headline late metric can't disagree with what
    // drives the ranking (the bug where the recommended option showed worse OTIF / more late orders).
    expect(onTimeScore.kpis.firmLateHours).toBe(0)
    expect(lateScore.kpis.firmLateHours).toBe(1) // REQ + 1h
    expect(lateScore.factors.find((f) => f.key === 'lateness')!.rawValue).toBe(lateScore.kpis.firmLateHours)
  })

  it('cost is cost-neutral (0, never NaN) when no resource is rated — the non-null guard', () => {
    const plan = [firmOp('UNRATED', REQ)]
    const scored = scorePlan(plan, { rateByResource: new Map(), basePlacements: plan, overtimeHours: 0 })
    expect(scored.kpis.costPerUnit).toBeNull()
    const cost = scored.factors.find((f) => f.key === 'cost')!
    expect(cost.rawValue).toBe(0)
    expect(cost.contribution).toBe(0)
    expect(Number.isNaN(scored.score)).toBe(false)
  })

  it('folds operator LABOR into per-unit cost — a pricier operator scores worse, all else equal (wi-12)', () => {
    // Same on-time op on the same (overhead-only) resource; only the operator's $/hr differs.
    // 60 min/unit × 100 units = 6000 run-min = 100 working-hours → labor = laborRate × 100, over 100 units.
    const op = (laborRate: number | null): Placement => ({
      ...firmOp('R', REQ),
      cycleTime: 60,
      operatorLaborRate: laborRate,
    })
    const rateByResource = new Map<string, ResourceRate>([['R', rate(0)]]) // resource cost 0 → isolate labor
    const cheap = scorePlan([op(5)], { rateByResource, basePlacements: [op(5)], overtimeHours: 0 })
    const pricey = scorePlan([op(20)], { rateByResource, basePlacements: [op(20)], overtimeHours: 0 })
    const none = scorePlan([op(null)], { rateByResource, basePlacements: [op(null)], overtimeHours: 0 })

    // labor cost / unit = laborRate × 100h / 100 units = laborRate. Resource cost is 0, so costPerUnit == laborRate.
    expect(cheap.kpis.costPerUnit).toBe(5)
    expect(pricey.kpis.costPerUnit).toBe(20)
    expect(none.kpis.costPerUnit).toBe(0) // no operator → labor cost-neutral, never NaN
    // Both on time → cost decides; the pricier operator's higher LABOR makes its plan score strictly worse.
    expect(pricey.score).toBeGreaterThan(cheap.score)
    expect(Number.isNaN(none.score)).toBe(false)
  })

  it('among on-time plans, the cheaper one wins (cost discriminates when lateness ties)', () => {
    const cheap = [firmOp('CHEAP', REQ)]
    const pricey = [firmOp('EXP', REQ)]
    const rateByResource = new Map<string, ResourceRate>([
      ['CHEAP', rate(1.5)],
      ['EXP', rate(2.0)],
    ])
    const cheapScore = scorePlan(cheap, { rateByResource, basePlacements: cheap, overtimeHours: 0 })
    const priceyScore = scorePlan(pricey, { rateByResource, basePlacements: pricey, overtimeHours: 0 })
    expect(cheapScore.score).toBeLessThan(priceyScore.score) // both on time → cost decides
  })
})

describe('scorePlan — window-overflow infeasibility folded into lateness (wi-13)', () => {
  // A firm op that can't fit any working segment: placedFeasible=false. Its recorded end is a fictional
  // contiguous fallback (here ON TIME, end===REQ) — exactly the blind spot: due-lateness sees nothing.
  const infeasibleOnTime = (resourceId = 'R'): Placement => ({ ...firmOp(resourceId, REQ), placedFeasible: false })

  it('an infeasible firm op scores STRICTLY WORSE than any feasible plan — even a feasible-but-LATE one', () => {
    const rate = (perUnit: number): ResourceRate => ({ setupCost: 0, runCostPerHour: 0, overheadPerUnit: perUnit })
    const rates = new Map<string, ResourceRate>([['R', rate(1)]])
    const infeasible = [infeasibleOnTime()] // on-time by the fictional end, but can't actually run
    const feasibleLate = [firmOp('R', REQ + 5 * HOUR)] // genuinely 5h firm-late, but it CAN run
    const inf = scorePlan(infeasible, { rateByResource: rates, basePlacements: infeasible, overtimeHours: 0 })
    const late = scorePlan(feasibleLate, { rateByResource: rates, basePlacements: feasibleLate, overtimeHours: 0 })
    // The blind spot is closed: the un-runnable plan is worse than a feasible-but-late one.
    expect(inf.score).toBeGreaterThan(late.score)
    // KPI honesty: firmLateHours stays the HONEST due figure (0 here — the fallback lands on time); the
    // sentinel is NEVER in firmLateHours. The legible signal is the separate count.
    expect(inf.kpis.firmLateHours).toBe(0)
    expect(inf.kpis.infeasibleFirmOps).toBe(1)
    // The legibility lock, generalised: lateness RAW === honest firmLateHours + infeasibleFirmOps × sentinel.
    const lateF = inf.factors.find((f) => f.key === 'lateness')!
    expect(lateF.rawValue).toBe(inf.kpis.firmLateHours! + inf.kpis.infeasibleFirmOps! * INFEASIBLE_LATENESS_HOURS)
  })

  it('TWO infeasible firm ops score worse than ONE (monotonic in the count)', () => {
    const one = [infeasibleOnTime('A')]
    const two = [infeasibleOnTime('A'), infeasibleOnTime('B')]
    const s1 = scorePlan(one, { rateByResource: new Map(), basePlacements: one, overtimeHours: 0 })
    const s2 = scorePlan(two, { rateByResource: new Map(), basePlacements: two, overtimeHours: 0 })
    expect(s2.kpis.infeasibleFirmOps).toBe(2)
    expect(s2.score).toBeGreaterThan(s1.score)
  })

  it('FORECAST infeasibility is NOT scored (firm-only scope, matching the lateness factor)', () => {
    const forecastInfeasible: Placement = { ...firmOp('R', REQ), firmness: 'forecast', placedFeasible: false }
    const s = scorePlan([forecastInfeasible], { rateByResource: new Map(), basePlacements: [forecastInfeasible], overtimeHours: 0 })
    expect(s.kpis.infeasibleFirmOps).toBe(0)
    expect(s.factors.find((f) => f.key === 'lateness')!.rawValue).toBe(0)
  })

  it('is INERT when all firm ops fit — feasible-plan scores are byte-identical to pre-wi-13 (the safety check)', () => {
    // Same plan, the only difference being the (now-always-true) placedFeasible flag → no infeasible op →
    // rawValue === firmLateHours, contribution/score unchanged. This is what makes the change safe.
    const plan = [firmOp('R', REQ + HOUR)] // feasible, 1h late
    const s = scorePlan(plan, { rateByResource: new Map(), basePlacements: plan, overtimeHours: 0 })
    expect(s.kpis.infeasibleFirmOps).toBe(0)
    expect(s.factors.find((f) => f.key === 'lateness')!.rawValue).toBe(s.kpis.firmLateHours) // the original lock, intact
  })
})

describe('firmLatenessDominates — the SHARED guard (test + runtime + UI use this one fn)', () => {
  it('the shipped aps-w2 default PASSES — ties the guard to the locked behavioural calibration', () => {
    // The scorePlan tests above prove the default behaviourally dominates; the guard must agree, so
    // the runtime/UI guard and the locked test can never drift apart.
    expect(firmLatenessDominates(OBJECTIVE_DEFAULTS).ok).toBe(true)
  })

  it('rejects a set where a non-lateness weight exceeds lateness / ratio (cost weighted up)', () => {
    const breaking: ObjectiveWeights = { ...OBJECTIVE_DEFAULTS, cost: 10 } // lateness 10 → ceiling 5; cost 10 > 5
    const verdict = firmLatenessDominates(breaking)
    expect(verdict.ok).toBe(false)
    expect(verdict.offending).toContain('cost')
    expect(verdict.maxOtherWeight).toBe(5) // lateness 10 / ratio 2
  })

  it('rejects a set where lateness is too low relative to the others', () => {
    const verdict = firmLatenessDominates({ ...OBJECTIVE_DEFAULTS, lateness: 2 }) // ceiling 1; cost 4 > 1
    expect(verdict.ok).toBe(false)
    expect(verdict.offending).toContain('lateness')
  })

  it('rejects a negative weight', () => {
    const verdict = firmLatenessDominates({ ...OBJECTIVE_DEFAULTS, changeover: -1 })
    expect(verdict.ok).toBe(false)
    expect(verdict.offending).toContain('changeover')
  })

  it('accepts a legitimate custom set that keeps lateness dominant (changeover raised within bounds)', () => {
    expect(firmLatenessDominates({ ...OBJECTIVE_DEFAULTS, changeover: 5 }).ok).toBe(true) // 5 ≤ ceiling 5
  })
})

describe('scorePlan — responds to the RESOLVED weights (config-driven proof)', () => {
  it('the same plan scores differently under different cost weights (weights flow through ctx)', () => {
    const plan = [firmOp('EXP', REQ)] // on time, costPerUnit 2.0
    const rateByResource = new Map<string, ResourceRate>([['EXP', rate(2.0)]])
    const base = { rateByResource, basePlacements: plan, overtimeHours: 0 }
    const lowCost = scorePlan(plan, { ...base, weights: { ...OBJECTIVE_DEFAULTS, cost: 2 } })
    const highCost = scorePlan(plan, { ...base, weights: { ...OBJECTIVE_DEFAULTS, cost: 4 } })
    // cost contribution = costPerUnit(2.0) × weight → 4 vs 8; the higher cost weight scores worse.
    expect(lowCost.factors.find((f) => f.key === 'cost')!.contribution).toBe(4)
    expect(highCost.factors.find((f) => f.key === 'cost')!.contribution).toBe(8)
    expect(highCost.score).toBeGreaterThan(lowCost.score)
  })
})
