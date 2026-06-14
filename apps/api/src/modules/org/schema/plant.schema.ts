import { index, text, timestamp } from 'drizzle-orm/pg-core'
import { generateId } from '../../../db/ulid'
import { orgSchema } from './_schema'

/**
 * Plant (5.7) — a producing site. Tenant-scoped; `tenant_id` is a plain text
 * column indexed for scoping (no cross-schema FK — O2). Soft delete is the
 * `status` transition (active → inactive), never a hard delete.
 */
export const plant = orgSchema.table(
  'plant',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    name: text('name').notNull(),
    timezone: text('timezone').notNull(),
    region: text('region'),
    location: text('location'),
    status: text('status', { enum: ['active', 'inactive'] })
      .notNull()
      .default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ tenantIdx: index('plant_tenant_idx').on(t.tenantId) }),
)

export type Plant = typeof plant.$inferSelect
export type NewPlant = typeof plant.$inferInsert
