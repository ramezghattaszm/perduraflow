import { Inject, Injectable } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
import { CONFIG_DB, type ConfigDatabase } from './config.db'
import {
  type NewReferenceSetAudit,
  type NewReferenceSetOverride,
  type ReferenceSetOverride,
  type ReferenceSetPayload,
  referenceSetAudit,
  referenceSetOverride,
} from './schema'

// Stored override levels (excludes `global`, the in-code floor). `line` is the S0b rung — accepted by the
// walker's fetch signature; no reference set stores a line row until it declares line depth (S1).
type OverrideLevel = 'tenant' | 'plant' | 'line'

/**
 * Drizzle queries for the reference-set store (`reference_set_override`, config schema, O2). Mirrors
 * {@link ConfigRepository}'s access pattern on the config-override shape: the active-row read the fold
 * walks, plus the sparse-payload upsert/soft-delete the suppression/restore write path uses.
 */
@Injectable()
export class ReferenceSetRepository {
  constructor(@Inject(CONFIG_DB) private readonly db: ConfigDatabase) {}

  /** The active override row for one (tenant, set_key, level, scope), or undefined. */
  findActive(
    tenantId: string,
    setKey: string,
    level: OverrideLevel,
    scopeId: string,
  ): Promise<ReferenceSetOverride | undefined> {
    return this.db.query.referenceSetOverride.findFirst({
      where: and(
        eq(referenceSetOverride.tenantId, tenantId),
        eq(referenceSetOverride.setKey, setKey),
        eq(referenceSetOverride.level, level),
        eq(referenceSetOverride.scopeId, scopeId),
        eq(referenceSetOverride.isActive, true),
      ),
    })
  }

  /** Insert a fresh active override (revision 1 by default). */
  async insert(data: NewReferenceSetOverride): Promise<ReferenceSetOverride> {
    const [row] = await this.db.insert(referenceSetOverride).values(data).returning()
    return row!
  }

  /** Replace an active override's payload, bumping its revision. */
  async update(id: string, payload: ReferenceSetPayload, revision: number, updatedBy: string | null): Promise<ReferenceSetOverride> {
    const [row] = await this.db
      .update(referenceSetOverride)
      .set({ payload, revision, updatedBy, updatedAt: new Date() })
      .where(eq(referenceSetOverride.id, id))
      .returning()
    return row!
  }

  /** Soft-delete an override (the level's whole contribution reset to parent). */
  async deactivate(id: string, updatedBy: string | null): Promise<void> {
    await this.db
      .update(referenceSetOverride)
      .set({ isActive: false, updatedBy, updatedAt: new Date() })
      .where(eq(referenceSetOverride.id, id))
  }

  /** Append member-change audit rows (append-only; one row per add/override/suppress/restore). */
  async appendAudit(rows: NewReferenceSetAudit[]): Promise<void> {
    if (rows.length > 0) await this.db.insert(referenceSetAudit).values(rows)
  }
}
