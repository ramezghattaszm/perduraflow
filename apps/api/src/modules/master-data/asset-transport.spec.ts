import 'reflect-metadata'
import { ASSET_READ_CONTRACT, type AssetReadContract } from '@perduraflow/contracts'
import { describe, expect, it } from 'vitest'
import { BindingResolver } from '../binding/binding.resolver'
import { ConfigureGuard } from '../../common/guards/configure.guard'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { AssetReadService } from './asset-read.service'
import { MasterDataAdminController } from './master-data.admin.controller'
import { MasterDataController } from './master-data.controller'

/**
 * asset.read transport (Layer 2 2b, D-L2-3) — guard coverage + binding resolution. Tooling admin CRUD sits
 * behind JwtAuthGuard + ConfigureGuard; tooling reads are auth-only. asset.read resolves through the O7
 * binding, serving both the MOVED resource ops (delegated, same rows) and the tooling ops.
 */

describe('asset.read — transport guard coverage', () => {
  it('tooling admin CRUD is ConfigureGuard-gated (admin controller: both guards)', () => {
    const guards = Reflect.getMetadata('__guards__', MasterDataAdminController) ?? []
    expect(guards).toContain(JwtAuthGuard)
    expect(guards).toContain(ConfigureGuard)
    const proto = MasterDataAdminController.prototype
    for (const m of ['createToolingAsset', 'updateToolingAsset', 'deactivateToolingAsset'] as const) {
      expect(typeof proto[m]).toBe('function')
      expect(Reflect.getMetadata('__guards__', proto[m])).toBeUndefined()
    }
  })

  it('tooling reads are AUTH-ONLY (read controller: JwtAuthGuard, no ConfigureGuard)', () => {
    const guards = Reflect.getMetadata('__guards__', MasterDataController) ?? []
    expect(guards).toContain(JwtAuthGuard)
    expect(guards).not.toContain(ConfigureGuard)
    const proto = MasterDataController.prototype
    for (const m of ['listToolingAssets', 'getToolingAsset', 'toolingAssetsForPart'] as const) {
      expect(typeof proto[m]).toBe('function')
      expect(Reflect.getMetadata('__guards__', proto[m])).toBeUndefined()
    }
  })
})

describe('asset.read — resolution through the binding', () => {
  it('registers + resolves the counterpart, serving a moved resource op AND a tooling op', async () => {
    const mdRead = { getResource: async () => ({ id: 'R1', name: 'Press A', plantId: 'P1' }) }
    const md = {}
    const repo = {
      findToolingAsset: async () => ({ id: 'ta1', assetId: 'DIE-1', assetType: 'die', toolFamily: 'STAMP-A', plantId: 'P1', toolLifeUnits: '50000', toolLifeUom: 'strokes', singleLocation: true, isActive: true }),
      eligibleResourceIdsFor: async () => ['R1'],
      partNosForToolingAsset: async () => ['SAL-1001'],
    }
    const impl = new AssetReadService(mdRead as never, md as never, repo as never)

    const binding = new BindingResolver({ findMode: async () => undefined } as never) // → platform_module
    binding.register(ASSET_READ_CONTRACT.id, 'platform_module', impl)
    const bound = await binding.resolve<AssetReadContract>('t1', ASSET_READ_CONTRACT)
    expect(bound.contract).toBe(ASSET_READ_CONTRACT)

    // moved resource op — delegates to the masterdata.read impl (same row)
    expect(await bound.getResource('t1', 'R1')).toMatchObject({ id: 'R1', name: 'Press A' })
    // tooling op — mapped to the DTO (eligibility + parts + exact-decimal tool life)
    expect(await bound.getToolingAsset('t1', 'ta1')).toEqual({
      id: 'ta1', assetId: 'DIE-1', assetType: 'die', toolFamily: 'STAMP-A', plantId: 'P1',
      toolLifeUnits: '50000', toolLifeUom: 'strokes', singleLocation: true, isActive: true,
      eligibleResourceIds: ['R1'], partNos: ['SAL-1001'],
    })
  })
})
