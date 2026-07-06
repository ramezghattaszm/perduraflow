import { sql } from 'drizzle-orm'
import { type AnyPgColumn, index, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { generateId } from '../../../db/ulid'
import { masterDataSchema } from './_schema'

/**
 * Plant-local part alias → global part (Layer 1 §4D / MD9). A plant may refer to a part by its own
 * `plant_part_no`; this maps `(plant_id, plant_part_no)` to the durable global `part_no`. Resolution
 * is deterministic and as-of — {@link MasterDataResolver.resolvePlantPart} — and returns a **typed**
 * `UNRESOLVABLE_PART_REF` when no mapping window covers the instant (never a guess; no exception queue
 * until Layer 3, D-MD9).
 *
 * **Windowed flavour (Pattern A shape):** own `[effective_from, effective_to)` + `supersedes_id`; a
 * partial unique index enforces at most one OPEN mapping per `(tenant, plant_id, plant_part_no)`, and a
 * custom GiST `EXCLUDE` (custom SQL `0003`) rejects any overlapping window for the same triple. `plant_id`
 * is a kernel org ref validated at the write path via `org.read` (O4).
 */
export const plantPartMapping = masterDataSchema.table(
  'plant_part_mapping',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    /** Kernel org plant ref (validated via org.read at write, O4). */
    plantId: text('plant_id').notNull(),
    /** The plant's own local part number (the alias to resolve). */
    plantPartNo: text('plant_part_no').notNull(),
    /** The global business key it resolves to. */
    partNo: text('part_no').notNull(),
    // Own effectivity window + supersession chain.
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    supersedesId: text('supersedes_id').references((): AnyPgColumn => plantPartMapping.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('plant_part_mapping_tenant_idx').on(t.tenantId),
    // At most one OPEN mapping per (plant_id, plant_part_no) within a tenant.
    openUnique: uniqueIndex('plant_part_mapping_tenant_plant_alias_open_unique')
      .on(t.tenantId, t.plantId, t.plantPartNo)
      .where(sql`${t.effectiveTo} is null`),
  }),
)

export type PlantPartMapping = typeof plantPartMapping.$inferSelect
export type NewPlantPartMapping = typeof plantPartMapping.$inferInsert
