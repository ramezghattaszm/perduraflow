import { describe, expect, it } from 'vitest'
import { changeoverSelectionConstraint, eddBaseSelectionConstraint, expediteSelectionConstraint, notReadySelectionConstraint } from './selection'
import { ConstraintPipeline } from './pipeline'
import { CHANGEOVER_BONUS_HOURS, EXPEDITE_BONUS_HOURS, MS_PER_HOUR, READY_DEFER_HOURS } from '../sequencer'
import type { ScheduleModel } from './types'
import type { SequencePolicy, SequencerItem } from '../sequencer'

/**
 * SELECTION mechanism (S1.1 Commit 4). Locks that the registered SELECTION constraints, summed by the
 * pipeline in registration order, reproduce the inline composite score
 * `(requiredDate − origin)/MS_PER_HOUR − bonus − expedite + notReady` **bit-for-bit** — and that changeover
 * is a stateful rank term reading the live `currentAttr` (never a placement cost).
 */

const item = (over: Partial<SequencerItem> = {}): SequencerItem =>
  ({ demandLineId: 'd', partId: 'p', partNo: 'P', routingOperationId: 'ro', opSeq: 1, changeoverValue: 'Black', qty: 1, setupTime: 0, cycleTime: 1, requiredDate: 0, firmness: 'firm', priorityRank: 2, eligibleResourceIds: ['r'], ...over }) as SequencerItem
const model = (over: Partial<ScheduleModel> = {}): ScheduleModel => ({ item: item(), resourceId: 'r', candidateStartMs: 0, originMs: 0, resourceFreeMs: 0, currentAttr: null, ...over })

// The reference: exactly the old inline formula (sequencer.ts, pre-Commit-4).
const inlineRank = (m: ScheduleModel, policy?: SequencePolicy): number => {
  const sameAttr = m.currentAttr != null && m.item.changeoverValue !== null && m.currentAttr === m.item.changeoverValue
  const allowBonus = m.item.firmness === 'forecast' || policy?.changeoverBonusAllFirmness === true
  const bonus = allowBonus && sameAttr ? CHANGEOVER_BONUS_HOURS : 0
  const expedite = policy?.expediteDemandLineIds?.has(m.item.demandLineId) ? EXPEDITE_BONUS_HOURS : 0
  const notReady = policy?.readyFirst === true && (m.item.earliestStartMs ?? 0) > m.resourceFreeMs ? READY_DEFER_HOURS : 0
  return (m.item.requiredDate - m.originMs) / MS_PER_HOUR - bonus - expedite + notReady
}

const pipe = (policy?: SequencePolicy) =>
  new ConstraintPipeline([], {}, [eddBaseSelectionConstraint(), changeoverSelectionConstraint(policy), expediteSelectionConstraint(policy), notReadySelectionConstraint(policy)])

describe('SELECTION composite score === the prior inline rank (bit-for-bit)', () => {
  it('EDD base only (firm, no bonus/expedite/notReady) — solve() default', () => {
    const m = model({ item: item({ requiredDate: 5 * MS_PER_HOUR }), originMs: 0 })
    expect(pipe().selectionScore(m)).toBe(inlineRank(m)) // 5
  })

  it('changeover bonus fires (forecast + sameAttr on live currentAttr) — the stateful term', () => {
    const m = model({ item: item({ firmness: 'forecast', changeoverValue: 'Black', requiredDate: 30 * MS_PER_HOUR }), currentAttr: 'Black' })
    // 30 − 24 = 6, identical to inline
    expect(pipe().selectionScore(m)).toBe(inlineRank(m))
    expect(pipe().selectionScore(m)).toBe(6)
  })

  it('no bonus when attr differs, or firm, or currentAttr null', () => {
    const diff = model({ item: item({ firmness: 'forecast', changeoverValue: 'Black' }), currentAttr: 'White', originMs: 0 })
    expect(pipe().selectionScore(diff)).toBe(inlineRank(diff))
    const firm = model({ item: item({ firmness: 'firm', changeoverValue: 'Black' }), currentAttr: 'Black' })
    expect(pipe().selectionScore(firm)).toBe(inlineRank(firm))
    const noAttr = model({ item: item({ firmness: 'forecast', changeoverValue: 'Black' }), currentAttr: null })
    expect(pipe().selectionScore(noAttr)).toBe(inlineRank(noAttr))
  })

  it('expedite + notReady policy levers (what-if) fold identically', () => {
    const policy: SequencePolicy = { expediteDemandLineIds: new Set(['d']), readyFirst: true }
    const m = model({ item: item({ requiredDate: 10 * MS_PER_HOUR, earliestStartMs: 999 }), resourceFreeMs: 0, originMs: 0 })
    expect(pipe(policy).selectionScore(m)).toBe(inlineRank(m, policy))
  })
})
