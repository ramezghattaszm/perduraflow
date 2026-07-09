import { sql } from 'drizzle-orm'
import { boolean, index, numeric, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { generateId } from '../../../db/ulid'
import { masterDataSchema } from './_schema'
import { resource } from './resource.schema'

/**
 * Tooling asset (Layer 2 2b, §5.1 / MD10/MD14, D-L2-5) — **Pattern B (mutable-with-audit, stable id)**,
 * consistent with `resource`: an operational asset (die/mold/fixture/tool), NOT ECN-revisioned (spec
 * marks its effectivity optional). Stable `id`; `asset_id` is the durable business key; changes are
 * in-place UPDATEs with an audit row (never a new version). `plant_id` is a kernel org ref validated at
 * the write path via `org.read` (O4). `tool_family` is the target the Layer-1 `part.tool_family` pointer
 * now resolves to. **Live state excluded** (current usage / up-down — transactional, MD10, out of Layer 2).
 *
 * `asset_type` is plain `text` THIS commit; validation against the configurable `asset_type` reference set
 * (via `reference.read`) lands in 2b.3. `tool_life_units` is `numeric` (exact — the factor-as-string
 * precedent; a native decimal string), nullable, paired with a nullable `tool_life_uom`.
 */
export const toolingAsset = masterDataSchema.table(
  'tooling_asset',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    /** Durable business key (unique per tenant among active rows). */
    assetId: text('asset_id').notNull(),
    /** Configurable taxonomy value — plain text now; write-validated against the `asset_type` set in 2b.3. */
    assetType: text('asset_type').notNull(),
    /** The tooling family the Layer-1 `part.tool_family` pointer resolves to. */
    toolFamily: text('tool_family'),
    /** Kernel org plant ref (validated via org.read at write, O4). */
    plantId: text('plant_id').notNull(),
    /** Tool-life budget (exact `numeric`, native decimal string) + its UoM — both nullable. */
    toolLifeUnits: numeric('tool_life_units'),
    toolLifeUom: text('tool_life_uom'),
    /** Whether the tool lives in a single physical location (can't run on two resources at once). */
    singleLocation: boolean('single_location').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('tooling_asset_tenant_idx').on(t.tenantId),
    // At most one ACTIVE tooling asset per (tenant, asset_id); a deactivated row may coexist.
    assetIdActiveUnique: uniqueIndex('tooling_asset_asset_id_active_unique')
      .on(t.tenantId, t.assetId)
      .where(sql`${t.isActive}`),
  }),
)

/** Tooling asset ↔ eligible resource (the resources a tool can run on) — a child of {@link toolingAsset}. */
export const toolingEligibleResource = masterDataSchema.table(
  'tooling_eligible_resource',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    toolingAssetId: text('tooling_asset_id')
      .notNull()
      .references(() => toolingAsset.id),
    resourceId: text('resource_id')
      .notNull()
      .references(() => resource.id),
  },
  (t) => ({
    assetIdx: index('tooling_eligible_resource_asset_idx').on(t.toolingAssetId),
    resourceIdx: index('tooling_eligible_resource_resource_idx').on(t.resourceId),
  }),
)

/** Tooling asset → the parts it produces (`part_no` business keys, resolve-as-of; no FK — O4). */
export const assetPartMap = masterDataSchema.table(
  'asset_part_map',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    toolingAssetId: text('tooling_asset_id')
      .notNull()
      .references(() => toolingAsset.id),
    partNo: text('part_no').notNull(),
  },
  (t) => ({
    assetIdx: index('asset_part_map_asset_idx').on(t.toolingAssetId),
    partIdx: index('asset_part_map_part_idx').on(t.tenantId, t.partNo),
  }),
)

export type ToolingAsset = typeof toolingAsset.$inferSelect
export type NewToolingAsset = typeof toolingAsset.$inferInsert
export type ToolingEligibleResource = typeof toolingEligibleResource.$inferSelect
export type NewToolingEligibleResource = typeof toolingEligibleResource.$inferInsert
export type AssetPartMap = typeof assetPartMap.$inferSelect
export type NewAssetPartMap = typeof assetPartMap.$inferInsert
