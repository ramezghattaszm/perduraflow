import { index, integer, jsonb, text, timestamp } from 'drizzle-orm/pg-core'
import type { ConfigLevel } from '@perduraflow/contracts'
import { generateId } from '../../../db/ulid'
import { configSchema } from './_schema'
import type { ReferenceMemberMetadata } from './reference-set-override.schema'

/** The member-change kinds a reference-set audit row records. */
export const REFERENCE_SET_AUDIT_ACTIONS = ['add', 'override', 'suppress', 'restore'] as const
export type ReferenceSetAuditAction = (typeof REFERENCE_SET_AUDIT_ACTIONS)[number]

/**
 * Reference-set **audit** log (append-only, immutable) — the membership analogue of {@link configAudit},
 * reusing its shape with the **member key** as the audited unit (config's `field`) plus a `set_key` (not a
 * `ConfigGroupKey`) and an explicit `action` for the richer add/override/suppress/restore vocabulary. One
 * row per member change: who, when, set, level, scope, member, action, old→new metadata. IATF: taxonomy
 * changes trace to a stated, dated, attributable event.
 */
export const referenceSetAudit = configSchema.table(
  'reference_set_audit',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    setKey: text('set_key').notNull(),
    level: text('level').$type<Exclude<ConfigLevel, 'global'>>().notNull(),
    scopeId: text('scope_id').notNull(),
    /** The audited unit — the member key (config_audit's `field` analogue). */
    memberKey: text('member_key').notNull(),
    action: text('action').$type<ReferenceSetAuditAction>().notNull(),
    /** Prior member metadata (null = the member was inherited / absent before this change). */
    oldValue: jsonb('old_value').$type<ReferenceMemberMetadata | null>(),
    /** New member metadata (null = suppressed or restored-to-parent — no metadata at this level). */
    newValue: jsonb('new_value').$type<ReferenceMemberMetadata | null>(),
    revision: integer('revision').notNull(),
    changedBy: text('changed_by'),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scopeIdx: index('reference_set_audit_scope_idx').on(t.tenantId, t.setKey, t.level, t.scopeId),
  }),
)

export type ReferenceSetAudit = typeof referenceSetAudit.$inferSelect
export type NewReferenceSetAudit = typeof referenceSetAudit.$inferInsert
