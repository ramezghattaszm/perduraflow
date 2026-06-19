import { boolean, doublePrecision, index, integer, text, timestamp } from 'drizzle-orm/pg-core'
import type { MasterDataStatus, ResourceType } from '@perduraflow/contracts'
import { generateId } from '../../../db/ulid'
import { masterDataSchema } from './_schema'

/**
 * Resource (machine / line / cell / work-centre) — MD14/5.5, brief §3. `plant_id`
 * and `calendar_id` reference the kernel **org** module by plain text id — **no
 * cross-schema FK** — validated at write through `org.read 1.1` (O4). Carries a
 * nominal `rate` (AS5); per-operation std times are the scheduling baseline (D7).
 */
export const resource = masterDataSchema.table(
  'resource',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    name: text('name').notNull(),
    resourceType: text('resource_type').$type<ResourceType>().notNull(),
    plantId: text('plant_id').notNull(),
    calendarId: text('calendar_id').notNull(),
    rate: doublePrecision('rate'),
    rateUom: text('rate_uom'),
    // Tier-B cost rates (phase 3, masterdata.read 1.2) — Master-Data-owned reference
    // data; the cost/unit calculation lives in scheduling (api-spec §12.8).
    runCostPerHour: doublePrecision('run_cost_per_hour'),
    setupCost: doublePrecision('setup_cost'),
    overheadPerUnit: doublePrecision('overhead_per_unit'),
    // Shift model (D-shift): per-resource overtime cap override; null → inherit the
    // resource-type default (resource_type_config). Splittability is resource-type-only.
    otCapMinutes: integer('ot_cap_minutes'),
    status: text('status').$type<MasterDataStatus>().notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ tenantIdx: index('resource_tenant_idx').on(t.tenantId) }),
)

/**
 * Resource group — interchangeability grouping (MD14/5.3). A resource may belong
 * to multiple groups (via `resource_group_member`).
 */
export const resourceGroup = masterDataSchema.table(
  'resource_group',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    name: text('name').notNull(),
    plantId: text('plant_id').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ tenantIdx: index('resource_group_tenant_idx').on(t.tenantId) }),
)

/** Resource ↔ group membership (many-to-many). Intra-schema FKs only (O2). */
export const resourceGroupMember = masterDataSchema.table(
  'resource_group_member',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    resourceGroupId: text('resource_group_id')
      .notNull()
      .references(() => resourceGroup.id),
    resourceId: text('resource_id')
      .notNull()
      .references(() => resource.id),
  },
  (t) => ({
    groupIdx: index('rgm_group_idx').on(t.resourceGroupId),
    resourceIdx: index('rgm_resource_idx').on(t.resourceId),
  }),
)

/**
 * Resource-type shift configuration (D-shift) — per `(tenant, resourceType)` defaults for
 * the calendar-aware sequencer: whether ops on this type are **splittable** (interruptible
 * across closed gaps) and the default **overtime cap** (minutes/day a resource may run past
 * its shift windows; a per-resource `resource.otCapMinutes` overrides it).
 */
export const resourceTypeConfig = masterDataSchema.table(
  'resource_type_config',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    resourceType: text('resource_type').$type<ResourceType>().notNull(),
    splittable: boolean('splittable').notNull().default(false),
    otCapMinutes: integer('ot_cap_minutes').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ tenantIdx: index('resource_type_config_tenant_idx').on(t.tenantId) }),
)

export type Resource = typeof resource.$inferSelect
export type NewResource = typeof resource.$inferInsert
export type ResourceTypeConfig = typeof resourceTypeConfig.$inferSelect
export type NewResourceTypeConfig = typeof resourceTypeConfig.$inferInsert
export type ResourceGroup = typeof resourceGroup.$inferSelect
export type NewResourceGroup = typeof resourceGroup.$inferInsert
export type ResourceGroupMember = typeof resourceGroupMember.$inferSelect
export type NewResourceGroupMember = typeof resourceGroupMember.$inferInsert
