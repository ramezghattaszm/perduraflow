import { describe, expect, it } from 'vitest'
import type { Placement } from './sequencer'
import { scorePlan, type ResourceRate } from './whatif.scoring'

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
  atRiskReason: endMs > REQ ? 'late' : null,
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
