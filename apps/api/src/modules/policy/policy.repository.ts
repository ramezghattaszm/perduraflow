import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { POLICY_DB, type PolicyDatabase } from './policy.db'
import { autonomyConfig, type AutonomyConfig, type NewAutonomyConfig } from './schema'

/** Drizzle queries for the policy module (scoped to its own schema, O2). */
@Injectable()
export class PolicyRepository {
  constructor(@Inject(POLICY_DB) private readonly db: PolicyDatabase) {}

  findByTenant(tenantId: string): Promise<AutonomyConfig | undefined> {
    return this.db.query.autonomyConfig.findFirst({
      where: eq(autonomyConfig.tenantId, tenantId),
    })
  }

  /** Upsert the single per-tenant row. */
  async upsert(data: NewAutonomyConfig): Promise<AutonomyConfig> {
    const existing = await this.findByTenant(data.tenantId)
    if (existing) {
      const [row] = await this.db
        .update(autonomyConfig)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(autonomyConfig.id, existing.id))
        .returning()
      return row!
    }
    const [row] = await this.db.insert(autonomyConfig).values(data).returning()
    return row!
  }
}
