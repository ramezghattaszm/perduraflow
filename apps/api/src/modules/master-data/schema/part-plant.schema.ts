import { sql } from 'drizzle-orm'
import { type AnyPgColumn, index, jsonb, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import type { MakeBuy } from '@perduraflow/contracts'
import { generateId } from '../../../db/ulid'
import { masterDataSchema } from './_schema'

/**
 * Per-plant part **override** layer (Layer 1 §4E scope) — the plant-scoped variance on top of the
 * global-within-tenant part. Keyed to the durable business key `part_no` (NOT a part version `id`):
 * an override is **independent of the part revision** — it rides its own effectivity window and does
 * not re-open when the part is revised. Each overridable column is nullable; **null = inherit the
 * global part value** (not "clear"). `shared_attributes` is a shallow key-merge over the global map
 * (plant key wins; a plant `null` value inherits; nested objects replace wholesale).
 *
 * **Windowed flavour (Pattern A shape):** own `[effective_from, effective_to)` + `supersedes_id`; a
 * partial unique index enforces at most one OPEN override per `(tenant, part_no, plant_id)`, and a
 * custom GiST `EXCLUDE` (custom SQL `0002`) rejects any overlapping window for the same triple.
 * `plant_id` is a kernel org ref validated at the write path via `org.read` (O4). Resolution layers
 * the window-containing override onto the resolved part version in {@link MasterDataResolver.resolvePart}.
 */
export const partPlant = masterDataSchema.table(
  'part_plant',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    /** Durable business key — the override binds to `part_no`, never a version `id` (revision-independent). */
    partNo: text('part_no').notNull(),
    /** Kernel org plant ref (validated via org.read at write, O4). */
    plantId: text('plant_id').notNull(),
    // Overridable columns — each nullable; null = inherit the global part value (§4E).
    makeBuy: text('make_buy').$type<MakeBuy>(),
    material: text('material'),
    gauge: text('gauge'),
    colour: text('colour'),
    toolFamily: text('tool_family'),
    sharedAttributes: jsonb('shared_attributes').$type<Record<string, unknown>>(),
    // Own effectivity window + supersession chain (independent of the part's revision windows).
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    supersedesId: text('supersedes_id').references((): AnyPgColumn => partPlant.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('part_plant_tenant_idx').on(t.tenantId),
    // At most one OPEN override per (part_no, plant_id) within a tenant.
    openUnique: uniqueIndex('part_plant_tenant_part_plant_open_unique')
      .on(t.tenantId, t.partNo, t.plantId)
      .where(sql`${t.effectiveTo} is null`),
  }),
)

export type PartPlant = typeof partPlant.$inferSelect
export type NewPartPlant = typeof partPlant.$inferInsert
