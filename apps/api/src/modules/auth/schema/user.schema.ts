import { boolean, index, jsonb, text, timestamp } from 'drizzle-orm/pg-core'
import type { UserPreferences } from '@perduraflow/contracts'
import { generateId } from '../../../db/ulid'
import { authSchema } from './_schema'
import { role } from './role.schema'

/**
 * User (kernel identity). Tenant-scoped (`tenant_id` plain text, indexed — no
 * cross-schema FK to tenant, O2). `roleId` references the tenant's editable role
 * set (intra-schema FK, auth owns role) — replaces the old hardcoded role enum
 * (ruling). Never expose `passwordHash` (API §11).
 */
export const user = authSchema.table(
  'user',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    avatarUrl: text('avatar_url'),
    /** Per-user UI preferences (e.g. sidebar collapsed); server-side, not browser storage. */
    preferences: jsonb('preferences').$type<UserPreferences>().notNull().default({}),
    isVerified: boolean('is_verified').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    roleId: text('role_id').references(() => role.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ tenantIdx: index('user_tenant_idx').on(t.tenantId) }),
)

export type User = typeof user.$inferSelect
export type NewUser = typeof user.$inferInsert
