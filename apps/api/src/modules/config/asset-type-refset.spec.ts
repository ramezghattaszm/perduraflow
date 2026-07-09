import { ASSET_READ_CONTRACT } from '@perduraflow/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AssetReadService } from '../master-data/asset-read.service'
import { BindingResolver } from '../binding/binding.resolver'
import {
  ASSET_TYPE_SET_KEY,
  buildAssetTypeReferenceSet,
  getReferenceSetDescriptor,
  registerReferenceSet,
} from './config.refsets'
import { ReferenceSetService } from './reference-set.service'
import type { ReferenceSetOverride } from './schema'

/**
 * `asset_type` reference set end-to-end (Layer 2b, D-L2-7) — the descriptor + in-use probe registered
 * TOGETHER (the safety invariant), and the REAL config → Master-Data callback through the O7 binding: config
 * suppression resolves `asset.read` and calls its in-use probe; a type still carried by an active
 * `tooling_asset` blocks its own removal with `REFERENCE_VALUE_IN_USE`. Nothing here is mocked on the
 * callback path — a real {@link BindingResolver}, a real {@link AssetReadService}, a real
 * {@link ReferenceSetService}; only the two data repos are in-memory.
 */

// A tiny stateful reference-set repo (set:level:scope) — enough to round-trip suppress → resolve.
function statefulRefsetRepo() {
  const store = new Map<string, ReferenceSetOverride>()
  let seq = 0
  const key = (k: string, l: string, s: string) => `${k}:${l}:${s}`
  return {
    findActive: async (_t: string, k: string, l: string, s: string) => {
      const r = store.get(key(k, l, s))
      return r?.isActive ? r : undefined
    },
    insert: async (data: { setKey: string; level: string; scopeId: string; payload: unknown; revision?: number }) => {
      const row = { id: `r${++seq}`, isActive: true, revision: data.revision ?? 1, updatedBy: null, ...data } as unknown as ReferenceSetOverride
      store.set(key(data.setKey, data.level, data.scopeId), row)
      return row
    },
    update: async (id: string, payload: unknown, revision: number, updatedBy: string | null) => {
      for (const [kk, r] of store) if (r.id === id) { const nr = { ...r, payload, revision, updatedBy } as ReferenceSetOverride; store.set(kk, nr); return nr }
      throw new Error('not found')
    },
    deactivate: async (id: string) => { for (const [kk, r] of store) if (r.id === id) store.set(kk, { ...r, isActive: false }) },
    appendAudit: async () => {},
  }
}

const T = 'T1'

/** Wire the REAL callback: config → binding → asset.read → probe. `activeTypes` are the in-use asset_types. */
function wire(activeTypes: Set<string>) {
  const assetRepo = { existsActiveToolingAssetOfType: async (_t: string, type: string) => activeTypes.has(type) }
  const asset = new AssetReadService({} as never, {} as never, assetRepo as never)
  const bindings = new BindingResolver({ findMode: async () => undefined } as never) // → platform_module
  bindings.register(ASSET_READ_CONTRACT.id, 'platform_module', asset)
  registerReferenceSet(
    buildAssetTypeReferenceSet(async (tenantId, memberKey) =>
      (await bindings.resolve<typeof asset>(tenantId, ASSET_READ_CONTRACT)).hasActiveToolingAssetOfType(tenantId, memberKey),
    ),
  )
  return new ReferenceSetService(statefulRefsetRepo() as never)
}

describe('asset_type reference set — registration invariant + in-use gate through the binding', () => {
  it('descriptor + probe register together — a descriptor with no probe is refused (safety invariant)', () => {
    // buildAssetTypeReferenceSet forces a probe; registering a hand-built descriptor without one throws.
    expect(() => registerReferenceSet({ setKey: ASSET_TYPE_SET_KEY, platformDefaults: [], declaredLevels: ['global', 'tenant'], resolutionMode: 'replace' })).toThrow(/in-use probe/i)
  })

  it('registers the asset_type descriptor with its defaults [tool, die, mold, fixture]', () => {
    wire(new Set())
    const d = getReferenceSetDescriptor(ASSET_TYPE_SET_KEY)
    expect(d?.platformDefaults.map((m) => m.key)).toEqual(['tool', 'die', 'mold', 'fixture'])
    expect(d?.declaredLevels).toEqual(['global', 'tenant'])
    expect(typeof d?.inUse).toBe('function') // the probe is present
  })

  it('BLOCKS suppression when a tooling row carries the type — REFERENCE_VALUE_IN_USE (real binding callback)', async () => {
    const svc = wire(new Set(['die'])) // an active tooling_asset is a die
    await expect(svc.suppressMember(ASSET_TYPE_SET_KEY, 'tenant', T, T, 'die', 'user-1')).rejects.toMatchObject({ code: 'REFERENCE_VALUE_IN_USE' })
    // rejected → nothing written, 'die' still resolves
    expect((await svc.resolveReferenceSet(ASSET_TYPE_SET_KEY, T)).members.map((m) => m.key)).toContain('die')
  })

  it('ALLOWS suppression of a type no tooling row uses (probe false)', async () => {
    const svc = wire(new Set(['die'])) // 'mold' is NOT in use
    const after = await svc.suppressMember(ASSET_TYPE_SET_KEY, 'tenant', T, T, 'mold', 'user-1')
    expect(after.members.map((m) => m.key)).toEqual(['die', 'fixture', 'tool']) // 'mold' gone, sorted
  })
})
