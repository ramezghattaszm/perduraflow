import { doublePrecision, index, integer, jsonb, text, timestamp } from 'drizzle-orm/pg-core'
import type { ChangeSet, CostedKpis, NarrationMode, WhatIfOption } from '@perduraflow/contracts'
import { generateId } from '../../../db/ulid'
import { schedulingSchema } from './_schema'

/**
 * Historical outcome (phase 5, D57 — the `measured_historical` baseline arm). A
 * past plan's recorded actual result for a plant (and optionally one line). Seeded
 * representative now; a real MES/historian writes the **same row shape** later with
 * `source = 'mes'` — zero code change. `resource_id` is a plain `text` master-data
 * reference (no cross-schema FK, O2). The measured arm aggregates these rows; a
 * scope with no rows yields the honest empty state (never a fabricated baseline).
 */
export const historicalOutcome = schedulingSchema.table(
  'historical_outcome',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    plantId: text('plant_id').notNull(),
    resourceId: text('resource_id'),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    otif: doublePrecision('otif').notNull(),
    costPerUnit: doublePrecision('cost_per_unit'),
    // OEE stored as its A·P·Q breakdown (what a real MES/historian records), plus the
    // blended product — so the baseline OEE is aggregated honestly, never fabricated.
    oeeAvailability: doublePrecision('oee_availability'),
    oeePerformance: doublePrecision('oee_performance'),
    oeeQuality: doublePrecision('oee_quality'),
    oee: doublePrecision('oee'),
    lateOrders: integer('late_orders').notNull().default(0),
    throughput: doublePrecision('throughput'),
    label: text('label').notNull(),
    source: text('source').notNull().default('seed'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('historical_outcome_tenant_idx').on(t.tenantId),
    plantIdx: index('historical_outcome_plant_idx').on(t.plantId),
  }),
)

/**
 * What-if result (phase 5, D55) — a persisted evaluation of a change-set. The
 * `options` jsonb carries each ranked option **with its structured rationale** —
 * deliberately stored so phase 6 can answer "why not B / what drove the cost" from
 * the stored form without re-running the engine (DoD proof #8), and so the
 * evaluation is auditable (D6). `determinism_key` is the hash of the inputs; the
 * same change-set + base + overlay + weights re-uses/reproduces the same result.
 */
export const whatIfResult = schedulingSchema.table(
  'what_if_result',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    plantId: text('plant_id').notNull(),
    baseVersionId: text('base_version_id').notNull(),
    changeSet: jsonb('change_set').$type<ChangeSet>().notNull(),
    baseKpis: jsonb('base_kpis').$type<CostedKpis>().notNull(),
    options: jsonb('options').$type<WhatIfOption[]>().notNull(),
    recommendedOptionId: text('recommended_option_id'),
    determinismKey: text('determinism_key').notNull(),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('what_if_result_tenant_idx').on(t.tenantId),
    determinismIdx: index('what_if_result_determinism_idx').on(t.determinismKey),
  }),
)

/**
 * What-if narration (phase 5, A19) — the async, translate-only prose for a result
 * (one option or an across-options summary). Recorded **after** the result renders,
 * never in the commit path; `status` distinguishes ready prose from an unavailable
 * model. `model` + `prompt_version` pin provenance for the D6 audit.
 */
export const whatIfNarration = schedulingSchema.table(
  'what_if_narration',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    resultId: text('result_id')
      .notNull()
      .references(() => whatIfResult.id),
    optionId: text('option_id'),
    mode: text('mode').$type<NarrationMode>().notNull(),
    status: text('status').$type<'ready' | 'unavailable'>().notNull(),
    prose: text('prose'),
    model: text('model'),
    promptVersion: text('prompt_version'),
    provider: text('provider'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ resultIdx: index('what_if_narration_result_idx').on(t.resultId) }),
)

export type HistoricalOutcome = typeof historicalOutcome.$inferSelect
export type NewHistoricalOutcome = typeof historicalOutcome.$inferInsert
export type WhatIfResult = typeof whatIfResult.$inferSelect
export type NewWhatIfResult = typeof whatIfResult.$inferInsert
export type WhatIfNarration = typeof whatIfNarration.$inferSelect
export type NewWhatIfNarration = typeof whatIfNarration.$inferInsert
