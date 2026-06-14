import { boolean, index, text, timestamp } from 'drizzle-orm/pg-core'
import { generateId } from '../../../db/ulid'
import { orgSchema } from './_schema'
import { plant } from './plant.schema'

/**
 * Plant group (D49) — a tenant-defined grouping. `group_type` `cluster` is the
 * resource-sharing candidate; `division`/`region` are reporting/scope.
 * `allows_resource_sharing` defaults false (only sharing groups may scope shared
 * pools later). A plant may belong to many groups → the junction below.
 */
export const plantGroup = orgSchema.table(
  'plant_group',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    name: text('name').notNull(),
    groupType: text('group_type', { enum: ['cluster', 'division', 'region', 'custom'] }).notNull(),
    allowsResourceSharing: boolean('allows_resource_sharing').notNull().default(false),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ tenantIdx: index('plant_group_tenant_idx').on(t.tenantId) }),
)

/** Junction: plant ↔ plant_group (a plant may join many groups, D49). Intra-schema FKs. */
export const plantGroupMember = orgSchema.table(
  'plant_group_member',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    plantGroupId: text('plant_group_id')
      .notNull()
      .references(() => plantGroup.id),
    plantId: text('plant_id')
      .notNull()
      .references(() => plant.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('plant_group_member_tenant_idx').on(t.tenantId),
    groupIdx: index('plant_group_member_group_idx').on(t.plantGroupId),
  }),
)

export type PlantGroup = typeof plantGroup.$inferSelect
export type NewPlantGroup = typeof plantGroup.$inferInsert
export type PlantGroupMember = typeof plantGroupMember.$inferSelect
