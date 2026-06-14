import { boolean, index, integer, text, timestamp } from 'drizzle-orm/pg-core'
import { generateId } from '../../../db/ulid'
import { authSchema } from './_schema'

/**
 * Approval tier (D25 shape) — a named rung in the tenant's approval ladder,
 * ordered by `rank`. Phase 0 seeds the structure (planner → supervisor → plant
 * manager) so roles can reference it; the rule engine that routes proposals to a
 * tier is SKIP-46. Lives in auth (RBAC/identity area, ruling AS2).
 */
export const approvalTier = authSchema.table(
  'approval_tier',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    name: text('name').notNull(),
    rank: integer('rank').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ tenantIdx: index('approval_tier_tenant_idx').on(t.tenantId) }),
)

export type ApprovalTier = typeof approvalTier.$inferSelect
export type NewApprovalTier = typeof approvalTier.$inferInsert
