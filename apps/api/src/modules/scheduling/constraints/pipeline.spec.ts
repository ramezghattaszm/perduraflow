import { describe, expect, it } from 'vitest'
import { ConstraintPipeline } from './pipeline'
import type { SequencerItem } from '../sequencer'

/**
 * Two-tier constraint pipeline — S1.1 Commit 1 (WRAPPING). The load-bearing property: an EMPTY pipeline
 * (no registered constraints) is a pure PASS-THROUGH — every tier/phase returns the inline-delegated value
 * unchanged, so routing the placement loop through the registry is byte-identical. Mechanisms move in one at
 * a time (Commits 2–5); this locks the wrapping so a regression there is caught here, not only in the plan diff.
 */

const item = (id: string): SequencerItem =>
  ({ demandLineId: id, partId: 'p', partNo: 'P', routingOperationId: 'ro', opSeq: 1, changeoverValue: null, qty: 1, setupTime: 0, cycleTime: 1, requiredDate: 0, firmness: 'firm', priorityRank: 2, eligibleResourceIds: ['r'] }) as SequencerItem

describe('ConstraintPipeline — empty pipeline is a pass-through (S1.1 Commit 1)', () => {
  const p = new ConstraintPipeline()

  it('ORDERING · order(items) returns the items unchanged (same order, same reference identity)', () => {
    const items = [item('a'), item('b'), item('c')]
    const ordered = p.order(items)
    expect(ordered).toBe(items) // identity — no copy, no reorder
  })

  it('PLACEMENT · candidacy with no registered constraint → a candidate (true)', () => {
    // Readiness/eligibility are registered CANDIDACY constraints (Commit 3); an empty pipeline defaults to
    // "candidate". The skip decision is entirely data-described — see candidacy.spec.
    expect(p.candidacy()).toBe(true)
  })

  it('PLACEMENT · floor returns the inline floor ms verbatim', () => {
    expect(p.floor(1_712_000_000_000)).toBe(1_712_000_000_000)
    expect(p.floor(0)).toBe(0)
  })

  it('PLACEMENT · feasibility returns the placeJob result verbatim (object identity preserved)', () => {
    const placed = { startMs: 10, endMs: 20 }
    expect(p.feasibility(placed)).toBe(placed)
    expect(p.feasibility(null)).toBeNull() // the no-fit degrade case, unchanged
  })
})
