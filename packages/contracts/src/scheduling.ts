import { z } from 'zod'
import type { NarrationMode } from './llm'
import type { OperatorAbsenceReason, ResourceDowntimeKind } from './masterdata'
import type { OrgPriority } from './org'

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

// `discarded` is a soft-deleted draft (never committed → no audit value): the status transition
// IS the soft delete (no row removed). committed/superseded stay immutable and are never discardable.
export const scheduleVersionStatusSchema = z.enum(['draft', 'committed', 'superseded', 'discarded'])
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

/**
 * The floor component that set an op's start — the engine's computed cause of its placement, the
 * atom of causal-lateness attribution (D-late). `resource`/`predecessor` point at a blocking op
 * (followed for the chain); the rest are roots: `material` (buy-component gate), `release`/`origin`
 * (couldn't start before its day / the horizon), `working_window` (couldn't fit a working segment),
 * `resource_downtime` (a line-down / maintenance closure on the resource delayed the start).
 */
export const bindingKindSchema = z.enum([
  'resource',
  'predecessor',
  'material',
  'release',
  'origin',
  'working_window',
  'resource_downtime',
  'operator',
])
export type BindingKind = z.infer<typeof bindingKindSchema>

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

/**
 * The operator the engine applied to an op — resolved via the SAME resource+time assignment lookup
 * the sequencer uses (resource_operator_assignment → operator.performanceFactor). So the card shows
 * the operator the engine actually applied, not a guess. Null when no assignment covers the op's
 * resource at its start → the op ran at standard (factor 1.0).
 */
export interface AssignedOperatorDto {
  /** The operator id — lets the lane lever compare the plan's operator to the live assignment. */
  id: string
  name: string
  /**
   * "Percent of standard" as a ratio: 1.0 = standard, >1.0 = faster, <1.0 = slower. The engine divides
   * RUN time by it (effectiveCycle = cycleTime / performanceFactor) — higher is faster. Do NOT invert.
   */
  performanceFactor: number
  /** The operator's labor rate (per the D57 labor-cost KPI), or null if unset. */
  laborRate: number | null
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
  /** STRANDED: this committed op sits inside an active line-down window — it can't run as planned
   *  (a FACT, computed op ∩ active downtime; no re-solve). Distinct from `atRisk` (the delivery
   *  prediction). Absent/false when no active window covers it. */
  stranded?: boolean
  /** This version's execution actual for the op (planned-vs-actual on the board);
   *  `null` until the version has actuals. */
  actual?: OperationActualDto | null
  /** The computed causal lateness chain for this op (D-late); populated only for at-risk ops, else null. */
  latenessChain?: LatenessChainDto | null
  /** The operator the engine applied (resource+time assignment → factor); null = ran at standard. */
  operator?: AssignedOperatorDto | null
}

/**
 * The plant's daily operating window (minutes from UTC midnight) — the union of the
 * resources' calendar shift patterns (D-shift). Drives the board Gantt axis so it spans
 * the working day (e.g. 06:00–22:00) instead of a naive midnight-to-last-op range. Null
 * when no calendar resolves (the Gantt falls back to the horizon range).
 */
export interface WorkingWindowDto {
  startMinute: number
  endMinute: number
  /** UTC weekdays the plant operates (0=Sun … 6=Sat) — drives the week view's closed days. */
  workingDays: number[]
  /** `YYYY-MM-DD` (UTC) full-day closures in scope — rendered closed in the week view. */
  holidays: string[]
}

/** Board payload: a version header + its run + ordered scheduled operations. */
export interface ScheduleVersionDetailDto {
  version: ScheduleVersionDto
  run: OptimizerRunDto
  operations: ScheduledOperationDto[]
  /** The plant's daily working window for the Gantt axis (D-shift); null if no calendar. */
  workingWindow: WorkingWindowDto | null
}

// --- Phase 3: performance variance / scorecard / workforce (api-spec §12.6/§12.8/§12.10) ---

