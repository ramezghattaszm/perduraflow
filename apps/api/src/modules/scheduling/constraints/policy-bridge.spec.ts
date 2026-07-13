import { describe, expect, it } from 'vitest'
import { asVeto, ConstraintPolicyResolution, deriveEnforcedHardKeys, deriveVetoConstraints, softFactor, type PolicyGovernedConstraint } from './policy-bridge'
import type { Constraint, ScheduleModel } from './types'
import { scorePlan } from '../whatif.scoring'
import type { Placement } from '../sequencer'

/**
 * S1.3 Commit 3 — the mode→behavior bridge, proven OFF the demo with SYNTHETIC modes + governed constraints
 * (nothing is registered in production — that is D28/D9/JIS, S2/S3). Exercises the live paths that stay DEAD
 * while inert: hard → veto, hard-with-slack → threshold veto, soft → factor (+ honest binding). The runtime
 * inertness of the empty registry is locked separately in inert-honesty.guard.spec.ts.
 */

const model = (over: Partial<ScheduleModel> & { resourceId: string }): ScheduleModel =>
  ({ item: { qty: 1, changeoverValue: null } as never, candidateStartMs: 0, originMs: 0, resourceFreeMs: 0, ...over }) as ScheduleModel

// A synthetic governed constraint: violated (degree = the model item's qty) — lets us drive the threshold.
const qtyConstraint = (mechanism: Constraint['mechanism']): Constraint => ({
  id: 'synthetic.qty',
  scope: 'PLACEMENT',
  mechanism,
  vocabularyVersion: '1.0.0',
  evaluate: (m) => ({ degree: (m.item as { qty: number }).qty }),
})
const governed = (mechanism: Constraint['mechanism'] = 'CANDIDACY'): PolicyGovernedConstraint => ({ constraintId: 'synthetic.qty', constraint: qtyConstraint(mechanism) })

const resolutionWith = (mode: 'hard' | 'soft' | 'hard-with-slack', threshold: number | null = null) =>
  new ConstraintPolicyResolution(
    new Map([['LINE-1', { modes: { 'synthetic.qty': { mode, threshold } } }]]),
    new Map([['R1', 'LINE-1'], ['R2', 'LINE-2']]), // R2's line has no policy → ungoverned
  )

describe('S1.3 mode→behavior bridge (synthetic modes, off the demo)', () => {
  it('hard → the veto fires on a violation, reading the mode by the placed resource line', () => {
    const veto = asVeto(governed(), resolutionWith('hard'))
    expect(veto.evaluate(model({ resourceId: 'R1', item: { qty: 3 } as never })).degree).toBe(1) // violated + hard → veto
    expect(veto.evaluate(model({ resourceId: 'R1', item: { qty: 0 } as never })).degree).toBe(0) // no violation → no veto
    expect(veto.evaluate(model({ resourceId: 'R2', item: { qty: 3 } as never })).degree).toBe(0) // R2 line ungoverned → no veto
  })

  it('hard-with-slack → the veto fires only PAST the resolved threshold', () => {
    const veto = asVeto(governed(), resolutionWith('hard-with-slack', 2))
    expect(veto.evaluate(model({ resourceId: 'R1', item: { qty: 3 } as never })).degree).toBe(1) // 3 > 2 → veto
    expect(veto.evaluate(model({ resourceId: 'R1', item: { qty: 2 } as never })).degree).toBe(0) // 2 > 2 false → no veto
  })

  it('soft → the veto is inert (a soft violation is a factor, not a veto)', () => {
    const veto = asVeto(governed(), resolutionWith('soft'))
    expect(veto.evaluate(model({ resourceId: 'R1', item: { qty: 9 } as never })).degree).toBe(0)
  })

  it('deriveVetoConstraints routes by mechanism (CANDIDACY → pre-place, FEASIBILITY → post-place)', () => {
    const pre = deriveVetoConstraints([governed('CANDIDACY')], resolutionWith('hard'))
    expect(pre.preplaceVeto).toHaveLength(1)
    expect(pre.feasibilityReject).toHaveLength(0)
    const post = deriveVetoConstraints([governed('FEASIBILITY')], resolutionWith('hard'))
    expect(post.feasibilityReject).toHaveLength(1)
    expect(post.preplaceVeto).toHaveLength(0)
  })

  it('deriveEnforcedHardKeys is empty unless the config registry marks the constraint hard', () => {
    // CONSTRAINT_POLICIES is empty in S1.3, so even a governed constraint yields no enforced-hard keys.
    expect([...deriveEnforcedHardKeys([governed()], resolutionWith('hard'))]).toEqual([])
  })

  it('soft → softFactor builds an objective factor that scorePlan appends AFTER the six + folds into the score', () => {
    const f = softFactor('synthetic.qty', '', 5, 2, 'whatif.factor.synthetic', { count: 5 })
    expect(f).toMatchObject({ key: 'synthetic.qty', rawValue: 5, weight: 2, contribution: 10, direction: 'worsens' })
    const pl: Placement = { demandLineId: 'D', partId: 'p', routingOperationId: 'ro', resourceId: 'R1', opSeq: 1, sequencePosition: 1, plannedStartMs: 0, plannedEndMs: 10, qty: 1, setupTime: 0, cycleTime: 1, setupSource: 'standard', cycleSource: 'standard', setupConfidence: null, cycleConfidence: null, atRisk: false, atRiskReason: null, placedFeasible: true, bindingKind: 'origin', bindingBlockerDemandLineId: null, bindingBlockerOpSeq: null, bindingDowntimeId: null, bindingOperatorId: null, operatorLaborRate: null, requiredDateMs: 1000, firmness: 'firm', changeoverValue: null }
    const base = scorePlan([pl], { rateByResource: new Map(), basePlacements: [pl], overtimeHours: 0 })
    const withSoft = scorePlan([pl], { rateByResource: new Map(), basePlacements: [pl], overtimeHours: 0, softFactors: [f] })
    expect(withSoft.factors).toHaveLength(base.factors.length + 1)
    expect(withSoft.factors[withSoft.factors.length - 1]!.key).toBe('synthetic.qty') // appended AFTER the six
    expect(withSoft.score).toBe(Number((base.score + 10).toFixed(4)))
  })

  it('honest binding → feasibility ConstraintBinding.binding reflects hardBoundKeys (false when empty)', () => {
    const pl: Placement = { demandLineId: 'D', partId: 'p', routingOperationId: 'ro', resourceId: 'R1', opSeq: 1, sequencePosition: 1, plannedStartMs: 0, plannedEndMs: 10, qty: 1, setupTime: 0, cycleTime: 1, setupSource: 'standard', cycleSource: 'standard', setupConfidence: null, cycleConfidence: null, atRisk: false, atRiskReason: null, placedFeasible: true, bindingKind: 'origin', bindingBlockerDemandLineId: null, bindingBlockerOpSeq: null, bindingDowntimeId: null, bindingOperatorId: null, operatorLaborRate: null, requiredDateMs: 1000, firmness: 'firm', changeoverValue: null }
    const ctx = { rateByResource: new Map(), basePlacements: [pl], overtimeHours: 0 }
    const feasOf = (r: ReturnType<typeof scorePlan>) => r.constraints.find((c) => c.key === 'feasibility')!.binding
    expect(feasOf(scorePlan([pl], ctx))).toBe(false) // inert default
    expect(feasOf(scorePlan([pl], { ...ctx, hardBoundKeys: new Set(['feasibility']) }))).toBe(true) // enforced → honest
  })
})
