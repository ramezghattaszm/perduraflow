import { index, numeric, text, timestamp, unique } from 'drizzle-orm/pg-core'
import { generateId } from '../../../db/ulid'
import { masterDataSchema } from './_schema'
import { part } from './part.schema'

/**
 * Per-part UoM conversion factors (Layer 1 §4B / MD4, D40) — an **engineering** flavour: keyed to the
 * specific part **version** (`part_id` FK → `part.id`), so factors ride the part revision (copied forward
 * on `revisePart`, guarded on the base UoM). `alternate_uom`/`base_uom` are plain `text` from the open
 * known-UoM set (A12 — unknown values accepted, must-ignore). **Invariant:** `base_uom` = the owning part
 * version's `uom`, enforced at the write path (`addUomFactor`). `alt_qty × factor = base_qty`.
 *
 * Master Data **publishes** factors (`getUomFactors`); it never converts others' transactional data (MD4).
 */
export const uomConversion = masterDataSchema.table(
  'uom_conversion',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    partId: text('part_id')
      .notNull()
      .references(() => part.id),
    alternateUom: text('alternate_uom').notNull(),
    baseUom: text('base_uom').notNull(),
    // `numeric` (exact) not `double precision` (binary float) — a conversion factor must round-trip
    // exactly (§4B rider). The global NUMERIC type-parser (db/pool.ts) returns it as a JS `number`.
    factor: numeric('factor').notNull().$type<number>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('uom_conversion_tenant_idx').on(t.tenantId),
    partIdx: index('uom_conversion_part_idx').on(t.partId),
    // At most one factor per (part version, alternate unit).
    altUnique: unique('uom_conversion_part_alt_unique').on(t.tenantId, t.partId, t.alternateUom),
  }),
)

export type UomConversion = typeof uomConversion.$inferSelect
export type NewUomConversion = typeof uomConversion.$inferInsert
