import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NewMasterDataAudit, Resource } from './schema'
import { MasterDataService } from './master-data.service'

/**
 * Pattern-B `resource` audit (Layer 0 §6): create/update/deactivate build exactly one
 * `master_data_audit` row via the builder handed to the repository's atomic `*WithAudit`
 * methods, capturing only the fields that changed as old→new (create = snapshot, no prior).
 * The repo is mocked — it invokes the service's builder and captures the row it produces;
 * the DB-level atomicity of `*WithAudit` is proven separately end-to-end.
 */

const resourceRow = (over: Partial<Resource> = {}): Resource => ({
  id: 'r1',
  tenantId: 't1',
  name: 'Press A',
  resourceType: 'line',
  plantId: 'p1',
  calendarId: 'c1',
  rate: 10,
  rateUom: 'EA/h',
  runCostPerHour: 100,
  setupCost: 50,
  overheadPerUnit: 0.5,
  otCapMinutes: 120,
  status: 'active',
  createdAt: new Date('2026-07-01T00:00:00Z'),
  updatedAt: new Date('2026-07-01T00:00:00Z'),
  ...over,
})

function makeService(repo: Partial<Record<string, ReturnType<typeof vi.fn>>>) {
  const org = {
    validatePlantIds: vi.fn().mockResolvedValue({ valid: [], invalid: [] }),
    validateCalendarIds: vi.fn().mockResolvedValue({ valid: [], invalid: [] }),
  }
  const events = { publish: vi.fn().mockResolvedValue(undefined) }
  const resolver = { revisePart: vi.fn(), reviseRouting: vi.fn() }
  return new MasterDataService(repo as never, org as never, events as never, resolver as never, {} as never)
}

describe('master-data audit — Pattern B resource', () => {
  beforeEach(() => vi.clearAllMocks())

  it('update builds ONE audit row with correct old→new for the changed field only', async () => {
    let captured: NewMasterDataAudit | null = null
    const updateResourceWithAudit = vi.fn(async (_t, _id, _patch, build) => {
      captured = build(resourceRow({ rate: 10 }), resourceRow({ rate: 20 }))
      return resourceRow({ rate: 20 })
    })
    const svc = makeService({ updateResourceWithAudit })

    await svc.updateResource('t1', 'r1', { rate: 20 }, 'user-42')

    expect(updateResourceWithAudit).toHaveBeenCalledTimes(1)
    expect(captured).toMatchObject({
      tenantId: 't1',
      entityType: 'resource',
      businessKey: 'r1',
      versionId: 'r1',
      action: 'update',
      actor: 'user-42',
      changedFields: { rate: { old: 10, new: 20 } },
    })
    expect(Object.keys(captured!.changedFields as object)).toEqual(['rate'])
  })

  it('a no-op update (no field actually changes) builds NO audit row (null)', async () => {
    let captured: NewMasterDataAudit | null = { placeholder: true } as never
    const updateResourceWithAudit = vi.fn(async (_t, _id, _patch, build) => {
      captured = build(resourceRow({ rate: 10 }), resourceRow({ rate: 10 }))
      return resourceRow({ rate: 10 })
    })
    const svc = makeService({ updateResourceWithAudit })

    await svc.updateResource('t1', 'r1', { rate: 10 }, 'user-42')

    expect(captured).toBeNull()
  })

  it('a status → inactive flip records action=deactivate', async () => {
    let captured: NewMasterDataAudit | null = null
    const updateResourceWithAudit = vi.fn(async (_t, _id, _patch, build) => {
      captured = build(resourceRow({ status: 'active' }), resourceRow({ status: 'inactive' }))
      return resourceRow({ status: 'inactive' })
    })
    const svc = makeService({ updateResourceWithAudit })

    await svc.updateResource('t1', 'r1', { status: 'inactive' }, 'user-42')

    expect(captured).toMatchObject({
      action: 'deactivate',
      changedFields: { status: { old: 'active', new: 'inactive' } },
    })
  })

  it('create builds one audit row (snapshot, no prior) and defaults actor to system', async () => {
    let captured: NewMasterDataAudit | null = null
    const createResourceWithAudit = vi.fn(async (_data, make) => {
      const row = resourceRow({ id: 'r9', rate: 15 })
      captured = make(row)
      return row
    })
    const svc = makeService({ createResourceWithAudit })

    await svc.createResource(
      't1',
      { name: 'Press A', resourceType: 'line', plantId: 'p1', calendarId: 'c1', rate: 15, rateUom: 'EA/h', runCostPerHour: 100, setupCost: 50, overheadPerUnit: 0.5, otCapMinutes: 120 },
      // actor omitted → 'system'
    )

    expect(createResourceWithAudit).toHaveBeenCalledTimes(1)
    expect(captured).toMatchObject({ action: 'create', actor: 'system', businessKey: 'r9', versionId: 'r9' })
    expect((captured!.changedFields as Record<string, unknown>)['rate']).toEqual({ new: 15 })
  })
})
