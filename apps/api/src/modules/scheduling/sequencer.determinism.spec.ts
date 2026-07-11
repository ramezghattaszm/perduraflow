import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sequence } from './sequencer'
import type { SequencerItem } from './sequencer'

/**
 * Determinism invariants (S1.1 Commit 6) — the four properties the byte-identical extraction rests on, now
 * locked over the registry-routed sequencer as the permanent regression guard S2+ builds on:
 *   1. purity — same inputs → identical output (no Date.now()/Math.random());
 *   2. total-order tie-break — the selection is order-invariant (input order cannot change the plan);
 *   3. stable resource assignment — least-loaded, ties broken by (pre-sorted) id;
 *   4. the SELECTION-scope stateful path — the changeover bonus reads the resource's LIVE `currentAttr`
 *      (mutated after each placement), so "who's next" depends on what was just placed.
 */

const H = 3_600_000
const item = (over: Partial<SequencerItem>): SequencerItem =>
  ({ demandLineId: 'x', partId: 'p', partNo: 'P', routingOperationId: 'ro', opSeq: 1, changeoverValue: null, qty: 1, setupTime: 0, cycleTime: 1, requiredDate: 0, firmness: 'firm', priorityRank: 2, eligibleResourceIds: ['r1'], ...over }) as SequencerItem

// A firm early job (campaign X), a firm mid job (campaign Y), a forecast late job (campaign X). All on r1.
const A = item({ demandLineId: 'A', firmness: 'firm', changeoverValue: 'X', requiredDate: 100 * H })
const B = item({ demandLineId: 'B', firmness: 'forecast', changeoverValue: 'X', requiredDate: 200 * H })
const C = item({ demandLineId: 'C', firmness: 'firm', changeoverValue: 'Y', requiredDate: 180 * H })
const ITEMS = [A, B, C]
const order = (items: SequencerItem[]) => sequence(items).placements.map((p) => p.demandLineId)

describe('sequencer determinism invariants (over the registry)', () => {
  it('1 — purity: two runs of the same inputs produce byte-identical placements', () => {
    expect(sequence(ITEMS).placements).toEqual(sequence(ITEMS).placements)
    // static: the sequencer + constraints carry no wall-clock/random source in CODE (Date is only
    // `new Date(ms)`, arg-based). Strip comment lines first — the docstrings legitimately mention "no
    // Date.now()", which is not a call.
    const code = ['sequencer.ts', 'constraints/pipeline.ts', 'constraints/selection.ts', 'constraints/floor.ts']
      .map((f) => readFileSync(join(__dirname, f), 'utf8'))
      .join('\n')
      .split('\n')
      .filter((l) => {
        const t = l.trim()
        return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*')
      })
      .join('\n')
    expect(code).not.toMatch(/Math\.random\(/)
    expect(code).not.toMatch(/Date\.now\(\)/)
  })

  it('2 — total-order tie-break: selection is order-invariant (reversed input → identical plan)', () => {
    expect(order([...ITEMS].reverse())).toEqual(order(ITEMS))
    // and any permutation agrees — the tie-break (firm→due→priority→partNo→demandLineId) is a strict total order
    expect(order([C, A, B])).toEqual(order(ITEMS))
  })

  it('3 — stable resource assignment: least-loaded, ties broken by (pre-sorted) id', () => {
    const solo = item({ demandLineId: 'S', eligibleResourceIds: ['r1', 'r2'] }) // both idle → tie → lowest id
    expect(sequence([solo]).placements[0]!.resourceId).toBe('r1')
  })

  it('4 — SELECTION stateful path: the changeover bonus reads the live currentAttr, reordering B ahead of C', () => {
    // After A (firm, X) places, r1's currentAttr = 'X'. B (forecast, X) gets the −24h bonus → 200−24=176 <
    // C's 180 (firm, no bonus) → B is selected before C. Without the stateful read it would be A,C,B (EDD).
    expect(order(ITEMS)).toEqual(['A', 'B', 'C'])
  })
})
