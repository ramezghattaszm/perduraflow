import { index, integer, jsonb, text, timestamp } from 'drizzle-orm/pg-core'
import type { ConfigGroupKey, ConfigLevel, ConfigValue } from '@perduraflow/contracts'
import { generateId } from '../../../db/ulid'
import { configSchema } from './_schema'

/**
 * Configuration **audit** log (append-only, immutable) — every config change is a recorded,
 * attributable event (who, when, group, level, scope, field, old→new). IATF: behaviour traces
 * to a stated, dated policy. One row per changed field per change event.
 */
export const configAudit = configSchema.table(
  'config_audit',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    settingGroup: text('setting_group').$type<ConfigGroupKey>().notNull(),
    level: text('level').$type<Exclude<ConfigLevel, 'global'>>().notNull(),
    scopeId: text('scope_id').notNull(),
    field: text('field').notNull(),
    /** Prior value (null = inherited from parent before this change). */
    oldValue: jsonb('old_value').$type<ConfigValue | null>(),
    /** New value (null = reset-to-parent — the field was cleared). */
    newValue: jsonb('new_value').$type<ConfigValue | null>(),
    revision: integer('revision').notNull(),
    changedBy: text('changed_by'),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scopeIdx: index('config_audit_scope_idx').on(t.tenantId, t.settingGroup, t.level, t.scopeId),
  })
)

export type ConfigAudit = typeof configAudit.$inferSelect
export type NewConfigAudit = typeof configAudit.$inferInsert
