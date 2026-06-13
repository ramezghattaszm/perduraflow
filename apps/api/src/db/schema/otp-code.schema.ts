import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { generateId } from '../ulid'

export const otpCode = pgTable(
  'otp_code',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    target: text('target').notNull(), // email (or phone for sms)
    type: text('type', { enum: ['registration', 'password_reset'] }).notNull(),
    channel: text('channel', { enum: ['email', 'sms'] })
      .notNull()
      .default('email'),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    lookupIdx: index('otp_code_lookup_idx').on(t.target, t.type, t.usedAt, t.expiresAt),
  }),
)

export type OtpCode = typeof otpCode.$inferSelect
