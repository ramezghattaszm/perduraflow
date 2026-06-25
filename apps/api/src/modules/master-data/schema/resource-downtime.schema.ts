import { boolean, index, text, timestamp } from 'drizzle-orm/pg-core'
import type { ResourceDowntimeKind } from '@perduraflow/contracts'
import { generateId } from '../../../db/ulid'
import { masterDataSchema } from './_schema'

/**
 * Resource downtime — a per-resource, time-boxed CLOSURE for `[from, to)` that the
 * calendar-aware sequencer subtracts from available capacity (so ops displace
 * around it, never excluded). The ONE mechanism for both an **unplanned line-down**
 * (`kind='line_down'`, `planned=false`) and a **planned maintenance window**
 * (`kind='maintenance'`, `planned=true`) — they differ only by `kind`/`planned`.
 * Replaces the plant-shared `calendar.maintenance_windows` (which couldn't model a
 * per-line outage without taking sibling lines down).
 *
 * `resource_id`/`plant_id` reference master-data/org by plain text id — **no
 * cross-schema FK** (O2). `plant_id` is denormalized so the plant-scoped solve
 * reads windows without a join. Distinct from `resource.status='inactive'`, which
 * is a permanent decommission (excluded from the eligible set), not a window.
 *
 * Lifecycle: "in effect at now" = `is_active && from_ts ≤ now < to_ts`. "Bring the
 * line back up" early = truncate `to_ts = now` (honest history: it WAS down
 * from→now). `is_active = false` is the soft-delete (retract a mistaken record).
 */
export const resourceDowntime = masterDataSchema.table(
  'resource_downtime',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    resourceId: text('resource_id').notNull(),
    plantId: text('plant_id').notNull(),
    kind: text('kind').$type<ResourceDowntimeKind>().notNull(),
    planned: boolean('planned').notNull().default(false),
    fromTs: timestamp('from_ts', { withTimezone: true }).notNull(),
    toTs: timestamp('to_ts', { withTimezone: true }).notNull(),
    reason: text('reason'),
    isActive: boolean('is_active').notNull().default(true),
    /** Actor who created the window (JWT sub); nullable — the dev simulator may omit it. */
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    plantIdx: index('resource_downtime_plant_idx').on(t.tenantId, t.plantId),
    resourceIdx: index('resource_downtime_resource_idx').on(t.tenantId, t.resourceId),
  }),
)

export type ResourceDowntime = typeof resourceDowntime.$inferSelect
export type NewResourceDowntime = typeof resourceDowntime.$inferInsert
