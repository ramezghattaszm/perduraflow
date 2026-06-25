import { doublePrecision, index, integer, text, timestamp } from 'drizzle-orm/pg-core'
import type {
  ActionTier,
  LearningParam,
  PredictionDisposition,
  PredictionOutcome,
  ProposedAction,
} from '@perduraflow/contracts'
import { generateId } from '../../../db/ulid'
import { learningSchema } from './_schema'

/**
 * Parameter prediction (phase 4 — api-spec §13.1). The OLS forecast of a
 * threshold-crossing for one `(resource, routing operation, param)`, with the gate
 * disposition. **One live row per key** (older forecasts marked `superseded` — the
 * settled-step chain, not a ticker). **Retained, never hard-deleted** — predictions
 * + their `outcome` are the substrate for the Phase-5 prediction-accuracy measure.
 */
export const parameterPrediction = learningSchema.table(
  'parameter_prediction',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    tenantId: text('tenant_id').notNull(),
    resourceId: text('resource_id').notNull(),
    routingOperationId: text('routing_operation_id').notNull(),
    param: text('param').$type<LearningParam>().notNull(),
    predictedValue: doublePrecision('predicted_value').notNull(),
    threshold: doublePrecision('threshold').notNull(),
    crossingAt: timestamp('crossing_at', { withTimezone: true }),
    horizonMinutes: integer('horizon_minutes').notNull(),
    confidence: doublePrecision('confidence').notNull(),
    fitSlope: doublePrecision('fit_slope').notNull(),
    fitR2: doublePrecision('fit_r2').notNull(),
    windowSize: integer('window_size').notNull().default(0),
    sampleCount: integer('sample_count').notNull().default(0),
    proposedAction: text('proposed_action').$type<ProposedAction>().notNull(),
    actionTier: text('action_tier').$type<ActionTier>().notNull(),
    disposition: text('disposition').$type<PredictionDisposition>().notNull(),
    /** What was written to the learned overlay on auto-commit/approve (reversibility/audit). */
    appliedLearnedValue: doublePrecision('applied_learned_value'),
    /** Snooze breadcrumb: confidence + horizon at the LAST dismissal, carried onto the re-surfaced
     *  row so the queue shows why it's back ("set aside at X%/Yh → now X'%/Y'h"). Null if not re-surfaced. */
    dismissedAtConfidence: doublePrecision('dismissed_at_confidence'),
    dismissedAtHorizonMinutes: integer('dismissed_at_horizon_minutes'),
    outcome: text('outcome').$type<PredictionOutcome>().notNull().default('pending'),
    /** The re-forecast that replaced this one (settled-step chain; null = live). */
    supersededBy: text('superseded_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('parameter_prediction_tenant_idx').on(t.tenantId),
    keyIdx: index('parameter_prediction_key_idx').on(
      t.tenantId,
      t.resourceId,
      t.routingOperationId,
      t.param
    ),
  })
)

export type ParameterPrediction = typeof parameterPrediction.$inferSelect
export type NewParameterPrediction = typeof parameterPrediction.$inferInsert
