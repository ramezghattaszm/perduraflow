import { Injectable } from '@nestjs/common'
import {
  POLICY_READ_CONTRACT,
  type AutonomyConfigDto,
  type PolicyReadContract,
} from '@perduraflow/contracts'
import { PolicyService } from './policy.service'

/** DI token for the published `policy.read 1.0` interface (consumed by the learning gate). */
export const POLICY_READ = Symbol('POLICY_READ')

/**
 * In-process implementation of `policy.read 1.0` (api-spec §13.6). The surface the
 * learning **confidence×tier gate** consumes to get the per-tenant threshold. A
 * platform read (A14-style), not a per-tenant binding; no transport (O6).
 */
@Injectable()
export class PolicyReadService implements PolicyReadContract {
  readonly contract = POLICY_READ_CONTRACT

  constructor(private readonly policy: PolicyService) {}

  /** The tenant's autonomy config (or safe defaults) — the gate's threshold + tier behavior. */
  getAutonomyConfig(tenantId: string): Promise<AutonomyConfigDto> {
    return this.policy.getAutonomyConfig(tenantId)
  }
}
