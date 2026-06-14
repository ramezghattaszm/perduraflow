import { boolean, index, jsonb, text, timestamp } from 'drizzle-orm/pg-core'
import { generateId } from '../../../db/ulid'
import { authSchema } from './_schema'
import { approvalTier } from './approval-tier.schema'

/**
 * Role (D33) — a tenant-editable permission set. Phase 0 models the STRUCTURE
 * (data scope + approval tier + the `configure` capability) and seeds the
 * default role set; the full per-dashboard action matrix is SKIP-43.
 *
 * `scopedPlantIds` / `scopedPlantGroupIds` are **plain text id arrays** that
 * reference the org module (no cross-schema FK — O2); they are validated through
 * the `org.read` contract at write time (O4). `approvalTierId` is an intra-schema
 * FK (auth owns approval_tier).
 */
export const role = authSchema.table(
  'role',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    name: text('name').notNull(),
    isDefaultSeed: boolean('is_default_seed').notNull().default(false),
    dataScope: text('data_scope', {
      enum: ['plant', 'plant_group', 'multi_plant', 'tenant'],
    })
      .notNull()
      .default('plant'),
    scopedPlantIds: jsonb('scoped_plant_ids').notNull().default([]),
    scopedPlantGroupIds: jsonb('scoped_plant_group_ids').notNull().default([]),
    approvalTierId: text('approval_tier_id').references(() => approvalTier.id),
    canConfigure: boolean('can_configure').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ tenantIdx: index('role_tenant_idx').on(t.tenantId) }),
)

export type Role = typeof role.$inferSelect
export type NewRole = typeof role.$inferInsert
