import { beforeEach, describe, expect, it } from 'vitest'
import { __testInUseProbe } from './config.refsets'
import { ReferenceSetService } from './reference-set.service'
import type { ReferenceSetOverride } from './schema'

/**
 * Reference-set suppression (Commit 3) — tombstone hide/restore + the in-use probe gate. A stateful mock
 * repo persists writes so a suppress → resolve round-trips; the test set carries a CONTROLLABLE probe
 * ({@link __testInUseProbe}) so both gate branches (rejected vs allowed) and the "probe only on suppress"
 * invariant are exercised.
 */

// A tiny stateful in-memory repo keyed by set:level:scope — enough to round-trip suppress → resolve.
function statefulRepo() {
  const store = new Map<string, ReferenceSetOverride>()
  let seq = 0
  const key = (k: string, l: string, s: string) => `${k}:${l}:${s}`
  return {
    _store: store,
    findActive: async (_t: string, k: string, l: string, s: string) => {
      const r = store.get(key(k, l, s))
      return r?.isActive ? r : undefined
    },
    insert: async (data: { tenantId: string; setKey: string; level: string; scopeId: string; payload: unknown; revision?: number }) => {
      const row = { id: `r${++seq}`, isActive: true, revision: data.revision ?? 1, updatedBy: null, ...data } as unknown as ReferenceSetOverride
      store.set(key(data.setKey, data.level, data.scopeId), row)
      return row
    },
    update: async (id: string, payload: unknown, revision: number, updatedBy: string | null) => {
      for (const [kk, r] of store) if (r.id === id) {
        const nr = { ...r, payload, revision, updatedBy } as ReferenceSetOverride
        store.set(kk, nr)
        return nr
      }
      throw new Error('not found')
    },
    deactivate: async (id: string) => {
      for (const [kk, r] of store) if (r.id === id) store.set(kk, { ...r, isActive: false })
    },
    appendAudit: async () => {}, // audit assertions live in reference-set.audit.spec
  }
}
const svc = () => new ReferenceSetService(statefulRepo() as never)
const keys = (m: { key: string }[]) => m.map((x) => x.key)
const T = 'T1'

describe('ReferenceSetService — suppression (tombstone) + in-use probe gate', () => {
  beforeEach(() => __testInUseProbe.reset())

  it('suppress hides an inherited default from the resolved set', async () => {
    const s = svc()
    const after = await s.suppressMember('__test_refset', 'tenant', T, T, 'a', 'user-1')
    expect(keys(after.members)).toEqual(['b', 'c']) // 'a' gone
    // re-resolving independently still shows it suppressed (the tombstone persisted)
    expect(keys((await s.resolveReferenceSet('__test_refset', T)).members)).toEqual(['b', 'c'])
    expect(__testInUseProbe.calls).toEqual([{ tenantId: T, memberKey: 'a' }]) // probe consulted once
  })

  it('restore brings a suppressed default back (and never invokes the probe)', async () => {
    const s = svc()
    await s.suppressMember('__test_refset', 'tenant', T, T, 'a', 'user-1')
    __testInUseProbe.calls.length = 0 // clear the suppress call; restore must add none
    const after = await s.restoreMember('__test_refset', 'tenant', T, T, 'a', 'user-1')
    expect(keys(after.members)).toEqual(['a', 'b', 'c']) // back
    expect(__testInUseProbe.calls).toEqual([]) // restore is always safe → no probe
  })

  it('rejects the suppression when the probe reports the value is in use (REFERENCE_VALUE_IN_USE) and writes nothing', async () => {
    const s = svc()
    __testInUseProbe.inUseKeys.add(`${T}:a`) // 'a' is referenced
    await expect(s.suppressMember('__test_refset', 'tenant', T, T, 'a', 'user-1')).rejects.toMatchObject({ code: 'REFERENCE_VALUE_IN_USE' })
    expect(__testInUseProbe.calls).toEqual([{ tenantId: T, memberKey: 'a' }]) // gate consulted the probe
    // no write happened → 'a' still resolves
    expect(keys((await s.resolveReferenceSet('__test_refset', T)).members)).toEqual(['a', 'b', 'c'])
  })

  it('the probe is invoked ONLY on suppression — resolve and restore never call it', async () => {
    const s = svc()
    await s.resolveReferenceSet('__test_refset', T)
    await s.restoreMember('__test_refset', 'tenant', T, T, 'a', 'user-1') // no-op (nothing suppressed)
    expect(__testInUseProbe.calls).toEqual([]) // neither read nor restore touched the probe
  })

  it('a set with NO in-use probe cannot be suppressed (safety invariant)', async () => {
    // __test_map registers no inUse probe → suppression is refused outright
    await expect(svc().suppressMember('__test_map', 'tenant', T, T, 'x', 'user-1')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })
})
