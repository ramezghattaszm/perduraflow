import { index, text, timestamp, unique } from 'drizzle-orm/pg-core'
import type { MasterDataStatus, PartType } from '@perduraflow/contracts'
import { generateId } from '../../../db/ulid'
import { masterDataSchema } from './_schema'

/**
 * Part master — core (MD1/5.1, brief §3). Global-within-tenant identity (D12);
 * `part_no` is the business key, unique within the tenant. Physical attributes
 * (material/gauge/colour, MD11/5.6) are the changeover drivers (AS6). Minimal
 * slice: single base UoM, no conversion (SKIP-02); current-version only, no
 * revision/effectivity (SKIP-44); no BOM (SKIP-45).
 */
export const part = masterDataSchema.table(
  'part',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    partNo: text('part_no').notNull(),
    description: text('description'),
    partType: text('part_type').$type<PartType>().notNull(),
    uom: text('uom').notNull(),
    material: text('material'),
    gauge: text('gauge'),
    colour: text('colour'),
    status: text('status').$type<MasterDataStatus>().notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('part_tenant_idx').on(t.tenantId),
    partNoUnique: unique('part_tenant_part_no_unique').on(t.tenantId, t.partNo),
  }),
)

export type Part = typeof part.$inferSelect
export type NewPart = typeof part.$inferInsert
