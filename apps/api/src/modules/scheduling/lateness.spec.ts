import { describe, expect, it } from 'vitest'
import { buildLatenessChain, buildLatenessChains, MAX_DEPTH, type LatenessLookups, type LatenessOp } from './lateness'

const lk: LatenessLookups = {
  resourceName: (id) => `R:${id}`,
  partNo: (id) => `P:${id}`,
  materialComponent: (id) => (id === 'fg' ? 'PV-22' : null),
}

const op = (over: Partial<LatenessOp> & Pick<LatenessOp, 'demandLineId' | 'opSeq' | 'bindingKind'>): LatenessOp => ({
  resourceId: 'res',
  partId: 'part',
  atRisk: true,
  bindingBlockerDemandLineId: null,
  bindingBlockerOpSeq: null,
  ...over,
})

const index = (ops: LatenessOp[]): Map<string, LatenessOp> =>
  new Map(ops.map((o) => [`${o.demandLineId}:${o.opSeq}`, o]))

describe('lateness causal chain', () => {
  it('traces the full cascade resource → predecessor → material root', () => {
    // DL-2002 op20 held by ST-8830 op20 (resource), which waited on ST-8830 op10 (predecessor),
    // which was material-gated (root). Mirrors the seed's C2×C3 cascade.
    const ops = [
      op({ demandLineId: 'DL-2002', opSeq: 20, resourceId: 'leak', bindingKind: 'resource', bindingBlockerDemandLineId: 'ST-8830', bindingBlockerOpSeq: 20 }),
      op({ demandLineId: 'ST-8830', opSeq: 20, resourceId: 'leak', bindingKind: 'predecessor', bindingBlockerDemandLineId: 'ST-8830', bindingBlockerOpSeq: 10 }),
      op({ demandLineId: 'ST-8830', opSeq: 10, resourceId: 'weld', partId: 'fg', bindingKind: 'material' }),
    ]
    const chain = buildLatenessChain(ops[0]!, index(ops), lk)!
    expect(chain.root).toBe('material')
    expect(chain.truncated).toBe(false)
    expect(chain.hops.map((h) => `${h.demandLineId}:${h.opSeq}:${h.kind}`)).toEqual([
      'DL-2002:20:resource',
      'ST-8830:20:predecessor',
      'ST-8830:10:material',
    ])
    expect(chain.hops.at(-1)!.detail).toBe('PV-22') // the gating component, resolved
  })

  it('a due-before-shift order is its own root (no spurious chain)', () => {
    const ops = [op({ demandLineId: 'DL-1006', opSeq: 10, bindingKind: 'release', atRisk: true })]
    const chain = buildLatenessChain(ops[0]!, index(ops), lk)!
    expect(chain.root).toBe('due_before_start')
    expect(chain.hops).toHaveLength(1)
    expect(chain.hops[0]!.kind).toBe('due_before_start')
  })

  it('a resource chain bottoming out at on-time firm work roots at capacity', () => {
    const ops = [
      op({ demandLineId: 'L1', opSeq: 10, bindingKind: 'resource', bindingBlockerDemandLineId: 'L2', bindingBlockerOpSeq: 10 }),
      op({ demandLineId: 'L2', opSeq: 10, bindingKind: 'release', atRisk: false }), // on-time blocker
    ]
    const chain = buildLatenessChain(ops[0]!, index(ops), lk)!
    expect(chain.root).toBe('capacity')
    expect(chain.hops.map((h) => h.kind)).toEqual(['resource', 'capacity'])
  })

  it('working-window root', () => {
    const chain = buildLatenessChain(op({ demandLineId: 'X', opSeq: 10, bindingKind: 'working_window' }), index([]), lk)!
    expect(chain.root).toBe('working_window')
  })

  it('cycle guard: a circular contention terminates, flagged truncated', () => {
    const ops = [
      op({ demandLineId: 'A', opSeq: 10, bindingKind: 'resource', bindingBlockerDemandLineId: 'B', bindingBlockerOpSeq: 10 }),
      op({ demandLineId: 'B', opSeq: 10, bindingKind: 'resource', bindingBlockerDemandLineId: 'A', bindingBlockerOpSeq: 10 }),
    ]
    const chain = buildLatenessChain(ops[0]!, index(ops), lk)!
    expect(chain.truncated).toBe(true)
    expect(chain.hops.length).toBeLessThanOrEqual(2) // A, B, then revisit-A stops
  })

  it('depth cap: an over-long chain truncates at MAX_DEPTH', () => {
    // A linear resource chain longer than MAX_DEPTH (each hop points to the next, all distinct).
    const n = MAX_DEPTH + 5
    const ops: LatenessOp[] = []
    for (let i = 0; i < n; i++) {
      const isLast = i === n - 1
      ops.push(
        op({
          demandLineId: `L${i}`,
          opSeq: 10,
          bindingKind: isLast ? 'release' : 'resource',
          atRisk: isLast ? false : true,
          bindingBlockerDemandLineId: isLast ? null : `L${i + 1}`,
          bindingBlockerOpSeq: isLast ? null : 10,
        }),
      )
    }
    const chain = buildLatenessChain(ops[0]!, index(ops), lk)!
    expect(chain.truncated).toBe(true)
    expect(chain.hops.length).toBe(MAX_DEPTH)
  })

  it('missing blocker does not fabricate — roots at capacity, truncated', () => {
    const ops = [op({ demandLineId: 'A', opSeq: 10, bindingKind: 'resource', bindingBlockerDemandLineId: 'GONE', bindingBlockerOpSeq: 99 })]
    const chain = buildLatenessChain(ops[0]!, index(ops), lk)!
    expect(chain.root).toBe('capacity')
    expect(chain.truncated).toBe(true)
    expect(chain.hops).toHaveLength(1)
  })

  it('null binding → no chain', () => {
    expect(buildLatenessChain(op({ demandLineId: 'A', opSeq: 10, bindingKind: null }), index([]), lk)).toBeNull()
  })

  it('deterministic: identical inputs → identical chain', () => {
    const ops = [
      op({ demandLineId: 'DL-2002', opSeq: 20, bindingKind: 'resource', bindingBlockerDemandLineId: 'ST-8830', bindingBlockerOpSeq: 20 }),
      op({ demandLineId: 'ST-8830', opSeq: 20, bindingKind: 'predecessor', bindingBlockerDemandLineId: 'ST-8830', bindingBlockerOpSeq: 10 }),
      op({ demandLineId: 'ST-8830', opSeq: 10, partId: 'fg', bindingKind: 'material' }),
    ]
    const a = buildLatenessChain(ops[0]!, index(ops), lk)
    const b = buildLatenessChain(ops[0]!, index(ops), lk)
    expect(a).toEqual(b)
  })

  it('buildLatenessChains keys only at-risk ops', () => {
    const ops = [
      op({ demandLineId: 'late', opSeq: 10, bindingKind: 'release', atRisk: true }),
      op({ demandLineId: 'ontime', opSeq: 10, bindingKind: 'release', atRisk: false }),
    ]
    const map = buildLatenessChains(ops, lk)
    expect([...map.keys()]).toEqual(['late:10'])
  })
})
