import { describe, expect, it } from 'vitest'
import { sequence } from './sequencer'
import type { SequencerItem } from './sequencer'

/**
 * S1.2 Commit B — the `toolId`-keyed cross-resource state substrate (busy-interval map + tool-life ledger),
 * proven OFF the demo with SYNTHETIC `toolId`s. No seed op carries a `toolId`, so the guarded update never
 * runs and both maps stay empty (byte-identical — the demo gate proves that). These tests prove the threading
 * itself: unset → empty; set → populated. NO constraint reads these in S1.2 (the D9 single-location + tool-
 * life-cap vetoes are S2/S3); this is state-axis-only.
 */

const item = (over: Partial<SequencerItem>): SequencerItem =>
  ({ demandLineId: 'x', partId: 'p', partNo: 'P', routingOperationId: 'ro', opSeq: 1, changeoverValue: null, qty: 1, setupTime: 0, cycleTime: 1, requiredDate: 0, firmness: 'firm', priorityRank: 2, eligibleResourceIds: ['r1'], ...over }) as SequencerItem

describe('S1.2 toolId-keyed cross-resource state (synthetic tools, off the demo)', () => {
  it('inert: no op carries a toolId → both maps stay empty', () => {
    const res = sequence([item({ demandLineId: 'A' }), item({ demandLineId: 'B', requiredDate: 10 * 3_600_000 })])
    expect(res.toolBusyIntervals.size).toBe(0)
    expect(res.toolLifeUsage.size).toBe(0)
  })

  it('busy-interval map: a tool-using placement records its [start,end] + resource under the toolId', () => {
    const res = sequence([item({ demandLineId: 'A', toolId: 'die-7', cycleTime: 5, qty: 2 })])
    const placed = res.placements[0]!
    expect(res.toolBusyIntervals.get('die-7')).toEqual([{ startMs: placed.plannedStartMs, endMs: placed.plannedEndMs, resourceId: placed.resourceId }])
  })

  it('busy intervals span resources: the SAME tool on two resources accumulates both windows', () => {
    // two independent ops on different resources sharing one tool → two intervals under that toolId
    const A = item({ demandLineId: 'A', toolId: 'die-7', eligibleResourceIds: ['r1'] })
    const B = item({ demandLineId: 'B', toolId: 'die-7', eligibleResourceIds: ['r2'], requiredDate: 10 * 3_600_000 })
    const res = sequence([A, B])
    const intervals = res.toolBusyIntervals.get('die-7')!
    expect(intervals).toHaveLength(2)
    expect(new Set(intervals.map((i) => i.resourceId))).toEqual(new Set(['r1', 'r2']))
  })

  it('tool-life ledger: usage accumulates (default = effective run qty; explicit toolUsage wins)', () => {
    const A = item({ demandLineId: 'A', toolId: 'die-7', qty: 3 }) // default usage = run qty 3
    const B = item({ demandLineId: 'B', toolId: 'die-7', qty: 10, toolUsage: 4, requiredDate: 10 * 3_600_000 }) // explicit 4
    const res = sequence([A, B])
    expect(res.toolLifeUsage.get('die-7')).toBe(7) // 3 + 4
  })

  it('ledger is per-tool: distinct toolIds accumulate independently', () => {
    const A = item({ demandLineId: 'A', toolId: 'die-7', toolUsage: 5 })
    const B = item({ demandLineId: 'B', toolId: 'die-9', toolUsage: 2, requiredDate: 10 * 3_600_000 })
    const res = sequence([A, B])
    expect(res.toolLifeUsage.get('die-7')).toBe(5)
    expect(res.toolLifeUsage.get('die-9')).toBe(2)
  })
})
