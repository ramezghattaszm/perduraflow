import { describe, expect, it } from 'vitest'
import { ReferenceSetService } from './reference-set.service'

/**
 * Reference-set membership fold (Commit 2) — the SECOND content kind on config's scope substrate. Rides
 * the same `walkScopePath` walker as config's scalar resolve; only the fold differs. Locks: platform
 * defaults as the `global` floor, add-member + override-metadata up the path, union of keys, `replace` vs
 * `merge` mode, and declared-depth (an undeclared rung is never walked). Tombstone suppression is Commit 3.
 * Repo is mocked so assertions bind only to the fold + walker.
 */

type Payload = { members?: Record<string, Record<string, number | string | boolean>>; tombstones?: string[] }
type Row = { payload: Payload } | undefined
const mockRepo = (rows: Record<string, Row>) =>
  ({ findActive: async (_t: string, k: string, l: string, s: string): Promise<Row> => rows[`${k}:${l}:${s}`] }) as never
const svc = (rows: Record<string, Row> = {}) => new ReferenceSetService(mockRepo(rows))
const keys = (m: { key: string }[]) => m.map((x) => x.key)
const T = 'T1'
const P = 'P1'

describe('ReferenceSetService.resolveReferenceSet — membership fold', () => {
  it('global-only: returns the platform defaults (the floor), sorted, with their metadata', async () => {
    const r = await svc().resolveReferenceSet('__test_refset', T)
    expect(keys(r.members)).toEqual(['a', 'b', 'c'])
    expect(r.members.find((m) => m.key === 'a')!.metadata).toEqual({ label: 'Alpha' })
  })

  it('add a member: a tenant contribution adds a new key — the resolved set is the UNION', async () => {
    const r = await svc({ '__test_refset:tenant:T1': { payload: { members: { d: { label: 'Delta' } } } } }).resolveReferenceSet('__test_refset', T)
    expect(keys(r.members)).toEqual(['a', 'b', 'c', 'd']) // platform defaults + tenant add
    expect(r.members.find((m) => m.key === 'd')!.metadata).toEqual({ label: 'Delta' })
  })

  it('resolves the union across global + tenant (defaults kept, tenant members added)', async () => {
    const r = await svc({ '__test_refset:tenant:T1': { payload: { members: { d: { label: 'Delta' }, e: { label: 'Echo' } } } } }).resolveReferenceSet('__test_refset', T)
    expect(keys(r.members)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('override member metadata (replace mode): a tenant contribution REPLACES the inherited metadata wholesale', async () => {
    const r = await svc({ '__test_refset:tenant:T1': { payload: { members: { a: { label: 'Alpha-Tenant', pinned: true } } } } }).resolveReferenceSet('__test_refset', T)
    expect(keys(r.members)).toEqual(['a', 'b', 'c']) // still 3 keys (override, not add)
    // replace: the whole metadata object is the tenant's — the default {label:'Alpha'} is gone, not merged
    expect(r.members.find((m) => m.key === 'a')!.metadata).toEqual({ label: 'Alpha-Tenant', pinned: true })
  })

  it('merge mode (map-like set): a member key contributed at tenant SHALLOW-merges onto the inherited metadata', async () => {
    const r = await svc({ '__test_map:tenant:T1': { payload: { members: { x: { color: 'blue' } } } } }).resolveReferenceSet('__test_map', T)
    // x: color overridden, size retained from the platform default (per-key shallow merge)
    expect(r.members.find((m) => m.key === 'x')!.metadata).toEqual({ color: 'blue', size: 'L' })
    // y untouched
    expect(r.members.find((m) => m.key === 'y')!.metadata).toEqual({ color: 'green', size: 'M' })
  })

  it('declared depth: an undeclared rung is never walked (a plant row on a {global,tenant} set is ignored)', async () => {
    const r = await svc({ '__test_refset:plant:P1': { payload: { members: { z: { label: 'Zulu' } } } } }).resolveReferenceSet('__test_refset', T, P)
    expect(keys(r.members)).toEqual(['a', 'b', 'c']) // plant rung not declared → z not folded in
  })

  it('a tombstone in a level payload omits the inherited member from the resolved set (Commit-3 fold)', async () => {
    const r = await svc({ '__test_refset:tenant:T1': { payload: { tombstones: ['a'] } } }).resolveReferenceSet('__test_refset', T)
    expect(keys(r.members)).toEqual(['b', 'c']) // 'a' suppressed
  })

  it('rejects an unknown/unregistered set', async () => {
    await expect(svc().resolveReferenceSet('__nope', T)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })
})
