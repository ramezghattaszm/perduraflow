import 'reflect-metadata'
import { BOM_READ_CONTRACT, type BomReadContract } from '@perduraflow/contracts'
import { describe, expect, it } from 'vitest'
import { BindingResolver } from '../binding/binding.resolver'
import { ConfigureGuard } from '../../common/guards/configure.guard'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { BomReadService } from './bom-read.service'
import { MasterDataAdminController } from './master-data.admin.controller'
import { MasterDataController } from './master-data.controller'

/**
 * bom.read transport (Layer 2 2a, D-L2-3) — guard coverage + binding resolution. The draft-authoring
 * ops (reviseBom/publishBom) sit on the admin controller behind JwtAuthGuard + ConfigureGuard; the read
 * ops (resolveBom/explodeBom/whereUsed/integrity) are auth-only. bom.read resolves through the O7 binding
 * (the path 2a.5's gate + net-requirements will use).
 */

describe('bom.read — transport guard coverage', () => {
  it('authoring ops (reviseBom/publishBom) are ConfigureGuard-gated (admin controller: both guards)', () => {
    const guards = Reflect.getMetadata('__guards__', MasterDataAdminController) ?? []
    expect(guards).toContain(JwtAuthGuard)
    expect(guards).toContain(ConfigureGuard) // ← the authoring gate
    const proto = MasterDataAdminController.prototype
    for (const m of ['reviseBom', 'publishBom'] as const) {
      expect(typeof proto[m]).toBe('function')
      expect(Reflect.getMetadata('__guards__', proto[m])).toBeUndefined() // no weaker method-level override
    }
  })

  it('read ops (resolveBom/explode/whereUsed/integrity) are AUTH-ONLY (read controller: JwtAuthGuard, no ConfigureGuard)', () => {
    const guards = Reflect.getMetadata('__guards__', MasterDataController) ?? []
    expect(guards).toContain(JwtAuthGuard)
    expect(guards).not.toContain(ConfigureGuard) // ← reads never require configure
    const proto = MasterDataController.prototype
    for (const m of ['resolveBom', 'bomExplode', 'bomWhereUsed', 'bomIntegrity'] as const) {
      expect(typeof proto[m]).toBe('function')
      expect(Reflect.getMetadata('__guards__', proto[m])).toBeUndefined()
    }
  })
})

describe('bom.read — resolution through the binding', () => {
  it('registers + resolves the counterpart and serves resolveBom/explodeBom (the gate + net-req path)', async () => {
    // a BomReadService over a mocked resolver/repo — enough to prove the DTO surface resolves via the binding
    const resolver = {
      resolveBom: async () => ({
        bom: { parentPartNo: 'FG', revision: 'A', status: 'published', effectiveFrom: new Date('2026-01-01T00:00:00Z'), effectiveTo: null },
        components: [{ componentPartNo: 'C-1', qtyPer: '2', scrapPct: '0.05' }],
      }),
      explodeBom: async () => ({ parentPartNo: 'FG', nodes: [{ partNo: 'C-1', level: 1, parentPartNo: 'FG', isLeaf: true }], cycles: [] }),
    }
    const repo = { bomComponentsFor: async () => [] }
    const impl = new BomReadService(resolver as never, repo as never)

    const bindingRepo = { findMode: async () => undefined } as never // → defaults platform_module
    const binding = new BindingResolver(bindingRepo)
    binding.register(BOM_READ_CONTRACT.id, 'platform_module', impl)

    const bound = await binding.resolve<BomReadContract>('t1', BOM_READ_CONTRACT)
    expect(bound.contract).toBe(BOM_READ_CONTRACT)

    const resolved = await bound.resolveBom('t1', 'FG')
    expect(resolved).toMatchObject({ parentPartNo: 'FG', status: 'published', effectiveFrom: '2026-01-01T00:00:00.000Z' })
    expect(resolved!.components[0]).toEqual({ componentPartNo: 'C-1', qtyPer: '2', scrapPct: '0.05' }) // exact-decimal strings

    const exploded = await bound.explodeBom('t1', 'FG')
    expect(exploded.nodes.map((n) => n.partNo)).toEqual(['C-1'])
  })
})
