import { boolean, doublePrecision, index, integer, text, timestamp } from 'drizzle-orm/pg-core'
import type { ChangeoverAttributeKey, MasterDataStatus } from '@perduraflow/contracts'
import { generateId } from '../../../db/ulid'
import { masterDataSchema } from './_schema'
import { part } from './part.schema'
import { resourceGroup } from './resource.schema'

/**
 * Routing (5.2, brief §3) — a part's process header. Current-version only
 * (SKIP-44); alternates / preference_rank / plant scoping deferred. Intra-schema
 * FK to `part` (O2).
 */
export const routing = masterDataSchema.table(
  'routing',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    partId: text('part_id')
      .notNull()
      .references(() => part.id),
    name: text('name').notNull(),
    isPrimary: boolean('is_primary').notNull().default(true),
    status: text('status').$type<MasterDataStatus>().notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('routing_tenant_idx').on(t.tenantId),
    partIdx: index('routing_part_idx').on(t.partId),
  }),
)

/**
 * Routing operation (5.2) — an ordered step targeting an eligible resource group.
 * `std_setup_time` / `std_cycle_time` are the deterministic `standard` baseline
 * (D7). `changeover_attribute_key` names which part attribute drives changeover
 * (AS6) — modeled, not sequenced (the matrix/rules are scheduling-owned, SKIP-48).
 * Intra-schema FKs only (O2).
 */
export const routingOperation = masterDataSchema.table(
  'routing_operation',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    routingId: text('routing_id')
      .notNull()
      .references(() => routing.id),
    opSeq: integer('op_seq').notNull(),
    resourceGroupId: text('resource_group_id')
      .notNull()
      .references(() => resourceGroup.id),
    stdSetupTime: doublePrecision('std_setup_time').notNull().default(0),
    stdCycleTime: doublePrecision('std_cycle_time').notNull().default(0),
    changeoverAttributeKey: text('changeover_attribute_key').$type<ChangeoverAttributeKey>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ routingIdx: index('routing_operation_routing_idx').on(t.routingId) }),
)

export type Routing = typeof routing.$inferSelect
export type NewRouting = typeof routing.$inferInsert
export type RoutingOperation = typeof routingOperation.$inferSelect
export type NewRoutingOperation = typeof routingOperation.$inferInsert
