import { index, text, timestamp, unique } from 'drizzle-orm/pg-core'
import type { BindingMode } from '@perduraflow/contracts'
import { generateId } from '../../../db/ulid'
import { bindingSchema } from './_schema'

/**
 * Per-tenant contract binding (A8 §6.3, AS12). One row per (tenant, domain
 * contract, major) names the counterpart `mode` that fulfils it. D42-governed
 * config; seeded `(tenant, 'masterdata.read', '1', 'platform_module')`. Re-binding
 * a contract to a different counterpart is a row change — no consumer code change
 * (the headline binding proof). Phase 2 implements only `platform_module`.
 */
export const contractBinding = bindingSchema.table(
  'contract_binding',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    contractId: text('contract_id').notNull(),
    /** Pinned major version (A12: pin major, float minor). */
    major: text('major').notNull(),
    mode: text('mode').$type<BindingMode>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('contract_binding_tenant_idx').on(t.tenantId),
    pairUnique: unique('contract_binding_tenant_contract_major_unique').on(t.tenantId, t.contractId, t.major),
  }),
)

export type ContractBinding = typeof contractBinding.$inferSelect
export type NewContractBinding = typeof contractBinding.$inferInsert
