import { describe, expect, it } from 'vitest'
import { eligibilityCandidacyConstraint, readinessCandidacyConstraint } from './candidacy'
import { ConstraintPipeline } from './pipeline'
import type { ScheduleModel } from './types'
import type { SequencerItem } from '../sequencer'

/**
 * CANDIDACY mechanism (S1.1 Commit 3). Locks that readiness INVOKES the reused `isReady` closure and
 * eligibility reads `item.eligibleResourceIds.length` — and that the pipeline's candidacy decision equals
 * the prior inline `isReady(item)` (since eligibility is always satisfied for ops reaching the sequencer).
 */

const item = (over: Partial<SequencerItem> = {}): SequencerItem =>
  ({ demandLineId: 'd', partId: 'p', partNo: 'P', routingOperationId: 'ro', opSeq: 1, changeoverValue: null, qty: 1, setupTime: 0, cycleTime: 1, requiredDate: 0, firmness: 'firm', priorityRank: 2, eligibleResourceIds: ['r'], ...over }) as SequencerItem

const model = (it: SequencerItem): ScheduleModel => ({ item: it, resourceId: '', candidateStartMs: 0, originMs: 0, resourceFreeMs: 0 })

describe('CANDIDACY constraints', () => {
  it('readiness INVOKES the reused isReady closure (degree 0 when ready, 1 when not)', () => {
    const ready = item()
    const isReady = (x: SequencerItem) => x === ready // asserts the same item flows through
    const c = readinessCandidacyConstraint(isReady)
    expect(c.evaluate(model(ready)).degree).toBe(0) // ready → candidate
    expect(c.evaluate(model(item())).degree).toBe(1) // a different item → not ready → skip
  })

  it('eligibility is satisfied with ≥1 eligible resource, violated with zero', () => {
    const c = eligibilityCandidacyConstraint()
    expect(c.evaluate(model(item({ eligibleResourceIds: ['r1', 'r2'] }))).degree).toBe(0)
    expect(c.evaluate(model(item({ eligibleResourceIds: [] }))).degree).toBe(1)
  })
})

describe('pipeline candidacy decision === the prior inline isReady (eligibility always satisfied)', () => {
  const built = item() // eligible by default (['r'])
  const isReadyTrue = () => true
  const isReadyFalse = () => false

  it('ready + eligible → candidate (true)', () => {
    const p = new ConstraintPipeline([], { candidacy: [readinessCandidacyConstraint(isReadyTrue), eligibilityCandidacyConstraint()] })
    expect(p.candidacy(() => model(built))).toBe(true)
  })
  it('not ready → skip (false) — matches the prior !isReady(item) continue', () => {
    const p = new ConstraintPipeline([], { candidacy: [readinessCandidacyConstraint(isReadyFalse), eligibilityCandidacyConstraint()] })
    expect(p.candidacy(() => model(built))).toBe(false)
  })
  it('ready but zero-eligible → skip (false) — the not-eligible branch (inert on the demo)', () => {
    const p = new ConstraintPipeline([], { candidacy: [readinessCandidacyConstraint(isReadyTrue), eligibilityCandidacyConstraint()] })
    expect(p.candidacy(() => model(item({ eligibleResourceIds: [] })))).toBe(false)
  })
})
