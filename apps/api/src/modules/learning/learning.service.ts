import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import {
  executionActualSchema,
  type DriftDetectedPayload,
  type ExecutionActualPayload,
  type LearningParam,
} from '@perduraflow/contracts'
import { EVENTS } from '../../events'
import { EventBus } from '../eventbus/event-bus'
import type { EventEnvelope } from '../eventbus/event-bus.types'
import { evaluate, RULE, type PriorState } from './learning.rule'
import { LearningRepository } from './learning.repository'
import type { ExecutionActual } from './schema'

/**
 * Learning service (phase 3 — the closed loop). Subscribes to `execution.actual.
 * recorded` (emitted by the scheduling simulator, SKIP-51), **appends** the actual
 * append-only, then re-runs the **damped rule** (learning.rule) for the affected
 * `(resource, op, cycle|setup)` and upserts the single settled `learned_parameter`.
 * Emits `learning.parameter.updated` on a decisive step, `learning.drift.detected`
 * (D56 tool-wear) when a cycle adopts/re-steps materially above standard, and
 * `learning.anomaly.flagged` on a guardrail rejection (A18 bounded).
 */
@Injectable()
export class LearningService implements OnModuleInit {
  private readonly logger = new Logger('LearningService')

  constructor(
    private readonly repo: LearningRepository,
    private readonly events: EventBus,
  ) {}

  /** Wire the closed loop: consume actuals off the bus (A4 / D5). */
  onModuleInit(): void {
    this.events.subscribe(EVENTS.EXECUTION_ACTUAL_RECORDED, (env: EventEnvelope) =>
      this.ingest(env.payload as ExecutionActualPayload, env.tenantId),
    )
  }

  /** Append one actual (idempotent) and re-learn its parameters. */
  async ingest(payload: ExecutionActualPayload, tenantId: string | null): Promise<void> {
    const data = executionActualSchema.parse(payload)
    const tid = tenantId ?? ''
    const row = await this.repo.appendActual({
      tenantId: tid,
      actualEventId: data.actualEventId,
      scheduleVersionId: data.scheduleVersionId,
      scheduledOperationId: data.scheduledOperationId,
      resourceId: data.resourceId,
      routingOperationId: data.routingOperationId,
      partId: data.partId,
      actualStart: new Date(data.actualStart),
      actualEnd: new Date(data.actualEnd),
      actualSetupTime: data.actualSetupTime,
      actualCycleTime: data.actualCycleTime,
      stdSetupTime: data.stdSetupTime,
      stdCycleTime: data.stdCycleTime,
      goodQty: data.goodQty,
      scrapQty: data.scrapQty,
      downtimeMinutes: data.downtimeMinutes,
      downtimeReason: data.downtimeReason,
      source: data.source,
      seq: data.seq,
    })
    if (!row) return // idempotent: already ingested
    await this.relearn(tid, data.resourceId, data.routingOperationId, 'cycle', data.stdCycleTime)
    await this.relearn(tid, data.resourceId, data.routingOperationId, 'setup', data.stdSetupTime)
  }

  /** Re-run the damped rule for one parameter over its full ordered actual series. */
  private async relearn(
    tenantId: string,
    resourceId: string,
    routingOperationId: string,
    param: LearningParam,
    std: number,
  ): Promise<void> {
    const actuals = await this.repo.actualSeries(tenantId, resourceId, routingOperationId)
    const series = actuals
      .map((a: ExecutionActual) => (param === 'cycle' ? a.actualCycleTime : a.actualSetupTime))
      .filter((v): v is number => v != null)
    if (series.length === 0) return

    const prior = await this.repo.findLearned(tenantId, resourceId, routingOperationId, param)
    const priorState: PriorState = {
      learnedValue: prior?.learnedValue ?? null,
      status: prior?.status ?? 'learning',
    }
    const result = evaluate(series, std, priorState)

    await this.repo.upsertLearned({
      tenantId,
      resourceId,
      routingOperationId,
      param,
      stdBaseline: std,
      learnedValue: result.learnedValue,
      source: result.source,
      confidence: result.confidence,
      sampleCount: result.sampleCount,
      windowSize: result.windowSize,
      windowMean: result.windowMean,
      windowStddev: result.windowStddev,
      status: result.status,
      lastSteppedAt: result.stepped ? new Date() : (prior?.lastSteppedAt ?? null),
    })

    if (!result.stepped) return

    if (result.status === 'rejected') {
      await this.events.publish(
        EVENTS.LEARNING_ANOMALY_FLAGGED,
        { tenantId, resourceId, routingOperationId, param, windowMean: result.windowMean, std },
        tenantId,
      )
      this.logger.warn(
        `anomaly: ${param} for ${resourceId}/${routingOperationId} window=${result.windowMean.toFixed(1)} std=${std} rejected (guardrail)`,
      )
      return
    }

    await this.events.publish(
      EVENTS.LEARNING_PARAMETER_UPDATED,
      { tenantId, resourceId, routingOperationId, param, learnedValue: result.learnedValue },
      tenantId,
    )

    // D56 tool-wear: a cycle that stepped materially ABOVE standard is a sustained wear signal.
    if (param === 'cycle' && result.learnedValue != null) {
      const deviationPct = std > 0 ? (result.learnedValue - std) / std : 0
      if (deviationPct >= RULE.STEP_BAND) {
        const drift: DriftDetectedPayload = {
          tenantId,
          resourceId,
          routingOperationId,
          param,
          deviationPct,
          confidence: result.confidence ?? 0,
        }
        await this.events.publish(EVENTS.LEARNING_DRIFT_DETECTED, drift, tenantId)
        this.logger.log(
          `tool-wear flag: ${resourceId}/${routingOperationId} cycle +${(deviationPct * 100).toFixed(0)}% (D56)`,
        )
      }
    }
  }
}
