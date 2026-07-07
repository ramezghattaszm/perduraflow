import { REFERENCE_READ_CONTRACT, type ReferenceReadContract } from '@perduraflow/contracts'
import { describe, expect, it } from 'vitest'
import { BindingResolver } from '../binding/binding.resolver'
import { ReferenceReadService } from './reference-read.service'
import { ReferenceSetService } from './reference-set.service'

/**
 * `reference.read 1.0` resolves through the O7 binding (like `masterdata.read`). Registers the
 * ReferenceReadService as the `platform_module` counterpart on a BindingResolver, resolves it by contract
 * descriptor, and confirms the resolved impl serves the reference set — proving the composition-root wiring.
 */
describe('reference.read — resolution through the binding', () => {
  it('registers + resolves the counterpart and serves the resolved reference set', async () => {
    // no per-tenant binding row → BindingResolver defaults the mode to platform_module
    const bindingRepo = { findMode: async () => undefined } as never
    const resolver = new BindingResolver(bindingRepo)

    // the real impl over a global-only reference set (mock repo → no stored overrides)
    const refRepo = { findActive: async () => undefined } as never
    const impl = new ReferenceReadService(new ReferenceSetService(refRepo))
    resolver.register(REFERENCE_READ_CONTRACT.id, 'platform_module', impl)

    // a consumer resolves the contract for its tenant, exactly as scheduling resolves masterdata.read
    const bound = await resolver.resolve<ReferenceReadContract>('T1', REFERENCE_READ_CONTRACT)
    expect(bound.contract).toBe(REFERENCE_READ_CONTRACT)

    const resolved = await bound.resolveReferenceSet('T1', '__test_refset')
    expect(resolved.setKey).toBe('__test_refset')
    expect(resolved.members.map((m) => m.key)).toEqual(['a', 'b', 'c']) // platform defaults, resolved via the binding
    expect(resolved.members[0]!.metadata).toEqual({ label: 'Alpha' })

    // listReferenceSets is served too
    const sets = await bound.listReferenceSets()
    expect(sets.map((s) => s.setKey).sort()).toEqual(['__test_map', '__test_refset'])
  })
})
