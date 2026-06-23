import { describe, expect, it } from 'vitest'
import {
  buildWorkList,
  opStatus,
  rollupStatus,
  type WorkListOpInput,
  type WorkListOrderMeta,
} from './work-list'

const NOW = Date.UTC(2026, 5, 22, 12, 0, 0) // 2026-06-22 12:00Z
const HOUR = 3_600_000

const meta = (
  over: Partial<WorkListOrderMeta> & Pick<WorkListOrderMeta, 'demandLineId'>
): WorkListOrderMeta => ({
  partNo: `P-${over.demandLineId}`,
  releaseReference: `REF-${over.demandLineId}`,
  customerName: 'Acme',
  priority: 'standard',
  firmness: 'firm',
  requiredDateIso: new Date(NOW + 48 * HOUR).toISOString(),
  requiredQty: 100,
  ...over,
})

const op = (
  over: Partial<WorkListOpInput> & Pick<WorkListOpInput, 'demandLineId' | 'opSeq'>
): WorkListOpInput => ({
  resourceId: 'res',
  resourceName: 'Press Line A',
  plannedStartMs: NOW + 24 * HOUR, // default: future
  plannedEndMs: NOW + 25 * HOUR,
  atRisk: false,
  atRiskReason: null,
  hasActual: false,
  chain: null,
  ...over,
})

const orders = (...ms: WorkListOrderMeta[]) => new Map(ms.map((m) => [m.demandLineId, m]))

describe('opStatus — per-op precedence', () => {
  it('completed when it has an actual (even if flagged at-risk)', () => {
    expect(opStatus({ hasActual: true, atRisk: true, plannedStartMs: NOW - HOUR }, NOW)).toBe(
      'completed'
    )
  })
  it('at_risk when flagged and not yet executed', () => {
    expect(opStatus({ hasActual: false, atRisk: true, plannedStartMs: NOW + HOUR }, NOW)).toBe(
      'at_risk'
    )
  })
  it('in_progress when started per plan, not done, not at-risk', () => {
    expect(opStatus({ hasActual: false, atRisk: false, plannedStartMs: NOW - HOUR }, NOW)).toBe(
      'in_progress'
    )
  })
  it('scheduled when entirely in the future', () => {
    expect(opStatus({ hasActual: false, atRisk: false, plannedStartMs: NOW + HOUR }, NOW)).toBe(
      'scheduled'
    )
  })
})

describe('rollupStatus — order precedence', () => {
  it('at_risk wins over everything', () => {
    expect(rollupStatus(['completed', 'at_risk', 'scheduled'])).toBe('at_risk')
  })
  it('completed only when ALL ops completed', () => {
    expect(rollupStatus(['completed', 'completed'])).toBe('completed')
    expect(rollupStatus(['completed', 'scheduled'])).toBe('in_progress')
  })
  it('in_progress when some started but not all done', () => {
    expect(rollupStatus(['in_progress', 'scheduled'])).toBe('in_progress')
  })
  it('scheduled when nothing has started', () => {
    expect(rollupStatus(['scheduled', 'scheduled'])).toBe('scheduled')
  })
  it('empty order is scheduled', () => {
    expect(rollupStatus([])).toBe('scheduled')
  })
})

describe('buildWorkList', () => {
  it('rolls ops up per order and tallies the status counts', () => {
    const ops: WorkListOpInput[] = [
      // DL-DONE: both ops executed → completed
      op({ demandLineId: 'DL-DONE', opSeq: 10, hasActual: true, plannedStartMs: NOW - 5 * HOUR }),
      op({ demandLineId: 'DL-DONE', opSeq: 20, hasActual: true, plannedStartMs: NOW - 4 * HOUR }),
      // DL-RUN: op10 done, op20 future → in_progress
      op({ demandLineId: 'DL-RUN', opSeq: 10, hasActual: true, plannedStartMs: NOW - 2 * HOUR }),
      op({ demandLineId: 'DL-RUN', opSeq: 20 }),
      // DL-FUT: all future → scheduled
      op({ demandLineId: 'DL-FUT', opSeq: 10 }),
      // DL-RISK: op20 at-risk → at_risk (binding op carries the reason/chain)
      op({ demandLineId: 'DL-RISK', opSeq: 10, hasActual: true, plannedStartMs: NOW - HOUR }),
      op({
        demandLineId: 'DL-RISK',
        opSeq: 20,
        resourceName: 'Leak Test',
        atRisk: true,
        atRiskReason: 'late',
      }),
    ]
    const { rows, counts } = buildWorkList(
      ops,
      orders(
        meta({ demandLineId: 'DL-DONE' }),
        meta({ demandLineId: 'DL-RUN' }),
        meta({ demandLineId: 'DL-FUT' }),
        meta({ demandLineId: 'DL-RISK' })
      ),
      NOW
    )
    expect(counts).toEqual({ total: 4, completed: 1, atRisk: 1, inProgress: 1, scheduled: 1 })

    const byId = new Map(rows.map((r) => [r.demandLineId, r]))
    expect(byId.get('DL-DONE')!.status).toBe('completed')
    expect(byId.get('DL-RUN')!.status).toBe('in_progress')
    expect(byId.get('DL-FUT')!.status).toBe('scheduled')

    const risk = byId.get('DL-RISK')!
    expect(risk.status).toBe('at_risk')
    expect(risk.atRiskDetail).toBe('op 20 · Leak Test')
    expect(risk.atRiskReason).toBe('late')
    expect(risk.label).toBe('P-DL-RISK · REF-DL-RISK')
  })

  it('orders rows most-actionable first (at_risk → in_progress → scheduled → completed)', () => {
    const ops: WorkListOpInput[] = [
      op({ demandLineId: 'A-DONE', opSeq: 10, hasActual: true, plannedStartMs: NOW - HOUR }),
      op({ demandLineId: 'B-RISK', opSeq: 10, atRisk: true, atRiskReason: 'late' }),
      op({ demandLineId: 'C-FUT', opSeq: 10 }),
    ]
    const { rows } = buildWorkList(
      ops,
      orders(
        meta({ demandLineId: 'A-DONE' }),
        meta({ demandLineId: 'B-RISK' }),
        meta({ demandLineId: 'C-FUT' })
      ),
      NOW
    )
    expect(rows.map((r) => r.status)).toEqual(['at_risk', 'scheduled', 'completed'])
  })

  it('non-at-risk rows carry no reason/chain; resourceNames are distinct in op order', () => {
    const ops: WorkListOpInput[] = [
      op({ demandLineId: 'DL', opSeq: 10, resourceName: 'Press A' }),
      op({ demandLineId: 'DL', opSeq: 20, resourceName: 'Press A' }),
      op({ demandLineId: 'DL', opSeq: 30, resourceName: 'Leak Test' }),
    ]
    const { rows } = buildWorkList(ops, orders(meta({ demandLineId: 'DL' })), NOW)
    expect(rows[0]!.resourceNames).toEqual(['Press A', 'Leak Test'])
    expect(rows[0]!.atRiskReason).toBeNull()
    expect(rows[0]!.chain).toBeNull()
    expect(rows[0]!.ops).toHaveLength(3)
  })

  it('skips ops whose demand line has no metadata (never fabricates an order)', () => {
    const ops: WorkListOpInput[] = [op({ demandLineId: 'ORPHAN', opSeq: 10 })]
    const { rows, counts } = buildWorkList(ops, orders(), NOW)
    expect(rows).toEqual([])
    expect(counts.total).toBe(0)
  })
})
