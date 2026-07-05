import { boolean, doublePrecision, index, text, timestamp } from 'drizzle-orm/pg-core'
import type { DemandType, Firmness } from '@perduraflow/contracts'
import { generateId } from '../../../db/ulid'
import { schedulingSchema } from './_schema'

/**
 * Demand input (§4.1) — **seeded canonical fixture** (SKIP-10): no net-requirements
 * netting, no integration. `required_qty` is pre-netted (D14/D20). `part_no` → master-data
 * by the durable **business key** (Pattern A; a live/forward ref, resolved as-of the schedule
 * build time via `resolvePart(part_no, asOf)`, never a part version `id`), no FK — O4; `plant_id`/
 * `customer_id`/`program_id` → kernel `org` (text refs). Priority is read from `org`
 * customer/program, not stored here.
 */
export const demandInput = schedulingSchema.table(
  'demand_input',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    demandLineId: text('demand_line_id').notNull(),
    releaseReference: text('release_reference'),
    partNo: text('part_no').notNull(),
    plantId: text('plant_id').notNull(),
    customerId: text('customer_id').notNull(),
    programId: text('program_id'),
    demandType: text('demand_type').$type<DemandType>().notNull().default('stock'),
    firmness: text('firmness').$type<Firmness>().notNull(),
    requiredQty: doublePrecision('required_qty').notNull(),
    uom: text('uom').notNull(),
    requiredDate: timestamp('required_date', { withTimezone: true }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('demand_input_tenant_idx').on(t.tenantId),
    plantIdx: index('demand_input_plant_idx').on(t.plantId),
  }),
)

export type DemandInput = typeof demandInput.$inferSelect
export type NewDemandInput = typeof demandInput.$inferInsert
