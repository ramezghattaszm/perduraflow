import { index, jsonb, text, timestamp } from 'drizzle-orm/pg-core'
import { generateId } from '../../../db/ulid'
import { masterDataSchema } from './_schema'

/**
 * Master-data change-audit (Layer 0 §6) — append-only, immutable: every create /
 * revise / supersede (Pattern A) and in-place update / deactivate (Pattern B) is a
 * recorded, attributable event. Built from scratch — there is no kernel audit bus;
 * this table lives INSIDE master-data, owned by the module per O2 (mirrors how
 * `config` owns `config_audit`). No update/delete path is ever exposed (D-L0-3).
 */

/** Which master-data entity a row describes. */
export const MASTER_DATA_ENTITY_TYPES = [
  'part',
  'part_plant',
  'plant_part_mapping',
  'routing',
  'resource',
  'resource_group',
  'resource_group_member',
  'resource_type_config',
] as const
export type MasterDataEntityType = (typeof MASTER_DATA_ENTITY_TYPES)[number]

/**
 * What happened. Pattern A (versioned): `create` / `revise` / `supersede`.
 * Pattern B (mutable-with-audit): `create` / `update` / `deactivate` (the
 * status/`is_active` flip). Commit 1 exercises the Pattern-B subset;
 * revise/supersede are wired in Commit 5.
 */
export const MASTER_DATA_AUDIT_ACTIONS = ['create', 'revise', 'supersede', 'update', 'deactivate'] as const
export type MasterDataAuditAction = (typeof MASTER_DATA_AUDIT_ACTIONS)[number]

/** One changed field: `{ new }` on create (no prior), `{ old, new }` on update/deactivate. */
export interface MasterDataAuditChange {
  old?: unknown
  new: unknown
}

/** Append-only master-data change log (Layer 0 §6) — one row per create/revise/supersede/update/deactivate. */
export const masterDataAudit = masterDataSchema.table(
  'master_data_audit',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    /** Entity kind (`resource`, `resource_group`, …). */
    entityType: text('entity_type').$type<MasterDataEntityType>().notNull(),
    /** Durable business key — `resource.id` (Pattern B) or `part_no` (Pattern A). */
    businessKey: text('business_key').notNull(),
    /** The row `id` affected (equals `business_key` for Pattern-B stable-id entities). */
    versionId: text('version_id').notNull(),
    action: text('action').$type<MasterDataAuditAction>().notNull(),
    /** Actor: JWT user id (`@CurrentUser().sub`), or the `'system'` sentinel for seed/system paths — never null. */
    actor: text('actor').notNull(),
    /** ECN/ECR id or connector source ref (Pattern-A revise); null otherwise. */
    sourceRef: text('source_ref'),
    /** Window start for revisioned actions; null for Pattern-B in-place changes. */
    effectiveFrom: timestamp('effective_from', { withTimezone: true }),
    /** `{ field: { old?, new } }` — only the fields that actually changed. */
    changedFields: jsonb('changed_fields').$type<Record<string, MasterDataAuditChange>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('master_data_audit_tenant_idx').on(t.tenantId),
    entityIdx: index('master_data_audit_entity_idx').on(t.tenantId, t.entityType, t.versionId),
  }),
)

export type MasterDataAudit = typeof masterDataAudit.$inferSelect
export type NewMasterDataAudit = typeof masterDataAudit.$inferInsert
