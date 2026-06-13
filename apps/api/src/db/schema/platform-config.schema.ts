import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { generateId } from '../ulid'

/** Generic key-value runtime config (feature flags, toggles). Admin-managed. */
export const platformConfig = pgTable('platform_config', {
  id: text('id').primaryKey().$defaultFn(generateId),
  key: text('key').notNull().unique(),
  value: text('value').notNull(),
  description: text('description'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type PlatformConfig = typeof platformConfig.$inferSelect
