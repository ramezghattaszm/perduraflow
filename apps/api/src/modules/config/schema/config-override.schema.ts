import { sql } from 'drizzle-orm'
import { boolean, integer, jsonb, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import type { ConfigGroupKey, ConfigLevel, ConfigValue } from '@perduraflow/contracts'
import { generateId } from '../../../db/ulid'
import { configSchema } from './_schema'

/**
 * A stored configuration **override** at a level (CONFIG-FRAMEWORK-DESIGN). One row per
 * `(tenant, settingGroup, level, scopeId)` while active. `global` is NOT stored here — it's the
 * shipped default held in the group descriptor (the floor); this table holds only `tenant` and
 * `plant` overrides, so every row is tenant-scoped (the standing tenancy rule holds).
 *
 * `payload` is **sparse** — only the fields this level overrides; unset fields cascade from the
 * parent. That sparseness is what enables per-field provenance ("inherited from tenant" vs
 * "overridden at plant"). `revision` bumps on each change (versioning); soft-delete via `isActive`
 * + a partial unique index so a deactivated row can coexist with its active successor.
 */
export const configOverride = configSchema.table(
  'config_override',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    settingGroup: text('setting_group').$type<ConfigGroupKey>().notNull(),
    /** `tenant` or `plant` — `global` is the code-level default, never stored. */
    level: text('level').$type<Exclude<ConfigLevel, 'global'>>().notNull(),
    /** The scope id: the tenantId for a tenant override, the plantId for a plant override. */
    scopeId: text('scope_id').notNull(),
    /** Sparse field overrides for this level (only the keys it sets). */
    payload: jsonb('payload').$type<Record<string, ConfigValue>>().notNull().default({}),
    revision: integer('revision').notNull().default(1),
    isActive: boolean('is_active').notNull().default(true),
    updatedBy: text('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One ACTIVE override per (tenant, group, level, scope); a soft-deleted row may coexist.
    activeUnique: uniqueIndex('config_override_active_unique')
      .on(t.tenantId, t.settingGroup, t.level, t.scopeId)
      .where(sql`${t.isActive}`),
  })
)

export type ConfigOverride = typeof configOverride.$inferSelect
export type NewConfigOverride = typeof configOverride.$inferInsert
