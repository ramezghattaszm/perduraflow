import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrgService } from './org.service'

/**
 * Line entity write path (Scheduling S0a) — a line is single-parent under a plant: its `plant_id` is
 * validated against the tenant's plants at write (O4), and a `LINE_CREATED` event is emitted. Mirrors the
 * plant write shape one level down.
 */

function make(repo: Record<string, ReturnType<typeof vi.fn>>) {
  const events = { publish: vi.fn().mockResolvedValue(undefined) }
  return { svc: new OrgService(repo as never, events as never), events }
}

describe('OrgService.createLine — line validates its plant (S0a)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a line under an existing plant and emits org.line.created', async () => {
    const repo = {
      activePlantIdsIn: vi.fn().mockResolvedValue(['p1']), // the plant resolves
      createLine: vi.fn().mockResolvedValue({ id: 'l1', tenantId: 't1', plantId: 'p1', name: 'Line 1', status: 'active' }),
    }
    const { svc, events } = make(repo)
    const dto = await svc.createLine('t1', { plantId: 'p1', name: 'Line 1', status: 'active' })
    expect(dto).toMatchObject({ id: 'l1', plantId: 'p1', name: 'Line 1', status: 'active' })
    expect(repo.activePlantIdsIn).toHaveBeenCalledWith('t1', ['p1']) // plant validated at write
    expect(events.publish).toHaveBeenCalledWith('org.line.created', expect.objectContaining({ id: 'l1' }), 't1')
  })

  it("rejects a line whose plant does not resolve (PLANT_NOT_FOUND) — nothing written", async () => {
    const repo = {
      activePlantIdsIn: vi.fn().mockResolvedValue([]), // plant absent
      createLine: vi.fn(),
    }
    const { svc } = make(repo)
    await expect(svc.createLine('t1', { plantId: 'p-bad', name: 'Line X', status: 'active' })).rejects.toMatchObject({ code: 'PLANT_NOT_FOUND' })
    expect(repo.createLine).not.toHaveBeenCalled()
  })
})
