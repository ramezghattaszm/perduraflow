import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MasterDataService } from './master-data.service'

/**
 * Tooling `asset_type` write validation (Layer 2b, D-L2-7). The write path resolves `reference.read` through
 * the O7 binding and rejects an `asset_type` that is not a member of the tenant's resolved set
 * (INVALID_ASSET_TYPE) BEFORE any row is written — the configurable set is the source of truth (D42, nothing
 * hardcoded). Here the binding is stubbed to the platform defaults `[tool, die, mold, fixture]`; the real
 * config→Master-Data callback is exercised end-to-end in config/asset-type-refset.spec.
 */

function make(repo: Record<string, ReturnType<typeof vi.fn>>) {
  const org = { validatePlantIds: vi.fn().mockResolvedValue({ valid: [], invalid: [] }), validateCalendarIds: vi.fn() }
  const events = { publish: vi.fn().mockResolvedValue(undefined) }
  const reference = { resolveReferenceSet: vi.fn().mockResolvedValue({ setKey: 'asset_type', members: [{ key: 'tool' }, { key: 'die' }, { key: 'mold' }, { key: 'fixture' }] }) }
  const bindings = { resolve: vi.fn().mockResolvedValue(reference) }
  const svc = new MasterDataService(repo as never, org as never, events as never, {} as never, bindings as never)
  return { svc, reference, bindings }
}

describe('MasterDataService — asset_type write validation (D-L2-7)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('a registered asset_type writes (resolves the set via reference.read for the tenant)', async () => {
    const repo = {
      resourceIdsIn: vi.fn().mockResolvedValue([]),
      createToolingAssetWithAudit: vi.fn(async (data, _e, _p, makeAudit) => {
        const row = { id: 'ta1', ...data }
        makeAudit(row)
        return row
      }),
    }
    const { svc, reference } = make(repo)
    await svc.createToolingAsset('t1', { assetId: 'DIE-1', assetType: 'die', plantId: 'P1' }, 'user-1')
    expect(repo.createToolingAssetWithAudit).toHaveBeenCalledOnce()
    expect(reference.resolveReferenceSet).toHaveBeenCalledWith('t1', 'asset_type') // tenant-scoped resolve
  })

  it('an unknown asset_type is rejected at write (INVALID_ASSET_TYPE) — nothing is written', async () => {
    const repo = { resourceIdsIn: vi.fn(), createToolingAssetWithAudit: vi.fn() }
    const { svc } = make(repo)
    await expect(
      svc.createToolingAsset('t1', { assetId: 'X-1', assetType: 'sprocket', plantId: 'P1' }, 'user-1'),
    ).rejects.toMatchObject({ code: 'INVALID_ASSET_TYPE' })
    expect(repo.createToolingAssetWithAudit).not.toHaveBeenCalled()
  })

  it('update to an unknown asset_type is rejected; update that omits asset_type skips the check', async () => {
    const before = { id: 'ta1', assetId: 'DIE-1', assetType: 'die', toolFamily: null, plantId: 'P1', toolLifeUnits: null, toolLifeUom: null, singleLocation: true, isActive: true }
    const repo = {
      updateToolingAssetWithAudit: vi.fn(async (_t, _id, patch, _e, _p, build) => {
        const after = { ...before, ...patch }
        build(before, after, [], [], [], [])
        return after
      }),
      eligibleResourceIdsFor: vi.fn().mockResolvedValue([]),
      partNosForToolingAsset: vi.fn().mockResolvedValue([]),
    }
    const { svc, bindings } = make(repo)
    // unknown → rejected before the write
    await expect(svc.updateToolingAsset('t1', 'ta1', { assetType: 'sprocket' }, 'u')).rejects.toMatchObject({ code: 'INVALID_ASSET_TYPE' })
    expect(repo.updateToolingAssetWithAudit).not.toHaveBeenCalled()
    // no asset_type in the patch → validation is not consulted
    await svc.updateToolingAsset('t1', 'ta1', { toolLifeUnits: '40000' }, 'u')
    expect(repo.updateToolingAssetWithAudit).toHaveBeenCalledOnce()
    expect(bindings.resolve).toHaveBeenCalledTimes(1) // only the rejected update touched reference.read
  })
})
