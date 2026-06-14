import { boolean, index, integer, text, timestamp } from 'drizzle-orm/pg-core'
import { generateId } from '../../../db/ulid'
import { orgSchema } from './_schema'

/**
 * Customer (5.7/D23) — the OEM. `firm_fence_days` is the DEFAULT firm-fence
 * horizon in days (D23); a program overrides it. Modeled now, enforcement later
 * (the per-line `firmness` flag is the later operative source).
 */
export const customer = orgSchema.table(
  'customer',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    name: text('name').notNull(),
    firmFenceDays: integer('firm_fence_days'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ tenantIdx: index('customer_tenant_idx').on(t.tenantId) }),
)

/** Program (5.7/D23) — a customer/vehicle program. `firm_fence_days` overrides the customer default. */
export const program = orgSchema.table(
  'program',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    customerId: text('customer_id')
      .notNull()
      .references(() => customer.id),
    name: text('name').notNull(),
    firmFenceDays: integer('firm_fence_days'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('program_tenant_idx').on(t.tenantId),
    customerIdx: index('program_customer_idx').on(t.customerId),
  }),
)

export type Customer = typeof customer.$inferSelect
export type NewCustomer = typeof customer.$inferInsert
export type Program = typeof program.$inferSelect
export type NewProgram = typeof program.$inferInsert
