import { describe, expect, it } from 'vitest'
import type { LatenessChainDto } from '@perduraflow/contracts'
import { compactLateness } from './conversation.service'

// The seed's C2×C3 cascade: DL-2002's inspection held by ST-8830's inspection ← ST-8830's weld (PV-22).
const CASCADE: LatenessChainDto = {
  root: 'material',
  truncated: false,
  hops: [
    { demandLineId: 'DL-2002', opSeq: 20, resourceId: 'leak', resourceName: 'Leak-Test Station', partNo: 'FG-3002', kind: 'resource', detail: null },
    { demandLineId: 'ST-8830', opSeq: 20, resourceId: 'leak', resourceName: 'Leak-Test Station', partNo: 'FG-3001', kind: 'predecessor', detail: null },
    { demandLineId: 'ST-8830', opSeq: 10, resourceId: 'weld', resourceName: 'Weld Cell 2', partNo: 'FG-3001', kind: 'material', detail: 'PV-22' },
  ],
}

/**
 * compactLateness is the Copilot's explain_lateness artifact (D-late): the SAME computed chain the
 * board + queue read. These lock the grounding contract — the hops are passed verbatim and in order,
 * the note forbids inferring a blocker, and a not-at-risk order returns an honest on-track answer.
 */
describe('compactLateness — Copilot explain_lateness artifact', () => {
  it('passes the chain hops verbatim, in order, with the material root + component', () => {
    const a = compactLateness('DL-2002', [CASCADE])
    expect(a.late).toBe(true)
    expect(a.chains).toHaveLength(1)
    expect(a.chains![0]!.root).toBe('material')
    expect(a.chains![0]!.hops.map((h) => `${h.order}:${h.op}:${h.kind}`)).toEqual([
      'DL-2002:20:resource',
      'ST-8830:20:predecessor',
      'ST-8830:10:material',
    ])
    expect(a.chains![0]!.hops.at(-1)!.detail).toBe('PV-22')
  })

  it('instructs the model to narrate in order and never infer a blocker (grounding)', () => {
    const a = compactLateness('DL-2002', [CASCADE])
    expect(a.note).toContain('IN ORDER')
    expect(a.note).toMatch(/NEVER add or infer/i)
  })

  it('an order with no at-risk chains returns an honest on-track answer', () => {
    const a = compactLateness('GP-1142', [])
    expect(a.late).toBe(false)
    expect(a.note).toMatch(/not at-risk|on track/i)
    expect(a.chains).toBeUndefined()
  })

  it('surfaces truncation honestly', () => {
    const a = compactLateness('X', [{ ...CASCADE, truncated: true }])
    expect(a.chains![0]!.truncated).toBe(true)
    expect(a.note).toContain('truncated')
  })
})
