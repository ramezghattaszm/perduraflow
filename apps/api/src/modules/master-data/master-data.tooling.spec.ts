import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MasterDataService } from './master-data.service'

/**
 * Tooling asset write path (Layer 2 2b, D-L2-5) — Pattern B (mutable-with-audit), unit level, repo + org
 * mocked. Proves create/update/deactivate each write their audit row (the Commit-1 *WithAudit discipline —
 * the repo tx atomicity is proven end-to-end separately), and that `plant_id` is org-validated (O4) +
 * eligible resources exist at the write path.
 */

function make(repo: Record<string, ReturnType<typeof vi.fn>>, orgOver: Record<string, unknown> = {}) {
  const org = { validatePlantIds: vi.fn().mockResolvedValue({ valid: [], invalid: [] }), validateCalendarIds: vi.fn(), ...orgOver }
  const events = { publish: vi.fn().mockResolvedValue(undefined) }
  return new MasterDataService(repo as never, org as never, events as never, {} as never)
}

describe('MasterDataService.createToolingAsset — Pattern B create + audit', () => {
  beforeEach(() => vi.clearAllMocks())

  it('validates plant + resources, inserts the asset + children + a create audit', async () => {
    let cap: { data?: Record<string, unknown>; elig?: string[]; parts?: string[]; audit?: Record<string, unknown> } = {}
    const repo = {
      resourceIdsIn: vi.fn().mockResolvedValue(['R1', 'R2']),
      createToolingAssetWithAudit: vi.fn(async (data, elig, parts, makeAudit) => {
        const row = { id: 'ta1', ...data }
        cap = { data, elig, parts, audit: makeAudit(row) }
        return row
      }),
    }
    await make(repo).createToolingAsset('t1', {
      assetId: 'DIE-1', assetType: 'die', toolFamily: 'STAMP-A', plantId: 'P1',
      toolLifeUnits: '50000', toolLifeUom: 'strokes', singleLocation: true,
      eligibleResourceIds: ['R1', 'R2'], partNos: ['SAL-1001'],
    }, 'user-1')

    expect(cap.data).toMatchObject({ assetId: 'DIE-1', assetType: 'die', toolFamily: 'STAMP-A', plantId: 'P1', toolLifeUnits: '50000', toolLifeUom: 'strokes', singleLocation: true })
    expect(cap.elig).toEqual(['R1', 'R2'])
    expect(cap.parts).toEqual(['SAL-1001'])
    expect(cap.audit).toMatchObject({
      entityType: 'tooling_asset', businessKey: 'DIE-1', versionId: 'ta1', action: 'create', actor: 'user-1',
      changedFields: expect.objectContaining({ assetType: { new: 'die' }, eligibleResourceIds: { new: ['R1', 'R2'] }, partNos: { new: ['SAL-1001'] } }),
    })
  })

  it('rejects a bad plant (O4, INVALID_PLANT_REFERENCE) before any write', async () => {
    const repo = { createToolingAssetWithAudit: vi.fn() }
    const svc = make(repo, { validatePlantIds: vi.fn().mockResolvedValue({ valid: [], invalid: ['P-BAD'] }) })
    await expect(svc.createToolingAsset('t1', { assetId: 'D', assetType: 'die', plantId: 'P-BAD' }, 'u')).rejects.toMatchObject({ code: 'INVALID_PLANT_REFERENCE' })
    expect(repo.createToolingAssetWithAudit).not.toHaveBeenCalled()
  })

  it('rejects an eligible resource that does not exist (INVALID_RESOURCE_REFERENCE)', async () => {
    const repo = { resourceIdsIn: vi.fn().mockResolvedValue([]), createToolingAssetWithAudit: vi.fn() }
    await expect(make(repo).createToolingAsset('t1', { assetId: 'D', assetType: 'die', plantId: 'P1', eligibleResourceIds: ['R1'] }, 'u')).rejects.toMatchObject({ code: 'INVALID_RESOURCE_REFERENCE' })
    expect(repo.createToolingAssetWithAudit).not.toHaveBeenCalled()
  })
})

describe('MasterDataService.updateToolingAsset / deactivate — in-place + audit', () => {
  beforeEach(() => vi.clearAllMocks())
  const before = { id: 'ta1', assetId: 'DIE-1', assetType: 'die', toolFamily: 'STAMP-A', plantId: 'P1', toolLifeUnits: '50000', toolLifeUom: 'strokes', singleLocation: true, isActive: true }

  it('a tracked change writes an `update` audit (in place, no new version)', async () => {
    let audit: Record<string, unknown> | null = null
    const repo = {
      updateToolingAssetWithAudit: vi.fn(async (_t, _id, patch, elig, parts, buildAudit) => {
        const after = { ...before, ...patch }
        audit = buildAudit(before, after, ['R1'], elig ?? ['R1'], ['SAL-1001'], parts ?? ['SAL-1001'])
        return after
      }),
      eligibleResourceIdsFor: vi.fn().mockResolvedValue(['R1']),
      partNosForToolingAsset: vi.fn().mockResolvedValue(['SAL-1001']),
    }
    await make(repo).updateToolingAsset('t1', 'ta1', { toolLifeUnits: '40000' }, 'user-1')
    expect(audit).toMatchObject({ entityType: 'tooling_asset', action: 'update', changedFields: { toolLifeUnits: { old: '50000', new: '40000' } } })
  })

  it('deactivate flips is_active → false and audits `deactivate`', async () => {
    let audit: Record<string, unknown> | null = null
    const repo = {
      updateToolingAssetWithAudit: vi.fn(async (_t, _id, patch, elig, parts, buildAudit) => {
        const after = { ...before, ...patch }
        audit = buildAudit(before, after, ['R1'], elig ?? ['R1'], ['SAL-1001'], parts ?? ['SAL-1001'])
        return after
      }),
      eligibleResourceIdsFor: vi.fn().mockResolvedValue(['R1']),
      partNosForToolingAsset: vi.fn().mockResolvedValue(['SAL-1001']),
    }
    await make(repo).deactivateToolingAsset('t1', 'ta1', 'user-1')
    expect(audit).toMatchObject({ action: 'deactivate', changedFields: { isActive: { old: true, new: false } } })
  })
})
