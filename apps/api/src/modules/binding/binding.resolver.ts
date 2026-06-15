import { HttpStatus, Injectable } from '@nestjs/common'
import type { BindingMode } from '@perduraflow/contracts'
import { AppException, ERROR_CODES } from '../../common/exceptions/app.exception'
import { BindingRepository } from './binding.repository'

/** A domain contract descriptor (`{ id, version }`) as published in `packages/contracts`. */
interface ContractDescriptor {
  id: string
  version: string
}

/**
 * The per-tenant binding resolver (O7, A8 §6.3 — api-spec §11.1). Domain-contract
 * consumers ask the resolver for *the counterpart bound to a contract for their
 * tenant*, never the producing module. Counterparts are registered at the
 * composition root (A2) — the resolver imports no domain module. The bound `mode`
 * is read from the `contract_binding` table (default `platform_module`); the impl
 * registered for that `(contractId, mode)` is returned. Re-binding is a config/row
 * change with zero consumer code change.
 *
 * Kernel contracts (e.g. `org.read`) are consumed directly — bindings are for
 * *domain* contracts only.
 */
@Injectable()
export class BindingResolver {
  private readonly counterparts = new Map<string, unknown>()

  constructor(private readonly repo: BindingRepository) {}

  /**
   * Registers a counterpart implementation for `(contractId, mode)`. Called once
   * per counterpart at the composition root (api-spec §11.1).
   */
  register(contractId: string, mode: BindingMode, impl: unknown): void {
    this.counterparts.set(`${contractId}:${mode}`, impl)
  }

  /**
   * Resolves the counterpart bound to `contract` for `tenantId` and returns it
   * typed as `T` (the contract interface). The consumer depends only on the
   * contract type + this resolver, never on the producing module.
   * @throws AppException UNKNOWN_ERROR - no counterpart registered for the bound mode
   */
  async resolve<T>(tenantId: string, contract: ContractDescriptor): Promise<T> {
    const mode: BindingMode = (await this.repo.findMode(tenantId, contract.id)) ?? 'platform_module'
    const impl = this.counterparts.get(`${contract.id}:${mode}`)
    if (!impl) {
      throw new AppException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        `No counterpart registered for ${contract.id} mode '${mode}'`,
        ERROR_CODES.UNKNOWN_ERROR,
      )
    }
    return impl as T
  }
}
