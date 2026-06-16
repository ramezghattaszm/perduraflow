import { Injectable } from '@nestjs/common'
import { AUTONOMY_DEFAULTS, type AutonomyConfigDto, type AutonomyConfigUpdate } from '@perduraflow/contracts'
import type { AutonomyConfig } from './schema'
import { PolicyRepository } from './policy.repository'

/** Map a persisted row → the autonomy config DTO. */
const toDto = (r: AutonomyConfig): AutonomyConfigDto => ({
  tier1AutoThreshold: r.tier1AutoThreshold,
  tier2Mode: r.tier2Mode,
  wearBand: r.wearBandOverride,
})

/**
 * Policy service (phase 4 — api-spec §13.5). Owns the per-tenant autonomy config
 * (the gate's threshold + tier behavior). Reads fall back to the **safe defaults**
 * (D48) when unconfigured, so a cold-start tenant runs conservative. Tier-3 stays
 * always-human (the A18 floor) — there is no field to relax it.
 */
@Injectable()
export class PolicyService {
  constructor(private readonly repo: PolicyRepository) {}

  /** The tenant's autonomy config, or the safe defaults if none persisted. */
  async getAutonomyConfig(tenantId: string): Promise<AutonomyConfigDto> {
    const row = await this.repo.findByTenant(tenantId)
    return row ? toDto(row) : { ...AUTONOMY_DEFAULTS }
  }

  /** Set the autonomy config (Objective Policy view; ConfigureGuard, D42 audited). */
  async updateAutonomyConfig(tenantId: string, body: AutonomyConfigUpdate): Promise<AutonomyConfigDto> {
    const row = await this.repo.upsert({
      tenantId,
      tier1AutoThreshold: body.tier1AutoThreshold,
      tier2Mode: body.tier2Mode,
      wearBandOverride: body.wearBand,
    })
    return toDto(row)
  }
}
