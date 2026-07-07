import { Inject, Injectable } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
import { CONFIG_DB, type ConfigDatabase } from './config.db'
import { type ReferenceSetOverride, referenceSetOverride } from './schema'

type OverrideLevel = 'tenant' | 'plant'

/**
 * Drizzle queries for the reference-set store (`reference_set_override`, config schema, O2). Mirrors
 * {@link ConfigRepository}'s access pattern on the config-override shape. Commit 2 needs only the active-row
 * read the membership fold walks; add/override/suppress writes + audit land in Commits 3–4.
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
}