/** Per-resource planned-vs-actual variance (4.4↔4.3), deterministic, no ML. */
export interface ResourceVarianceDto {
  resourceId: string
  resourceName: string
  /** Σ actual good_qty / Σ planned_qty over the EXECUTED ops (those with actuals) — execution
   * performance of what has actually run, not diluted by the rolling window's unexecuted future. */
  throughputAttainment: number
  /** 1 − attainment (the "Line A running N% behind" chip); 0 when on/ahead of plan. */
  behindPlanPct: number
  /**
   * CONTINUOUS executed-past attainment for this resource — Σ good ÷ Σ planned-at-execution over the
   * Reporting-Policy window, aggregated across executing versions (stable across re-solve). `null`
   * when the resource executed nothing in the window. Drives the lane "behind plan" chip; distinct
   * from {@link throughputAttainment} (this version's ops only — the plan-quality retrospective).
   */
  continuousAttainment: number | null
  /**
   * CONTINUOUS historical OEE for this resource (A·P·Q) over the Reporting-Policy window, read from
   * the measured_historical (`historical_outcome`) rows — the SAME source as the scorecard's
   * "Historical" baseline arm (no divergence). `null` when no in-window rows exist for the resource.
   * Distinct from the per-version scorecard OEE.
   */
  continuousOee: OeeDto | null
  /** Ops started within tolerance of planned_start / executed ops. */
  scheduleAdherence: number
  /**
   * Capacity utilization over the forward window (D-util): busy (engine processing minutes,
   * setup + cycle×qty of the resource's ops starting in the window) ÷ regular working minutes
   * available (shifts − closures, OT excluded). `> 1` = committed beyond regular capacity
   * (overloaded). `null` when the resource has no regular capacity in the window (e.g. down).
   */
  utilizationPct: number | null
}

