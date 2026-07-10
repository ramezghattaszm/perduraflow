import { Inject, Injectable } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
import type { ConfigGroupKey } from '@perduraflow/contracts'
import { CONFIG_DB, type ConfigDatabase } from './config.db'
import {
  configAudit,
  configOverride,
  type ConfigOverride,
  type NewConfigAudit,
  type NewConfigOverride,
} from './schema'

// Stored override levels (excludes `global`, the in-code floor). `line` is the S0b rung — accepted by the
// walker's fetch signature; no config group stores a line row until it declares line depth (S1).
type OverrideLevel = 'tenant' | 'plant' | 'line'

/** Drizzle queries for the config module (scoped to its own schema, O2). */
@Injectable()
export class ConfigRepository {
  constructor(@Inject(CONFIG_DB) private readonly db: ConfigDatabase) {}

  /** The active override row for one (tenant, group, level, scope), or undefined. */
  findActive(
    tenantId: string,
    settingGroup: ConfigGroupKey,
    level: OverrideLevel,
    scopeId: string,
  ): Promise<ConfigOverride | undefined> {
    return this.db.query.configOverride.findFirst({
      where: and(
        eq(configOverride.tenantId, tenantId),
        eq(configOverride.settingGroup, settingGroup),
        eq(configOverride.level, level),
        eq(configOverride.scopeId, scopeId),
        eq(configOverride.isActive, true),
      ),
    })
  }

  /** Insert a fresh active override (revision 1). */
  async insert(data: NewConfigOverride): Promise<ConfigOverride> {
    const [row] = await this.db.insert(configOverride).values(data).returning()
    return row!
  }

  /** Replace an active override's payload, bumping its revision. */
  async update(id: string, payload: Record<string, number | string | boolean>, revision: number, updatedBy: string | null): Promise<ConfigOverride> {
    const [row] = await this.db
      .update(configOverride)
      .set({ payload, revision, updatedBy, updatedAt: new Date() })
      .where(eq(configOverride.id, id))
      .returning()
    return row!
  }

  /** Soft-delete an override (reset-to-parent of the whole level). */
  async deactivate(id: string, updatedBy: string | null): Promise<void> {
    await this.db
      .update(configOverride)
      .set({ isActive: false, updatedBy, updatedAt: new Date() })
      .where(eq(configOverride.id, id))
  }

  /** Append audit rows (one per changed field). */
  async appendAudit(rows: NewConfigAudit[]): Promise<void> {
    if (rows.length > 0) await this.db.insert(configAudit).values(rows)
  }
}
