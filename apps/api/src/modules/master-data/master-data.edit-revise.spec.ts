import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MasterDataService } from './master-data.service'
import type { Part, Routing, RoutingOperation } from './schema'

/**
 * Pattern-A never-edit-in-place (Layer 0 D-L0-7): admin updatePart/updateRouting route through
 * revise* (a new effectivity-dated version), never an in-place UPDATE. A no-op edit writes nothing;
 * revision/effectiveFrom auto-derive when omitted (UI hedge). Repo + resolver mocked.
 */

const partRow = (over: Partial<Part> = {}): Part => ({
  id: 'p_v1', tenantId: 't1', partNo: 'X-1', description: 'orig', partType: 'component', uom: 'EA',
  material: 'steel', gauge: null, colour: null, status: 'active', revision: 'A',
  makeBuy: 'make', customerPartNo: null, customerId: null, program: null,
  effectiveFrom: new Date('2026-06-01T00:00:00Z'), effectiveTo: null, supersedesId: null,
  createdAt: new Date('2026-06-01T00:00:00Z'), updatedAt: new Date('2026-06-01T00:00:00Z'), ...over,
})
const routingRow = (over: Partial<Routing> = {}): Routing => ({
  id: 'r_v1', tenantId: 't1', partNo: 'X-1', name: 'primary', isPrimary: true, status: 'active',
  revision: 'A', effectiveFrom: new Date('2026-06-01T00:00:00Z'), effectiveTo: null, supersedesId: null,
  createdAt: new Date('2026-06-01T00:00:00Z'), updatedAt: new Date('2026-06-01T00:00:00Z'), ...over,
})
const op = (over: Partial<RoutingOperation> = {}): RoutingOperation => ({
  id: 'op1', tenantId: 't1', routingId: 'r_v1', opSeq: 10, resourceGroupId: 'rg1', stdSetupTime: 30,
  stdCycleTime: 5, changeoverAttributeKey: 'colour', createdAt: new Date('2026-06-01T00:00:00Z'), ...over,
})

function make(repo: Record<string, ReturnType<typeof vi.fn>>, resolver: Record<string, ReturnType<typeof vi.fn>>) {
  const org = { validatePlantIds: vi.fn(), validateCalendarIds: vi.fn() }
  const events = { publish: vi.fn().mockResolvedValue(undefined) }
  return new MasterDataService(repo as never, org as never, events as never, resolver as never)
}

describe('updatePart → revise', () => {
  beforeEach(() => vi.clearAllMocks())

  it('a real change revises off the open version with auto-derived revision B + effectiveFrom now', async () => {
    const revisePart = vi.fn().mockResolvedValue(partRow({ id: 'p_v2', revision: 'B', material: 'aluminum' }))
    const svc = make(
      { findPart: vi.fn().mockResolvedValue(partRow()), findOpenPart: vi.fn().mockResolvedValue(partRow()) },
      { revisePart },
    )
    await svc.updatePart('t1', 'p_v1', { material: 'aluminum' }, 'user-1')
    expect(revisePart).toHaveBeenCalledTimes(1)
    const [tenantId, partNo, input, actor] = revisePart.mock.calls[0]!
    expect([tenantId, partNo, actor]).toEqual(['t1', 'X-1', 'user-1'])
    expect(input.revision).toBe('B') // A -> B auto-derived
    expect(typeof input.effectiveFrom).toBe('string') // effective now
    expect(input.changes).toEqual({ material: 'aluminum' }) // only the changed attr
  })

  it('a no-op edit writes NOTHING (no revise) and returns the open version', async () => {
    const revisePart = vi.fn()
    const svc = make(
      { findPart: vi.fn().mockResolvedValue(partRow()), findOpenPart: vi.fn().mockResolvedValue(partRow()) },
      { revisePart },
    )
    const out = await svc.updatePart('t1', 'p_v1', { material: 'steel', description: 'orig' }, 'user-1')
    expect(revisePart).not.toHaveBeenCalled()
    expect(out.material).toBe('steel')
  })

  it('explicit revision + effectiveFrom pass through (not auto-derived)', async () => {
    const revisePart = vi.fn().mockResolvedValue(partRow({ id: 'p_v2', revision: 'C' }))
    const svc = make(
      { findPart: vi.fn().mockResolvedValue(partRow()), findOpenPart: vi.fn().mockResolvedValue(partRow()) },
      { revisePart },
    )
    await svc.updatePart('t1', 'p_v1', { status: 'inactive', revision: 'C', effectiveFrom: '2026-09-01T00:00:00Z' }, 'u')
    const [, , input] = revisePart.mock.calls[0]!
    expect([input.revision, input.effectiveFrom]).toEqual(['C', '2026-09-01T00:00:00Z'])
    expect(input.changes).toEqual({ status: 'inactive' })
  })
})

describe('updateRouting → revise', () => {
  beforeEach(() => vi.clearAllMocks())

  it('an operation-set change revises (op rows copy onto the new version)', async () => {
    const reviseRouting = vi.fn().mockResolvedValue({ id: 'r_v2', partNo: 'X-1', name: 'primary', isPrimary: true, status: 'active', operations: [], revision: 'B', effectiveFrom: '', effectiveTo: null })
    const svc = make(
      {
        findRouting: vi.fn().mockResolvedValue(routingRow()),
        findOpenRouting: vi.fn().mockResolvedValue(routingRow()),
        operationsFor: vi.fn().mockResolvedValue([op({ stdCycleTime: 5 })]),
        resourceGroupIdsIn: vi.fn().mockResolvedValue(['rg1']),
      },
      { reviseRouting },
    )
    await svc.updateRouting('t1', 'r_v1', { operations: [{ opSeq: 10, resourceGroupId: 'rg1', stdSetupTime: 30, stdCycleTime: 9, changeoverAttributeKey: 'colour' }] }, 'user-1')
    expect(reviseRouting).toHaveBeenCalledTimes(1)
    expect(reviseRouting.mock.calls[0]![2].changes.operations).toHaveLength(1)
  })

  it('a no-op routing edit (identical ops) writes nothing', async () => {
    const reviseRouting = vi.fn()
    const svc = make(
      {
        findRouting: vi.fn().mockResolvedValue(routingRow()),
        findOpenRouting: vi.fn().mockResolvedValue(routingRow()),
        operationsFor: vi.fn().mockResolvedValue([op({ stdCycleTime: 5 })]),
        resourceGroupIdsIn: vi.fn().mockResolvedValue(['rg1']),
      },
      { reviseRouting },
    )
    await svc.updateRouting('t1', 'r_v1', { operations: [{ opSeq: 10, resourceGroupId: 'rg1', stdSetupTime: 30, stdCycleTime: 5, changeoverAttributeKey: 'colour' }] }, 'user-1')
    expect(reviseRouting).not.toHaveBeenCalled()
  })
})
