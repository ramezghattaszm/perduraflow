import { beforeEach, describe, expect, it } from 'vitest'
import { __testInUseProbe } from './config.refsets'
import { ReferenceSetService } from './reference-set.service'
import type { NewReferenceSetAudit, ReferenceSetOverride } from './schema'

/**
 * Reference-set member-level audit (Commit 4) — one append-only row per member change (add / override /
 * suppress / restore), reusing the config_audit shape (member key as the audited unit) + `changedBy` =
 * the JWT sub. Stateful mock repo persists overrides AND captures the audit rows.
 */

function statefulRepo() {
  const store = new Map<string, ReferenceSetOverride>()
  const audit: NewReferenceSetAudit[] = []
  let seq = 0
  const k = (s: string, l: string, sc: string) => `${s}:${l}:${sc}`
  return {
    audit,
    findActive: async (_t: string, s: string, l: string, sc: string) => {
      const r = store.get(k(s, l, sc))
      return r?.isActive ? r : undefined
    },
    insert: async (data: { setKey: string; level: string; scopeId: string; revision?: number }) => {
      const row = { id: `r${++seq}`, isActive: true, revision: data.revision ?? 1, updatedBy: null, ...data } as unknown as ReferenceSetOverride
      store.set(k(data.setKey, data.level, data.scopeId), row)
      return row
    },
    update: async (id: string, payload: unknown, revision: number) => {
      for (const [kk, r] of store) if (r.id === id) { const nr = { ...r, payload, revision } as ReferenceSetOverride; store.set(kk, nr); return nr }
      throw new Error('not found')
    },
    deactivate: async (id: string) => { for (const [kk, r] of store) if (r.id === id) store.set(kk, { ...r, isActive: false }) },
    appendAudit: async (rows: NewReferenceSetAudit[]) => { audit.push(...rows) },
  }
}
const T = 'T1'

describe('ReferenceSetService — member-level audit (one row per change kind)', () => {
  beforeEach(() => __testInUseProbe.reset())

  it('add: a brand-new member writes an `add` row (old null → new metadata), changedBy = the JWT sub', async () => {
    const repo = statefulRepo()
    await new ReferenceSetService(repo as never).setMember('__test_refset', 'tenant', T, T, 'd', { label: 'Delta' }, 'user-9')
    expect(repo.audit).toHaveLength(1)
    expect(repo.audit[0]).toMatchObject({ setKey: '__test_refset', level: 'tenant', scopeId: T, memberKey: 'd', action: 'add', oldValue: null, newValue: { label: 'Delta' }, changedBy: 'user-9' })
  })

  it('override: setting an already-resolving key writes an `override` row (old = inherited metadata → new)', async () => {
    const repo = statefulRepo()
    await new ReferenceSetService(repo as never).setMember('__test_refset', 'tenant', T, T, 'a', { label: 'Alpha-2' }, 'user-9')
    expect(repo.audit).toHaveLength(1)
    expect(repo.audit[0]).toMatchObject({ memberKey: 'a', action: 'override', oldValue: { label: 'Alpha' }, newValue: { label: 'Alpha-2' } })
  })

  it('suppress: writes a `suppress` row (old = suppressed metadata → new null)', async () => {
    const repo = statefulRepo()
    await new ReferenceSetService(repo as never).suppressMember('__test_refset', 'tenant', T, T, 'a', 'user-9')
    expect(repo.audit).toHaveLength(1)
    expect(repo.audit[0]).toMatchObject({ memberKey: 'a', action: 'suppress', oldValue: { label: 'Alpha' }, newValue: null, changedBy: 'user-9' })
  })

  it('restore: after a suppression, writes a `restore` row', async () => {
    const repo = statefulRepo()
    const svc = new ReferenceSetService(repo as never)
    await svc.suppressMember('__test_refset', 'tenant', T, T, 'a', 'user-9')
    await svc.restoreMember('__test_refset', 'tenant', T, T, 'a', 'user-9')
    expect(repo.audit).toHaveLength(2)
    expect(repo.audit[1]).toMatchObject({ memberKey: 'a', action: 'restore', newValue: null, changedBy: 'user-9' })
  })

  it('all four change kinds are represented across a full add/override/suppress/restore sequence', async () => {
    const repo = statefulRepo()
    const svc = new ReferenceSetService(repo as never)
    await svc.setMember('__test_refset', 'tenant', T, T, 'd', { label: 'Delta' }, 'u') // add
    await svc.setMember('__test_refset', 'tenant', T, T, 'a', { label: 'A2' }, 'u') // override
    await svc.suppressMember('__test_refset', 'tenant', T, T, 'b', 'u') // suppress
    await svc.restoreMember('__test_refset', 'tenant', T, T, 'b', 'u') // restore
    expect(repo.audit.map((r) => r.action)).toEqual(['add', 'override', 'suppress', 'restore'])
  })
})
