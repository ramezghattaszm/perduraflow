import { z } from 'zod'
import type { NarrationMode } from './llm'

/**
 * Scheduling module client↔API contract (phase 2 — api-spec §11). The scheduling
 * module is a CONSUMER of `masterdata.read` (via the binding resolver) and a
 * PRODUCER of the committed schedule the board renders. It publishes no
 * inter-module read contract this phase (no consumer yet). DTOs are response
 * shapes; the request schemas validate the solve/commit writes.
 *
 * Deterministic spine only (D2). `setup_source`/`cycle_source` default `standard`
 * and `*_confidence` are null — wired now, flipped by Phase 3's closed loop with
 * zero schema/board change (SKIP-04).
 */

// --- enums -------------------------------------------------------------------

export const demandTypeSchema = z.enum(['JIT', 'JIS', 'stock'])
export type DemandType = z.infer<typeof demandTypeSchema>

export const firmnessSchema = z.enum(['firm', 'forecast'])
export type Firmness = z.infer<typeof firmnessSchema>

export const scheduleVersionStatusSchema = z.enum(['draft', 'committed', 'superseded'])
export type ScheduleVersionStatus = z.infer<typeof scheduleVersionStatusSchema>

export const optimizerRunStatusSchema = z.enum(['success', 'infeasible', 'failed'])
export type OptimizerRunStatus = z.infer<typeof optimizerRunStatusSchema>

export const optimizerTriggerSchema = z.enum(['manual', 'scheduled', 'event', 'what_if'])
export type OptimizerTrigger = z.infer<typeof optimizerTriggerSchema>

/**
 * Whether a planning time is the master-data baseline, an ML correction from an
 * *observed* adoption (D7/SKIP-04, phase 3), or an ML **prediction** adopted ahead
 * of the drift materialising (phase 4 — acted on a forecast, not yet an actual).
 */
export const timeSourceSchema = z.enum(['standard', 'ml_adjusted', 'ml_predicted'])
export type TimeSource = z.infer<typeof timeSourceSchema>

// --- DTOs --------------------------------------------------------------------

export interface DemandInputDto {
  id: string
  demandLineId: string
  releaseReference: string | null
  /** → master-data part (resolved via masterdata.read). */
  partId: string
  plantId: string
  customerId: string
  programId: string | null
  demandType: DemandType
  firmness: Firmness
  requiredQty: number
  uom: string
  /** ISO timestamp. */
  requiredDate: string
  isActive: boolean
}

export interface OptimizerRunDto {
  id: string
  plantId: string
  trigger: OptimizerTrigger
  objectiveSummary: string
  status: OptimizerRunStatus
  stopReason: string | null
  startedAt: string
  finishedAt: string | null
  inputDemandCount: number
}

export interface ScheduleVersionDto {
  id: string
  plantId: string
  status: ScheduleVersionStatus
  horizonStart: string
  horizonEnd: string
  optimizerRunId: string
  supersedesVersionId: string | null
  createdAt: string
}

/**
 * Per-operation execution actual, surfaced on the board op so the bar detail panel
 * can show planned-vs-actual without a second round-trip. A subset of the
 * `learning` ExecutionActual (read-only); `null` until the version has actuals.
 */
export interface OperationActualDto {
  actualStart: string
  actualEnd: string
  actualCycleTime: number | null
  goodQty: number
  scrapQty: number
}

export interface ScheduledOperationDto {
  id: string
  scheduleVersionId: string
  demandLineId: string
  /** → master-data part / routing-operation / resource (resolved via masterdata.read). */
  partId: string
  routingOperationId: string
  resourceId: string
  opSeq: number
  sequencePosition: number
  plannedStart: string
  plannedEnd: string
  plannedQty: number
  setupTime: number
  cycleTime: number
  setupSource: TimeSource
  cycleSource: TimeSource
  /** Null until Phase 3's ML closed loop populates it (SKIP-04). */
  setupConfidence: number | null
  cycleConfidence: number | null
  atRisk: boolean
  atRiskReason: string | null
  /** This version's execution actual for the op (planned-vs-actual on the board);
   *  `null` until the version has actuals. */
  actual?: OperationActualDto | null
}

/** Board payload: a version header + its run + ordered scheduled operations. */
export interface ScheduleVersionDetailDto {
  version: ScheduleVersionDto
  run: OptimizerRunDto
  operations: ScheduledOperationDto[]
}

// --- Phase 3: performance variance / scorecard / workforce (api-spec §12.6/§12.8/§12.10) ---

