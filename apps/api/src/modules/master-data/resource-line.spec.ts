import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MasterDataService } from './master-data.service'

/**
 * Resource `line_id` write validation (Scheduling S0a, O4 via org.read 1.3). A set line is validated two
 * ways: (1) it resolves to an active tenant line (INVALID_LINE_REFERENCE), and (2) the plant-consistency
 * guard — the line must sit in the resource's OWN plant (LINE_PLANT_MISMATCH). `line_id=null` skips both
 * (plant-only grain). The line entity lives in org; master-data consumes org.read to validate.
 */

function make(orgOver: Record<string, ReturnType<typeof vi.fn>> = {}) {
  const org = {
    validatePlantIds: vi.fn().mockResolvedValue({ valid: ['p1'], invalid: [] }),
    validateCalendarIds: vi.fn().mockResolvedValue({ valid: ['c1'], invalid: [] }),
    validateLineIds: vi.fn().mockResolvedValue({ valid: [], invalid: [] }),
    getLine: vi.fn().mockResolvedValue(null),
    ...orgOver,
  }
  const events = { publish: vi.fn().mockResolvedValue(undefined) }
  const repo = {
    createResourceWithAudit: vi.fn(async (data: Record<string, unknown>, makeAudit: (r: unknown) => unknown) => {
      const row = { id: 'r1', status: 'active', ...data }
      makeAudit(row)
      return row
    }),
    findResource: vi.fn(),
  }
  const svc = new MasterDataService(repo as never, org as never, events as never, {} as never, {} as never)
  return { svc, org, repo }
}

const baseDto = { name: 'Press A', resourceType: 'line' as const, plantId: 'p1', calendarId: 'c1', rate: null, rateUom: null, runCostPerHour: null, setupCost: null, overheadPerUnit: null, otCapMinutes: null }

describe('MasterDataService.createResource — line_id validation (S0a)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('accepts a line whose plant matches the resource plant', async () => {
    const { svc, org, repo } = make({
      validateLineIds: vi.fn().mockResolvedValue({ valid: ['l1'], invalid: [] }),
      getLine: vi.fn().mockResolvedValue({ id: 'l1', plantId: 'p1', name: 'Line 1', status: 'active' }),
    })
    const dto = await svc.createResource('t1', { ...baseDto, lineId: 'l1' }, 'u')
    expect(dto.lineId).toBe('l1')
    expect(org.validateLineIds).toHaveBeenCalledWith('t1', ['l1']) // O4
    expect(repo.createResourceWithAudit).toHaveBeenCalledOnce()
  })

  it('rejects an unknown line (INVALID_LINE_REFERENCE) — nothing written', async () => {
    const { svc, repo } = make({ validateLineIds: vi.fn().mockResolvedValue({ valid: [], invalid: ['l-bad'] }) })
    await expect(svc.createResource('t1', { ...baseDto, lineId: 'l-bad' }, 'u')).rejects.toMatchObject({ code: 'INVALID_LINE_REFERENCE' })
    expect(repo.createResourceWithAudit).not.toHaveBeenCalled()
  })

  it('rejects a CROSS-PLANT line (LINE_PLANT_MISMATCH) — a resource cannot sit on a line in another plant', async () => {
    const { svc, repo } = make({
      validateLineIds: vi.fn().mockResolvedValue({ valid: ['l-otherplant'], invalid: [] }),
      getLine: vi.fn().mockResolvedValue({ id: 'l-otherplant', plantId: 'p2', name: 'Line 2', status: 'active' }), // plant p2 ≠ resource p1
    })
    await expect(svc.createResource('t1', { ...baseDto, lineId: 'l-otherplant' }, 'u')).rejects.toMatchObject({ code: 'LINE_PLANT_MISMATCH' })
    expect(repo.createResourceWithAudit).not.toHaveBeenCalled()
  })

  it('lineId null → plant-only grain, no line validation touched', async () => {
    const { svc, org, repo } = make()
    const dto = await svc.createResource('t1', { ...baseDto, lineId: null }, 'u')
    expect(dto.lineId).toBeNull()
    expect(org.validateLineIds).not.toHaveBeenCalled()
    expect(org.getLine).not.toHaveBeenCalled()
    expect(repo.createResourceWithAudit).toHaveBeenCalledOnce()
  })
})
