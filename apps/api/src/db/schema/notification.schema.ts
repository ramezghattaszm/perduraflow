import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { generateId } from '../ulid'
import { user } from './user.schema'

/** In-app notification feed (per-user). Distinct from outbound email/SMS. */
export const notification = pgTable(
  'notification',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('notification_user_idx').on(t.userId, t.createdAt),
  }),
)

export type Notification = typeof notification.$inferSelect
