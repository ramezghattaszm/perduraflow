import { doublePrecision, index, integer, text, timestamp, unique } from 'drizzle-orm/pg-core'
import type { LearnedStatus, LearningParam, TimeSource } from '@perduraflow/contracts'
import { generateId } from '../../../db/ulid'
import { learningSchema } from './_schema'

/**
 * Learned parameter (D7 overlay) — ONE settled record per `(resource, routing
 * operation, param)`, not a time series (convergence-not-motion; the actuals are
 * the series). `learned_value` null until adoption. `status` is the damped state
 * machine (api-spec §12.3): `learning` → `held` (decisive step) / `rejected`
 * (guardrail breach, A18 bounded). Structured value+source+confidence+basis =
 * the Phase-4-predictor / Phase-5-narration shape (forward-hooks).
 */
export const learnedParameter = learningSchema.table(
  'learned_parameter',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    resourceId: text('resource_id').notNull(),
    routingOperationId: text('routing_operation_id').notNull(),
    param: text('param').$type<LearningParam>().notNull(),
    stdBaseline: doublePrecision('std_baseline').notNull(),
    learnedValue: doublePrecision('learned_value'),
    source: text('source').$type<TimeSource>().notNull().default('standard'),
    confidence: doublePrecision('confidence'),
    sampleCount: integer('sample_count').notNull().default(0),
    windowSize: integer('window_size').notNull().default(0),
    windowMean: doublePrecision('window_mean').notNull().default(0),
    windowStddev: doublePrecision('window_stddev').notNull().default(0),
    status: text('status').$type<LearnedStatus>().notNull().default('learning'),
    lastSteppedAt: timestamp('last_stepped_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('learned_parameter_tenant_idx').on(t.tenantId),
    keyUnique: unique('learned_parameter_key_unique').on(
      t.tenantId,
      t.resourceId,
      t.routingOperationId,
      t.param,
    ),
  }),
)

export type LearnedParameter = typeof learnedParameter.$inferSelect
export type NewLearnedParameter = typeof learnedParameter.$inferInsert
