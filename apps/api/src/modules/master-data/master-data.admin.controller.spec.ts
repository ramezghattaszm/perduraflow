import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { ConfigureGuard } from '../../common/guards/configure.guard'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { MasterDataAdminController } from './master-data.admin.controller'

/**
 * Guard coverage for the admin write surface (API §11, Layer-0 lesson): every `/admin/master-data/*`
 * write must sit behind BOTH JwtAuthGuard + ConfigureGuard. The guards are declared at the class level,
 * so every handler — including the Layer-1 §4B/§4D/§4E writes added in Commit 6 — inherits them. This
 * test pins that (a regression that dropped the class guard, or a method that re-declared a weaker set,
 * would fail here) and that the new handlers are actually wired.
 */
describe('MasterDataAdminController — admin write guards', () => {
  it('requires JwtAuthGuard + ConfigureGuard at the controller level', () => {
    const guards = Reflect.getMetadata('__guards__', MasterDataAdminController) ?? []
    expect(guards).toContain(JwtAuthGuard)
    expect(guards).toContain(ConfigureGuard)
  })

  it('wires the Layer-1 override / mapping / uom-factor write handlers', () => {
    const proto = MasterDataAdminController.prototype
    for (const method of ['setPartPlantOverride', 'setPlantPartMapping', 'addUomFactor'] as const) {
      expect(typeof proto[method]).toBe('function')
      // no method-level guard override that could narrow/replace the class guards
      expect(Reflect.getMetadata('__guards__', proto[method])).toBeUndefined()
    }
  })
})
