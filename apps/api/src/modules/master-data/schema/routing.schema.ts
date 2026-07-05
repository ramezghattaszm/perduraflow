import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  boolean,
  doublePrecision,
  index,
  integer,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import type { ChangeoverAttributeKey, MasterDataStatus } from '@perduraflow/contracts'
import { generateId } from '../../../db/ulid'
import { masterDataSchema } from './_schema'
import { part } from './part.schema'
import { resourceGroup } from './resource.schema'

/**
 * Routing (5.2, brief §3) — a part's process header. Intra-schema FK to `part` (O2).
 *
 * **Layer 0 — Pattern A (revisioned):** business key `(part_no, name)`; each revision is
 * its own row keyed by `[effective_from, effective_to)`, `effective_to IS NULL` = open/current
 * (a partial unique index enforces one open version per key). `part_no` is denormalized (kept in
 * sync with the routing's part) — `part_id` is retained this layer and dropped with the consumer
 * switch to resolve-by-`part_no` (Commit 6). `supersedes_id` links a version to the one it replaced
 * (self-ref, intra-schema). `part_no`/`revision`/`effective_from` carry DB defaults so existing insert
 * sites (createRouting via `part_id`, the seed) keep compiling untouched; the `''` `part_no` default is
 * a transient placeholder — nothing reads `part_no` until Commit 6, and the seed sets it in Commit 7.
 */
export const routing = masterDataSchema.table(
  'routing',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    partId: text('part_id')
      .notNull()
      .references(() => part.id),
    // Denormalized part business key (Pattern A resolve-by-part_no); backfilled from part_id.
    partNo: text('part_no').notNull().default(''),
    name: text('name').notNull(),
    isPrimary: boolean('is_primary').notNull().default(true),
    status: text('status').$type<MasterDataStatus>().notNull().default('active'),
    // Layer 0 versioning (Pattern A) — defaults keep insert sites compiling (see part.schema).
    revision: text('revision').notNull().default('A'),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    supersedesId: text('supersedes_id').references((): AnyPgColumn => routing.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('routing_tenant_idx').on(t.tenantId),
    partIdx: index('routing_part_idx').on(t.partId),
    // At most one OPEN (current) version per (part_no, name) within a tenant (Pattern A).
    partNoNameOpenUnique: uniqueIndex('routing_tenant_part_no_name_open_unique')
      .on(t.tenantId, t.partNo, t.name)
      .where(sql`${t.effectiveTo} is null`),
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
