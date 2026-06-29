import { boolean, doublePrecision, index, integer, text, timestamp } from 'drizzle-orm/pg-core'
import { generateId } from '../../../db/ulid'
import { learningSchema } from './_schema'
import { executionActual } from './execution-actual.schema'

/**
 * Tier-2 per-piece cycle record (§4.3, SKIP-51) — the raw per-piece/per-stroke series a `cycle_batch`
 * actuals event carries, persisted under the **op-summary `execution_actual` row it was derived into**
 * (Σgood/Σscrap, measured cycle, span). **Empty unless a Tier-2 connector feeds it.** Append-only.
 * `op_actual_id` is an **intra-schema FK** to `execution_actual` (allowed — O2 forbids only CROSS-schema
 * FKs). The learner never reads this table — it reads the derived op row only (A14 grain rule).
 */
export const cycleRecord = learningSchema.table(
  'cycle_record',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    opActualId: text('op_actual_id')
      .notNull()
      .references(() => executionActual.id),
    pieceIdx: integer('piece_idx').notNull(),
    cycleMs: doublePrecision('cycle_ms').notNull(),
    good: boolean('good').notNull(),
    ts: timestamp('ts', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('cycle_record_tenant_idx').on(t.tenantId),
    opActualIdx: index('cycle_record_op_actual_idx').on(t.opActualId),
  }),
)

export type NewCycleRecord = typeof cycleRecord.$inferInsert
