import { describe, expect, it } from 'vitest'
import { MasterDataResolver } from './master-data.resolver'

/**
 * BOM explosion + where-used (Layer 2 §4a.2, D-L2-1) — unit level, repo mocked. Proves multi-level
 * topology with derived levels, per-LEVEL as-of resolution (reconstruction works through the tree, not
 * just the root), where-used up-traversal, cycle-safety (a planted cycle terminates as a structured
 * finding, never a hang), and that drafts are excluded at every level (a draft-only part resolves to
 * nothing → a leaf). Topology only — no quantities asserted.
 */

/** Build a resolver over a controlled BOM graph: `resolveAt(partNo, asOf) → bomId | undefined`, `edges[bomId] → components`. */
function resolver(cfg: {
  resolveAt: (partNo: string, asOf: Date) => string | undefined
  edges: Record<string, string[]>
  parents?: (comp: string) => string[]
}) {
  const repo = {
    findBomAsOf: async (_t: string, partNo: string, asOf: Date) => {
      const id = cfg.resolveAt(partNo, asOf)
      return id ? { id, parentPartNo: partNo, status: 'published' } : undefined
    },
    bomComponentsFor: async (bomId: string) => (cfg.edges[bomId] ?? []).map((c) => ({ componentPartNo: c, qtyPer: '1' })),
    findBomParentsOf: async (_t: string, comp: string) => cfg.parents?.(comp) ?? [],
  }
  return new MasterDataResolver(repo as never)
}
const node = (n: { partNo: string; level: number; parentPartNo: string; isLeaf: boolean; cyclic?: boolean }) => expect.objectContaining(n)

describe('MasterDataResolver.explodeBom — multi-level topology', () => {
  it('explodes multiple levels and derives level + isLeaf (make recurses, buy/leaf terminates)', async () => {
    const r = resolver({
      resolveAt: (p) => ({ FG: 'b:FG', 'SUB-A': 'b:SUB' })[p], // FG + SUB-A have BOMs; BUY-* don't
      edges: { 'b:FG': ['SUB-A', 'BUY-1'], 'b:SUB': ['BUY-2', 'BUY-3'] },
    })
    const out = await r.explodeBom('t1', 'FG')
    expect(out.cycles).toEqual([])
    // DFS order (indented-BOM style): SUB-A, then its children, then BUY-1
    expect(out.nodes).toEqual([
      node({ partNo: 'SUB-A', level: 1, parentPartNo: 'FG', isLeaf: false }), // make → recursed
      node({ partNo: 'BUY-2', level: 2, parentPartNo: 'SUB-A', isLeaf: true }),
      node({ partNo: 'BUY-3', level: 2, parentPartNo: 'SUB-A', isLeaf: true }),
      node({ partNo: 'BUY-1', level: 1, parentPartNo: 'FG', isLeaf: true }), // leaf
    ])
  })

  it('resolves as-of at EACH level — a historical asOf reconstructs the sub-tree that was live then', async () => {
    const CUT = new Date('2026-03-01T00:00:00Z')
    const r = resolver({
      resolveAt: (p, asOf) => {
        if (p === 'FG') return 'b:FG'
        if (p === 'SUB-A') return asOf < CUT ? 'b:SUB-v1' : 'b:SUB-v2' // SUB-A's version depends on asOf
        return undefined
      },
      edges: { 'b:FG': ['SUB-A'], 'b:SUB-v1': ['BUY-OLD'], 'b:SUB-v2': ['BUY-NEW-1', 'BUY-NEW-2'] },
    })
    const early = await r.explodeBom('t1', 'FG', '2026-01-15T00:00:00Z')
    expect(early.nodes.map((n) => n.partNo)).toEqual(['SUB-A', 'BUY-OLD']) // v1 sub-tree reconstructed
    const late = await r.explodeBom('t1', 'FG', '2026-06-15T00:00:00Z')
    expect(late.nodes.map((n) => n.partNo)).toEqual(['SUB-A', 'BUY-NEW-1', 'BUY-NEW-2']) // v2 sub-tree
  })

  it('excludes drafts at every level — a part whose only BOM is a draft resolves to nothing → a leaf', async () => {
    // DRAFT-SUB has only a draft BOM → findBomAsOf (non-draft filter) returns undefined → it is a leaf.
    const r = resolver({
      resolveAt: (p) => ({ FG: 'b:FG' })[p], // DRAFT-SUB deliberately absent → resolves to undefined
      edges: { 'b:FG': ['DRAFT-SUB', 'BUY-1'] },
    })
    const out = await r.explodeBom('t1', 'FG')
    expect(out.nodes).toEqual([
      node({ partNo: 'DRAFT-SUB', level: 1, parentPartNo: 'FG', isLeaf: true }), // draft not exploded
      node({ partNo: 'BUY-1', level: 1, parentPartNo: 'FG', isLeaf: true }),
    ])
    expect(out.nodes.some((n) => n.level === 2)).toBe(false) // no children under the draft
  })

  it('a planted cycle is caught and TERMINATES (structured finding, not an infinite loop)', async () => {
    const r = resolver({
      resolveAt: (p) => ({ A: 'b:A', B: 'b:B' })[p], // A→B→A
      edges: { 'b:A': ['B'], 'b:B': ['A'] },
    })
    const out = await r.explodeBom('t1', 'A') // completes (a hang would time the test out)
    expect(out.cycles).toEqual([{ path: ['A', 'B', 'A'] }])
    expect(out.nodes).toEqual([
      node({ partNo: 'B', level: 1, parentPartNo: 'A', isLeaf: false }),
      node({ partNo: 'A', level: 2, parentPartNo: 'B', isLeaf: true, cyclic: true }), // cycle terminus
    ])
  })

  it('a diamond (shared component on two branches) is NOT a cycle — both occurrences appear', async () => {
    const r = resolver({
      resolveAt: (p) => ({ FG: 'b:FG', L: 'b:L', R: 'b:R' })[p],
      edges: { 'b:FG': ['L', 'R'], 'b:L': ['SHARED'], 'b:R': ['SHARED'] }, // SHARED under both L and R
    })
    const out = await r.explodeBom('t1', 'FG')
    expect(out.cycles).toEqual([])
    expect(out.nodes.filter((n) => n.partNo === 'SHARED')).toHaveLength(2) // two distinct occurrences
  })
})

describe('MasterDataResolver.whereUsed — up-traversal', () => {
  it('returns the parent chain up the structure with derived levels', async () => {
    const up: Record<string, string[]> = { 'BUY-2': ['SUB-A'], 'SUB-A': ['FG'], FG: [] }
    const r = resolver({ resolveAt: () => undefined, edges: {}, parents: (c) => up[c] ?? [] })
    const out = await r.whereUsed('t1', 'BUY-2')
    expect(out.parents).toEqual([
      { partNo: 'SUB-A', level: 1, childPartNo: 'BUY-2' },
      { partNo: 'FG', level: 2, childPartNo: 'SUB-A' },
    ])
  })

  it('is cycle-safe — an ancestor loop terminates (never re-ascends)', async () => {
    const up: Record<string, string[]> = { A: ['B'], B: ['A'] } // A used by B, B used by A
    const r = resolver({ resolveAt: () => undefined, edges: {}, parents: (c) => up[c] ?? [] })
    const out = await r.whereUsed('t1', 'A') // completes
    // B uses A (level 1); ascending to B's parents re-reaches A (already in the path) → STOP, not re-added
    expect(out.parents).toEqual([{ partNo: 'B', level: 1, childPartNo: 'A' }])
  })
})
