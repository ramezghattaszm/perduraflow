import { doublePrecision, index, text, timestamp } from 'drizzle-orm/pg-core'
import { generateId } from '../../../db/ulid'
import { schedulingSchema } from './_schema'

/**
 * Material availability (§4.8) — the scheduler's material-gate **input** (D36): when a
 * purchased/raw component is available (on-hand + inbound receipts → an availability date),
 * scheduler-owned exactly like {@link demandInput}. **Seeded** for now (SKIP-10 style); the
 * real source is ERP/inventory/MES via the D35 modes. `component_part_id` → master-data
 * (text ref, no FK — O4); `plant_id` → kernel `org` (text ref). A component with no row is
 * treated as fully on-hand (no gate). Modeled as a single "fully-covered" date per component
 * (quantity-phased netting is a later refinement; buy-components only — make/precedence is D37).
 */
export const materialAvailability = schedulingSchema.table(
  'material_availability',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    plantId: text('plant_id').notNull(),
    componentPartId: text('component_part_id').notNull(),
    /** When the component is available to consume (on-hand + receipts landed). */
    availableAt: timestamp('available_at', { withTimezone: true }).notNull(),
    qty: doublePrecision('qty'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('material_availability_tenant_idx').on(t.tenantId),
    plantIdx: index('material_availability_plant_idx').on(t.plantId),
  }),
)

/**
 * Material requirement (BOM-lite) — **interim** source for which finished part consumes
 * which buy-component (FG → component, qty/unit), so the material gate (D36) has something
 * to explode against while the real Master-Data BOM is deferred (SKIP-45). **This table is
 * temporary**: when the master-data BOM lands, the gate reads the BOM (§5.1) and this table
 * retires — a clean swap that keeps the master-data ownership boundary intact today. Buy
 * components only (no `make` / dependent-demand / precedence; that's D37). `part_id` /
 * `component_part_id` → master-data (text refs, no FK — O4).
 */
export const materialRequirement = schedulingSchema.table(
  'material_requirement',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    plantId: text('plant_id').notNull(),
    partId: text('part_id').notNull(), // finished part
    componentPartId: text('component_part_id').notNull(), // consumed buy-component
    qtyPerUnit: doublePrecision('qty_per_unit').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('material_requirement_tenant_idx').on(t.tenantId),
    partIdx: index('material_requirement_part_idx').on(t.partId),
  }),
)

export type MaterialAvailability = typeof materialAvailability.$inferSelect
export type NewMaterialAvailability = typeof materialAvailability.$inferInsert
export type MaterialRequirement = typeof materialRequirement.$inferSelect
export type NewMaterialRequirement = typeof materialRequirement.$inferInsert
