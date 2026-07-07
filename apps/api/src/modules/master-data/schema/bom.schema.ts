import { sql } from 'drizzle-orm'
import { type AnyPgColumn, index, numeric, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { generateId } from '../../../db/ulid'
import { masterDataSchema } from './_schema'

/**
 * BOM version lifecycle (Layer 2 §4a, D-L2-2) — a **combined** status machine + effectivity window
 * (mirrors `schedule_version`'s draft→committed superseding, but with Pattern-A windows):
 * - `draft`      — no window (`effective_from` null), invisible to resolve-as-of, freely edited. At most
 *                  ONE open draft per `parent_part_no`.
 * - `published`  — an open window (`effective_from` set, `effective_to` null). At most ONE open published
 *                  per `parent_part_no`. This is what `resolveBom` returns.
 * - `superseded` — a closed past window (`effective_to` set); still queryable as-of (reconstruction).
 */
export const BOM_STATUSES = ['draft', 'published', 'superseded'] as const
export type BomStatus = (typeof BOM_STATUSES)[number]

/**
 * BOM version header (Layer 2 §4a.1, D-L2-1) — keyed to the durable business key `parent_part_no`, with
 * its OWN `revision`/window/`supersedes_id`, **independent of the parent part's revision** (like routing).
 * Version-level effectivity (not per-edge, deviating from spec §5.3) so publish-the-whole-BOM is one atomic
 * window flip. Edges are children ({@link bomComponent}) that ride this window.
 */
export const bom = masterDataSchema.table(
  'bom',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    parentPartNo: text('parent_part_no').notNull(),
    revision: text('revision').notNull().default('A'),
    status: text('status').$type<BomStatus>().notNull().default('draft'),
    /** Window start — NULL while `draft`; set on publish. */
    effectiveFrom: timestamp('effective_from', { withTimezone: true }),
    /** Window end — NULL = the open published version; set when superseded. */
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    supersedesId: text('supersedes_id').references((): AnyPgColumn => bom.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('bom_tenant_idx').on(t.tenantId),
    // At most one open DRAFT per parent_part_no within a tenant.
    draftUnique: uniqueIndex('bom_parent_draft_unique')
      .on(t.tenantId, t.parentPartNo)
      .where(sql`${t.status} = 'draft'`),
    // At most one open PUBLISHED per parent_part_no within a tenant.
    publishedOpenUnique: uniqueIndex('bom_parent_published_open_unique')
      .on(t.tenantId, t.parentPartNo)
      .where(sql`${t.status} = 'published' and ${t.effectiveTo} is null`),
  }),
)

/**
 * BOM edge (Layer 2 §4a.1) — a **single-level** parent→direct-component link, a CHILD of a {@link bom}
 * version (`bom_id` FK). **No per-edge effectivity** — the edge rides the version window (multi-level +
 * `level` are DERIVED at explode time, 2a.2). `qty_per`/`scrap_pct` are `numeric` (EXACT — the Layer-1
 * factor precedent; they feed downstream quantity math where the exact-decimal decision fires) and travel
 * as node-postgres' native decimal STRING (no global OID-1700 parser).
 */
export const bomComponent = masterDataSchema.table(
  'bom_component',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    bomId: text('bom_id')
      .notNull()
      .references(() => bom.id),
    componentPartNo: text('component_part_no').notNull(),
    qtyPer: numeric('qty_per').notNull(),
    scrapPct: numeric('scrap_pct'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    bomIdx: index('bom_component_bom_idx').on(t.bomId),
    tenantIdx: index('bom_component_tenant_idx').on(t.tenantId),
  }),
)

export type Bom = typeof bom.$inferSelect
export type NewBom = typeof bom.$inferInsert
export type BomComponent = typeof bomComponent.$inferSelect
export type NewBomComponent = typeof bomComponent.$inferInsert
