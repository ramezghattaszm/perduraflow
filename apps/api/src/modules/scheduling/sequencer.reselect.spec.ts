import { describe, expect, it } from 'vitest'
import { sequence } from './sequencer'
import type { SequencerItem } from './sequencer'
import { VOCABULARY_VERSION, type Constraint } from './constraints/types'

/**
 * S1.2 Commit A — the veto-and-reselect primitive, proven OFF the demo with SYNTHETIC vetoes injected through
 * the test-only `vetoConstraints` seam (no veto is registered in the production solve — that is D28/D9/JIS,
 * S2/S3). These tests exercise the new control-flow paths that stay DEAD while inert: resource-retry (both
 * veto points), defer-to-next-candidate, and the termination backstop. The byte-identical demo gate
 * (`plan:baseline`) proves the inert path; this proves the primitive's determinism where the demo can't.
 */

const item = (over: Partial<SequencerItem>): SequencerItem =>
  ({ demandLineId: 'x', partId: 'p', partNo: 'P', routingOperationId: 'ro', opSeq: 1, changeoverValue: null, qty: 1, setupTime: 0, cycleTime: 1, requiredDate: 0, firmness: 'firm', priorityRank: 2, eligibleResourceIds: ['r1'], ...over }) as SequencerItem

/** A pre-place (resource-aware CANDIDACY) veto: rejects `(op, resource)` when the assigned resource matches. */
const vetoResource = (resId: string): Constraint => ({
  id: 'test.veto.preplace.resource',
  scope: 'PLACEMENT',
  mechanism: 'CANDIDACY',
  vocabularyVersion: VOCABULARY_VERSION,
  evaluate: (m) => ({ degree: m.resourceId === resId ? 1 : 0 }),
})

/** A post-place FEASIBILITY reject-form veto: rejects the placement when it landed on the given resource. */
const rejectResource = (resId: string): Constraint => ({
  id: 'test.veto.postplace.resource',
  scope: 'PLACEMENT',
  mechanism: 'FEASIBILITY',
  vocabularyVersion: VOCABULARY_VERSION,
  evaluate: (m) => ({ degree: m.resourceId === resId ? 1 : 0 }),
})

/** A stateful pre-place veto: op `dlid` may not be the FIRST op on its resource (vetoes while currentAttr null). */
const vetoAsFirstOp = (dlid: string): Constraint => ({
  id: 'test.veto.preplace.notfirst',
  scope: 'PLACEMENT',
  mechanism: 'CANDIDACY',
  vocabularyVersion: VOCABULARY_VERSION,
  evaluate: (m) => ({ degree: m.item.demandLineId === dlid && (m.currentAttr === null || m.currentAttr === undefined) ? 1 : 0 }),
})

/** An unconditional pre-place veto on op `dlid` — it can never be placed by reselect (forces the backstop). */
const vetoAlways = (dlid: string): Constraint => ({
  id: 'test.veto.preplace.always',
  scope: 'PLACEMENT',
  mechanism: 'CANDIDACY',
  vocabularyVersion: VOCABULARY_VERSION,
  evaluate: (m) => ({ degree: m.item.demandLineId === dlid ? 1 : 0 }),
})

const seq = (items: SequencerItem[], veto?: { preplaceVeto?: Constraint[]; feasibilityReject?: Constraint[] }) =>
  sequence(items, undefined, undefined, undefined, undefined, undefined, undefined, veto)

