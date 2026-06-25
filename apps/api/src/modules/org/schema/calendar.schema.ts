import { boolean, index, jsonb, text, timestamp } from 'drizzle-orm/pg-core'
import { generateId } from '../../../db/ulid'
import { orgSchema } from './_schema'

/**
 * Calendar (D17) — shared reference data: shift patterns, holidays, working days,
 * modelled once and consumed at each layer's own grain. `plant_id` is a plain text
 * ref (tenant-level when null; no cross-schema FK — O2). The JSON fields use basic
 * editors in phase 0 (SKIP-52). Time-boxed closures (maintenance / line-down) are
 * NOT here — they live in the per-resource `master_data.resource_downtime` table so
 * an outage can target one line without taking sibling lines on a shared calendar down.
 */
export const calendar = orgSchema.table(
  'calendar',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    plantId: text('plant_id'),
    name: text('name').notNull(),
    shiftPatterns: jsonb('shift_patterns').notNull().default([]),
    holidays: jsonb('holidays').notNull().default([]),
    // Shift model (D-shift): UTC weekdays the calendar operates (0=Sun … 6=Sat).
    // Default Mon–Sat; Sunday closed. Consumed by the calendar-aware sequencer.
    workingDays: jsonb('working_days').notNull().default([1, 2, 3, 4, 5, 6]),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ tenantIdx: index('calendar_tenant_idx').on(t.tenantId) }),
)

export type Calendar = typeof calendar.$inferSelect
export type NewCalendar = typeof calendar.$inferInsert
