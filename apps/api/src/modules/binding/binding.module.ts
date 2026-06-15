import { Global, Module } from '@nestjs/common'
import { bindingDbProvider } from './binding.db'
import { BindingRepository } from './binding.repository'
import { BindingResolver } from './binding.resolver'

/**
 * Binding module (kernel — A8 §6.3 / api-spec §11.1). Owns the `binding` schema
 * (`contract_binding`) and the `BindingResolver`. **Global** so any domain
 * consumer can inject the resolver without coupling to this module's internals.
 * It imports **no domain module** — counterparts are registered at the
 * composition root (app.module, A2).
 */
@Global()
@Module({
  providers: [bindingDbProvider, BindingRepository, BindingResolver],
  exports: [BindingResolver],
})
export class BindingModule {}