/** Per-resource planned-vs-actual variance (4.4↔4.3), deterministic, no ML. */
export interface ResourceVarianceDto {
  resourceId: string
  resourceName: string
  /** Σ actual good_qty / Σ planned_qty over the version window. */
  throughputAttainment: number
  /** 1 − attainment (the "Line A running N% behind" chip); 0 when on/ahead of plan. */
  behindPlanPct: number
  /** Ops started within tolerance of planned_start / total ops. */
  scheduleAdherence: number
}

/** Board variance strip + Scorecard operational summary (all computed from rows). */
export interface PerformanceVarianceDto {
  scheduleVersionId: string
  resources: ResourceVarianceDto[]
  /** Blended throughput attainment; **null when the version has no actuals yet** (no data ≠ 100%). */
  throughputAttainment: number | null
  /** Sequence churn vs the prior committed version (0–1); null if no prior. */
  churn: number | null
  /** Ops with a held learned overlay / total ops. */
  learnedParamCount: number
  opCount: number
}

/** OEE A·P·Q breakdown (Scorecard). */
export interface OeeDto {
  availability: number
  performance: number
  quality: number
  /** A·P·Q. */
  oee: number
}

/** At-risk order exposure row (Scorecard). */
export interface AtRiskOrderDto {
  demandLineId: string
  label: string
  /** Computed sub-line, e.g. "op 10 · Press Line A" (never hardcoded). */
  detail: string
  /** The reason tag from the schedule (e.g. "late") — rendered as a badge. */
  reason: string
  /** The op's resource — clicking the row drills the Scorecard to this line. */
  resourceId: string
}

/** A prior-version metric snapshot for version-over-version deltas (NOT the manual baseline). */
export interface ScorecardPreviousDto {
  otif: number
  costPerUnit: number | null
  oee: OeeDto | null
}

/** View 2 · Service–Cost Scorecard (plant manager) — phase-3-computable metrics. */
export interface ScorecardDto {
  plantId: string
  scheduleVersionId: string | null
  /** When set, metrics are scoped to one resource/line (drill-down); null = plant-level. */
  resourceId?: string | null
  /** Prior **committed** version's metrics for version-over-version ↑/↓ (null if none). */
  previous: ScorecardPreviousDto | null
  /** On-time-in-full (service). */
  otif: number
  /** Tier-B cost per unit (computed from seeded Master-Data rates); null when no actuals. */
  costPerUnit: number | null
  /** OEE A·P·Q; **null when the version has no actuals yet** (no data ≠ 0%). */
  oee: OeeDto | null
  /** Throughput attainment; **null when no actuals yet**. */
  throughputAttainment: number | null
  atRisk: AtRiskOrderDto[]
}

/** A coverage matrix axis entry (operator row or station/cert column). */
export interface CoverageAxisDto {
  id: string
  label: string
  /** Operator only: absent this shift (the OUT marker). */
  out?: boolean
  /** Station/cert only: requires a certification (the `*`). */
  certRequired?: boolean
}

/** A coverage cell state. */
export type CoverageCell = 'qualified' | 'not_qualified' | 'gap'

/** Cert-gap → named-operator OT call-in (D54 human-confirmed proposal). */
export interface CoverageProposalDto {
  id: string
  /** The station/certification with no certified present operator. */
  station: string
  /** The named qualified operator to call in. */
  operatorName: string
  reason: string
  status: 'proposed' | 'confirmed'
}

/** View 3 · Workforce coverage (supervisor). */
export interface WorkforceCoverageDto {
  plantId: string
  operators: CoverageAxisDto[]
  stations: CoverageAxisDto[]
  /** Row-major cells[operatorIndex][stationIndex]. */
  cells: CoverageCell[][]
  /** Effective coverage % for the next shift. */
  readinessPct: number
  certGapCount: number
  proposals: CoverageProposalDto[]
}

// --- request schemas ---------------------------------------------------------

/** `POST /admin/scheduling/solve` — run the deterministic sequencer for a plant. */
export const solveScheduleSchema = z.object({ plantId: z.string().min(1) }).strict()
export type SolveScheduleRequest = z.infer<typeof solveScheduleSchema>

// =============================================================================
// Phase 5 — what-if (D55) + plan-comparison/baselines (D57) + narration (A19)
// =============================================================================

// --- change-set (change-set-general; evaluation-only in phase 5) --------------

/** Where a change-set came from — a defined trigger (phase 5), arbitrary later (phase 6). */
export const changeOriginTypeSchema = z.enum(['demand', 'prediction', 'collision', 'manual'])
export type ChangeOriginType = z.infer<typeof changeOriginTypeSchema>

/**
 * One change in a change-set. A discriminated union so the engine stays
 * feasibility-honest per kind. Phase 5 calls with defined kinds (demand revision,
 * wear remediation); the union is general so phase 6 can drive it conversationally.
 */
