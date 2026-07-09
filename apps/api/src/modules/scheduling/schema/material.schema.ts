import { doublePrecision, index, text, timestamp } from 'drizzle-orm/pg-core'
import { generateId } from '../../../db/ulid'
import { schedulingSchema } from './_schema'

/**
 * Material availability (§4.8) — the scheduler's material-gate **input** (D36): when a
 * purchased/raw component is available (on-hand + inbound receipts → an availability date),
 * scheduler-owned exactly like {@link demandInput}. **Seeded** for now (SKIP-10 style); the
 * real source is ERP/inventory/MES via the D35 modes. `component_part_no` → master-data by the
 * durable **business key** (Pattern A; resolve-as-of, never a part version `id`), no FK — O4;
 * `plant_id` → kernel `org` (text ref). A component with no row is treated as fully on-hand (no
 * gate). Modeled as a single "fully-covered" date per component (quantity-phased netting is a later
 * refinement; buy-components only — make/precedence is D37).
 */
export const materialAvailability = schedulingSchema.table(
  'material_availability',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    plantId: text('plant_id').notNull(),
    componentPartNo: text('component_part_no').notNull(),
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

// Material requirement (the interim BOM-lite table) was RETIRED in Layer 2 2a.5 (D-L2-4, migration 0035):
// the material gate now explodes each FG's published master-data BOM → buy leaves (via the `bom.read`
// binding) instead. `material_availability` (below) is unchanged — it stays the availability-date input.

/**
 * Resource ↔ operator assignment (C5, §4.8) — a **consumed pinned** scheduler input: who
 * runs which line, for which window. The scheduler READS this to apply the assigned operator's
 * `operator.performanceFactor` to the op's run time (effectiveCycle = baseCycle / performanceFactor);
 * it **never assigns or optimizes** the roster — that stays outside the labor boundary. **Seeded**
 * for the demo (a couple of pointed assignments); production fills it from a real roster. The
 * factor lives on the operator, not here (operator-level performance; task-specific factor-on-row
 * and recurring shift windows are documented future refinements). `resource_id`/`operator_id` →
 * master-data, `plant_id` → kernel `org` — text refs, **no cross-schema FK** (O4). The window is a
 * nullable `[effective_from, effective_to]` range (null = open-ended), point-resolved at op start.
 * A resource with no assignment covering the op's start = factor 1.0 (standard) — exactly like a
 * component with no material row = on-hand.
 */
export const resourceOperatorAssignment = schedulingSchema.table(
  'resource_operator_assignment',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    plantId: text('plant_id').notNull(),
    resourceId: text('resource_id').notNull(),
    operatorId: text('operator_id').notNull(),
    /** Window start (epoch via timestamptz); null = open start. */
    effectiveFrom: timestamp('effective_from', { withTimezone: true }),
    /** Window end; null = open end. */
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('resource_operator_assignment_tenant_idx').on(t.tenantId),
    resourceIdx: index('resource_operator_assignment_resource_idx').on(t.resourceId),
  }),
)

export type MaterialAvailability = typeof materialAvailability.$inferSelect
export type NewMaterialAvailability = typeof materialAvailability.$inferInsert
export type ResourceOperatorAssignment = typeof resourceOperatorAssignment.$inferSelect
export type NewResourceOperatorAssignment = typeof resourceOperatorAssignment.$inferInsert
