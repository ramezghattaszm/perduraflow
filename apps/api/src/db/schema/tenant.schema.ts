import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { generateId } from '../ulid'

/**
 * Generic tenant — the scope every user-facing row belongs to. The column
 * exists even in single-tenant apps (one seeded default tenant). The tenant
 * entity shape is app-specific; this is the minimal template baseline.
 */
export const tenant = pgTable('tenant', {
  id: text('id').primaryKey().$defaultFn(generateId),
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type Tenant = typeof tenant.$inferSelect
