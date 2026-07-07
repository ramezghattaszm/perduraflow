import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import { ConfigureGuard } from '../../common/guards/configure.guard'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ReferenceSetController } from './reference-set.controller'

/**
 * Guard coverage for the reference-set admin surface (API §11, mirrors config). Every MUTATION
 * (add/override via setMember, suppress, restore) must sit behind BOTH JwtAuthGuard (class) +
 * ConfigureGuard (method); reads (list/resolve) are auth-only. And `assertScope` must forbid a
 * tenant-level write to any tenant but the caller's.
 */
describe('ReferenceSetController — admin write guards', () => {
  it('requires JwtAuthGuard at the controller level', () => {
    expect(Reflect.getMetadata('__guards__', ReferenceSetController) ?? []).toContain(JwtAuthGuard)
  })

  it('every mutation handler carries ConfigureGuard; reads do NOT', () => {
    const proto = ReferenceSetController.prototype
    for (const method of ['setMember', 'suppress', 'restore'] as const) {
      expect(Reflect.getMetadata('__guards__', proto[method]) ?? []).toContain(ConfigureGuard)
    }
    for (const read of ['list', 'resolve'] as const) {
      expect(Reflect.getMetadata('__guards__', proto[read]) ?? []).not.toContain(ConfigureGuard)
    }
  })

  it('assertScope forbids a tenant-level write to another tenant (before touching the service)', async () => {
    const refset = { setMember: vi.fn() }
    const ctrl = new ReferenceSetController(refset as never, {} as never)
    const user = { tenantId: 'T1', sub: 'u1' } as never
    // assertScope throws synchronously (the handler isn't async) — wrap so it surfaces as a rejection
    await expect(
      (async () => ctrl.setMember(user, '__test_refset', 'tenant', 'OTHER_TENANT', 'a', { metadata: {} }))(),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(refset.setMember).not.toHaveBeenCalled() // rejected before any write
  })

  it('a tenant-level write to the caller’s own tenant is allowed through to the service', async () => {
    const refset = { setMember: vi.fn().mockResolvedValue({ setKey: '__test_refset', members: [] }) }
    const ctrl = new ReferenceSetController(refset as never, {} as never)
    const user = { tenantId: 'T1', sub: 'u1' } as never
    await ctrl.setMember(user, '__test_refset', 'tenant', 'T1', 'a', { metadata: { label: 'X' } })
    expect(refset.setMember).toHaveBeenCalledWith('__test_refset', 'tenant', 'T1', 'T1', 'a', { label: 'X' }, 'u1')
  })
})