export const changeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('demand_qty'), demandLineId: z.string().min(1), to: z.number().int().positive() }),
  z.object({ kind: z.literal('demand_date'), demandLineId: z.string().min(1), to: z.string().min(1) }),
  z.object({ kind: z.literal('resource_window'), resourceId: z.string().min(1), downFrom: z.string().min(1), downTo: z.string().min(1) }),
  z.object({ kind: z.literal('overtime'), resourceId: z.string().min(1), hours: z.number().positive() }),
  z.object({ kind: z.literal('wear_remediation'), resourceId: z.string().min(1), action: z.enum(['service', 'defer', 'ot']) }),
])
export type Change = z.infer<typeof changeSchema>

export const changeSetSchema = z
  .object({
    origin: z.object({ type: changeOriginTypeSchema, ref: z.string().optional() }).strict(),
    changes: z.array(changeSchema).min(1),
  })
  .strict()
export type ChangeSet = z.infer<typeof changeSetSchema>

// --- structured rationale (the phase-6 substrate — addressable 3 ways) --------

export type RationaleFactorKey = 'lateness' | 'changeover' | 'overtime' | 'inventory' | 'displacement' | 'cost'
export type FactorDirection = 'improves' | 'worsens' | 'neutral'

/**
 * One objective factor's contribution to an option's score — the **by-factor**
 * query axis. `contribution = rawValue · weight` (signed; lower score is better,
 * matching the sequencer). `detailKey`/`detailParams` are an **i18n key + params**,
 * never free text — so the structured form is the source of truth and narration
 * only re-voices it (the A19 boundary).
 */
export interface RationaleFactor {
  key: RationaleFactorKey
  labelKey: string
  rawValue: number
  unit: string
  weight: number
  contribution: number
  direction: FactorDirection
  detailKey: string
  detailParams: Record<string, string | number>
}

/** A binding/non-binding constraint — the **by-constraint** query axis. */
export interface ConstraintBinding {
  key: string
  labelKey: string
  type: 'hard' | 'soft'
  /** True = this constraint is what limited the option (the binding edge). */
  binding: boolean
  /** How much room remained (null for hard/violated). */
  slack: number | null
  detailKey: string
  detailParams: Record<string, string | number>
}

/**
 * Why this option beats/loses to another — the **by-option** query axis. Computed
 * at generation time so "why not B" answers from the stored rationale with **no
 * engine re-run** (DoD proof #8). `decidingFactors` are the factor deltas that
 * actually swung the verdict.
 */
export interface OptionComparative {
  vsOptionId: string
  deltaScore: number
  verdict: 'preferred' | 'dominated' | 'tradeoff'
  decidingFactors: { key: RationaleFactorKey; delta: number }[]
}

/**
 * The structured rationale — the deterministic source of truth narration renders
 * **alongside** (never replacing). Addressable by **factor** (`factors[].key`), by
 * **constraint** (`constraints[].key`), and by **option** (`comparatives[]`).
 * `schemaVersion` versions the shape; `weightSetVersion` pins the AS9 objective
 * weights that produced the contributions, so a stored rationale stays
 * interpretable if weights ever re-tune (contribution = rawValue · weight).
 */
export interface StructuredRationale {
  schemaVersion: string
  weightSetVersion: string
  optionId: string
  score: number
  headlineKey: string
  headlineParams: Record<string, string | number>
  factors: RationaleFactor[]
  constraints: ConstraintBinding[]
  comparatives: OptionComparative[]
}

// --- costed KPIs + options + result ------------------------------------------

/** A plan's costed KPI bundle — every figure computed from rows (no hardcoding). */
export interface CostedKpis {
  /** On-time fraction (plan-based). */
  otif: number
  /** Tier-B cost per unit; null when not costable (no rates/qty). */
  costPerUnit: number | null
  /** OEE A·P·Q; null without actuals. */
  oee: OeeDto | null
  /** Count of at-risk (late) orders. */
  lateOrders: number
  /** Total placed quantity over the horizon. */
  throughput: number | null
  /** Sequence churn vs the base plan (0–1); null when not applicable. */
  churn: number | null
}

/**
 * One ranked what-if option. Carries its costed KPIs, a feasibility verdict
 * (feasibility-honest — an infeasible option says why, never silently mangled),
 * a score, and the structured rationale.
 */
export interface WhatIfOption {
  id: string
  rank: number
  labelKey: string
  feasible: boolean
  /** i18n key for why it can't be scheduled (null when feasible). */
  infeasibleReasonKey: string | null
  kpis: CostedKpis
  score: number
  rationale: StructuredRationale
}

/**
 * A what-if evaluation result (D55). Deterministic: the same change-set against
 * the same base + learned overlay + weights yields the same `determinismKey` and
 * the same options/rationale. Persisted (rationale jsonb) as the phase-6 substrate.
 */
