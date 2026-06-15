import { z } from 'zod'

/**
 * Per-tenant contract binding mode (platform architecture A8 / §6.3). Per tenant
 * × contract, exactly one counterpart fulfils a domain contract. Phase 2
 * implements only `platform_module`; `connector | upload | native` are later
 * configuration, not code (the binding resolver indirection makes the swap a
 * config change — api-spec §11.1).
 */
export const bindingModeSchema = z.enum(['platform_module', 'connector', 'upload', 'native'])
export type BindingMode = z.infer<typeof bindingModeSchema>

/** A resolved per-tenant binding row (api-spec §11.1, AS12). */
export interface ContractBindingDto {
  contractId: string
  /** Pinned major version (A12: pin major, float minor). */
  major: string
  mode: BindingMode
}
