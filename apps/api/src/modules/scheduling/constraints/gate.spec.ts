import { describe, expect, it } from 'vitest'
import { placementFeasibilityConstraint } from './feasibility'
import { eligibilityPreGateConstraint } from './pregate'
import { ConstraintPipeline } from './pipeline'
import type { ScheduleModel } from './types'
import type { SequencerItem } from '../sequencer'

/**
 * FEASIBILITY (degrade) + PRE_GATE (S1.1 Commit 5). Locks: FEASIBILITY reads placedFeasible; degrade-form
 * pipeline returns the placement unchanged (no veto). PRE_GATE eligibility uses the SAME predicate as the
 * CANDIDACY eligibility term — consistent (same ops), no gap/overlap.
 */

const item = (over: Partial<SequencerItem> = {}): SequencerItem =>
  ({ demandLineId: 'd', partId: 'p', partNo: 'P', routingOperationId: 'ro', opSeq: 1, changeoverValue: null, qty: 1, setupTime: 0, cycleTime: 1, requiredDate: 0, firmness: 'firm', priorityRank: 2, eligibleResourceIds: ['r'], ...over }) as SequencerItem
const model = (over: Partial<ScheduleModel> = {}): ScheduleModel => ({ item: item(), resourceId: 'r', candidateStartMs: 0, originMs: 0, resourceFreeMs: 0, ...over })

describe('FEASIBILITY (degrade form)', () => {
  it('degree 1 when placeJob returned null (infeasible), 0 when it fit', () => {
    const c = placementFeasibilityConstraint()
    expect(c.evaluate(model({ placedFeasible: false })).degree).toBe(1)
    expect(c.evaluate(model({ placedFeasible: true })).degree).toBe(0)
  })

  it('the pipeline degrade form returns the placement UNCHANGED (no veto/reselect)', () => {
    const p = new ConstraintPipeline([], { feasibility: [placementFeasibilityConstraint()] })
    const placed = { startMs: 10, endMs: 20 }
    expect(p.feasibility(placed, () => model({ placedFeasible: true }))).toBe(placed)
    expect(p.feasibility(null, () => model({ placedFeasible: false }))).toBeNull() // the null degrade passes through
  })
})

describe('PRE_GATE · eligibility — consistent with the CANDIDACY eligibility term', () => {
  it('rejects (degree 1) a zero-eligible op, passes (0) with ≥1 eligible — the same predicate as CANDIDACY', () => {
    const c = eligibilityPreGateConstraint()
    expect(c.evaluate(model({ item: item({ eligibleResourceIds: [] }) })).degree).toBe(1)
    expect(c.evaluate(model({ item: item({ eligibleResourceIds: ['r1'] }) })).degree).toBe(0)
    // Same threshold as candidacy.eligibility (length===0 reject vs length>0 pass) → no gap, no overlap:
    // the PRE_GATE aborts the solve first, so the CANDIDACY skip never sees a zero-eligible op.
  })
})
