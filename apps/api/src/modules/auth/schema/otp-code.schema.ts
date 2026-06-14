import { text, timestamp } from 'drizzle-orm/pg-core'
import { generateId } from '../../../db/ulid'
import { authSchema } from './_schema'

/**
 * OTP code (auth infrastructure). Keyed by `target` (email) + `type`; codes are
 * bcrypt-hashed, single-use (`usedAt`), and expiring (`expiresAt`). This is a
 * PRE-auth table (registration/reset happen before a tenant/user is resolved),
 * so it carries no `tenant_id` — it is identity plumbing, not user-facing data.
 */
export const otpCode = authSchema.table('otp_code', {
  id: text('id').primaryKey().$defaultFn(generateId),
  target: text('target').notNull(),
  type: text('type', { enum: ['registration', 'password_reset'] }).notNull(),
  codeHash: text('code_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type OtpCode = typeof otpCode.$inferSelect
export type NewOtpCode = typeof otpCode.$inferInsert
