import { doublePrecision, integer, text, timestamp, unique } from 'drizzle-orm/pg-core'
import type { Tier2Mode } from '@perduraflow/contracts'
import { generateId } from '../../../db/ulid'
import { policySchema } from './_schema'

/**
 * Per-tenant autonomy config (phase 4 — api-spec §13.5). The confidence threshold +
 * tier behavior the learning gate reads (A18 trust envelope; D42 configurable, D48
 * safe defaults). One row per tenant; Tier-3 is always human (the A18 floor) so it
 * carries no field — it cannot be relaxed via config.
 */
export const autonomyConfig = policySchema.table(
  'autonomy_config',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    tier1AutoThreshold: doublePrecision('tier1_auto_threshold').notNull().default(0.75),
    tier2Mode: text('tier2_mode').$type<Tier2Mode>().notNull().default('advisory'),
    /** Crossing-threshold band override (fraction over std); null = §12.7 default. */
    wearBandOverride: doublePrecision('wear_band_override'),
    /** Snooze re-surface overrides (D-snooze); null → the RULE.SNOOZE_* constants. */
    snoozeConfDelta: doublePrecision('snooze_conf_delta'),
    snoozeUrgencyMinutes: integer('snooze_urgency_minutes'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ tenantUnique: unique('autonomy_config_tenant_unique').on(t.tenantId) })
)

export type AutonomyConfig = typeof autonomyConfig.$inferSelect
export type NewAutonomyConfig = typeof autonomyConfig.$inferInsert
