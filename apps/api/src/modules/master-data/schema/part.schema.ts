import { sql } from 'drizzle-orm'
import { type AnyPgColumn, index, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import type { MakeBuy, MasterDataStatus, PartType } from '@perduraflow/contracts'
import { generateId } from '../../../db/ulid'
import { masterDataSchema } from './_schema'

/**
 * Part master — core (MD1/5.1, brief §3). Global-within-tenant identity (D12);
 * `part_no` is the durable business key. Physical attributes (material/gauge/colour,
 * MD11/5.6) are the changeover drivers (AS6). Single base UoM, no conversion (SKIP-02);
 * no BOM (SKIP-45).
 *
 * **Layer 0 — Pattern A (revisioned):** each engineering revision is its OWN row
 * (per-version `id`), keyed by `part_no` + `[effective_from, effective_to)`. Consumers
 * resolve by `part_no` + as-of (never by version `id`). `effective_to IS NULL` = the
 * open/current version; a partial unique index enforces at most one open version per
 * `part_no`. `supersedes_id` links a version to the one it replaced (self-ref, intra-schema).
 * A fresh part starts at revision `A`, effective from creation; supersession (Commit 5)
 * closes the prior window and opens a new version.
 */
export const part = masterDataSchema.table(
  'part',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    partNo: text('part_no').notNull(),
    description: text('description'),
    partType: text('part_type').$type<PartType>().notNull(),
    uom: text('uom').notNull(),
    material: text('material'),
    gauge: text('gauge'),
    colour: text('colour'),
    status: text('status').$type<MasterDataStatus>().notNull().default('active'),
    // Layer 1 §4A part-core. `make_buy` is the authoritative sourcing flag (NOT NULL, NO DB default —
    // every insert states it, like `part_no`; migration 0026 backfills then drops the transient default).
    // customer_part_no/customer_id/program are engineering refs (nullable); customer_id/program are kernel
    // org refs validated at the write path via org.read 1.2 (O4). All ride the part revision (copied
    // forward on revisePart), never plant-scoped here (plant variance is the part_plant override layer).
    makeBuy: text('make_buy').$type<MakeBuy>().notNull(),
    customerPartNo: text('customer_part_no'),
    customerId: text('customer_id'),
    program: text('program'),
    // Layer 0 versioning (Pattern A). `revision`/`effective_from` carry DB defaults so a
    // fresh create (and the seed) start at revision 'A' effective now, without every insert
    // site restating them; a revise (Commit 5) supplies them explicitly.
    revision: text('revision').notNull().default('A'),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    supersedesId: text('supersedes_id').references((): AnyPgColumn => part.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('part_tenant_idx').on(t.tenantId),
    // At most one OPEN (current) version per part_no within a tenant (Pattern A).
    partNoOpenUnique: uniqueIndex('part_tenant_part_no_open_unique')
      .on(t.tenantId, t.partNo)
      .where(sql`${t.effectiveTo} is null`),
  }),
)

export type Part = typeof part.$inferSelect
export type NewPart = typeof part.$inferInsert
