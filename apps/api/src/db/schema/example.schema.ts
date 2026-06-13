import { boolean, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { generateId } from '../ulid'
import { tenant } from './tenant.schema'
import { user } from './user.schema'

/**
 * The `example` resource — the reference shape every future module copies. It
 * demonstrates: ULID text PK, owner + tenant scoping, soft delete via isActive,
 * and the indexes a scoped/owned list needs (API-ARCHITECTURE.md §2/§11).
 */
export const example = pgTable(
  'example',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenant.id),
    title: text('title').notNull(),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantActiveIdx: index('example_tenant_active_idx').on(t.tenantId, t.isActive),
    ownerIdx: index('example_owner_idx').on(t.ownerId),
  }),
)

export type Example = typeof example.$inferSelect
