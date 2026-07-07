import { sql } from 'drizzle-orm'
import { boolean, integer, jsonb, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import type { ConfigLevel } from '@perduraflow/contracts'
import { generateId } from '../../../db/ulid'
import { configSchema } from './_schema'

/**
 * A member's per-value metadata (label / i18n key / behavior flags) — a flat scalar map. Kept scalar so
 * the reference-set `merge` mode is a shallow per-key merge (nested-deep deferred, platform doc §3.3).
 */
export type ReferenceMemberMetadata = Record<string, number | string | boolean>

/**
 * A level's sparse contribution to a reference set (CONFIG-REFERENCE-SET-SCOPE §5). `members` are the
 * keys this level ADDS or OVERRIDES (key → metadata); `tombstones` are inherited keys this level
 * SUPPRESSES (applied in Commit 3). Sparse — unset keys cascade from the parent, exactly like the config
 * group `payload`. This structured object is why reference sets get their OWN table (below) rather than
 * literally reusing `config_override` (whose `payload` is typed to a flat `Record<string, ConfigValue>`).
 */
export interface ReferenceSetPayload {
  members?: Record<string, ReferenceMemberMetadata>
  tombstones?: string[]
}

/**
 * Stored **reference-set** override at a level — the membership analogue of {@link configOverride},
 * reusing its exact SHAPE (`(tenant, key, level, scopeId, sparse payload, revision, isActive)` +
 * partial-unique-on-active). Distinct table (not the literal `config_override`) because a reference set
 * is a different content kind: its key is a `set_key` (not a `ConfigGroupKey`) and its `payload` holds
 * member contributions + tombstones (not a flat scalar field map). `global` is NOT stored — platform
 * defaults are the in-code descriptor floor. One ACTIVE row per `(tenant, set_key, level, scopeId)`.
 */
export const referenceSetOverride = configSchema.table(
  'reference_set_override',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    setKey: text('set_key').notNull(),
    /** `tenant` or `plant` — `global` is the code-level default (platform defaults), never stored. */
    level: text('level').$type<Exclude<ConfigLevel, 'global'>>().notNull(),
    /** The scope id: the tenantId for a tenant override, the plantId for a plant override. */
    scopeId: text('scope_id').notNull(),
    /** Sparse member contributions (added/overridden) + tombstones (suppressed keys) for this level. */
    payload: jsonb('payload').$type<ReferenceSetPayload>().notNull().default({}),
    revision: integer('revision').notNull().default(1),
    isActive: boolean('is_active').notNull().default(true),
    updatedBy: text('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One ACTIVE override per (tenant, set_key, level, scope); a soft-deleted row may coexist.
    activeUnique: uniqueIndex('reference_set_override_active_unique')
      .on(t.tenantId, t.setKey, t.level, t.scopeId)
      .where(sql`${t.isActive}`),
  }),
)

export type ReferenceSetOverride = typeof referenceSetOverride.$inferSelect
export type NewReferenceSetOverride = typeof referenceSetOverride.$inferInsert
