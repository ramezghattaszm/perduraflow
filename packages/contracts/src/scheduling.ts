import { z } from 'zod'

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

/** Whether a planning time is the master-data baseline or an ML correction (D7/SKIP-04). */
export const timeSourceSchema = z.enum(['standard', 'ml_adjusted'])
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
