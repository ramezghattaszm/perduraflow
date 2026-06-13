import { boolean, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { generateId } from '../ulid'
import { tenant } from './tenant.schema'

export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenant.id),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    avatarUrl: text('avatar_url'),
    isVerified: boolean('is_verified').notNull().default(false),
    role: text('role', { enum: ['user', 'admin'] })
      .notNull()
      .default('user'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('user_tenant_idx').on(t.tenantId),
  }),
)

export type User = typeof user.$inferSelect
export type UserRole = User['role']
