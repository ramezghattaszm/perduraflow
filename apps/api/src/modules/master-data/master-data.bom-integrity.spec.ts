import { describe, expect, it, vi } from 'vitest'
import { MasterDataResolver } from './master-data.resolver'

/**
 * BOM integrity validation (Layer 2 §4a.2, D-L2-6) — unit level, repo mocked. Each failure mode
 * (missing component, cycle, effectivity inconsistency, make/buy incoherence) is a structured finding
 * that BLOCKS publish with a typed INVALID_BOM; a valid BOM publishes; and the on-demand call returns
 * findings for a DRAFT (an author checks before publishing). Topology only — no plan quantities.
 */

/** Build a resolver over a controlled graph: the draft's edges, part make/buy, and each part's effective BOM edges. */
function repoFor(cfg: {
  parent: string
  draftEdges: string[]
  parts: Record<string, 'make' | 'buy'> // findPartAsOf → { makeBuy }; absent = not found
  boms?: Record<string, string[]> // partNo → its EFFECTIVE-as-of published BOM's edges
  hasPublished?: string[] // parts with ANY published BOM (effectivity-gap: has a recipe, not effective as-of)
}) {
  const publishBomTx = vi.fn(async (input: { draftId: string; effectiveFrom: Date }) => ({ id: input.draftId, status: 'published', parentPartNo: cfg.parent, effectiveFrom: input.effectiveFrom }))
  const repo = {
    findOpenDraftBom: async (_t: string, p: string) => (p === cfg.parent ? { id: 'DRAFT', parentPartNo: cfg.parent, status: 'draft', effectiveFrom: null } : undefined),
    findOpenPublishedBom: async () => undefined, // fresh publish, no prior
    findBomAsOf: async (_t: string, p: string) => (cfg.boms?.[p] ? { id: `PUB:${p}`, parentPartNo: p, status: 'published' } : undefined),
    bomComponentsFor: async (id: string) => {
      const edges = id === 'DRAFT' ? cfg.draftEdges : (cfg.boms?.[id.replace(/^PUB:/, '')] ?? [])
      return edges.map((c) => ({ componentPartNo: c, qtyPer: '1' }))
    },
    findPartAsOf: async (_t: string, p: string) => (cfg.parts[p] ? { partNo: p, makeBuy: cfg.parts[p] } : undefined),
    hasAnyPublishedBom: async (_t: string, p: string) => (cfg.hasPublished ?? []).includes(p) || cfg.boms?.[p] != null,
    publishBomTx,
  }
  return { resolver: new MasterDataResolver(repo as never), publishBomTx }
}

const EF = '2026-01-01T00:00:00Z'

describe('validateBomIntegrity — publish gate (blocking)', () => {
  it('a VALID BOM publishes (make child has a BOM, buy child is a leaf, no cycle)', async () => {
    const { resolver, publishBomTx } = repoFor({
      parent: 'FG', draftEdges: ['SUB', 'BUY1'], parts: { SUB: 'make', BUY1: 'buy' }, boms: { SUB: ['RAW'] },
    })
    const out = await resolver.publishBom('t1', 'FG', EF, 'u')
    expect(out.status).toBe('published')
    expect(publishBomTx).toHaveBeenCalledTimes(1)
  })

  it('MISSING COMPONENT blocks publish (INVALID_BOM); nothing written', async () => {
    const { resolver, publishBomTx } = repoFor({ parent: 'FG', draftEdges: ['GHOST'], parts: {} })
    await expect(resolver.publishBom('t1', 'FG', EF, 'u')).rejects.toMatchObject({ code: 'INVALID_BOM' })
    expect(publishBomTx).not.toHaveBeenCalled()
  })

  it('a CYCLE blocks publish (INVALID_BOM)', async () => {
    // FG draft → SUB; SUB's published BOM → FG  ⇒  FG → SUB → FG
    const { resolver, publishBomTx } = repoFor({ parent: 'FG', draftEdges: ['SUB'], parts: { SUB: 'make', FG: 'make' }, boms: { SUB: ['FG'] } })
    await expect(resolver.publishBom('t1', 'FG', EF, 'u')).rejects.toMatchObject({ code: 'INVALID_BOM' })
    expect(publishBomTx).not.toHaveBeenCalled()
  })

  it('EFFECTIVITY INCONSISTENCY blocks publish — a make child has a recipe but none effective as-of', async () => {
    const { resolver, publishBomTx } = repoFor({ parent: 'FG', draftEdges: ['MK'], parts: { MK: 'make' }, boms: {}, hasPublished: ['MK'] })
    await expect(resolver.publishBom('t1', 'FG', EF, 'u')).rejects.toMatchObject({ code: 'INVALID_BOM' })
    expect(publishBomTx).not.toHaveBeenCalled()
  })

  it('MAKE/BUY INCOHERENCE blocks publish — a buy component carries its own BOM', async () => {
    const { resolver, publishBomTx } = repoFor({ parent: 'FG', draftEdges: ['BUYX'], parts: { BUYX: 'buy' }, boms: { BUYX: ['RAW'] } })
    await expect(resolver.publishBom('t1', 'FG', EF, 'u')).rejects.toMatchObject({ code: 'INVALID_BOM' })
    expect(publishBomTx).not.toHaveBeenCalled()
  })
})

describe('validateBomIntegrity — on-demand (author checks a draft before publishing)', () => {
  it('returns structured findings for an unpublished draft (each kind identified, not thrown)', async () => {
    const { resolver } = repoFor({
      parent: 'FG',
      draftEdges: ['GHOST', 'BUYX', 'MK'],
      parts: { BUYX: 'buy', MK: 'make' }, // GHOST absent
      boms: { BUYX: ['RAW'] }, // buy w/ BOM → incoherent
      hasPublished: ['MK'], // make w/ recipe not effective → effectivity gap
    })
    const res = await resolver.validateBomIntegrity('t1', 'FG')
    expect(res.ok).toBe(false)
    const byKind = Object.fromEntries(res.findings.map((f) => [f.kind, f.component]))
    expect(byKind).toMatchObject({
      COMPONENT_NOT_FOUND: 'GHOST',
      MAKE_BUY_INCOHERENT: 'BUYX',
      EFFECTIVITY_INCONSISTENT: 'MK',
    })
  })

  it('a valid draft returns ok with no findings', async () => {
    const { resolver } = repoFor({ parent: 'FG', draftEdges: ['SUB', 'BUY1'], parts: { SUB: 'make', BUY1: 'buy' }, boms: { SUB: ['RAW'] } })
    const res = await resolver.validateBomIntegrity('t1', 'FG')
    expect(res).toEqual({ parentPartNo: 'FG', ok: true, findings: [] })
  })
})
