import { Module } from '@nestjs/common'
import { PolicyController } from './policy.controller'
import { policyDbProvider } from './policy.db'
import { POLICY_READ, PolicyReadService } from './policy-read.service'
import { PolicyRepository } from './policy.repository'
import { PolicyService } from './policy.service'

/**
 * Policy module (phase 4 — per-tenant autonomy/objective config, D42). Owns the
 * `policy` Postgres schema + scoped Drizzle instance, and publishes `policy.read`
 * (POLICY_READ) for the learning confidence×tier gate. EXPORTS only the read
 * interface (O1) — consumers read the contract, not the repository. Objective
 * trade-off weights are a Phase-5 seam in this module's schema, not built yet.
 */
@Module({
  controllers: [PolicyController],
  providers: [
    policyDbProvider,
    PolicyRepository,
    PolicyService,
    PolicyReadService,
    { provide: POLICY_READ, useExisting: PolicyReadService },
  ],
  exports: [POLICY_READ],
})
export class PolicyModule {}
