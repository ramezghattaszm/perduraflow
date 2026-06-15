import { z } from 'zod'
import type { TimeSource } from './scheduling'

/**
 * Learning module contract (`learning.read`, phase 3 — api-spec §12). The platform
 * **ML-parameter-learning capability** (A14): it ingests execution actuals (4.3),
 * derives **damped** learned cycle/setup times (D5/D7), and publishes the learned
 * overlay scheduling consumes at solve. Carries `id + version` from day one
 * (SKIP-21). A14 makes this a platform capability consumed **directly** (like the
 * kernel `org.read`), **not** a per-tenant binding — learning is not a swappable
 * domain counterpart.
 *
 * The learned record is **structured** (value + source + confidence + sample
 * basis) so a Phase-4 predictor can extend it and the Phase-5 narration surface
 * (A19) can verbalise it — never a bare float (forward-hooks).
 */
export const LEARNING_READ_CONTRACT = { id: 'learning.read', version: '1.0' } as const

// --- enums -------------------------------------------------------------------

/** Which time parameter is being learned (D3 priority: changeover/setup, then cycle). */
export const learningParamSchema = z.enum(['cycle', 'setup'])
export type LearningParam = z.infer<typeof learningParamSchema>

/**
 * Learned-parameter lifecycle (the damped state machine, api-spec §12.3):
 * `learning` = accruing samples, scheduler still uses standard; `held` = a settled
 * step adopted and holding; `rejected` = breached a guardrail (kept standard, flagged).
 */
export const learnedStatusSchema = z.enum(['learning', 'held', 'rejected'])
export type LearnedStatus = z.infer<typeof learnedStatusSchema>

// --- DTOs --------------------------------------------------------------------

/**
 * One settled learned parameter for a `(resource, routing operation, param)` — a
 * **single held step**, NOT a time series (convergence-not-motion; the actuals are
 * the series). `learnedValue` is null until adoption (scheduler uses `stdBaseline`).
 */
export interface LearnedParameterDto {
  resourceId: string
  routingOperationId: string
  param: LearningParam
  /** The master-data standard at adoption, retained alongside (D7). */
  stdBaseline: number
  /** Current settled value; null = not yet adopted (use standard). */
  learnedValue: number | null
  /** `standard` until adopted, then `ml_adjusted` — mirrors the board tag. */
  source: TimeSource
  /** 0–1, rising with samples; null while `learning`. */
  confidence: number | null
  sampleCount: number
  /** Mean / dispersion of the trailing window — the basis behind the value (explainability). */
  windowMean: number
  windowStddev: number
  status: LearnedStatus
  /** When it last took a decisive step (not per-actual); ISO string or null. */
  lastSteppedAt: string | null
}

/**
 * Published `learning.read 1.0` interface (api-spec §12.9). Scheduling consumes it
 * directly at solve to overlay learned cycle/setup; the board/variance panel lists
 * learned overlays. No transport in the interface (O6).
 */
export interface LearningReadContract {
  readonly contract: typeof LEARNING_READ_CONTRACT
  /** The learned overlay for one parameter, or null if none recorded yet. */
  getLearnedParameter(
    tenantId: string,
    resourceId: string,
    routingOperationId: string,
    param: LearningParam,
  ): Promise<LearnedParameterDto | null>
  /** All learned overlays for the tenant (board/panel; consumer filters by resource). */
  listLearnedParameters(tenantId: string): Promise<LearnedParameterDto[]>
  /** Persisted actuals for a schedule version — scheduling joins these for variance/OEE/cost (4.4↔4.3). */
  listActualsForVersion(tenantId: string, scheduleVersionId: string): Promise<ExecutionActualDto[]>
}

/** A persisted execution actual (4.3) returned to the variance/OEE/cost computation. */
export interface ExecutionActualDto {
  id: string
  scheduledOperationId: string
  resourceId: string
  routingOperationId: string
  partId: string
  actualStart: string
  actualEnd: string
  actualSetupTime: number | null
  actualCycleTime: number | null
  goodQty: number
  scrapQty: number
  downtimeMinutes: number
}

// --- 4.3 execution actual (the cross-module ingestion payload) ----------------

/**
 * Execution actual (§4.3) — the simulator (SKIP-51, in `scheduling`) emits this on
 * the EventBus; `learning` consumes + appends it. The cross-module surface for the
 * closed loop; a real MES connector emits the same shape later (cleanly swappable).
 */
export const executionActualSchema = z
  .object({
    actualEventId: z.string().min(1),
    scheduleVersionId: z.string().min(1),
    scheduledOperationId: z.string().min(1),
    resourceId: z.string().min(1),
    routingOperationId: z.string().min(1),
    partId: z.string().min(1),
    actualStart: z.string(), // ISO
    actualEnd: z.string(),
    actualSetupTime: z.number().nonnegative().nullable().default(null),
    actualCycleTime: z.number().nonnegative().nullable().default(null),
    /** The D7 standard baselines (from master-data), carried so the learner is self-contained
     *  (reference data, not the 4.3 measured fields). */
    stdSetupTime: z.number().nonnegative(),
    stdCycleTime: z.number().nonnegative(),
    goodQty: z.number().nonnegative(),
    scrapQty: z.number().nonnegative().default(0),
    downtimeMinutes: z.number().nonnegative().default(0),
    downtimeReason: z.string().nullable().default(null),
    source: z.enum(['simulator', 'manual']).default('simulator'),
    /** Deterministic emission order within a run (window stability, D2). */
    seq: z.number().int().nonnegative(),
  })
  .strict()
export type ExecutionActualPayload = z.infer<typeof executionActualSchema>

/** EventBus payload for `learning.drift.detected` (D56 tool-wear flag → notifications). */
export interface DriftDetectedPayload {
  tenantId: string
  resourceId: string
  routingOperationId: string
  param: LearningParam
  deviationPct: number
  confidence: number
}