export interface WhatIfResultDto {
  id: string
  plantId: string
  baseVersionId: string
  changeSet: ChangeSet
  /** The base (current) plan's KPIs — the comparison anchor for option deltas. */
  baseKpis: CostedKpis
  options: WhatIfOption[]
  recommendedOptionId: string | null
  /** Hash of (base inputs + change-set + overlay + weights) — same → same result. */
  determinismKey: string
  createdAt: string
}

// --- plan-comparison / baselines (D57) ---------------------------------------

export const baselineSourceSchema = z.enum(['frozen_engine_snapshot', 'measured_historical'])
export type BaselineSource = z.infer<typeof baselineSourceSchema>

/**
 * Live plan vs a typed baseline (D57). `frozen_engine_snapshot` is the same engine
 * with the learning + stability layers off and naive policies — the gap is "the
 * lift our intelligence adds" (NOT "vs your manual process"). `measured_historical`
 * computes from seeded historical rows and shows `emptyState` when none exist.
 * Baselines are never fabricated.
 */
export interface PlanComparisonDto {
  source: BaselineSource
  /** True → no baseline available (no historical rows) → render the honest empty state. */
  emptyState: boolean
  plantId: string
  scheduleVersionId: string | null
  live: CostedKpis | null
  baseline: CostedKpis | null
  /** Honest i18n label key for this arm. */
  labelKey: string
}

/** A recorded historical outcome — the measured-historical arm's source rows. */
export interface HistoricalOutcomeDto {
  id: string
  plantId: string
  resourceId: string | null
  periodStart: string
  periodEnd: string
  otif: number
  costPerUnit: number | null
  oee: number | null
  lateOrders: number
  throughput: number | null
  /** "representative seed" now; a real period label once a historian feeds it. */
  label: string
  /** 'seed' now, 'mes' later — same row shape, zero code change. */
  source: string
}

// --- narration (A19, async/non-blocking, alongside the rationale) ------------

/** Narration for a what-if result — async, never in the commit path. */
export interface WhatIfNarrationDto {
  resultId: string
  optionId: string | null
  mode: NarrationMode
  /** `ready` with prose, or `unavailable` (model slow/failed) — zero functional impact. */
  status: 'ready' | 'unavailable'
  prose: string | null
  model: string | null
  promptVersion: string | null
  createdAt: string
}

// --- request schemas (phase 5) -----------------------------------------------

/** `POST /scheduling/what-if` — evaluate a change-set → ranked costed option-set. */
export const whatIfRequestSchema = z
  .object({ plantId: z.string().min(1), baseVersionId: z.string().optional(), changeSet: changeSetSchema })
  .strict()
export type WhatIfRequest = z.infer<typeof whatIfRequestSchema>

/** `POST /scheduling/what-if/:id/narrate` — render the rationale into prose (async). */
export const narrateRequestSchema = z
  .object({ mode: z.enum(['option', 'across_options']).default('across_options'), optionId: z.string().optional() })
  .strict()
export type NarrateRequest = z.infer<typeof narrateRequestSchema>

/** `POST /scheduling/what-if/:id/apply` — commit an option through the guardrail (human action). */
export const applyOptionSchema = z.object({ optionId: z.string().min(1) }).strict()
export type ApplyOptionRequest = z.infer<typeof applyOptionSchema>

/**
 * `PATCH /dev/scheduling/demand/:demandLineId` — **dev-only** persistent demand-qty
 * mutation for the scenario launcher (a real demand change a planner would receive).
 * Mutates the seeded `demand_input` so a re-solve reflects it; restored by `demo:reset`.
 */
export const updateDemandQtySchema = z.object({ requiredQty: z.number().int().positive() }).strict()
export type UpdateDemandQtyRequest = z.infer<typeof updateDemandQtySchema>

/**
 * `POST /dev/scheduling/simulate` — the SKIP-51 demo simulator + drift trigger
 * (dev/staging only, never in nav). Seeded/deterministic.
 */
export const simulateActualsSchema = z
  .object({
    scheduleVersionId: z.string().min(1),
    /** Production cycles emitted per scheduled op (enough samples to let learning adopt). */
    cyclesPerOp: z.number().int().positive().max(50).default(12),
    drift: z
      .object({
        resourceId: z.string().min(1),
        param: z.enum(['cycle', 'setup']).default('cycle'),
        /** Fractional ramp target, e.g. 0.08 = +8% (Collision-2 tool-wear). */
        magnitude: z.number(),
        rampOverEvents: z.number().int().positive().default(8),
      })
      .strict()
      .optional(),
  })
  .strict()
export type SimulateActualsRequest = z.infer<typeof simulateActualsSchema>