describe('S1.2 veto-and-reselect primitive (synthetic vetoes, off the demo)', () => {
  it('inert single-pass: no veto → places on assignResource’s pick (least-loaded, first-seen tie)', () => {
    // Two idle resources; assignResource keeps the first-seen on the tie (r1). orderedResources[0] must agree,
    // so the reselect loop takes r1 on its first (only) pass — the equivalence the byte-identical gate rests on.
    const it = item({ demandLineId: 'A', eligibleResourceIds: ['r1', 'r2'] })
    expect(seq([it]).placements[0]!.resourceId).toBe('r1')
    // and passing an empty veto object changes nothing (dead branch)
    expect(seq([it], {}).placements[0]!.resourceId).toBe('r1')
  })

  it('resource-retry (pre-place veto): (op, r1) vetoed → op reselects onto the next resource r2', () => {
    const it = item({ demandLineId: 'A', eligibleResourceIds: ['r1', 'r2'] })
    const res = seq([it], { preplaceVeto: [vetoResource('r1')] })
    expect(res.placements.map((p) => p.resourceId)).toEqual(['r2'])
    expect(res.allVetoedDispositions).toEqual([]) // reselect succeeded → no backstop
  })

  it('resource-retry (post-place reject): placement on r1 rejected → reselects onto r2', () => {
    const it = item({ demandLineId: 'A', eligibleResourceIds: ['r1', 'r2'] })
    const res = seq([it], { feasibilityReject: [rejectResource('r1')] })
    expect(res.placements.map((p) => p.resourceId)).toEqual(['r2'])
    expect(res.allVetoedDispositions).toEqual([])
  })

  it('reselection order is deterministic: retries by (freeMs asc, then id)', () => {
    // r1 pre-loaded busier than r2 via a prior firm op on r1-only, so orderedResources for the two-way op is
    // [r2, r1] (r2 least-loaded). Veto r2 → it must fall to r1 (the next in the deterministic order).
    const filler = item({ demandLineId: 'F', eligibleResourceIds: ['r1'], cycleTime: 100, requiredDate: 0 })
    const two = item({ demandLineId: 'A', eligibleResourceIds: ['r1', 'r2'], requiredDate: 10 * 3_600_000 })
    const res = seq([filler, two], { preplaceVeto: [vetoResource('r2')] })
    const a = res.placements.find((p) => p.demandLineId === 'A')!
    expect(a.resourceId).toBe('r1')
  })

  it('defer-to-next-candidate then later success (no backstop): the total-order-best defers, a different op goes first', () => {
    // A (firm, early) is the total-order-best but may not be the FIRST op on r1 (stateful veto); B (forecast)
    // may. So B places first, sets r1.currentAttr, and A — no longer first — places second. No backstop fires.
    const A = item({ demandLineId: 'A', firmness: 'firm', requiredDate: 10 * 3_600_000, changeoverValue: 'X', eligibleResourceIds: ['r1'] })
    const B = item({ demandLineId: 'B', firmness: 'forecast', requiredDate: 500 * 3_600_000, changeoverValue: 'Y', eligibleResourceIds: ['r1'] })
    const res = seq([A, B], { preplaceVeto: [vetoAsFirstOp('A')] })
    expect(res.placements.map((p) => p.demandLineId)).toEqual(['B', 'A'])
    expect(res.allVetoedDispositions).toEqual([]) // A eventually placed via reselect, not the backstop
  })

  it('without the veto the same fixture places the firm op first (proves the veto caused the reorder)', () => {
    const A = item({ demandLineId: 'A', firmness: 'firm', requiredDate: 10 * 3_600_000, changeoverValue: 'X', eligibleResourceIds: ['r1'] })
    const B = item({ demandLineId: 'B', firmness: 'forecast', requiredDate: 500 * 3_600_000, changeoverValue: 'Y', eligibleResourceIds: ['r1'] })
    expect(seq([A, B]).placements.map((p) => p.demandLineId)).toEqual(['A', 'B'])
  })

  it('termination backstop: an op vetoed on every eligible resource is force-placed + logged all_vetoed', () => {
    const A = item({ demandLineId: 'A', eligibleResourceIds: ['r1'] })
    const res = seq([A], { preplaceVeto: [vetoAlways('A')] })
    // the backstop guarantees termination: A is still placed (degraded), and the disposition is recorded
    expect(res.placements.map((p) => p.demandLineId)).toEqual(['A'])
    expect(res.allVetoedDispositions).toEqual([{ demandLineId: 'A', opSeq: 1 }])
  })

  it('backstop is deterministic: the total-order-best is the one force-placed', () => {
    // Both always-vetoed on their shared resource → both hit the backstop; the tieBreakLess-min (firm A) is
    // force-placed first, then B. Deterministic regardless of input order.
    const A = item({ demandLineId: 'A', firmness: 'firm', requiredDate: 10 * 3_600_000, eligibleResourceIds: ['r1'] })
    const B = item({ demandLineId: 'B', firmness: 'firm', requiredDate: 500 * 3_600_000, eligibleResourceIds: ['r1'] })
    const res = seq([B, A], { preplaceVeto: [vetoAlways('A'), vetoAlways('B')] })
    expect(res.placements.map((p) => p.demandLineId)).toEqual(['A', 'B'])
    expect(res.allVetoedDispositions).toEqual([
      { demandLineId: 'A', opSeq: 1 },
      { demandLineId: 'B', opSeq: 1 },
    ])
  })
})
