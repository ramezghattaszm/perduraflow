import { describe, expect, it } from 'vitest'
import type { WhatIfOption, WhatIfResultDto } from '@perduraflow/contracts'
import { buildComparison } from './WhatIfComparison'

const opt = (id: string, over: Partial<WhatIfOption>): WhatIfOption => ({
  id,
  rank: 1,
  labelKey: id,
  feasible: true,
  infeasibleReasonKey: null,
  kpis: { otif: 1, costPerUnit: null, oee: null, lateOrders: 0, throughput: null, churn: null },
  score: 0,
  rationale: { schemaVersion: '1.0', weightSetVersion: 'aps-w2', optionId: id, score: 0, headlineKey: '', headlineParams: {}, factors: [], constraints: [], comparatives: [] },
  ...over,
})
const result = (options: WhatIfOption[], recommendedOptionId: string | null): WhatIfResultDto => ({
  id: 'wir-1',
  plantId: 'p1',
  baseVersionId: 'v1',
  changeSet: { origin: { type: 'manual' }, changes: [] },
  baseKpis: { otif: 1, costPerUnit: null, oee: null, lateOrders: 0, throughput: null, churn: null },
  options,
  recommendedOptionId,
  determinismKey: 'k',
  createdAt: '2026-06-21T00:00:00.000Z',
  requestedChanges: [],
})

/**
 * buildComparison is the decide-support #2 no-transcription guarantee: the side-by-side cells are
 * read DIRECTLY from the what-if result (option kpis + rationale factors), never produced/retyped
 * by the LLM. These assert the rendered values equal the artifact's values.
 */
describe('buildComparison — render-don\'t-retype (decide-support #2)', () => {
  const A = opt('protect_delivery', {
    rank: 1,
    kpis: { otif: 0.84, costPerUnit: 1.59, oee: null, lateOrders: 6, throughput: 36200, churn: null },
    rationale: { schemaVersion: '1.0', weightSetVersion: 'aps-w2', optionId: 'protect_delivery', score: 0, headlineKey: '', headlineParams: {}, constraints: [], comparatives: [], factors: [
      { key: 'changeover', labelKey: '', rawValue: 16, unit: '', weight: 1, contribution: 16, direction: 'worsens', detailKey: '', detailParams: {} },
      { key: 'displacement', labelKey: '', rawValue: 7, unit: '', weight: 2, contribution: 14, direction: 'worsens', detailKey: '', detailParams: {} },
    ] },
  })
  const B = opt('minimize_changeover', {
    rank: 2,
    kpis: { otif: 0.816, costPerUnit: 1.58, oee: null, lateOrders: 7, throughput: 36200, churn: null },
    rationale: { schemaVersion: '1.0', weightSetVersion: 'aps-w2', optionId: 'minimize_changeover', score: 0, headlineKey: '', headlineParams: {}, constraints: [], comparatives: [], factors: [
      { key: 'changeover', labelKey: '', rawValue: 6, unit: '', weight: 1, contribution: 6, direction: 'improves', detailKey: '', detailParams: {} },
    ] },
  })
  const C = opt('infeasible_one', { rank: 3, feasible: false, infeasibleReasonKey: 'whatif.infeasible.noResource' })
  const model = buildComparison(result([A, B, C], 'protect_delivery'), (o) => o.labelKey)
  const row = (k: string) => model.rows.find((r) => r.key === k)!

  it('columns mirror the options, with recommended + feasibility marked', () => {
    expect(model.columns.map((c) => c.label)).toEqual(['protect_delivery', 'minimize_changeover', 'infeasible_one'])
    expect(model.columns.find((c) => c.id === 'protect_delivery')!.recommended).toBe(true)
    expect(model.columns.find((c) => c.id === 'infeasible_one')!.feasible).toBe(false)
  })

  it('KPI cells equal the artifact values (no transcription)', () => {
    expect(row('otif').cells).toEqual(['84%', '82%', '—']) // 0.84, 0.816→82%, infeasible '—'
    expect(row('cost').cells).toEqual(['$1.59', '$1.58', '—'])
    expect(row('late').cells).toEqual(['6', '7', '—'])
    expect(row('throughput').cells).toEqual(['36200', '36200', '—'])
  })

  it('factor cells equal the artifact factor rawValues (changeover / displacement)', () => {
    expect(row('changeover').cells).toEqual(['16', '6', '—'])
    expect(row('displacement').cells).toEqual(['7', '—', '—']) // B has no displacement factor → '—'
  })
})
