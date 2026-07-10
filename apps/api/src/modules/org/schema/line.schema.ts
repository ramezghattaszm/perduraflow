import { index, text, timestamp } from 'drizzle-orm/pg-core'
import { generateId } from '../../../db/ulid'
import { orgSchema } from './_schema'

/**
 * Line (Scheduling S0a) — a producing line within a plant; the first realized
 * sub-plant **containment** level. Mirrors {@link plant} one level down: tenant-scoped,
 * `plant_id` is a plain text single-parent ref (no cross-schema FK — O2; validated at
 * write via `org.read`/`validatePlantIds`, O4). Soft delete is the `status` transition
 * (active → inactive), never a hard delete. Distinct from `resource_group` (a M:N
 * eligibility pool) — a line is a *location* (1:N), never a capability set.
 */
export const line = orgSchema.table(
  'line',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    /** Single-parent containment — the plant this line belongs to (plain text, O2; O4-validated at write). */
    plantId: text('plant_id').notNull(),
    name: text('name').notNull(),
    status: text('status', { enum: ['active', 'inactive'] })
      .notNull()
      .default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('line_tenant_idx').on(t.tenantId),
    plantIdx: index('line_plant_idx').on(t.plantId),
  }),
)

export type Line = typeof line.$inferSelect
export type NewLine = typeof line.$inferInsert