/** Board variance strip + Scorecard operational summary (all computed from rows). */
export interface PerformanceVarianceDto {
  scheduleVersionId: string
  resources: ResourceVarianceDto[]
  /** Blended throughput attainment; **null when the version has no actuals yet** (no data ≠ 100%).
   * PER-VERSION (this committed plan's executed ops) — the plan-quality retrospective (scorecard). */
  throughputAttainment: number | null
  /**
   * CONTINUOUS plant-performance throughput — Σ good ÷ Σ planned-at-execution over the
   * Reporting-Policy window, aggregating real actuals across executing versions (each measured
   * against the plan that was live when it ran). A fact about the plant's executed past, so it does
   * NOT reset on a re-solve. `null` when nothing executed in the window. The KPI strip reads THIS.
   */
  plantThroughputAttainment: number | null
  /**
   * CONTINUOUS plant On-Time delivery over the Reporting-Policy window — the fraction of orders that
   * delivered by their due, aggregated from the authoritative executed actuals across versions (the
   * SAME substrate as continuous throughput). Order-grain (an order is on-time iff its latest finish
   * in the window ≤ its due), so the seeded historical late deliveries pull it below 100% — a
   * continuous, plan-current view, distinct from the per-version Scorecard OTIF. The cockpit On-Time
   * KPI reads THIS; `null` when nothing executed in the window. (The live forward at-risk is the
   * separate At-risk tile / work-list committedAtRisk.)
   */
  plantOnTime: number | null
  /**
   * CONTINUOUS historical OEE (A·P·Q) over the Reporting-Policy window — aggregated from the
   * measured_historical (`historical_outcome`) rows, the SAME scope the scorecard's "Historical"
   * baseline arm uses, so the historical number is identical on both surfaces (no divergence).
   * Plan-independent and present from `demo:reset`; does NOT reset on a re-solve. `null` when no
   * in-window rows exist. The cockpit OEE headline reads THIS; the scorecard keeps the per-version
   * OEE (the plan-quality retrospective) — the same two-home split as throughput.
   */
  plantOee: OeeDto | null
  /** The continuous reporting window (ISO) — `today − reportingWindowDays` → start-of-today. */
  reportingWindowStart: string
  reportingWindowEnd: string
  /**
   * Plant capacity utilization over the forward window (D-util) — Σ busy ÷ Σ available across the
   * plant's resources, the capacity-weighted average of the per-resource figures (reconciles by
   * construction). `null` when the plant has no regular capacity in the window.
   */
  utilizationPct: number | null
  /** The forward utilization window (ISO): `max(today, horizonStart)` → `horizonEnd`. */
  utilizationWindowStart: string
  utilizationWindowEnd: string
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

/** A root cause that terminates a lateness chain (D-late). */
export const latenessRootSchema = z.enum([
  'material',
  'working_window',
  'capacity',
  'due_before_start',
  'resource_downtime',
  'operator',
])
export type LatenessRoot = z.infer<typeof latenessRootSchema>

/**
 * One hop in a lateness chain — an op and the computed reason it was pushed. `predecessor`/`resource`
 * point to the next (blocking) hop; a {@link LatenessRoot} value is terminal. Every hop is a stored
 * engine fact (the binding floor), never inferred — the Copilot narrates these verbatim.
 */
export interface LatenessHop {
  demandLineId: string
  opSeq: number
  resourceId: string
  resourceName: string
  partNo: string
  /** Why THIS op was pushed (its binding). Terminal hop carries a LatenessRoot. */
  kind: 'predecessor' | 'resource' | LatenessRoot
  /** Root specifics, e.g. the gating component part no ("PV-22") on a `material` hop, or the downtime
   *  window's reason on a `resource_downtime` hop; else null. */
  detail: string | null
  /** On a `resource_downtime` root hop: line-down vs maintenance (drives copy nuance); else null. */
  downtimeKind?: ResourceDowntimeKind | null
  /** On an `operator` root hop: the slow operator's performance % (e.g. 25). `detail` holds the name. */
  operatorPct?: number | null
}

/**
 * The full computed causal chain for a late order: ordered hops from the late op through its blockers
 * to a root. Deterministic (same schedule → same chain), grounded (each hop = a stored binding),
 * guarded (max depth + visited-set → `truncated`). Read identically by the board, queue, and Copilot.
 */
export interface LatenessChainDto {
  /** [the late op, …blockers…, the root op]. */
  hops: LatenessHop[]
  root: LatenessRoot
  /** True if the walk hit the depth cap or a revisit (chain shown is partial, never silently dropped). */
  truncated: boolean
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
  /** The computed causal chain for this at-risk op (D-late); null if not derivable. */
  chain: LatenessChainDto | null
}

/** A prior-version metric snapshot for version-over-version deltas (NOT the manual baseline). */
export interface ScorecardPreviousDto {
  otif: number
  costPerUnit: number | null
  oee: OeeDto | null
  /** Execution discipline: executed ops started within tolerance of planned start / executed ops. */
  scheduleAdherence: number | null
  throughputAttainment: number | null
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
  /**
   * Schedule Adherence — executed ops started within tolerance of planned start / executed ops
   * (execution discipline). A distinct axis from {@link otif} (delivery outcome). Null without actuals.
   */
  scheduleAdherence: number | null
  /** Throughput attainment; **null when no actuals yet**. */
  throughputAttainment: number | null
  atRisk: AtRiskOrderDto[]
  /**
   * Canonical at-risk-committed-orders count (firm orders currently at-risk) — from the work-list
   * status engine (plant-level), so the scorecard tile, the cockpit tile and the baseline "late
   * orders" live column all show the same number. Distinct from `atRisk` (the per-op causal-chain list).
   */
  committedAtRisk: number
}

// --- work list (all-work table; generalizes the exception queue) --------------

/**
 * A work item's computed lifecycle status (D-worklist) — derived from the schedule + actuals,
 * never stored. Mutually exclusive + exhaustive, evaluated in precedence order:
 * `completed` (executed) → `at_risk` (committed, predicted late/blocked) → `stranded` (a committed op
 * sits inside an active line-down window — it CANNOT run as planned; a FACT, not a prediction, and
 * distinct from late: the order may re-sequence on-time) → `in_progress` (started, on-track) →
 * `scheduled` (future, on-track). `at_risk` uses the SAME `atRisk` flag the board / KPI strip /
 * exception queue read (the delivery prediction, R1 — unchanged until a re-solve); `stranded` is the
 * separate infeasibility fact, so neither masks the other and both reconcile across surfaces.
 */
export const workListStatusSchema = z.enum(['completed', 'at_risk', 'stranded', 'in_progress', 'scheduled'])
export type WorkListStatus = z.infer<typeof workListStatusSchema>

/** One operation under a work-list order row (the expand detail) — same per-op taxonomy. */
export interface WorkListOpDto {
  opSeq: number
  resourceId: string
  resourceName: string
  status: WorkListStatus
  plannedStart: string
  plannedEnd: string
  atRiskReason: string | null
}

/**
 * One order (demand line) in the work list — its ops rolled up to a single status, plus the
 * fields a planner scans (customer / priority / due / planned / lane). At-risk rows carry the
 * binding op's reason + the computed causal chain (D-late), identical to the exception queue.
 */
export interface WorkListRowDto {
  /** = demandLineId (the DataTable row key). */
  id: string
  demandLineId: string
  /** "partNo · releaseReference" (or demandLineId) — the scan label. */
  label: string
  partNo: string
  releaseReference: string | null
  customerName: string
  priority: OrgPriority
  firmness: Firmness
  /** ISO timestamp. */
  requiredDate: string
  requiredQty: number
  /** Rolled-up status (precedence: at_risk → all-completed → in_progress → scheduled). */
  status: WorkListStatus
  /** The order's planned window across its ops (ISO); null if it has no ops. */
  plannedStart: string | null
  plannedEnd: string | null
  /** Distinct lanes the order runs on, name-resolved, in op order. */
  resourceNames: string[]
  /** The binding at-risk op's "op N · Lane" sub-line; null when not at-risk. */
  atRiskDetail: string | null
  /** The binding at-risk op's reason tag; null when not at-risk. */
  atRiskReason: string | null
  /** The computed causal chain for the order's at-risk op (D-late); null otherwise. */
  chain: LatenessChainDto | null
  /** Per-op breakdown for the expand row. */
  ops: WorkListOpDto[]
}

/** Status rollup counts (the filter chips); `total` = all rows. */
export interface WorkListCountsDto {
  total: number
  completed: number
  /** Distinct orders currently at-risk (status `at_risk`), ALL firmness — the browse-filter count. */
  atRisk: number
  /**
   * The CANONICAL at-risk-committed-orders count: FIRM orders currently at-risk (the firm subset of
   * {@link atRisk}). The single source the cockpit + scorecard at-risk KPIs and the baseline "late
   * orders" live column read, so every surface reconciles. (`atRisk` stays all-firmness for the filter.)
   */
  committedAtRisk: number
  /** Orders with a committed op inside an active line-down window (can't run as planned). */
  stranded: number
  inProgress: number
  scheduled: number
}

/**
 * The Work List payload (D-worklist): every order with a computed status + the summary counts.
 * Single source — the exception queue renders this filtered to `at_risk`, so its row count equals
 * `counts.atRisk`. Statuses are computed here, never persisted (compute-not-store).
 */
export interface WorkListResponseDto {
  plantId: string
  scheduleVersionId: string | null
  counts: WorkListCountsDto
  rows: WorkListRowDto[]
}

/** A coverage matrix axis entry (operator row or station/cert column). */
export interface CoverageAxisDto {
  id: string
  label: string
  /** Operator only: absent this shift (the OUT marker). */
  out?: boolean
  /** Operator only: WHY they're out (drives the OUT marker's reason tag); null/absent when present. */
  outReason?: OperatorAbsenceReason | null
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
  /** The proposed operator's absence reason (`not_scheduled` = clean call-in; `vacation` = tentative). */
  absenceReason: OperatorAbsenceReason
  /** True when the only available fill is on vacation — call-in may not be possible; confirm first. */
  tentative: boolean
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

// --- material gate (§4.8 / D36) ----------------------------------------------

/** A buy-component's availability (the §4.8 input) — for the scenario launcher dropdown. */
export interface MaterialAvailabilityDto {
  componentPartId: string
  componentPartNo: string
  availableAt: string
}

/**
 * A detected material condition (board): a component whose availability gates committed
 * consuming ops (planned before the material arrives). Mirrors the line-down / demand cards.
 */
export interface MaterialConditionDto {
  componentPartId: string
  componentPartNo: string
  availableAt: string
  /** Demand lines whose committed ops are gated (start before `availableAt`). */
  gatedDemandLineIds: string[]
}

/**
 * A pinned resource↔operator assignment (the §4.8 performance input, C5) — for the launcher.
 * The operator's `performanceFactor` (master-data) modifies the line's run time when scheduled.
 */
export interface ResourceOperatorAssignmentDto {
  /** The assignment row id — the target for DELETE /admin/scheduling/operator-assignments/:id. */
  id: string
  resourceId: string
  resourceName: string
  operatorId: string
  operatorName: string
  /** Operator efficiency rating, ratio (1.0 = standard); applied as a run-time divisor. */
  performanceFactor: number
  effectiveFrom: string | null
  effectiveTo: string | null
}

// --- request schemas ---------------------------------------------------------

/** `POST /admin/scheduling/solve` — run the deterministic sequencer for a plant. */
export const solveScheduleSchema = z.object({ plantId: z.string().min(1) }).strict()
export type SolveScheduleRequest = z.infer<typeof solveScheduleSchema>

/** `PATCH /dev/scheduling/material/:componentPartId` — set a component's availability (launcher). */
export const setMaterialAvailabilitySchema = z
  .object({ plantId: z.string().min(1), availableAt: z.string().min(1) })
  .strict()
export type SetMaterialAvailabilityRequest = z.infer<typeof setMaterialAvailabilitySchema>

/** `PATCH /dev/scheduling/operator-assignment/:resourceId` — pin/swap a line's operator (launcher). */
export const setResourceOperatorAssignmentSchema = z
  .object({
    plantId: z.string().min(1),
    operatorId: z.string().min(1),
    effectiveFrom: z.string().nullable().default(null),
    effectiveTo: z.string().nullable().default(null),
  })
  .strict()
export type SetResourceOperatorAssignmentRequest = z.infer<
  typeof setResourceOperatorAssignmentSchema
>

/**
 * `POST /admin/scheduling/operator-assignments` — the PLANNER assign/switch lever (C5, product). Pins
 * (or switches) the operator on a resource for an optional window; the engine reacts on the next
 * re-solve. Resource-grain + time-windowed (matches the model + shift staffing); the planner assigns,
 * the engine never optimizes the roster (labor stays external). Cross-plant is allowed — operators
 * float between plants day-to-day; home plant is an informational default, not a constraint.
 */
export const assignOperatorSchema = z
  .object({
    plantId: z.string().min(1),
    resourceId: z.string().min(1),
    operatorId: z.string().min(1),
    effectiveFrom: z.string().nullable().default(null),
    effectiveTo: z.string().nullable().default(null),
  })
  .strict()
export type AssignOperatorRequest = z.infer<typeof assignOperatorSchema>

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
  z.object({
    kind: z.literal('demand_qty'),
    demandLineId: z.string().min(1),
    to: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal('demand_date'),
    demandLineId: z.string().min(1),
    to: z.string().min(1),
  }),
  z.object({
    kind: z.literal('resource_window'),
    resourceId: z.string().min(1),
    downFrom: z.string().min(1),
    downTo: z.string().min(1),
  }),
  // Line-down REMEDIATION marker: the resource is already down per a PERSISTED resource_downtime
  // window (the situation lives in the base context's calendars). This change carries NO window
  // times — it only signals "generate the reroute / overtime remediation for this down line." The
  // window is the situation (base, single source); the change-set is the response (no double-apply).
  z.object({
    kind: z.literal('line_down'),
    resourceId: z.string().min(1),
  }),
  z.object({
    kind: z.literal('overtime'),
    resourceId: z.string().min(1),
    hours: z.number().positive(),
  }),
  z.object({
    kind: z.literal('wear_remediation'),
    resourceId: z.string().min(1),
    action: z.enum(['service', 'defer', 'ot']),
  }),
  // Material arrival (D36 gate): a buy-component's availability gates its consuming ops. The
  // gate itself lives in the §4.8 material-availability data; this marks the trigger so the
  // engine offers the wait / re-sequence-around remediation. `availableAt` is informational.
  z.object({
    kind: z.literal('material_arrival'),
    componentPartId: z.string().min(1),
    availableAt: z.string().min(1),
  }),
  // Standing at-risk REMEDIATION marker (order-scoped): a firm order is late in the COMMITTED plan
  // with no injected disruption. The "condition" is the order's own firm-lateness. The engine offers
  // the reroute family ONLY when this order's causal chain roots at reroutable capacity contention AND
  // its binding op is multi-eligible (an alternative line exists) — otherwise reroute is honestly
  // unavailable (material → expedite, due-before-start → renegotiate) and only the base levers apply.
  z.object({
    kind: z.literal('at_risk_remediation'),
    demandLineId: z.string().min(1),
  }),
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

export type RationaleFactorKey =
  | 'lateness'
  | 'changeover'
  | 'overtime'
  | 'inventory'
  | 'displacement'
  | 'cost'
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
  /** Firm-lateness HOURS — total hours firm orders breach their due. THE quantity the objective
   *  minimizes (firm-lateness dominance), so it's the headline late metric in the option tiles:
   *  a plan with fewer late orders but larger total breach is correctly NOT recommended. `null` when
   *  not tracked (historical/execution baselines, which don't carry per-op due breaches). */
  firmLateHours: number | null
  /** Count of FIRM ops that can't be placed in working time (window-overflow infeasibility — the op is
   *  longer than any working segment and can't split). The scoring analog of the `stranded` /
   *  `exceeds_working_window` status: such an op can't run as planned, so the objective treats it as the
   *  worst firm-delivery outcome (a large folded firm-lateness penalty), while THIS count stays the honest
   *  legible signal ("N ops can't be scheduled") — `firmLateHours` never shows the sentinel. 0 = all firm
   *  ops fit. `null` when not tracked (historical/execution baselines). */
  infeasibleFirmOps: number | null
  /** Total placed quantity over the horizon. */
  throughput: number | null
  /** Sequence churn vs the base plan (0–1); null when not applicable. */
  churn: number | null
}

/**
 * One order left at-risk by an option's evaluated (never-persisted) plan — the preview "blast radius"
 * the cockpit highlights without writing a draft. ORDER-grain: an order is at-risk iff any of its ops
 * carries the sequencer's `atRisk` flag (`end > due` OR window-overflow) — the SAME meaning the
 * committed board + work-list use, so a preview highlight reads like-for-like against committed at-risk.
 * - `firmLate` — a FIRM op breaches its due (vs a forecast breach); drives emphasis.
 * - `reason` — the binding op's at-risk reason (capacity / material / operator / …), for the impact panel.
 * - `dueDateIso` — the order's required date; the viewed-week scope key (consistent with the work-list).
 * - `resourceIds` — the resources its at-risk ops sit on in THIS plan (blast-radius-by-line).
 */
export interface WhatIfAtRiskOrder {
  demandLineId: string
  firmLate: boolean
  reason: string | null
  dueDateIso: string
  resourceIds: string[]
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
  /**
   * For an `at_risk_remediation` what-if: how the TARGET order fares in THIS option's plan — `feasible`
   * (all its ops placeable) and `firmLate` (any firm op breaches due). Drives the PER-ORDER verdict
   * (has-options / can't-run / can't-be-on-time) so the honest-unachievable message is the target's own,
   * not a plant-wide infeasibility leak from unrelated orders. Null for non-remediation what-ifs (and
   * old cached results → the verdict falls back to the plant-wide rule). Plant-wide SCORING is unchanged. */
  targetOutcome?: { feasible: boolean; firmLate: boolean } | null
  /**
   * The orders THIS option's plan leaves at-risk (order-grain) — the preview blast radius the cockpit
   * highlights without persisting. The banner count AND the board highlight both read THIS array (never
   * the `lateOrders` KPI independently), so they cannot contradict (the changed order itself, the cause,
   * is identified separately from the change-set). Empty for an infeasible option (no runnable plan).
   * Optional so old cached results (pre-field) deserialize cleanly → treated as `[]`. */
  atRiskOrders?: WhatIfAtRiskOrder[]
}

/**
 * A what-if evaluation result (D55). Deterministic: the same change-set against
 * the same base + learned overlay + weights yields the same `determinismKey` and
 * the same options/rationale. Persisted (rationale jsonb) as the phase-6 substrate.
 */
/**
 * Honest-unachievable verdict for a what-if whose every option leaves a plan you can't run (all
 * options infeasible — starved OR window-overflow). Mirrors goal-seek's `outcome:'unachievable'`: an
 * EXPLICIT structured outcome (not inferred from `options:[]`), so a consumer branches cleanly on
 * "is this unremediable?" rather than guessing. `reasonKey` states it; `leversKey` (null for a generic
 * change-set) points at the structural fixes (split the op / re-promise / change the requirement).
 */
export interface WhatIfUnremediable {
  reasonKey: string
  leversKey: string | null
}

export interface WhatIfResultDto {
  id: string
  plantId: string
  baseVersionId: string
  changeSet: ChangeSet
  /** The base (current) plan's KPIs — the comparison anchor for option deltas. */
  baseKpis: CostedKpis
  /** The SELECTABLE options (a runnable plan: `feasible && infeasibleFirmOps===0`) — the real choices.
   *  Non-options (a plan you can't run) are re-labeled `feasible:false` and demoted by consumers to a
   *  stat-less "also evaluated" line, never shown as tiles (their KPIs describe a plan that won't run). */
  options: WhatIfOption[]
  recommendedOptionId: string | null
  /** Set when NO option yields a runnable plan — the honest-unachievable outcome (then `options` are all
   *  non-options / `recommendedOptionId` is null). Null when ≥1 selectable option exists. */
  unremediable: WhatIfUnremediable | null
  /** Hash of (base inputs + change-set + overlay + weights) — same → same result. */
  determinismKey: string
  createdAt: string
  /**
   * The never-silently-drop ledger (conversation Pass A): every requested change + whether the
   * engine honored it. Populated richly at evaluation time (drives the structure-derived echo
   * the conversation prepends to a Type-2 answer); the persisted read returns a basic form.
   */
  requestedChanges: RequestedChange[]
}

/** One requested change in a change-set + whether the engine honored it (Pass A ledger). */
export interface RequestedChange {
  kind: Change['kind']
  /** Human one-liner, e.g. "add 4h overtime on Press Line A" or "move GP-1142 due date to 2026-06-27". */
  summary: string
  /** `applied` (honored as asked), `partial` (honored but adjusted — e.g. OT clamped to ceiling), `unapplied` (could not be honored). */
  status: 'applied' | 'partial' | 'unapplied'
  /** Why it was partial/unapplied (planner-readable); null when fully applied. */
  note: string | null
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
  .object({
    plantId: z.string().min(1),
    baseVersionId: z.string().optional(),
    changeSet: changeSetSchema,
  })
  .strict()
export type WhatIfRequest = z.infer<typeof whatIfRequestSchema>

/** `POST /scheduling/what-if/:id/narrate` — render the rationale into prose (async). */
export const narrateRequestSchema = z
  .object({
    mode: z.enum(['option', 'across_options']).default('across_options'),
    optionId: z.string().optional(),
  })
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
    /**
     * Only emit actuals for **completed** ops — those whose planned end is at/before this epoch ms.
     * The rolling-window seed passes today's start so a single past→future committed version executes
     * only its PAST days (today/future stay planned). Absent = emit for every op (the live-drift demo).
     */
    completedBeforeMs: z.number().int().nonnegative().optional(),
    /**
     * Scope emission to a SINGLE resource — only ops on this resource emit actuals; every other lane is
     * left untouched. The UI live-drift uses it so drifting one line doesn't re-emit (and overwrite) the
     * rest of the plant's history — which would wipe another lane's accumulated wear/prediction. Absent =
     * emit for every lane (the warm-start reset, which seeds the full plant history in one pass).
     */
    onlyResourceId: z.string().min(1).optional(),
    /**
     * Seed deterministic EXECUTION misses into the historical actuals so warm-start Schedule
     * Adherence isn't a fake 100%: a thin, stable slice of past ops are backdated as started off
     * their planned window (actual start shifted beyond the adherence tolerance). Opt-in (the
     * rolling-window reset sets it); the live-drift demo leaves it off. Duration is preserved, so
     * OEE/throughput and on-time delivery are unaffected — only adherence moves.
     */
    injectMisses: z.boolean().optional(),
    drift: z
      .object({
        resourceId: z.string().min(1),
        param: z.enum(['cycle', 'setup']).default('cycle'),
        /** Fractional ramp target, e.g. 0.08 = +8% (Collision-2 tool-wear). */
        magnitude: z.number(),
        rampOverEvents: z.number().int().positive().default(8),
        /**
         * Ramp shape exponent: 1 = linear (default; the live-drift demo). >1 = convex/accelerating
         * (slow early, steep recent) — keeps the trailing-window MEAN below the adopt threshold while
         * the recent slope still projects a near crossing, i.e. a live "predicting, not yet adopted"
         * wear state. The warm-start seed uses 2 (realistic tool wear accelerates toward end-of-life).
         * Omitted = linear (the service treats absent as 1).
         */
        curve: z.number().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
export type SimulateActualsRequest = z.infer<typeof simulateActualsSchema>
