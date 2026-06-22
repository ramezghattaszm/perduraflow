import { describe, expect, it } from 'vitest'
import { renderGoalSeek } from './conversation.service'
import type { GoalSeekResult } from './whatif.service'

const base = (over: Partial<GoalSeekResult>): GoalSeekResult => ({
  outcome: 'unachievable',
  resourceName: 'Press Line A',
  hours: null,
  resultId: null,
  baseFirmLateOnResource: 1,
  ceilingHours: 4,
  ...over,
})

/**
 * The goal-seek echo is the grounding-by-render mechanism: a suggested value is shown from the
 * engine's finding (renderGoalSeek), never the model's prose. The predicate is RESOURCE-SCOPED —
 * OT on R is judged against R's own firm-late work — so these lock all four outcomes, including the
 * "binding constraint is elsewhere" answer (more useful than a bare "not achievable").
 */
describe('renderGoalSeek — grounded, resource-scoped value echo', () => {
  it('achieved: the minimal OT that clears the resource’s own firm at-risk', () => {
    expect(renderGoalSeek(base({ outcome: 'achieved', hours: 3, resultId: 'wir-1' }))).toBe(
      '**Found:** 3h overtime on Press Line A clears its firm at-risk — the minimum that does.',
    )
  })

  it('already_clear: nothing at risk anywhere', () => {
    expect(renderGoalSeek(base({ outcome: 'already_clear', hours: 0, baseFirmLateOnResource: 0 }))).toBe(
      '**Already clear:** no firm orders are at risk — no overtime needed.',
    )
  })

  it('elsewhere: names where the binding work is (OT on R can’t touch it)', () => {
    const echo = renderGoalSeek(base({ outcome: 'elsewhere', baseFirmLateOnResource: 0, elsewhereResources: ['Press Line B'], reason: 'no firm at-risk runs on Press Line A; the late firm work is on Press Line B' }))
    expect(echo).toBe("**Overtime on Press Line A won't help:** no firm at-risk runs on Press Line A; the late firm work is on Press Line B.")
  })

  it('unachievable: honest reason, never a fabricated out-of-bounds value', () => {
    const echo = renderGoalSeek(base({ outcome: 'unachievable', reason: 'the firm at-risk on Press Line A is gated by material availability, not capacity — overtime can\'t clear it' }))
    expect(echo).toContain('**Not achievable:**')
    expect(echo).toContain('gated by material availability')
    expect(echo).not.toMatch(/\d{2,}h/)
  })
})
