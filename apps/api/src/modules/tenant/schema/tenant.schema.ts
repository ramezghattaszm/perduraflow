import { boolean, text, timestamp } from 'drizzle-orm/pg-core'
import { generateId } from '../../../db/ulid'
import { tenantSchema } from './_schema'

/**
 * Tenant — the scope root every user-facing row belongs to (D24). Active from
 * day one (SKIP-01): the demo seeds one row; other modules carry a `tenant_id`
 * text column (no cross-schema FK to here — O2) validated via the tenant read
 * interface. Isolation *hardening* + the second topology are deferred (SKIP-01).
 */
export const tenant = tenantSchema.table('tenant', {
  id: text('id').primaryKey().$defaultFn(generateId),
  name: text('name').notNull(),
  /** Tenant logo URL; null → OrgAvatar placeholder. Managed later (SKIP-53). */
  logoUrl: text('logo_url'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type Tenant = typeof tenant.$inferSelect
export type NewTenant = typeof tenant.$inferInsert
