import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Resource } from './schema'
import { MasterDataService } from './master-data.service'

/**
 * Commit 1 proof (Layer 0 §6): Pattern-B `resource` create/update/deactivate write
 * exactly one `master_data_audit` row, capturing only the fields that changed as
 * old→new (create = snapshot, no prior). Repo is mocked — this asserts the service's
 * audit-write contract, not the DB (the DB round-trip is proven end-to-end separately).
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
  return new MasterDataService(repo as never, org as never, events as never)
}

describe('master-data audit — Pattern B resource', () => {
  beforeEach(() => vi.clearAllMocks())

  it('update writes exactly ONE audit row with correct old→new for the changed field only', async () => {
    const appendAudit = vi.fn().mockResolvedValue(undefined)
    const svc = makeService({
      findResource: vi.fn().mockResolvedValue(resourceRow({ rate: 10 })),
      updateResource: vi.fn().mockResolvedValue(resourceRow({ rate: 20 })),
      appendAudit,
    })

    await svc.updateResource('t1', 'r1', { rate: 20 }, 'user-42')

    expect(appendAudit).toHaveBeenCalledTimes(1)
    const [rows] = appendAudit.mock.calls[0]!
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      tenantId: 't1',
      entityType: 'resource',
      businessKey: 'r1',
      versionId: 'r1',
      action: 'update',
      actor: 'user-42',
      changedFields: { rate: { old: 10, new: 20 } },
    })
    // only the changed field is logged — nothing else
    expect(Object.keys(rows[0].changedFields)).toEqual(['rate'])
  })

  it('a no-op update (no field actually changes) writes NO audit row', async () => {
    const appendAudit = vi.fn().mockResolvedValue(undefined)
    const svc = makeService({
      findResource: vi.fn().mockResolvedValue(resourceRow({ rate: 10 })),
      updateResource: vi.fn().mockResolvedValue(resourceRow({ rate: 10 })),
      appendAudit,
    })

    await svc.updateResource('t1', 'r1', { rate: 10 }, 'user-42')

    expect(appendAudit).not.toHaveBeenCalled()
  })

  it('a status → inactive flip records action=deactivate', async () => {
    const appendAudit = vi.fn().mockResolvedValue(undefined)
    const svc = makeService({
      findResource: vi.fn().mockResolvedValue(resourceRow({ status: 'active' })),
      updateResource: vi.fn().mockResolvedValue(resourceRow({ status: 'inactive' })),
      appendAudit,
    })

    await svc.updateResource('t1', 'r1', { status: 'inactive' }, 'user-42')

    const [rows] = appendAudit.mock.calls[0]!
    expect(rows[0]).toMatchObject({
      action: 'deactivate',
      changedFields: { status: { old: 'active', new: 'inactive' } },
    })
  })

  it('create writes one audit row (snapshot, no prior) and defaults actor to system', async () => {
    const appendAudit = vi.fn().mockResolvedValue(undefined)
    const svc = makeService({
      createResource: vi.fn().mockResolvedValue(resourceRow({ id: 'r9', rate: 15 })),
      appendAudit,
    })
    await svc.createResource(
      't1',
      { name: 'Press A', resourceType: 'line', plantId: 'p1', calendarId: 'c1', rate: 15, rateUom: 'EA/h', runCostPerHour: 100, setupCost: 50, overheadPerUnit: 0.5, otCapMinutes: 120 },
      // actor omitted → 'system'
    )

    expect(appendAudit).toHaveBeenCalledTimes(1)
    const [rows] = appendAudit.mock.calls[0]!
    expect(rows[0]).toMatchObject({ action: 'create', actor: 'system', businessKey: 'r9', versionId: 'r9' })
    expect(rows[0].changedFields.rate).toEqual({ new: 15 })
    expect(rows[0].changedFields).not.toHaveProperty('rate.old')
  })
})
