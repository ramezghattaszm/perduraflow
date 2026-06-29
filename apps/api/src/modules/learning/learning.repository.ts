import { Inject, Injectable } from '@nestjs/common'
import { and, asc, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm'
import { LEARNING_DB, type LearningDatabase } from './learning.db'
import {
  cycleRecord,
  executionActual,
  learnedParameter,
  parameterPrediction,
  type ExecutionActual,
  type LearnedParameter,
  type NewExecutionActual,
  type NewLearnedParameter,
  type NewParameterPrediction,
  type ParameterPrediction,
} from './schema'
import type { CycleRecord, LearningParam, PredictionDisposition, PredictionOutcome } from '@perduraflow/contracts'

/** Dispositions that count as a *live* forecast (shown / actionable). */
const LIVE_DISPOSITIONS: PredictionDisposition[] = ['queued', 'auto_committed', 'approved']

/** Drizzle queries for the learning module (scoped to its own schema, O2). */
@Injectable()
export class LearningRepository {
  constructor(@Inject(LEARNING_DB) private readonly db: LearningDatabase) {}

  // --- actuals (append-only) -------------------------------------------------
  /** Idempotent append: skip if the `actualEventId` already exists. Returns the row or null if a dup. */
  async appendActual(data: NewExecutionActual): Promise<ExecutionActual | null> {
    const existing = await this.db.query.executionActual.findFirst({
      where: and(
        eq(executionActual.tenantId, data.tenantId),
        eq(executionActual.actualEventId, data.actualEventId),
      ),
    })
    if (existing) return null
    const [row] = await this.db.insert(executionActual).values(data).returning()
    return row!
  }

  /** Persist a Tier-2 op's raw per-piece cycle records under its derived op-summary row (append-only,
   *  §4.3). Intra-schema; the learner never reads these — they're the audit/raw tail behind the derived
   *  op actual. No-op for an empty batch. */
  async appendCycleRecords(tenantId: string, opActualId: string, pieces: CycleRecord[]): Promise<void> {
    if (pieces.length === 0) return
    await this.db.insert(cycleRecord).values(
      pieces.map((p) => ({ tenantId, opActualId, pieceIdx: p.pieceIdx, cycleMs: p.cycleMs, good: p.good, ts: new Date(p.ts) })),
    )
  }

  /** Actual values for one `(resource, op)` in deterministic emission order (windowed learning input). */
  async actualSeries(
    tenantId: string,
    resourceId: string,
    routingOperationId: string,
  ): Promise<ExecutionActual[]> {
    return this.db
      .select()
      .from(executionActual)
      .where(
        and(
          eq(executionActual.tenantId, tenantId),
          eq(executionActual.resourceId, resourceId),
          eq(executionActual.routingOperationId, routingOperationId),
        ),
      )
      // Order by true recency (ingestion time), seq only as an intra-call tiebreak. `seq` RESETS to 0
      // every simulate call, so using it as the primary sort interleaves separate runs by their local
      // index — a later, smaller run (e.g. a scoped wear-drift of ~300 actuals) would sort BEFORE the
      // warm-start's ~1050, dropping its drifted cycles out of the learner's trailing window so the drift
      // never registers. `createdAt` is monotonic across runs (and ≈ seq within a run, which is emitted
      // sequentially), so the most recent actuals are correctly at the tail.
      .orderBy(asc(executionActual.createdAt), asc(executionActual.seq))
  }

  listActualsForVersion(tenantId: string, scheduleVersionId: string): Promise<ExecutionActual[]> {
    return this.db
      .select()
      .from(executionActual)
      .where(
        and(
          eq(executionActual.tenantId, tenantId),
          eq(executionActual.scheduleVersionId, scheduleVersionId),
        ),
      )
      // Recency order (createdAt), seq as an intra-call tiebreak: a per-op "last cycle wins" dedup must
      // pick the MOST RECENTLY emitted cycle. `seq` resets to 0 each simulate() call, so a later run (a
      // scoped wear-drift) would sort before an earlier one and lose the dedup — picking the stale cycle.
      .orderBy(asc(executionActual.createdAt), asc(executionActual.seq))
  }

  /**
   * Actuals for a set of resources with `actualStart` in `[startMs, endMs)` — the executed-past
   * population for continuous plant KPIs, spanning every executing version (each row keeps its own
   * `scheduleVersionId`; nothing is moved). Ordered by `createdAt` (recency) so the per-op dedup keeps
   * the MOST RECENTLY emitted cycle — `seq` resets each simulate() call, so a later scoped wear-drift
   * would otherwise sort before the warm-start and lose the dedup, hiding the drift from the lane KPIs.
   */
  listActualsForResourcesInWindow(
    tenantId: string,
    resourceIds: string[],
    startMs: number,
    endMs: number,
  ): Promise<ExecutionActual[]> {
    if (resourceIds.length === 0) return Promise.resolve([])
    return this.db
      .select()
      .from(executionActual)
      .where(
        and(
          eq(executionActual.tenantId, tenantId),
          inArray(executionActual.resourceId, resourceIds),
          gte(executionActual.actualStart, new Date(startMs)),
          lt(executionActual.actualStart, new Date(endMs)),
        ),
      )
      .orderBy(asc(executionActual.createdAt), asc(executionActual.seq))
  }

  // --- learned parameters (one settled row per key) --------------------------
  findLearned(
    tenantId: string,
    resourceId: string,
    routingOperationId: string,
    param: LearningParam,
  ): Promise<LearnedParameter | undefined> {
    return this.db.query.learnedParameter.findFirst({
      where: and(
        eq(learnedParameter.tenantId, tenantId),
        eq(learnedParameter.resourceId, resourceId),
        eq(learnedParameter.routingOperationId, routingOperationId),
        eq(learnedParameter.param, param),
      ),
    })
  }

  listLearned(tenantId: string): Promise<LearnedParameter[]> {
    return this.db
      .select()
      .from(learnedParameter)
      .where(eq(learnedParameter.tenantId, tenantId))
  }

  /** Upsert the single settled record for a key (the rule produces it). */
  async upsertLearned(data: NewLearnedParameter): Promise<LearnedParameter> {
    const existing = await this.findLearned(
      data.tenantId,
      data.resourceId,
      data.routingOperationId,
      data.param,
    )
    if (existing) {
      const [row] = await this.db
        .update(learnedParameter)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(learnedParameter.id, existing.id))
        .returning()
      return row!
    }
    const [row] = await this.db.insert(learnedParameter).values(data).returning()
    return row!
  }

  // --- parameter predictions (phase 4) ---------------------------------------
  /** The current live (non-superseded, actionable) forecast for a key, or undefined. */
  findLivePrediction(
    tenantId: string,
    resourceId: string,
    routingOperationId: string,
    param: LearningParam,
  ): Promise<ParameterPrediction | undefined> {
    return this.db.query.parameterPrediction.findFirst({
      where: and(
        eq(parameterPrediction.tenantId, tenantId),
        eq(parameterPrediction.resourceId, resourceId),
        eq(parameterPrediction.routingOperationId, routingOperationId),
        eq(parameterPrediction.param, param),
        isNull(parameterPrediction.supersededBy),
        inArray(parameterPrediction.disposition, LIVE_DISPOSITIONS),
      ),
      orderBy: desc(parameterPrediction.createdAt),
    })
  }

  /** All live forecasts for the tenant — Exception Queue + board flags. */
  listLivePredictions(tenantId: string): Promise<ParameterPrediction[]> {
    return this.db
      .select()
      .from(parameterPrediction)
      .where(
        and(
          eq(parameterPrediction.tenantId, tenantId),
          isNull(parameterPrediction.supersededBy),
          inArray(parameterPrediction.disposition, LIVE_DISPOSITIONS),
        ),
      )
      .orderBy(desc(parameterPrediction.createdAt))
  }

  /** Currently SET-ASIDE forecasts — human `dismissed` (snoozed a queued one) or `reverted` (overrode an
   *  adopted one), not yet superseded. The Exception Queue's "Set aside" list. A re-surfaced one becomes
   *  superseded → drops out here and reappears in the live read. Ordered most-recently-disposed first. */
  listSetAsidePredictions(tenantId: string): Promise<ParameterPrediction[]> {
    return this.db
      .select()
      .from(parameterPrediction)
      .where(
        and(
          eq(parameterPrediction.tenantId, tenantId),
          isNull(parameterPrediction.supersededBy),
          inArray(parameterPrediction.disposition, ['dismissed', 'reverted']),
        ),
      )
      .orderBy(desc(parameterPrediction.updatedAt))
  }

  /** The current SNOOZED (set-aside, not-superseded) forecast for a key — the snooze anchor. Covers both
   *  a `dismissed` queued proposal and a `reverted` human override of an adopted one: both re-surface only
   *  when materially worse (one-shot), so both anchor the snooze. */
  findSnoozed(
    tenantId: string,
    resourceId: string,
    routingOperationId: string,
    param: LearningParam,
  ): Promise<ParameterPrediction | undefined> {
    return this.db.query.parameterPrediction.findFirst({
      where: and(
        eq(parameterPrediction.tenantId, tenantId),
        eq(parameterPrediction.resourceId, resourceId),
        eq(parameterPrediction.routingOperationId, routingOperationId),
        eq(parameterPrediction.param, param),
        isNull(parameterPrediction.supersededBy),
        inArray(parameterPrediction.disposition, ['dismissed', 'reverted']),
      ),
      orderBy: desc(parameterPrediction.createdAt),
    })
  }

  findPredictionById(tenantId: string, id: string): Promise<ParameterPrediction | undefined> {
    return this.db.query.parameterPrediction.findFirst({
      where: and(eq(parameterPrediction.tenantId, tenantId), eq(parameterPrediction.id, id)),
    })
  }

  async insertPrediction(data: NewParameterPrediction): Promise<ParameterPrediction> {
    const [row] = await this.db.insert(parameterPrediction).values(data).returning()
    return row!
  }

  /** Patch a prediction's disposition/outcome/applied value (gate + human disposition). */
  async updatePrediction(
    id: string,
    patch: Partial<{
      disposition: PredictionDisposition
      outcome: PredictionOutcome
      appliedLearnedValue: number | null
      supersededBy: string | null
      dismissedAtConfidence: number | null
      dismissedAtHorizonMinutes: number | null
      horizonMinutes: number
      crossingAt: Date | null
      updatedAt: Date
    }>,
  ): Promise<void> {
    await this.db
      .update(parameterPrediction)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(parameterPrediction.id, id))
  }
}
