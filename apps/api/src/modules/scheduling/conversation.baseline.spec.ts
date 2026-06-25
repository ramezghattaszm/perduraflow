import { describe, expect, it } from 'vitest'
import type { CostedKpis, PlanComparisonDto } from '@perduraflow/contracts'
import { compactBaseline } from './conversation.service'

const kpis = (over: Partial<CostedKpis>): CostedKpis => ({ otif: 1, costPerUnit: null, oee: null, lateOrders: 0, firmLateHours: null, throughput: null, churn: null, ...over })
const dto = (over: Partial<PlanComparisonDto>): PlanComparisonDto => ({
  source: 'frozen_engine_snapshot',
  emptyState: false,
  plantId: 'p1',
  scheduleVersionId: 'v1',
  live: null,
  baseline: null,
  labelKey: 'baseline.frozenLabel',
  ...over,
})

/**
 * compactBaseline is the Pass D content-grounding artifact: it returns the SAME live/baseline
 * numbers the scorecard shows (from PlanComparisonService.compare) plus a deterministic per-KPI
 * delta + direction, so the model only translates. These lock the delta math and the honest empty-state.
 */
describe('compactBaseline — Pass D baseline artifact', () => {
  it('returns per-KPI live/baseline/delta with correct direction (lower-is-better aware)', () => {
    const a = compactBaseline(
      dto({
        live: kpis({ otif: 0.95, costPerUnit: 1.8, lateOrders: 2 }),
        baseline: kpis({ otif: 0.9, costPerUnit: 2.0, lateOrders: 5 }),
      }),
      'Press Line A',
    )
    expect(a.emptyState).toBe(false)
    expect(a.scope).toBe('Press Line A')
    expect(a.comparison).toContain('engine-lift')
    const by = Object.fromEntries((a.kpis ?? []).map((k) => [k.kpi, k]))
    expect(by['OTIF']).toMatchObject({ live: 0.95, baseline: 0.9, delta: 0.05, direction: 'better' }) // higher OTIF = better
    expect(by['cost per unit']).toMatchObject({ delta: -0.2, direction: 'better' }) // lower cost = better
    expect(by['late orders']).toMatchObject({ delta: -3, direction: 'better' }) // fewer late = better
  })

  it('flags a worse delta (cost up = worse)', () => {
    const a = compactBaseline(dto({ live: kpis({ costPerUnit: 2.2 }), baseline: kpis({ costPerUnit: 2.0 }) }), null)
    expect(a.scope).toBe('the whole plant')
    const cost = (a.kpis ?? []).find((k) => k.kpi === 'cost per unit')
    expect(cost).toMatchObject({ delta: 0.2, direction: 'worse' })
  })

  it('drops a KPI absent on both sides (no all-"—" row)', () => {
    const a = compactBaseline(dto({ live: kpis({ otif: 0.9 }), baseline: kpis({ otif: 0.9 }) }), null)
    // OEE/cost/throughput are null on both → excluded; OTIF (flat) kept.
    expect((a.kpis ?? []).map((k) => k.kpi)).toEqual(['OTIF', 'late orders'])
    expect((a.kpis ?? []).find((k) => k.kpi === 'OTIF')).toMatchObject({ direction: 'flat', delta: 0 })
  })

  it('honest empty-state for a missing historical baseline — never fabricated', () => {
    const a = compactBaseline(dto({ source: 'measured_historical', emptyState: true, live: null, baseline: null }), null)
    expect(a.emptyState).toBe(true)
    expect(a.kpis).toBeUndefined()
    expect(a.note).toContain('No historical baseline exists yet')
    expect(a.comparison).toContain('measured-historical')
  })
})
