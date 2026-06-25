import { HttpStatus, Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { AppException, ERROR_CODES } from '../../common/exceptions/app.exception'
import {
  executionActualSchema,
  type ActionTier,
  type DriftDetectedPayload,
  type ExecutionActualPayload,
  type LearningParam,
  type PolicyReadContract,
  type PredictionDisposition,
} from '@perduraflow/contracts'
import { EVENTS } from '../../events'
import { EventBus } from '../eventbus/event-bus'
import type { EventEnvelope } from '../eventbus/event-bus.types'
import { POLICY_READ } from '../policy/policy-read.service'
import { evaluate, RULE, snoozeDecision, type PriorState } from './learning.rule'
import { predict, PREDICT, type PredictionResult } from './learning.predictor'
import { LearningRepository } from './learning.repository'
import type { ExecutionActual } from './schema'

/**
 * The confidence×tier gate (api-spec §13.3 — pure). Confidence is the dial *inside*
 * a tier, never a bypass *around* it (A18): Tier-1 auto-commits at ≥ threshold;
 * Tier-3 is **always human** regardless of confidence (the A18 floor); Tier-2 is
 * advisory-first this phase (queued). Deterministic given the inputs.
 */
function gateDisposition(tier: ActionTier, confidence: number, tier1Threshold: number): PredictionDisposition {
  if (tier === 'tier1') return confidence >= tier1Threshold ? 'auto_committed' : 'queued'
  return 'queued' // tier2 advisory-first; tier3 always human — confidence cannot bypass the tier
}

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
    @Inject(POLICY_READ) private readonly policy: PolicyReadContract,
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
    // Phase 4: project the observed series forward (predict-and-act-or-propose).
    await this.forecast(tid, data.resourceId, data.routingOperationId, 'cycle', data.stdCycleTime)
    await this.forecast(tid, data.resourceId, data.routingOperationId, 'setup', data.stdSetupTime)
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

  /**
   * Project the observed series forward (api-spec §13.2–§13.4 — A14 predictive arm).
   * Fits the trend, forecasts a threshold-crossing, routes it through the gate, and
   * (Tier-1 ≥ threshold) pre-emptively adopts the predicted value. **Damped** — a
   * new settled prediction is written only when it materially changes (no ticker);
   * **deterministic** — the forecast (value/horizon/confidence) is data-derived, and
   * `crossingAt` anchors on the last actual's clock, never `Date.now()`.
   */
  private async forecast(
    tenantId: string,
    resourceId: string,
    routingOperationId: string,
    param: LearningParam,
    std: number,
  ): Promise<void> {
    const actuals = await this.repo.actualSeries(tenantId, resourceId, routingOperationId)
    const series = actuals
      .map((a) => (param === 'cycle' ? a.actualCycleTime : a.actualSetupTime))
      .filter((v): v is number => v != null)
    const live = await this.repo.findLivePrediction(tenantId, resourceId, routingOperationId, param)
    // A dismissed forecast is SNOOZED (not live) — looked up only when nothing is live, so it can be
    // measured against a fresh forecast (D-snooze) and re-surfaced ONLY when materially worse.
    const snoozed = live ? undefined : await this.repo.findSnoozed(tenantId, resourceId, routingOperationId, param)

    const cfg = await this.policy.getAutonomyConfig(tenantId)
    const wearBand = cfg.wearBand ?? RULE.STEP_BAND
    const threshold = std * (1 + wearBand)
    const cadence = this.cadenceMinutes(actuals, std)
    const result = series.length >= PREDICT.MIN_SAMPLES ? predict(series, threshold, cadence) : null

    // No honest FORWARD forecast now (already crossed, or trend reversed). `materialized` = the
    // observed window reached the threshold (it came true); `corrected` = it flattened before crossing.
    if (!result) {
      const window = series.slice(-PREDICT.WINDOW)
      const windowMean = window.length > 0 ? window.reduce((a, b) => a + b, 0) / window.length : 0
      const materialized = windowMean >= threshold
      if (live) {
        await this.repo.updatePrediction(live.id, { disposition: 'superseded', outcome: materialized ? 'materialized' : 'corrected' })
        // Reversibility (proof #3): a pre-emptively-adopted forecast that did NOT materialise is
        // corrected by the subsequent actuals — restore the observed overlay (undo the ml_predicted adopt).
        if (!materialized && live.appliedLearnedValue != null) {
          const obs = evaluate(series, std, { learnedValue: null, status: 'learning' })
          await this.repo.upsertLearned({
            tenantId,
            resourceId,
            routingOperationId,
            param,
            stdBaseline: std,
            learnedValue: obs.learnedValue,
            source: obs.source,
            confidence: obs.confidence,
            sampleCount: obs.sampleCount,
            windowSize: obs.windowSize,
            windowMean: obs.windowMean,
            windowStddev: obs.windowStddev,
            status: obs.status,
            lastSteppedAt: new Date(),
          })
          this.logger.log(`prediction corrected: ${resourceId}/${routingOperationId} ${param} reverted to observed (reversible, proof #3)`)
        }
      } else if (snoozed && materialized) {
        // Safety floor (D-snooze): the wear actually crossed while snoozed → re-surface immediately,
        // regardless of the confidence/urgency triggers. Flip the snoozed row back to the queue, carry
        // its dismissal snapshot as the breadcrumb, and mark it now (horizon 0).
        const lastEnd = actuals[actuals.length - 1]?.actualEnd ?? null
        await this.repo.updatePrediction(snoozed.id, {
          disposition: 'queued',
          dismissedAtConfidence: snoozed.confidence,
          dismissedAtHorizonMinutes: snoozed.horizonMinutes,
          horizonMinutes: 0,
          crossingAt: lastEnd,
        })
        await this.events.publish(EVENTS.LEARNING_PREDICTION_QUEUED, { tenantId, resourceId, routingOperationId, param, confidence: snoozed.confidence, tier: snoozed.actionTier }, tenantId)
        await this.events.publish(EVENTS.LEARNING_PREDICTION_UPDATED, { tenantId, predictionId: snoozed.id }, tenantId)
      }
      return
    }

    const lastActual = actuals[actuals.length - 1]!
    const crossingAt = new Date(lastActual.actualEnd.getTime() + result.horizonMinutes * 60_000)
    const disposition = gateDisposition(result.actionTier, result.confidence, cfg.tier1AutoThreshold)

    // SNOOZED (no live): re-surface ONLY when materially worse than the dismissal snapshot (D-snooze).
    // `stay` = remain set aside (the fix — no re-surface on the next actual). Re-anchoring is implicit:
    // the breadcrumb is taken from the snoozed row, and a re-dismissal snapshots the new (worse) values.
    if (snoozed) {
      const confDelta = cfg.snoozeConfDelta ?? RULE.SNOOZE_CONF_DELTA
      const urgencyMinutes = cfg.snoozeUrgencyMinutes ?? RULE.SNOOZE_URGENCY_MINUTES
      const outcome = snoozeDecision({
        tier: result.actionTier,
        newConfidence: result.confidence,
        newHorizonMinutes: result.horizonMinutes,
        dismissedConfidence: snoozed.confidence,
        dismissedHorizonMinutes: snoozed.horizonMinutes,
        tier1AutoThreshold: cfg.tier1AutoThreshold,
        confDelta,
        urgencyMinutes,
      })
      if (outcome === 'stay') return
      await this.writeSettledPrediction({
        tenantId,
        resourceId,
        routingOperationId,
        param,
        std,
        result,
        crossingAt,
        disposition: outcome === 'auto_commit' ? 'auto_committed' : 'queued',
        priorId: snoozed.id,
        breadcrumb: { confidence: snoozed.confidence, horizonMinutes: snoozed.horizonMinutes },
      })
      return
    }

    // Damped: keep the existing settled forecast unless it materially moved or the gate decision
    // changed (convergence-not-motion, forward form — no live ticker).
    const moved =
      !live ||
      live.disposition !== disposition ||
      !live.crossingAt ||
      Math.abs(crossingAt.getTime() - live.crossingAt.getTime()) > cadence * 60_000
    if (!moved) return

    await this.writeSettledPrediction({
      tenantId,
      resourceId,
      routingOperationId,
      param,
      std,
      result,
      crossingAt,
      disposition,
      priorId: live?.id ?? null,
      // Sticky breadcrumb: once a forecast has re-surfaced from a snooze, carry the dismissal snapshot
      // through subsequent damped re-forecasts so "you set this aside at …" persists until acted on.
      breadcrumb:
        live?.dismissedAtConfidence != null
          ? { confidence: live.dismissedAtConfidence, horizonMinutes: live.dismissedAtHorizonMinutes ?? 0 }
          : null,
    })
  }

  /**
   * Insert a settled prediction (supersede the prior live/snoozed row), then act per disposition:
   * auto-commit pre-adopts the predicted overlay; queued just records. `breadcrumb` (the dismissal
   * snapshot) is carried onto the row only when re-surfacing from a snooze (else null). One place so
   * the normal forecast path and the snooze re-surface path can never drift.
   */
  private async writeSettledPrediction(args: {
    tenantId: string
    resourceId: string
    routingOperationId: string
    param: LearningParam
    std: number
    result: PredictionResult
    crossingAt: Date
    disposition: PredictionDisposition
    priorId: string | null
    breadcrumb: { confidence: number; horizonMinutes: number } | null
  }): Promise<void> {
    const { tenantId, resourceId, routingOperationId, param, std, result, crossingAt, disposition } = args
    const applied = disposition === 'auto_committed' ? result.predictedValue : null
    const created = await this.repo.insertPrediction({
      tenantId,
      resourceId,
      routingOperationId,
      param,
      predictedValue: result.predictedValue,
      threshold: result.threshold,
      crossingAt,
      horizonMinutes: Math.round(result.horizonMinutes),
      confidence: result.confidence,
      fitSlope: result.fitSlope,
      fitR2: result.fitR2,
      windowSize: result.windowSize,
      sampleCount: result.sampleCount,
      proposedAction: result.proposedAction,
      actionTier: result.actionTier,
      disposition,
      appliedLearnedValue: applied,
      outcome: 'pending',
      dismissedAtConfidence: args.breadcrumb?.confidence ?? null,
      dismissedAtHorizonMinutes: args.breadcrumb?.horizonMinutes ?? null,
    })
    if (args.priorId) await this.repo.updatePrediction(args.priorId, { disposition: 'superseded', supersededBy: created.id })

    if (disposition === 'auto_committed') {
      await this.preAdopt(tenantId, resourceId, routingOperationId, param, std, result.predictedValue, result.confidence)
      await this.events.publish(
        EVENTS.LEARNING_PREDICTION_AUTOCOMMITTED,
        { tenantId, resourceId, routingOperationId, param, predictedValue: result.predictedValue, confidence: result.confidence, horizonMinutes: result.horizonMinutes },
        tenantId,
      )
      this.logger.log(
        `pre-emptive adopt: ${resourceId}/${routingOperationId} ${param}→${result.predictedValue.toFixed(2)} (conf ${result.confidence.toFixed(2)}, ~${Math.round(result.horizonMinutes)}m, A18 Tier-1)`,
      )
    } else {
      await this.events.publish(
        EVENTS.LEARNING_PREDICTION_QUEUED,
        { tenantId, resourceId, routingOperationId, param, confidence: result.confidence, tier: result.actionTier },
        tenantId,
      )
    }
    await this.events.publish(EVENTS.LEARNING_PREDICTION_UPDATED, { tenantId, predictionId: created.id }, tenantId)
  }

  /** Pre-emptively write the predicted value as a held overlay (source `ml_predicted`,
   *  A18). The next solve uses it (D44: next draft, not retroactive); subsequent real
   *  actuals re-step the learner if the drift doesn't materialise (reversible). */
  private async preAdopt(
    tenantId: string,
    resourceId: string,
    routingOperationId: string,
    param: LearningParam,
    std: number,
    predictedValue: number,
    confidence: number,
  ): Promise<void> {
    await this.repo.upsertLearned({
      tenantId,
      resourceId,
      routingOperationId,
      param,
      stdBaseline: std,
      learnedValue: predictedValue,
      source: 'ml_predicted',
      confidence,
      sampleCount: 0,
      windowSize: 0,
      windowMean: predictedValue,
      windowStddev: 0,
      status: 'held',
      lastSteppedAt: new Date(),
    })
  }

  /** Minutes per "event" (one op-run) → converts events-to-cross into clock horizon.
   *  Uses the mean **actual op duration** (robust — each actual carries its own
   *  run length); falls back to the standard. Deterministic (data-derived). */
  private cadenceMinutes(actuals: ExecutionActual[], std: number): number {
    const durs = actuals
      .map((a) => (a.actualEnd.getTime() - a.actualStart.getTime()) / 60_000)
      .filter((d) => d > 0)
    if (durs.length === 0) return std > 0 ? std : 1
    return durs.reduce((a, b) => a + b, 0) / durs.length
  }

  /** Human-approve a queued prediction (View 4 / api-spec §13.7) → applies the pre-adjust. */
  async approvePrediction(tenantId: string, id: string): Promise<void> {
    const p = await this.requireQueued(tenantId, id)
    const prior = await this.repo.findLearned(tenantId, p.resourceId, p.routingOperationId, p.param)
    const std = prior?.stdBaseline ?? p.predictedValue
    await this.repo.updatePrediction(id, { disposition: 'approved', appliedLearnedValue: p.predictedValue })
    await this.preAdopt(tenantId, p.resourceId, p.routingOperationId, p.param, std, p.predictedValue, p.confidence)
  }

  /** Human-dismiss a queued prediction (no action taken). */
  async dismissPrediction(tenantId: string, id: string): Promise<void> {
    await this.requireQueued(tenantId, id)
    await this.repo.updatePrediction(id, { disposition: 'dismissed' })
  }

  /** A queued prediction or the right error (a human can only dispose a queued one). */
  private async requireQueued(tenantId: string, id: string) {
    const p = await this.repo.findPredictionById(tenantId, id)
    if (!p) throw new AppException(HttpStatus.NOT_FOUND, 'Prediction not found', ERROR_CODES.PREDICTION_NOT_FOUND)
    if (p.disposition !== 'queued') {
      throw new AppException(HttpStatus.CONFLICT, 'Prediction is not awaiting approval', ERROR_CODES.PREDICTION_NOT_QUEUED)
    }
    return p
  }
}
