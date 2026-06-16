import { Inject, Injectable } from '@nestjs/common'
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import { LEARNING_DB, type LearningDatabase } from './learning.db'
import {
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
import type { LearningParam, PredictionDisposition, PredictionOutcome } from '@perduraflow/contracts'

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
      .orderBy(asc(executionActual.seq), asc(executionActual.createdAt))
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
      .orderBy(asc(executionActual.seq))
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
    }>,
  ): Promise<void> {
    await this.db
      .update(parameterPrediction)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(parameterPrediction.id, id))
  }
}
