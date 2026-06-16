import type {
  ExecutionActualDto,
  LearnedParameterDto,
  ParameterPredictionDto,
} from '@perduraflow/contracts'
import type { ExecutionActual, LearnedParameter, ParameterPrediction } from './schema'

/** Map a prediction row → its contract DTO (the settled forecast statement). */
export const toParameterPredictionDto = (r: ParameterPrediction): ParameterPredictionDto => ({
  id: r.id,
  resourceId: r.resourceId,
  routingOperationId: r.routingOperationId,
  param: r.param,
  predictedValue: r.predictedValue,
  threshold: r.threshold,
  crossingAt: r.crossingAt ? r.crossingAt.toISOString() : null,
  horizonMinutes: r.horizonMinutes,
  confidence: r.confidence,
  fitR2: r.fitR2,
  sampleCount: r.sampleCount,
  proposedAction: r.proposedAction,
  actionTier: r.actionTier,
  disposition: r.disposition,
  appliedLearnedValue: r.appliedLearnedValue,
  outcome: r.outcome,
  createdAt: r.createdAt.toISOString(),
})

/** Map a learned-parameter row to its contract DTO (the structured learned record). */
export const toLearnedParameterDto = (r: LearnedParameter): LearnedParameterDto => ({
  resourceId: r.resourceId,
  routingOperationId: r.routingOperationId,
  param: r.param,
  stdBaseline: r.stdBaseline,
  learnedValue: r.learnedValue,
  source: r.source,
  confidence: r.confidence,
  sampleCount: r.sampleCount,
  windowMean: r.windowMean,
  windowStddev: r.windowStddev,
  status: r.status,
  lastSteppedAt: r.lastSteppedAt ? r.lastSteppedAt.toISOString() : null,
})

/** Map a persisted actual to the DTO scheduling joins for variance/OEE/cost. */
export const toExecutionActualDto = (r: ExecutionActual): ExecutionActualDto => ({
  id: r.id,
  scheduledOperationId: r.scheduledOperationId,
  resourceId: r.resourceId,
  routingOperationId: r.routingOperationId,
  partId: r.partId,
  actualStart: r.actualStart.toISOString(),
  actualEnd: r.actualEnd.toISOString(),
  actualSetupTime: r.actualSetupTime,
  actualCycleTime: r.actualCycleTime,
  goodQty: r.goodQty,
  scrapQty: r.scrapQty,
  downtimeMinutes: r.downtimeMinutes,
})
