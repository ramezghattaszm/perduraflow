import { describe, expect, it } from 'vitest'
import { materialFloorConstraint, minBatchFloorConstraint, precedenceFloorConstraint, releaseFloorConstraint } from './floor'
import { ConstraintPipeline } from './pipeline'
import type { ScheduleModel } from './types'
import type { SequencerItem } from '../sequencer'

/**
 * FLOOR mechanism (S1.1 Commit 2). Locks that each FLOOR constraint contributes the SAME value the inline
 * sequencer computed, and that the pipeline folds them with `Math.max` — the exact composition the loop had
 * inline (`Math.max(prevFree, origin, earliest, predEnd, release)` for start; `max(qty, minBatch)` for qty).
 */

const item = (over: Partial<SequencerItem> = {}): SequencerItem =>
  ({ demandLineId: 'd', partId: 'p', partNo: 'P', routingOperationId: 'ro', opSeq: 1, changeoverValue: null, qty: 40, setupTime: 0, cycleTime: 1, requiredDate: 0, firmness: 'firm', priorityRank: 2, eligibleResourceIds: ['r'], ...over }) as SequencerItem

const model = (it: SequencerItem, resourceId = 'r'): ScheduleModel =>
  ({ item: it, resourceId, candidateStartMs: 0, originMs: 0, resourceFreeMs: 0 })

describe('FLOOR constraints — same arithmetic, contribution shape', () => {
  it('material contributes item.earliestStartMs (0 when absent)', () => {
    expect(materialFloorConstraint().evaluate(model(item({ earliestStartMs: 500 }))).contribution).toBe(500)
    expect(materialFloorConstraint().evaluate(model(item())).contribution).toBe(0)
  })
  it('release contributes item.releaseFloorMs (0 when absent)', () => {
    expect(releaseFloorConstraint().evaluate(model(item({ releaseFloorMs: 700 }))).contribution).toBe(700)
    expect(releaseFloorConstraint().evaluate(model(item())).contribution).toBe(0)
  })
  it('precedence INVOKES the reused predecessorEnd closure verbatim', () => {
    const sit = item()
    const predecessorEnd = (x: SequencerItem) => (x === sit ? 900 : -1) // asserts the same item is passed through
    expect(precedenceFloorConstraint(predecessorEnd).evaluate(model(sit)).contribution).toBe(900)
  })
  it('min-batch contributes minBatchByResource.get(resourceId) (0 when absent)', () => {
    const map = new Map([['r', 100]])
    expect(minBatchFloorConstraint(map).evaluate(model(item(), 'r')).contribution).toBe(100)
    expect(minBatchFloorConstraint(map).evaluate(model(item(), 'other')).contribution).toBe(0)
  })
})

describe('pipeline folds FLOOR contributions with Math.max (byte-identical composition)', () => {
  const sit = item({ earliestStartMs: 500, releaseFloorMs: 700 })
  const predecessorEnd = () => 900
  const p = new ConstraintPipeline([], {
    floor: [materialFloorConstraint(), releaseFloorConstraint(), precedenceFloorConstraint(predecessorEnd)],
    quantityFloor: [minBatchFloorConstraint(new Map([['r', 100]]))],
  })

  it('floor tier = max(baseFloor, material, release, precedence)', () => {
    // base 300 → max(300, 500, 700, 900) = 900, exactly Math.max(prevFree,origin,earliest,predEnd,release)
    expect(p.floor(300, () => model(sit))).toBe(900)
    expect(p.floor(1000, () => model(sit))).toBe(1000) // a higher base (resource free) still dominates
  })

  it('quantity tier = max(demandQty, minBatch)', () => {
    expect(p.quantityFloor(40, () => model(sit, 'r'))).toBe(100) // min-batch binds
    expect(p.quantityFloor(250, () => model(sit, 'r'))).toBe(250) // demand above min-batch
    expect(p.quantityFloor(40, () => model(sit, 'other'))).toBe(40) // no min-batch for this resource
  })
})
