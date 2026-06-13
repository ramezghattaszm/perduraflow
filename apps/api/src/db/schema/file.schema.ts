import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { generateId } from '../ulid'
import { user } from './user.schema'

export const file = pgTable('file', {
  id: text('id').primaryKey().$defaultFn(generateId),
  key: text('key').notNull(),
  provider: text('provider', { enum: ['local', 's3'] }).notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  uploadedBy: text('uploaded_by').references(() => user.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type FileRecord = typeof file.$inferSelect
