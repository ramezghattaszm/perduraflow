import { HttpStatus, Inject, Injectable } from '@nestjs/common'
import {
  MASTERDATA_READ_CONTRACT,
  type AtRiskOrderDto,
  type CalendarDto,
  type CoverageAxisDto,
  type CoverageCell,
  type ConfigReadContract,
  type ObjectiveWeights,
  type CoverageProposalDto,
  type ExecutionActualDto,
  type LatenessChainDto,
  type LearnedParameterDto,
  type LearningReadContract,
  type MasterDataReadContract,
  type MaterialAvailabilityDto,
  type MaterialConditionDto,
  type AssignOperatorRequest,
  type ResourceOperatorAssignmentDto,
  type OeeDto,
  type OperatorAbsenceReason,
  type OperatorDto,
  type OrgPriority,
  type OrgReadContract,
  type PartDto,
  type PerformanceVarianceDto,
  type ResourceDowntimeDto,
  type ResourceDto,
  type ResourceVarianceDto,
  type ScheduleVersionDetailDto,
  type ScheduleVersionDto,
  type ScorecardDto,
  type WorkforceCoverageDto,
  type WorkingWindowDto,
  type WorkListResponseDto,
} from '@perduraflow/contracts'
import { AppException, ERROR_CODES } from '../../common/exceptions/app.exception'
import { EVENTS } from '../../events'
import { BindingResolver } from '../binding/binding.resolver'
import { EventBus } from '../eventbus/event-bus'
import { LEARNING_READ } from '../learning/learning-read.service'
import { CONFIG_READ } from '../config/config-read.service'
import { ORG_READ } from '../org/org-read.service'
import {
  toDemandInputDto,
  toOptimizerRunDto,
  toScheduledOperationDto,
  toScheduleVersionDto,
} from './scheduling.mapper'
import { SchedulingRepository } from './scheduling.repository'
import type { DemandInput, ResourceOperatorAssignment, ScheduledOperation } from './schema'
import { buildLatenessChains, type LatenessLookups, type LatenessOp } from './lateness'
import { buildWorkList, type WorkListOpInput, type WorkListOrderMeta } from './work-list'
import { sequence, type EffectiveTimes, type ResolveEffective, type ResolveOperator, type SequencerItem } from './sequencer'
import { buildWorkingCalendar, startOfDayUtc, workingMinutesInRange, type WorkingCalendar } from './working-calendar'

/** The deterministic sequencer inputs for a plant — shared by `solve()` + what-if. */
export interface BaseContext {
  items: SequencerItem[]
  /** The D4 hard-gate reason (an unresolvable line / no eligible resource), or null. */
  infeasibleReason: string | null
  demand: DemandInput[]
  resourceById: Map<string, ResourceDto>
  partNoById: Map<string, string>
  /** Per-resource operating calendar (working windows / closures / OT) for the sequencer. */
  resourceCalendars: Map<string, WorkingCalendar>
  /** Active downtime windows (line-down / maintenance) for this plant — same-source for solve + what-if. */
  downtime: ResourceDowntimeDto[]
  /** Per-resource downtime windows (id + epoch-ms bounds) for binder attribution (→ `resource_downtime` root). */
  downtimeByResource: Map<string, Array<{ id: string; startMs: number; endMs: number }>>
  /** Operator performance (C5, §4.8): factor for the operator pinned to a resource at op start. */
  resolveOperator: ResolveOperator
  /** The plant's operator roster (perf factor + labor rate + availability) — the faster-operator lever's
   *  candidate pool (Part B). Same source as `resolveOperator`; exposed so the what-if lever can pick. */
  operators: OperatorDto[]
  /** Live operator→resource assignments (the double-booking guard's input for the faster-operator lever). */
  operatorAssignments: ResourceOperatorAssignment[]
  /** Minimum-batch floor (C4) per resource — run-quantity floor from the resource-type config. */
  minBatchByResource: Map<string, number>
  /** RESOLVED objective weights (Objective Policy, plant→tenant→global) the scorer uses (config-driven). */
  weights: ObjectiveWeights
  /** The resolved weight-set version token — stamped into the rationale + the what-if determinism key. */
  weightSetVersion: string
  /**
   * Canonical digest of the PERSISTED base-context inputs the change-set does NOT carry and that
   * aren't already in the items/overlay/downtime/weights digests — operator factors + assignments
   * (C5), min-batch (C4), cost rates (C6), and working-calendar structure (shifts/holidays/OT). Hashed
   * into the what-if determinism key so changing any of them busts the cache (else a stale result is
   * replayed across different inputs — the generalized root of the line-down cache bug).
   */
  baseInputsDigest: string
}

const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, standard: 2 }

// --- calendar JSON coercion (CalendarDto fields are untyped jsonb) -----------
/** `unknown` → `number[]`, or undefined so {@link buildWorkingCalendar} applies its default. */
function asNumberArray(v: unknown): number[] | undefined {
  return Array.isArray(v) && v.every((n) => typeof n === 'number') && v.length > 0 ? (v as number[]) : undefined
}
/** `unknown` → `string[]` (e.g. holiday `YYYY-MM-DD` list). */
function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []
}
/** `unknown` → shift patterns with `HH:MM` `start`/`end` strings. */
function asShiftPatterns(v: unknown): Array<{ start: string; end: string }> {
  if (!Array.isArray(v)) return []
  return v.filter((p): p is { start: string; end: string } => !!p && typeof p.start === 'string' && typeof p.end === 'string')
}

/**
 * Derive the per-resource downtime maps from active downtime windows. Returns BOTH the
 * `closed` `[startMs,endMs)` intervals (baked into each resource's calendar — this is what
 * DISPLACES ops) and the id-bearing `windows` (so the binder can name the closure that bound
 * a start → the `resource_downtime` root). One source for the calendar math + the attribution.
 */
function downtimeMaps(downtime: ResourceDowntimeDto[]): {
  closed: Map<string, Array<[number, number]>>
  windows: Map<string, Array<{ id: string; startMs: number; endMs: number }>>
} {
  const closed = new Map<string, Array<[number, number]>>()
  const windows = new Map<string, Array<{ id: string; startMs: number; endMs: number }>>()
  for (const d of downtime) {
    const startMs = Date.parse(d.from)
    const endMs = Date.parse(d.to)
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue
    ;(closed.get(d.resourceId) ?? closed.set(d.resourceId, []).get(d.resourceId)!).push([startMs, endMs])
    ;(windows.get(d.resourceId) ?? windows.set(d.resourceId, []).get(d.resourceId)!).push({ id: d.id, startMs, endMs })
  }
  return { closed, windows }
}

/** Do two half-open windows `[from, to)` overlap? `null` bound = open (±∞). */
function windowsOverlap(aFrom: Date | null, aTo: Date | null, bFrom: Date | null, bTo: Date | null): boolean {
  const af = aFrom?.getTime() ?? Number.NEGATIVE_INFINITY
  const at = aTo?.getTime() ?? Number.POSITIVE_INFINITY
  const bf = bFrom?.getTime() ?? Number.NEGATIVE_INFINITY
  const bt = bTo?.getTime() ?? Number.POSITIVE_INFINITY
  return af < bt && bf < at
}

/** The operator assigned to a resource at an instant — null when none covers it (→ standard). */
export interface AssignedOperator {
  id: string
  name: string
  performanceFactor: number
  laborRate: number | null
}

/**
 * Build the operator resolver the engine + the read path SHARE (C5): given the plant's operators and
 * their resource assignments, return the operator covering a (resource, instant) — the assignments
 * whose `[effectiveFrom, effectiveTo)` window contains the instant, picked deterministically (latest
 * `effectiveFrom`, then lowest operatorId). Null when none covers it → factor 1.0 (standard), exactly
 * like a component with no material row = on-hand. The factor lives on the operator, not the
 * assignment. One source so the sequencer's run-time scaling and the op card's "who ran this" agree.
 */
export function buildOperatorResolver(
  operators: Array<{ id: string; name: string; performanceFactor: number; laborRate: number | null }>,
  assignments: Array<{ resourceId: string; operatorId: string; effectiveFrom: Date | null; effectiveTo: Date | null }>,
): (resourceId: string, atMs: number) => AssignedOperator | null {
  const byId = new Map(operators.map((o) => [o.id, o]))
  const byResource = new Map<string, Array<{ operatorId: string; from: number; to: number }>>()
  for (const a of assignments) {
    const arr = byResource.get(a.resourceId) ?? []
    arr.push({
      operatorId: a.operatorId,
      from: a.effectiveFrom?.getTime() ?? Number.NEGATIVE_INFINITY,
      to: a.effectiveTo?.getTime() ?? Number.POSITIVE_INFINITY,
    })
    byResource.set(a.resourceId, arr)
  }
  return (resourceId, atMs) => {
    const candidates = (byResource.get(resourceId) ?? []).filter((a) => atMs >= a.from && atMs < a.to)
    if (candidates.length === 0) return null
    candidates.sort((x, y) => y.from - x.from || (x.operatorId < y.operatorId ? -1 : 1))
    const op = byId.get(candidates[0]!.operatorId)
    return op ? { id: op.id, name: op.name, performanceFactor: op.performanceFactor, laborRate: op.laborRate } : null
  }
}
/**
 * The daily working window spanning a set of resource calendars — the earliest shift
 * open to the latest shift close (minutes from midnight), for the Gantt axis (D-shift).
 * Null when no calendar has any window (24/7 fallback → the Gantt uses the horizon range).
 */
function workingWindowOf(cals: Map<string, WorkingCalendar>): WorkingWindowDto | null {
  let start = Number.POSITIVE_INFINITY
  let end = Number.NEGATIVE_INFINITY
  const workingDays = new Set<number>()
  const holidays = new Set<string>()
  for (const cal of cals.values()) {
    if (cal.dayWindows.length === 0) continue
    start = Math.min(start, cal.dayWindows[0]![0])
    end = Math.max(end, cal.dayWindows[cal.dayWindows.length - 1]![1])
    for (const d of cal.workingDays) workingDays.add(d)
    for (const h of cal.holidays) holidays.add(h)
  }
  return Number.isFinite(start) && Number.isFinite(end) && end > start
    ? { startMinute: start, endMinute: end, workingDays: [...workingDays].sort((a, b) => a - b), holidays: [...holidays] }
    : null
}
/** Confidence a held learned value must clear before the scheduler overlays it (A18 bounded). */
const LEARNED_CONF_USE = 0.6

/**
 * Scheduling domain service (phase 2). **Consumes master-data ONLY through the
 * binding-resolved `masterdata.read` contract** (O7 — `this.resolveMasterData`),
 * never master-data's tables/code; kernel `org.read` is consumed directly. Runs
 * the deterministic sequencer (SKIP-03 stand-in) over seeded demand and persists
 * a `draft` schedule version; a separate `commit` promotes it (AS11).
 */
@Injectable()
export class SchedulingService {
  constructor(
    private readonly repo: SchedulingRepository,
    private readonly bindings: BindingResolver,
    @Inject(ORG_READ) private readonly org: OrgReadContract,
    @Inject(LEARNING_READ) private readonly learning: LearningReadContract,
    @Inject(CONFIG_READ) private readonly config: ConfigReadContract,
    private readonly events: EventBus,
  ) {}

  /** Resolve the master-data contract bound to this tenant (the binding indirection, O7). */
  private resolveMasterData(tenantId: string): Promise<MasterDataReadContract> {
    return this.bindings.resolve<MasterDataReadContract>(tenantId, MASTERDATA_READ_CONTRACT)
  }

  // --- reads -----------------------------------------------------------------
  /** Lists the plant's schedule versions (newest first) for the board selector. */
  async listVersions(tenantId: string, plantId: string): Promise<ScheduleVersionDto[]> {
    return (await this.repo.listVersions(tenantId, plantId)).map(toScheduleVersionDto)
  }

  /**
   * One version + its run + ordered operations (board payload).
   * @throws AppException SCHEDULE_VERSION_NOT_FOUND
   */
  /**
   * Build the causal lateness chains (D-late) for a version's at-risk ops — keyed by
   * `demandLineId:opSeq`. Resolves the resource/part/material lookups the pure walk needs. ONE source
   * shared by the board op panel, the Scorecard at-risk list, and the Copilot's explain_lateness tool.
   */
  private async latenessChainsFor(tenantId: string, plantId: string, ops: ScheduledOperation[]): Promise<Map<string, LatenessChainDto>> {
    const md = await this.resolveMasterData(tenantId)
    const resName = new Map((await md.listResources(tenantId)).map((r) => [r.id, r.name]))
    const partNo = new Map((await md.listParts(tenantId)).map((p) => [p.id, p.partNo]))
    // Per part, the binding gate component = the requirement whose component arrives latest (matches
    // the sequencer's earliestStartMs = max availability). null = no material gate on that part.
    const availAt = new Map<string, number>()
    for (const a of await this.repo.listMaterialAvailability(tenantId, plantId)) {
      availAt.set(a.componentPartId, Math.max(availAt.get(a.componentPartId) ?? 0, a.availableAt.getTime()))
    }
    const compByPart = new Map<string, string>()
    const bestAt = new Map<string, number>()
    for (const r of await this.repo.listMaterialRequirements(tenantId, plantId)) {
      const at = availAt.get(r.componentPartId) ?? 0
      if (at >= (bestAt.get(r.partId) ?? -1)) {
        bestAt.set(r.partId, at)
        compByPart.set(r.partId, partNo.get(r.componentPartId) ?? r.componentPartId)
      }
    }
    // Downtime windows by id — so a `resource_downtime` root narrates the stored window (kind + reason).
    // Active windows (in-effect / future) resolve fully; a window already retracted or expired (e.g. the
    // line was brought back up) degrades to the generic line-down label — still a correct, grounded root.
    const downtimeById = new Map((await md.listActiveDowntime(tenantId, plantId)).map((d) => [d.id, d]))
    // Operators by id — so an `operator` root names the slow operator (+ %) the engine recorded.
    const operatorById = new Map((await md.listOperators(tenantId)).map((o) => [o.id, o]))
    const lk: LatenessLookups = {
      resourceName: (rid) => resName.get(rid) ?? rid,
      partNo: (pid) => partNo.get(pid) ?? pid,
      materialComponent: (pid) => compByPart.get(pid) ?? null,
      downtime: (id) => {
        const d = id ? downtimeById.get(id) : undefined
        return d ? { kind: d.kind, reason: d.reason } : null
      },
      operator: (id) => {
        const o = id ? operatorById.get(id) : undefined
        return o ? { name: o.name, performanceFactor: o.performanceFactor } : null
      },
    }
    const latenessOps: LatenessOp[] = ops.map((o) => ({
      demandLineId: o.demandLineId,
      opSeq: o.opSeq,
      resourceId: o.resourceId,
      partId: o.partId,
      atRisk: o.atRisk,
      bindingKind: o.bindingKind ?? null,
      bindingBlockerDemandLineId: o.bindingBlockerDemandLineId ?? null,
      bindingBlockerOpSeq: o.bindingBlockerOpSeq ?? null,
      bindingDowntimeId: o.bindingDowntimeId ?? null,
      bindingOperatorId: o.bindingOperatorId ?? null,
    }))
    return buildLatenessChains(latenessOps, lk)
  }

  /**
   * The "stranded" op ids of a committed plan: ops whose `[plannedStart, plannedEnd)` overlaps an
   * ACTIVE line-down / maintenance window on their resource — they CANNOT run as planned (the line
   * is down then). A FACT (committed op ∩ active window), no re-solve — distinct from at-risk (the
   * delivery prediction). ONE source so the board (op.stranded) and the work-list ('stranded' status)
   * reconcile. Empty when there are no active windows.
   */
  private async strandedOpIds(tenantId: string, plantId: string, ops: ScheduledOperation[]): Promise<Set<string>> {
    const md = await this.resolveMasterData(tenantId)
    const { closed } = downtimeMaps(await md.listActiveDowntime(tenantId, plantId))
    const out = new Set<string>()
    if (closed.size === 0) return out
    for (const o of ops) {
      const wins = closed.get(o.resourceId)
      if (!wins) continue
      const s = o.plannedStart.getTime()
      const e = o.plannedEnd.getTime()
      if (wins.some(([ws, we]) => s < we && e > ws)) out.add(o.id)
    }
    return out
  }

  /**
   * The causal lateness chains for one order on the plant's committed plan (D-late) — one per at-risk
   * op of that order. Empty when the order isn't at-risk. Used by the Copilot's explain_lateness tool;
   * the chain is computed (grounded), so the Copilot narrates it and never infers a blocker.
   */
  async latenessForOrder(tenantId: string, plantId: string, demandLineId: string): Promise<LatenessChainDto[]> {
    const version = await this.repo.findCommittedVersion(tenantId, plantId)
    if (!version) return []
    const ops = await this.repo.operationsForVersion(version.id)
    const chains = await this.latenessChainsFor(tenantId, version.plantId, ops)
    return [...chains.values()].filter((c) => c.hops[0]?.demandLineId === demandLineId)
  }

  /**
   * The board payload for a version: header + run + ordered operations, each enriched with this
   * version's execution actual (planned-vs-actual) and, for at-risk ops, the computed causal lateness
   * chain (D-late) — so the bar panel shows "held by … ← root" from the same chain the queue + Copilot read.
   * @throws AppException SCHEDULE_VERSION_NOT_FOUND
   */
  async versionDetail(tenantId: string, id: string): Promise<ScheduleVersionDetailDto> {
    const version = await this.repo.findVersion(tenantId, id)
    if (!version) {
      throw new AppException(HttpStatus.NOT_FOUND, 'Schedule version not found', ERROR_CODES.SCHEDULE_VERSION_NOT_FOUND)
    }
    const run = await this.repo.findRun(tenantId, version.optimizerRunId)
    const ops = await this.repo.operationsForVersion(version.id)
    // Attach this version's execution actuals (read-only, from learning) so the
    // board's bar-detail panel can show planned-vs-actual without a second call.
    const actuals = await this.learning.listActualsForVersion(tenantId, version.id)
    const actualByOp = new Map(actuals.map((a) => [a.scheduledOperationId, a]))
    // The plant's daily working window for the Gantt axis — derived from the SAME
    // calendars the sequencer placed against (D-shift), so the axis spans the working day.
    const plantResources = (await (await this.resolveMasterData(tenantId)).listResources(tenantId)).filter((r) => r.plantId === version.plantId)
    const workingWindow = workingWindowOf(await this.resolveResourceCalendars(tenantId, plantResources))
    // Causal lateness chains for the at-risk ops (D-late) — attached to the board op so the bar panel
    // can show "held by … ← root", same computed chain the queue + Copilot read.
    const chains = await this.latenessChainsFor(tenantId, version.plantId, ops)
    // Stranded ops (committed op ∩ active line-down window) — a FACT the board marks "can't run as
    // planned", distinct from at-risk. One source (same helper feeds the work-list).
    const stranded = await this.strandedOpIds(tenantId, version.plantId, ops)
    // The operator the engine applied per op — same (resource, op-start) assignment lookup the
    // sequencer used (buildOperatorResolver), so the card shows WHO ran it + the factor that shaped
    // this op's cycle. Resolved against current assignments (the board flags staleness separately).
    const md = await this.resolveMasterData(tenantId)
    const resolveOperator = buildOperatorResolver(
      await md.listOperators(tenantId),
      await this.repo.listResourceOperatorAssignments(tenantId, version.plantId),
    )
    return {
      version: toScheduleVersionDto(version),
      run: toOptimizerRunDto(run!),
      workingWindow,
      operations: ops.map((o) => {
        const a = actualByOp.get(o.id)
        const op = resolveOperator(o.resourceId, o.plannedStart.getTime())
        return {
          ...toScheduledOperationDto(o),
          stranded: stranded.has(o.id),
          actual: a
            ? {
                actualStart: a.actualStart,
                actualEnd: a.actualEnd,
                actualCycleTime: a.actualCycleTime,
                goodQty: a.goodQty,
                scrapQty: a.scrapQty,
              }
            : null,
          latenessChain: chains.get(`${o.demandLineId}:${o.opSeq}`) ?? null,
          operator: op ? { id: op.id, name: op.name, performanceFactor: op.performanceFactor, laborRate: op.laborRate } : null,
        }
      }),
    }
  }

  /** Lists the plant's seeded demand (read-only). */
  async listDemand(tenantId: string, plantId: string) {
    return (await this.repo.listDemand(tenantId, plantId)).map(toDemandInputDto)
  }

  /** The plant's buy-component availability (§4.8 input) — the scenario launcher dropdown. */
  async listMaterialAvailability(tenantId: string, plantId: string): Promise<MaterialAvailabilityDto[]> {
    const partNo = new Map((await (await this.resolveMasterData(tenantId)).listParts(tenantId)).map((p) => [p.id, p.partNo]))
    return (await this.repo.listMaterialAvailability(tenantId, plantId)).map((a) => ({
      componentPartId: a.componentPartId,
      componentPartNo: partNo.get(a.componentPartId) ?? a.componentPartId,
      availableAt: a.availableAt.toISOString(),
    }))
  }

  /** The plant's pinned resource↔operator assignments (§4.8 performance input) — launcher view. */
  async listResourceOperatorAssignments(tenantId: string, plantId: string): Promise<ResourceOperatorAssignmentDto[]> {
    const md = await this.resolveMasterData(tenantId)
    const resourceName = new Map((await md.listResources(tenantId)).map((r) => [r.id, r.name]))
    const operators = new Map((await md.listOperators(tenantId)).map((o) => [o.id, o]))
    return (await this.repo.listResourceOperatorAssignments(tenantId, plantId)).map((a) => ({
      id: a.id,
      resourceId: a.resourceId,
      resourceName: resourceName.get(a.resourceId) ?? a.resourceId,
      operatorId: a.operatorId,
      operatorName: operators.get(a.operatorId)?.name ?? a.operatorId,
      performanceFactor: operators.get(a.operatorId)?.performanceFactor ?? 1,
      effectiveFrom: a.effectiveFrom?.toISOString() ?? null,
      effectiveTo: a.effectiveTo?.toISOString() ?? null,
    }))
  }

  /**
   * Assign (or switch) the operator on a resource — the PLANNER lever (C5). Resource-grain +
   * time-windowed, replace-open per resource (switching a line's operator is one call). The planner
   * assigns; the engine reacts on the next re-solve (no auto-re-solve). Validation:
   * - `effectiveFrom < effectiveTo` when both set;
   * - **per-operator overlap** rejected (tenant-wide, cross-plant) — one operator can't be on two
   *   resources at once;
   * - **per-resource** is one-operator-per-resource by construction (the replace-open upsert).
   * Cross-plant is ALLOWED (operators float between plants day-to-day); home plant is informational,
   * not enforced. The "no cross-plant move mid-shift" rule needs the shift model — deferred.
   * @throws OPERATOR_ASSIGNMENT_INVALID bad window; resource/operator not in the tenant
   * @throws OPERATOR_DOUBLE_BOOKED the operator already covers another line in an overlapping window
   */
  async assignOperator(tenantId: string, dto: AssignOperatorRequest): Promise<ResourceOperatorAssignmentDto> {
    const from = dto.effectiveFrom ? new Date(dto.effectiveFrom) : null
    const to = dto.effectiveTo ? new Date(dto.effectiveTo) : null
    if (from && Number.isNaN(from.getTime())) throw new AppException(HttpStatus.BAD_REQUEST, 'Invalid effectiveFrom', ERROR_CODES.OPERATOR_ASSIGNMENT_INVALID)
    if (to && Number.isNaN(to.getTime())) throw new AppException(HttpStatus.BAD_REQUEST, 'Invalid effectiveTo', ERROR_CODES.OPERATOR_ASSIGNMENT_INVALID)
    if (from && to && from.getTime() >= to.getTime())
      throw new AppException(HttpStatus.BAD_REQUEST, 'effectiveFrom must precede effectiveTo', ERROR_CODES.OPERATOR_ASSIGNMENT_INVALID)

    const md = await this.resolveMasterData(tenantId)
    const resource = (await md.listResources(tenantId)).find((r) => r.id === dto.resourceId && r.plantId === dto.plantId)
    if (!resource) throw new AppException(HttpStatus.BAD_REQUEST, 'Resource not found in this plant', ERROR_CODES.OPERATOR_ASSIGNMENT_INVALID)
    const operator = (await md.listOperators(tenantId)).find((o) => o.id === dto.operatorId && o.isActive)
    if (!operator) throw new AppException(HttpStatus.BAD_REQUEST, 'Operator not found', ERROR_CODES.OPERATOR_ASSIGNMENT_INVALID)
    // Can't run a line if you're not present next shift (sick / vacation / not scheduled).
    if (!operator.available) throw new AppException(HttpStatus.CONFLICT, `${operator.name} is out (not available)`, ERROR_CODES.OPERATOR_ASSIGNMENT_INVALID)

    // Double-booking guard (tenant-wide, cross-plant): the operator can't cover ANOTHER resource in a
    // window that overlaps this one. Same resource is fine — that's the replace-open switch.
    const others = (await this.repo.listAssignmentsByOperator(tenantId, dto.operatorId)).filter((a) => a.resourceId !== dto.resourceId)
    const clash = others.find((a) => windowsOverlap(from, to, a.effectiveFrom, a.effectiveTo))
    if (clash) {
      throw new AppException(HttpStatus.CONFLICT, `${operator.name} is already assigned to another line in an overlapping window`, ERROR_CODES.OPERATOR_DOUBLE_BOOKED)
    }

    const row = await this.repo.setResourceOperatorAssignment(tenantId, dto.plantId, dto.resourceId, dto.operatorId, from, to)
    if (!row) throw new AppException(HttpStatus.INTERNAL_SERVER_ERROR, 'Assignment write failed', ERROR_CODES.OPERATOR_ASSIGNMENT_INVALID)
    return {
      id: row.id,
      resourceId: row.resourceId,
      resourceName: resource.name,
      operatorId: row.operatorId,
      operatorName: operator.name,
      performanceFactor: operator.performanceFactor,
      effectiveFrom: row.effectiveFrom?.toISOString() ?? null,
      effectiveTo: row.effectiveTo?.toISOString() ?? null,
    }
  }

  /**
   * Unassign an operator from a resource — the line reverts to standard (factor 1.0) on the next
   * re-solve. Tenant-scoped delete (the ownership guard).
   * @throws OPERATOR_ASSIGNMENT_NOT_FOUND no such assignment for this tenant
   */
  async unassignOperator(tenantId: string, id: string): Promise<void> {
    const deleted = await this.repo.deleteResourceOperatorAssignment(tenantId, id)
    if (!deleted) throw new AppException(HttpStatus.NOT_FOUND, 'Operator assignment not found', ERROR_CODES.OPERATOR_ASSIGNMENT_NOT_FOUND)
  }

  /**
   * Detected material conditions (D36) for the board: a component whose availability gates
   * committed consuming ops (ops planned to start before the material arrives). Plan-relative,
   * like the line-down / demand cards — fires when the §4.8 data diverges from the committed
   * plan; self-clears when the material is early enough (reset) or the plan is re-sequenced.
   */
  async materialConditions(tenantId: string, plantId: string, versionId?: string): Promise<MaterialConditionDto[]> {
    const avail = await this.repo.listMaterialAvailability(tenantId, plantId)
    if (avail.length === 0) return []
    const version = versionId ? await this.repo.findVersion(tenantId, versionId) : await this.repo.findCommittedVersion(tenantId, plantId)
    if (!version) return []
    const ops = await this.repo.operationsForVersion(version.id)
    const reqs = await this.repo.listMaterialRequirements(tenantId, plantId)
    const partsByComponent = new Map<string, Set<string>>()
    for (const r of reqs) {
      const set = partsByComponent.get(r.componentPartId) ?? new Set<string>()
      set.add(r.partId)
      partsByComponent.set(r.componentPartId, set)
    }
    const partNo = new Map((await (await this.resolveMasterData(tenantId)).listParts(tenantId)).map((p) => [p.id, p.partNo]))
    const conditions: MaterialConditionDto[] = []
    for (const a of avail) {
      const parts = partsByComponent.get(a.componentPartId)
      if (!parts) continue
      const gated = ops.filter((o) => parts.has(o.partId) && o.plannedStart.getTime() < a.availableAt.getTime())
      if (gated.length > 0) {
        conditions.push({
          componentPartId: a.componentPartId,
          componentPartNo: partNo.get(a.componentPartId) ?? a.componentPartId,
          availableAt: a.availableAt.toISOString(),
          gatedDemandLineIds: [...new Set(gated.map((o) => o.demandLineId))],
        })
      }
    }
    return conditions
  }

  /** Board rows: the plant's resources, via the bound `masterdata.read`. */
  async listResources(tenantId: string, plantId: string): Promise<ResourceDto[]> {
    const md = await this.resolveMasterData(tenantId)
    return (await md.listResources(tenantId)).filter((r) => r.plantId === plantId)
  }

  /**
   * Plant-scoped, **bounded** entity catalog for the conversation layer (phase 6) —
   * the small set of real ids a change-set must reference (orders + lines), with
   * human names resolved so language ("delay Stellantis", "Press Line A") maps to
   * real ids. Bounded by the plant's active demand + resources (a handful each).
   */
  async entityCatalog(tenantId: string, plantId: string): Promise<{
    orders: { demandLineId: string; releaseReference: string | null; customer: string; part: string; qty: number; firmness: string; due: string }[]
    resources: { id: string; name: string; status: string }[]
  }> {
    const md = await this.resolveMasterData(tenantId)
    const partNo = new Map((await md.listParts(tenantId)).map((p) => [p.id, p.partNo]))
    const resources = (await md.listResources(tenantId))
      .filter((r) => r.plantId === plantId)
      .map((r) => ({ id: r.id, name: r.name, status: r.status }))
    const custCache = new Map<string, string>()
    const demand = (await this.repo.listDemand(tenantId, plantId)).filter((d) => d.isActive)
    // Earliest-due first: the conversation inlines a near-horizon slice, so this ordering keeps
    // the orders a planner is actively scheduling (and the demo's tight-due spine) in that slice.
    demand.sort((a, b) => a.requiredDate.getTime() - b.requiredDate.getTime() || (a.demandLineId < b.demandLineId ? -1 : 1))
    const orders = []
    for (const d of demand) {
      let customer = custCache.get(d.customerId)
      if (customer === undefined) {
        customer = (await this.org.getCustomer(tenantId, d.customerId))?.name ?? d.customerId
        custCache.set(d.customerId, customer)
      }
      // releaseReference is the human-facing order id the planner reads off the board (e.g.
      // GM-830-1142) — exposed so "delay GM-830-1142" resolves, not just the internal demandLineId.
      orders.push({ demandLineId: d.demandLineId, releaseReference: d.releaseReference, customer, part: partNo.get(d.partId) ?? d.partId, qty: d.requiredQty, firmness: d.firmness, due: d.requiredDate.toISOString() })
    }
    return { orders, resources }
  }

  // --- solve (deterministic sequencer) ---------------------------------------
  /**
   * Runs the deterministic sequencer for a plant and persists a `draft` version.
   * Reads parts/routings/resources through the binding-resolved `masterdata.read`.
   * @throws AppException NO_DEMAND_TO_SCHEDULE - no active demand for the plant
   * @throws AppException SCHEDULE_INFEASIBLE - a line has no routing / no eligible resource (D4 hard gate)
   */
  async solve(tenantId: string, plantId: string): Promise<ScheduleVersionDto> {
    const startedAt = new Date()
    const ctx = await this.buildBaseContext(tenantId, plantId)
    if (ctx.demand.length === 0) {
      throw new AppException(HttpStatus.BAD_REQUEST, 'No active demand to schedule', ERROR_CODES.NO_DEMAND_TO_SCHEDULE)
    }

    // Hard gate (D4): an unresolvable line / no eligible resource → infeasible run, NO version.
    if (ctx.infeasibleReason) {
      await this.repo.createRun({
        tenantId,
        plantId,
        trigger: 'manual',
        objectiveSummary: 'EDD changeover-aware (SKIP-03 stand-in)',
        status: 'infeasible',
        stopReason: ctx.infeasibleReason,
        startedAt,
        finishedAt: new Date(),
        inputDemandCount: ctx.demand.length,
      })
      throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ctx.infeasibleReason, ERROR_CODES.SCHEDULE_INFEASIBLE)
    }

    // Overlay learned values (SKIP-04 goes live, api-spec §12.5): precompute the
    // held, guardrail-passing learned cycle/setup per (op, eligible resource), then
    // the sequencer prefers them — the longer learned cycle on a drifted resource
    // re-sequences to avoid starvation. Std where no trusted learned value exists.
    const items = ctx.items
    const demand = ctx.demand
    // Forecast boundary = today's start: a pre-adopted forecast applies forward only, never to the
    // rolling window's already-executed past (D44). Measured overlays are unaffected by this.
    const resolveEffective = await this.buildLearnedOverlay(tenantId, items, startOfDayUtc(Date.now()))
    const result = sequence(items, resolveEffective, undefined, ctx.resourceCalendars, ctx.resolveOperator, ctx.minBatchByResource, ctx.downtimeByResource)
    const run = await this.repo.createRun({
      tenantId,
      plantId,
      trigger: 'manual',
      objectiveSummary: 'EDD changeover-aware (SKIP-03 stand-in)',
      status: 'success',
      stopReason: `completed: ${result.placements.length} operations placed`,
      startedAt,
      finishedAt: new Date(),
      inputDemandCount: demand.length,
    })
    const version = await this.repo.createVersionWithOps(
      {
        tenantId,
        plantId,
        status: 'draft',
        horizonStart: new Date(result.horizonStartMs),
        horizonEnd: new Date(result.horizonEndMs),
        optimizerRunId: run.id,
      },
      result.placements.map((p) => ({
        demandLineId: p.demandLineId,
        partId: p.partId,
        routingOperationId: p.routingOperationId,
        resourceId: p.resourceId,
        opSeq: p.opSeq,
        sequencePosition: p.sequencePosition,
        plannedStart: new Date(p.plannedStartMs),
        plannedEnd: new Date(p.plannedEndMs),
        plannedQty: p.qty,
        setupTime: p.setupTime,
        cycleTime: p.cycleTime,
        setupSource: p.setupSource,
        cycleSource: p.cycleSource,
        setupConfidence: p.setupConfidence,
        cycleConfidence: p.cycleConfidence,
        atRisk: p.atRisk,
        atRiskReason: p.atRiskReason,
        bindingKind: p.bindingKind,
        bindingBlockerDemandLineId: p.bindingBlockerDemandLineId,
        bindingBlockerOpSeq: p.bindingBlockerOpSeq,
        bindingDowntimeId: p.bindingDowntimeId,
        bindingOperatorId: p.bindingOperatorId,
      })),
    )
    // Auto-reap: soft-delete the plant's prior (uncommitted) drafts so re-solving doesn't pile up
    // stale drafts in the version list — keep only this newest draft. Committed/superseded untouched.
    await this.repo.discardDraftsForPlant(tenantId, plantId, version.id)
    await this.events.publish(EVENTS.SCHEDULING_RUN_COMPLETED, { id: run.id, tenantId, name: plantId }, tenantId)
    return toScheduleVersionDto(version)
  }

  /**
   * Promotes a `draft` version to `committed`, superseding the plant's prior
   * committed (AS11). The seam the Phase-3 approval policy will gate (SKIP-46).
   * @throws AppException SCHEDULE_VERSION_NOT_FOUND
   */
  async commit(tenantId: string, id: string): Promise<ScheduleVersionDto> {
    const version = await this.repo.findVersion(tenantId, id)
    if (!version) {
      throw new AppException(HttpStatus.NOT_FOUND, 'Schedule version not found', ERROR_CODES.SCHEDULE_VERSION_NOT_FOUND)
    }
    if (version.status === 'committed') return toScheduleVersionDto(version)
    const prior = await this.repo.findCommittedVersion(tenantId, version.plantId)
    if (prior && prior.id !== version.id) {
      await this.repo.updateVersionStatus(tenantId, prior.id, { status: 'superseded' })
    }
    const updated = await this.repo.updateVersionStatus(tenantId, id, {
      status: 'committed',
      supersedesVersionId: prior?.id ?? null,
    })
    await this.events.publish(EVENTS.SCHEDULING_VERSION_COMMITTED, { id, tenantId, name: version.plantId }, tenantId)
    return toScheduleVersionDto(updated!)
  }

  /**
   * Soft-delete a DRAFT version (status → `discarded`; the row is kept, just hidden from listings).
   * The immutability boundary: a `committed` or `superseded` version is part of the permanent record
   * (IATF/audit) and is NEVER discardable — only a never-committed `draft` is. Idempotent only for an
   * already-`discarded` draft is rejected too (it is no longer a draft).
   * @throws AppException SCHEDULE_VERSION_NOT_FOUND - no such version for this tenant
   * @throws AppException SCHEDULE_VERSION_NOT_DRAFT - the version is committed/superseded/discarded (immutable)
   */
  async discardDraft(tenantId: string, id: string): Promise<ScheduleVersionDto> {
    const version = await this.repo.findVersion(tenantId, id)
    if (!version) {
      throw new AppException(HttpStatus.NOT_FOUND, 'Schedule version not found', ERROR_CODES.SCHEDULE_VERSION_NOT_FOUND)
    }
    if (version.status !== 'draft') {
      // The hard boundary: committed and superseded (a former live plan) are immutable history.
      throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'Only a draft can be discarded', ERROR_CODES.SCHEDULE_VERSION_NOT_DRAFT)
    }
    const updated = await this.repo.updateVersionStatus(tenantId, id, { status: 'discarded' })
    return toScheduleVersionDto(updated!)
  }

  // --- internal --------------------------------------------------------------
  /** Priority rank from org: program override, else customer default (MD15). */
  private async priorityRankFor(
    tenantId: string,
    customerId: string,
    programId: string | null,
    cache: Map<string, number>,
  ): Promise<number> {
    const key = `${customerId}:${programId ?? ''}`
    const cached = cache.get(key)
    if (cached !== undefined) return cached
    let priority: OrgPriority = 'standard'
    if (programId) {
      const program = await this.org.getProgram(tenantId, programId)
      if (program?.priority) priority = program.priority
      else {
        const customer = await this.org.getCustomer(tenantId, customerId)
        if (customer) priority = customer.priority
      }
    } else {
      const customer = await this.org.getCustomer(tenantId, customerId)
      if (customer) priority = customer.priority
    }
    const rank = PRIORITY_RANK[priority] ?? 2
    cache.set(key, rank)
    return rank
  }

  /** Resolve an order's effective priority tier (program override → customer default → standard). Cached per (customer, program). */
  private async priorityFor(
    tenantId: string,
    customerId: string,
    programId: string | null,
    cache: Map<string, OrgPriority>,
  ): Promise<OrgPriority> {
    const key = `${customerId}:${programId ?? ''}`
    const cached = cache.get(key)
    if (cached !== undefined) return cached
    let priority: OrgPriority = 'standard'
    if (programId) {
      const program = await this.org.getProgram(tenantId, programId)
      if (program?.priority) priority = program.priority
      else priority = (await this.org.getCustomer(tenantId, customerId))?.priority ?? 'standard'
    } else {
      priority = (await this.org.getCustomer(tenantId, customerId))?.priority ?? 'standard'
    }
    cache.set(key, priority)
    return priority
  }

  /**
   * Assemble the deterministic sequencer inputs for a plant — the shared base both
   * `solve()` and the **what-if engine** (phase 5) build on, so they never drift.
   * Returns the items, an infeasibility reason (the D4 hard gate), the active
   * demand, and resource/part lookups. Does NOT persist anything.
   */
  async buildBaseContext(tenantId: string, plantId: string): Promise<BaseContext> {
    const md = await this.resolveMasterData(tenantId)
    const demand = await this.repo.activeDemand(tenantId, plantId)
    const resources = await md.listResources(tenantId)
    const resourceById = new Map(resources.map((r) => [r.id, r]))
    const activeResourceIds = new Set(resources.filter((r) => r.status === 'active').map((r) => r.id))
    const partNoById = new Map((await md.listParts(tenantId)).map((p) => [p.id, p.partNo]))
    const partCache = new Map<string, PartDto | null>()
    const priorityCache = new Map<string, number>()

    // Material gate (D36, §4.8): per finished part, the earliest start its consumed
    // buy-components allow = the latest component availability. Sourced from the interim
    // material_requirement (BOM-lite; retires when the master-data BOM lands, SKIP-45) and
    // the material_availability input. Components with no availability row = fully on-hand.
    const availMs = new Map<string, number>()
    for (const a of await this.repo.listMaterialAvailability(tenantId, plantId)) {
      availMs.set(a.componentPartId, Math.max(availMs.get(a.componentPartId) ?? 0, a.availableAt.getTime()))
    }
    const earliestByPart = new Map<string, number>()
    for (const r of await this.repo.listMaterialRequirements(tenantId, plantId)) {
      const ms = availMs.get(r.componentPartId)
      if (ms != null) earliestByPart.set(r.partId, Math.max(earliestByPart.get(r.partId) ?? 0, ms))
    }

    // Order-release floor: PAST-dated demand sits on its own past day; today/future demand floors at
    // today (so the rolling window's future still front-loads from today — unchanged when no past
    // demand exists, since this then equals the schedule origin). Day-anchored to the planning "now".
    const todayStartMs = startOfDayUtc(Date.now())

    const items: SequencerItem[] = []
    let infeasibleReason: string | null = null
    for (const line of demand) {
      const part = partCache.get(line.partId) ?? (await md.getPart(tenantId, line.partId))
      partCache.set(line.partId, part)
      const routing = await md.getPrimaryRoutingForPart(tenantId, line.partId)
      if (!part || !routing || routing.operations.length === 0) {
        infeasibleReason = `Demand ${line.demandLineId}: no active primary routing for part ${line.partId}`
        break
      }
      const priorityRank = await this.priorityRankFor(tenantId, line.customerId, line.programId, priorityCache)
      for (const op of routing.operations) {
        const group = await md.getResourceGroup(tenantId, op.resourceGroupId)
        const eligible = (group?.memberResourceIds ?? []).filter((id) => activeResourceIds.has(id)).sort()
        if (eligible.length === 0) {
          infeasibleReason = `Demand ${line.demandLineId}: no eligible active resource for op ${op.opSeq}`
          break
        }
        items.push({
          demandLineId: line.demandLineId,
          partId: line.partId,
          partNo: part.partNo,
          routingOperationId: op.id,
          opSeq: op.opSeq,
          changeoverValue: changeoverValueFor(part, op.changeoverAttributeKey),
          qty: line.requiredQty,
          setupTime: op.stdSetupTime,
          cycleTime: op.stdCycleTime,
          requiredDate: line.requiredDate.getTime(),
          firmness: line.firmness,
          priorityRank,
          eligibleResourceIds: eligible,
          earliestStartMs: earliestByPart.get(line.partId),
          releaseFloorMs: Math.min(todayStartMs, startOfDayUtc(line.requiredDate.getTime())),
        })
      }
      if (infeasibleReason) break
    }
    // Downtime closures (line-down / maintenance): per-resource time-boxed windows the calendar-aware
    // sequencer subtracts from capacity (ops displace around them — NOT excluded). The SAME windows
    // feed the binder so a delayed start roots at `resource_downtime` (with the window id). One source.
    const downtime = await md.listActiveDowntime(tenantId, plantId)
    const { closed: downtimeClosed, windows: downtimeByResource } = downtimeMaps(downtime)
    const resourceCalendars = await this.resolveResourceCalendars(tenantId, resources, downtimeClosed)

    // Operator performance (C5, §4.8): the operator pinned to a resource scales the op's run time
    // when scheduled. Consumed input — the scheduler reads the assignment + the operator's factor,
    // never assigns. Per resource: the assignments covering the op's start, picked deterministically
    // (latest effectiveFrom, then operatorId); the factor lives on the operator. No covering
    // assignment → 1.0 (standard), exactly like a component with no material row = on-hand.
    const operators = await md.listOperators(tenantId)
    const operatorAssignments = await this.repo.listResourceOperatorAssignments(tenantId, plantId)
    const resolveOperator = buildOperatorResolver(operators, operatorAssignments)

    // Minimum batch (C4): each resource's run-quantity floor from its resource-type config
    // (minBatchQty; 0 = no floor). The sequencer floors effRunQty = max(demandQty, minBatch).
    const minBatchByType = new Map((await md.listResourceTypeConfigs(tenantId)).map((c) => [c.resourceType, c.minBatchQty]))
    const minBatchByResource = new Map(resources.map((r) => [r.id, minBatchByType.get(r.resourceType) ?? 0]))

    // Objective Policy (config-driven): resolve the scorer's weights + the version token (plant→
    // tenant→global) once per solve, so scoring is deterministic and the rationale/cache key stamp
    // the exact weights in force. The runtime guard ran on write, so a resolved set always dominates.
    const { weights, version: weightSetVersion } = await this.config.resolveObjective(tenantId, plantId)

    // Determinism digest of the persisted base inputs the change-set doesn't carry (see BaseContext).
    // Computed HERE where the raw data lives (operator factors live behind a closure; min-batch / rates /
    // calendar are per-resource). Sorted for stability. Downtime is hashed separately (downtimeDigest).
    const factorByOperator = new Map(operators.map((o) => [o.id, o.performanceFactor]))
    const opDigest = operatorAssignments
      .map(
        (a) =>
          `${a.resourceId}=${a.operatorId}:${a.effectiveFrom?.getTime() ?? Number.NEGATIVE_INFINITY}:${a.effectiveTo?.getTime() ?? Number.POSITIVE_INFINITY}:${factorByOperator.get(a.operatorId) ?? 1}`,
      )
      .sort()
    const minBatchDigest = [...minBatchByResource.entries()].map(([rid, mb]) => `${rid}:${mb}`).sort()
    const rateDigest = resources.map((r) => `${r.id}:${r.runCostPerHour}:${r.setupCost}:${r.overheadPerUnit}`).sort()
    // Operator attributes the cost factor (laborRate, wi-12) + the faster-operator lever (availability,
    // home plant, factor) read — beyond the assignment-keyed opDigest, since the lever also considers
    // UNASSIGNED candidates. A change to any busts the what-if cache (else a stale lever/score replays).
    const operatorDigest = operators
      .map((o) => `${o.id}:${o.performanceFactor}:${o.laborRate ?? 'n'}:${o.available ? 1 : 0}:${o.homePlantId}:${o.isActive ? 1 : 0}`)
      .sort()
    const calDigest = [...resourceCalendars.entries()]
      .map(([rid, c]) => `${rid}:${c.workingDays.join('')}:${c.dayWindows.map((w) => w.join('-')).join(',')}:${[...c.holidays].sort().join('|')}:${c.splittable ? 1 : 0}:${c.otCeilingMinutes}`)
      .sort()
    const baseInputsDigest = JSON.stringify({ op: opDigest, opr: operatorDigest, mb: minBatchDigest, rate: rateDigest, cal: calDigest })

    return { items, infeasibleReason, demand, resourceById, partNoById, resourceCalendars, downtime, downtimeByResource, resolveOperator, operators, operatorAssignments, minBatchByResource, weights, weightSetVersion, baseInputsDigest }
  }

  /**
   * Resolve each resource's operating calendar into a normalized {@link WorkingCalendar}
   * for the calendar-aware sequencer (D-shift): the org calendar (working days / shift
   * windows / holidays) plus the resource-type shift config (splittable / OT cap, with a
   * per-resource OT override). `extraClosedByResource` injects time-boxed closures (the
   * per-resource line-down / maintenance windows from `resource_downtime`, or a what-if
   * window) as closed intervals — merged + deduped by {@link buildWorkingCalendar}, so a
   * window present in BOTH base and a what-if changeset is subtracted ONCE (no double-apply).
   * A resource whose calendar can't be resolved is omitted → the sequencer falls back to 24/7.
   */
  async resolveResourceCalendars(
    tenantId: string,
    resources: ResourceDto[],
    extraClosedByResource?: Map<string, Array<[number, number]>>,
  ): Promise<Map<string, WorkingCalendar>> {
    const cfgByType = new Map(
      (await (await this.resolveMasterData(tenantId)).listResourceTypeConfigs(tenantId)).map((c) => [c.resourceType, c]),
    )
    const calCache = new Map<string, CalendarDto | null>()
    const out = new Map<string, WorkingCalendar>()
    for (const r of resources) {
      let calDto = calCache.get(r.calendarId)
      if (calDto === undefined) {
        calDto = await this.org.getCalendar(tenantId, r.calendarId)
        calCache.set(r.calendarId, calDto)
      }
      if (!calDto) continue
      const cfg = cfgByType.get(r.resourceType)
      out.set(
        r.id,
        buildWorkingCalendar({
          workingDays: asNumberArray(calDto.workingDays),
          shiftPatterns: asShiftPatterns(calDto.shiftPatterns),
          holidays: asStringArray(calDto.holidays),
          // Time-boxed closures (maintenance / line-down) come from per-resource resource_downtime
          // via `extraClosedByResource` (Step 3 wires the read); merged + deduped by buildWorkingCalendar.
          closedIntervals: [...(extraClosedByResource?.get(r.id) ?? [])],
          splittable: cfg?.splittable ?? false,
          // A normal solve spends NO overtime; the resource's OT cap is only the ceiling the
          // what-if overtime option may opt into (decision: OT is policy-only, never auto-spent).
          otCapMinutes: 0,
          otCeilingMinutes: r.otCapMinutes ?? cfg?.otCapMinutes ?? 0,
        }),
      )
    }
    return out
  }

  /**
   * Precompute the learned overlay (api-spec §12.5): per `(op, eligible resource)`,
   * fetch the held learned cycle/setup from `learning.read` and return a pure
   * resolver the deterministic sequencer calls. `held` learned-from-actuals values
   * clearing `LEARNED_CONF_USE` are used (A18 bounded); a pre-adopted forecast
   * (`ml_predicted`) is used regardless of confidence but FORWARD-ONLY — gated by the
   * op's start vs `forecastFromMs` so it never rewrites already-executed past ops (D44).
   * Otherwise the std baseline. Public so the what-if engine reuses the identical overlay.
   * @param forecastFromMs Forecast boundary (epoch ms); ops starting before it drop any
   *   `ml_predicted` overlay. Omit (what-if/comparison) to apply overlays without a time gate.
   */
  async buildLearnedOverlay(tenantId: string, items: SequencerItem[], forecastFromMs?: number): Promise<ResolveEffective> {
    // A held overlay is applied when (a) it's a deliberate pre-adopt (`ml_predicted` — the human/system
    // already decided to act on the forecast, so the confidence floor that guards AUTO-trusting
    // learned-from-actuals values does NOT gate it), or (b) it's a learned-from-actuals value clearing
    // `LEARNED_CONF_USE` (A18 bounded). The bypass is scoped narrowly to `ml_predicted` by design.
    const usable = (p: LearnedParameterDto | null): p is LearnedParameterDto =>
      !!p &&
      p.status === 'held' &&
      p.learnedValue != null &&
      (p.source === 'ml_predicted' || (p.confidence ?? 0) >= LEARNED_CONF_USE)
    const learned = new Map<string, { cycle: LearnedParameterDto | null; setup: LearnedParameterDto | null }>()
    const pairs = new Set<string>()
    for (const it of items) for (const rid of it.eligibleResourceIds) pairs.add(`${rid}::${it.routingOperationId}`)
    for (const key of pairs) {
      const [rid, opId] = key.split('::') as [string, string]
      learned.set(key, {
        cycle: await this.learning.getLearnedParameter(tenantId, rid, opId, 'cycle'),
        setup: await this.learning.getLearnedParameter(tenantId, rid, opId, 'setup'),
      })
    }
    // A pre-adopted forecast (`ml_predicted`) is FORWARD-ONLY (D44): it must not rewrite ops that
    // already ran. When `forecastFromMs` is set (the persisted solve passes today's start) and the
    // op starts before it, the forecast is dropped → the op falls back to std (or a measured value).
    // Measured (`ml_adjusted`, learned from actuals) is retroactively consistent and never gated.
    const forwardOK = (p: LearnedParameterDto | null, atMs?: number): boolean =>
      !(p?.source === 'ml_predicted' && forecastFromMs != null && atMs != null && atMs < forecastFromMs)
    return (routingOperationId, resourceId, stdSetup, stdCycle, atMs): EffectiveTimes => {
      const rec = learned.get(`${resourceId}::${routingOperationId}`)
      const c = rec?.cycle ?? null
      const s = rec?.setup ?? null
      const applyC = usable(c) && forwardOK(c, atMs)
      const applyS = usable(s) && forwardOK(s, atMs)
      return {
        setupTime: applyS ? s!.learnedValue! : stdSetup,
        cycleTime: applyC ? c!.learnedValue! : stdCycle,
        // Propagate the overlay's REAL source — a pre-adopted forecast (`ml_predicted`) must stay
        // distinguishable from a learned-from-actuals value (`ml_adjusted`) at the op level (D44).
        setupSource: applyS ? s!.source : 'standard',
        cycleSource: applyC ? c!.source : 'standard',
        setupConfidence: applyS ? s!.confidence : null,
        cycleConfidence: applyC ? c!.confidence : null,
      }
    }
  }

  // --- phase 3 reads: performance variance / scorecard / workforce ------------
  /**
   * Planned-vs-actual variance for a version (4.4↔4.3) — deterministic, no ML.
   * Throughput attainment, behind-plan %, adherence, sequence churn vs the prior
   * version, and the learned-overlay count. All computed from rows (no literals).
   * @throws AppException SCHEDULE_VERSION_NOT_FOUND
   */
  async variance(tenantId: string, versionId: string): Promise<PerformanceVarianceDto> {
    const version = await this.repo.findVersion(tenantId, versionId)
    if (!version) {
      throw new AppException(HttpStatus.NOT_FOUND, 'Schedule version not found', ERROR_CODES.SCHEDULE_VERSION_NOT_FOUND)
    }
    const ops = await this.repo.operationsForVersion(versionId)
    const actuals = await this.learning.listActualsForVersion(tenantId, versionId)
    const actualByOp = new Map(actuals.map((a) => [a.scheduledOperationId, a]))
    const md = await this.resolveMasterData(tenantId)
    const allResources = await md.listResources(tenantId)
    const nameById = new Map(allResources.map((r) => [r.id, r.name]))

    // Capacity utilization (D-util) over the FORWARD window [max(today, horizonStart) → horizonEnd]
    // — excludes the rolling window's executed past. busy = engine processing minutes of the ops
    // STARTING in the window; available = regular working minutes from the live calendar (OT excluded).
    // Single source feeding the KPI strip (plant) + the lane badges (per resource); plant = Σbusy/Σavail
    // (capacity-weighted average → reconciles by construction). > 1 = committed beyond regular capacity.
    const utilWindowStart = Math.max(startOfDayUtc(Date.now()), version.horizonStart.getTime())
    const utilWindowEnd = version.horizonEnd.getTime()
    // Subtract downtime (line-down / maintenance) from available minutes — a down line's regular
    // capacity drops over the window, so utilization reflects the outage (same source as the solve).
    const { closed: utilDowntime } = downtimeMaps(await md.listActiveDowntime(tenantId, version.plantId))
    const utilCalendars = await this.resolveResourceCalendars(
      tenantId,
      allResources.filter((r) => r.plantId === version.plantId),
      utilDowntime,
    )
    const availByResource = new Map<string, number>()
    for (const [rid, cal] of utilCalendars) availByResource.set(rid, workingMinutesInRange(cal, utilWindowStart, utilWindowEnd))
    let plantBusy = 0
    let plantAvail = 0

    // CONTINUOUS plant-performance throughput (Reporting-Policy window, cross-version) — a fact about
    // the executed past, stable across re-solve. Feeds the KPI strip headline + the lane "behind plan"
    // chip (per-resource continuous attainment). Distinct from the per-version attainment below.
    const cont = await this.computePlantThroughput(tenantId, version.plantId)
    // CONTINUOUS historical OEE (A·P·Q) — the cockpit headline. Read from the seeded measured_historical
    // rows over the Reporting-Policy window (same source as the scorecard's Historical baseline arm), so
    // it's plan-independent, present from demo:reset, and never waits for a re-solve.
    const histOee = await this.computeHistoricalOee(tenantId, version.plantId)

    const byResource = new Map<string, typeof ops>()
    for (const op of ops) {
      const list = byResource.get(op.resourceId) ?? []
      list.push(op)
      byResource.set(op.resourceId, list)
    }
    const resources: ResourceVarianceDto[] = [...byResource.entries()]
      .map(([resourceId, list]) => {
        // Utilization: busy (processing minutes of ops starting in the window) ÷ available (regular cal).
        const busy = list
          .filter((o) => o.plannedStart.getTime() >= utilWindowStart && o.plannedStart.getTime() < utilWindowEnd)
          .reduce((s, o) => s + o.setupTime + o.cycleTime * o.plannedQty, 0)
        const avail = availByResource.get(resourceId) ?? 0
        const utilizationPct = avail > 0 ? busy / avail : null
        if (avail > 0) {
          plantBusy += busy
          plantAvail += avail
        }
        // Attainment is EXECUTION performance: good output vs the planned qty of the ops that have
        // actually RUN (have actuals). The denominator is scoped to executed ops, NOT the whole
        // horizon — in the rolling window most ops are future/unexecuted, so dividing by all planned
        // qty would read ~80% "behind" for every lane just because the future hasn't happened yet.
        const withActual = list.filter((o) => actualByOp.has(o.id))
        const planned = withActual.reduce((s, o) => s + o.plannedQty, 0)
        const good = withActual.reduce((s, o) => s + (actualByOp.get(o.id)?.goodQty ?? 0), 0)
        const onTime = withActual.filter((o) => {
          const a = actualByOp.get(o.id)!
          return Math.abs(new Date(a.actualStart).getTime() - o.plannedStart.getTime()) <= ADHERENCE_TOLERANCE_MIN * 60_000
        }).length
        const attainment = planned > 0 ? good / planned : 1
        // The lane "behind plan" chip reads the CONTINUOUS attainment (executed-past, cross-version) so
        // it doesn't reset on a re-solve; behindPlanPct = 1 − continuous (0 when nothing ran in window).
        const continuousAttainment = cont.byResource.get(resourceId) ?? null
        return {
          resourceId,
          resourceName: nameById.get(resourceId) ?? resourceId,
          throughputAttainment: attainment,
          continuousAttainment,
          continuousOee: histOee.byResource.get(resourceId) ?? null,
          behindPlanPct: continuousAttainment != null ? Math.max(0, 1 - continuousAttainment) : 0,
          scheduleAdherence: withActual.length > 0 ? onTime / withActual.length : 1,
          utilizationPct,
        }
      })
      .sort((a, b) => a.resourceName.localeCompare(b.resourceName))

    const hasActuals = actuals.length > 0
    // Same scope as the per-resource attainment: executed ops only (good vs planned of what RAN),
    // so the version-level throughput isn't diluted by the unexecuted future of the rolling window.
    const executedOps = ops.filter((o) => actualByOp.has(o.id))
    const totalPlanned = executedOps.reduce((s, o) => s + o.plannedQty, 0)
    const totalGood = executedOps.reduce((s, o) => s + (actualByOp.get(o.id)?.goodQty ?? 0), 0)
    const learnedParamCount = ops.filter(
      (o) => o.cycleSource === 'ml_adjusted' || o.setupSource === 'ml_adjusted',
    ).length

    // Churn vs the prior version this one supersedes (or the plant's other committed).
    const priorId =
      version.supersedesVersionId ??
      (await this.repo.findCommittedVersion(tenantId, version.plantId).then((v) => (v && v.id !== versionId ? v.id : null)))
    let churn: number | null = null
    if (priorId) {
      const prior = await this.repo.operationsForVersion(priorId)
      const priorByKey = new Map(prior.map((o) => [`${o.demandLineId}:${o.routingOperationId}`, o]))
      const changed = ops.filter((o) => {
        const p = priorByKey.get(`${o.demandLineId}:${o.routingOperationId}`)
        if (!p) return true
        return (
          p.resourceId !== o.resourceId ||
          p.sequencePosition !== o.sequencePosition ||
          p.plannedStart.getTime() !== o.plannedStart.getTime()
        )
      }).length
      churn = ops.length > 0 ? changed / ops.length : 0
    }

    return {
      scheduleVersionId: versionId,
      resources,
      // PER-VERSION attainment (this committed plan) — null when no actuals yet (no data ≠ 100%).
      throughputAttainment: hasActuals && totalPlanned > 0 ? totalGood / totalPlanned : null,
      // CONTINUOUS plant throughput (cross-version, Reporting-Policy window) — the scorecard retrospective.
      plantThroughputAttainment: cont.plant,
      // CONTINUOUS historical OEE (A·P·Q) from measured_historical rows — the cockpit headline.
      plantOee: histOee.plant,
      reportingWindowStart: new Date(cont.windowStartMs).toISOString(),
      reportingWindowEnd: new Date(cont.windowEndMs).toISOString(),
      utilizationPct: plantAvail > 0 ? plantBusy / plantAvail : null,
      utilizationWindowStart: new Date(utilWindowStart).toISOString(),
      utilizationWindowEnd: new Date(utilWindowEnd).toISOString(),
      churn,
      learnedParamCount,
      opCount: ops.length,
    }
  }

  /**
   * Resolve the **authoritative** executed-past actuals for the plant over the **Reporting-Policy**
   * window (CONFIG-driven). The shared substrate for every continuous (cross-version, re-solve-stable)
   * plant metric — throughput AND OEE read this so they agree on which actuals count.
   *
   * - **Window:** `[startOfToday − reportingWindowDays, startOfToday)` from the resolved reporting policy.
   * - **Authority:** per `(resource, routingOp, day)` keep the **latest-committed** executing version
   *   present (double-count-proof if a day was ever re-executed under a newer version), then dedupe to
   *   ONE representative per executing op (actuals are seq-ordered → the last cycle wins).
   * - **Honesty:** a day that didn't execute contributes nothing; an empty window → `[]` (→ `null` KPI).
   */
  private async resolveContinuousActuals(
    tenantId: string,
    plantId: string,
  ): Promise<{ authoritative: ExecutionActualDto[]; resourceIds: string[]; windowStartMs: number; windowEndMs: number }> {
    const MS_PER_DAY = 86_400_000
    const { reportingWindowDays } = await this.config.resolveReporting(tenantId, plantId)
    const windowEndMs = startOfDayUtc(Date.now())
    const windowStartMs = windowEndMs - reportingWindowDays * MS_PER_DAY

    const md = await this.resolveMasterData(tenantId)
    const resourceIds = (await md.listResources(tenantId)).filter((r) => r.plantId === plantId).map((r) => r.id)
    const actuals = await this.learning.listActualsForResourcesInWindow(tenantId, resourceIds, windowStartMs, windowEndMs)
    if (actuals.length === 0) return { authoritative: [], resourceIds, windowStartMs, windowEndMs }

    // Authority: latest-committed executing version per (resource, routingOp, day).
    const versions = await this.repo.findVersionsByIds(tenantId, [...new Set(actuals.map((a) => a.scheduleVersionId))])
    const createdAtById = new Map(versions.map((v) => [v.id, v.createdAt.getTime()]))
    const groupKey = (a: { resourceId: string; routingOperationId: string; actualStart: string }) =>
      `${a.resourceId}::${a.routingOperationId}::${startOfDayUtc(new Date(a.actualStart).getTime())}`
    const bestVersionByGroup = new Map<string, string>()
    for (const a of actuals) {
      const k = groupKey(a)
      const cur = bestVersionByGroup.get(k)
      if (cur === undefined || (createdAtById.get(a.scheduleVersionId) ?? 0) > (createdAtById.get(cur) ?? 0)) {
        bestVersionByGroup.set(k, a.scheduleVersionId)
      }
    }
    // Dedupe to ONE representative per executing op (seq-ordered → last cycle wins).
    const repByOp = new Map<string, ExecutionActualDto>()
    for (const a of actuals) {
      if (bestVersionByGroup.get(groupKey(a)) === a.scheduleVersionId) repByOp.set(a.scheduledOperationId, a)
    }
    return { authoritative: [...repByOp.values()], resourceIds, windowStartMs, windowEndMs }
  }

  /**
   * Continuous plant-performance throughput over the Reporting-Policy window — Σ good ÷ Σ
   * planned-at-execution across the authoritative executed-past actuals, each measured against the
   * plan that was live when it ran. A fact about the past → **stable across re-solve**. Per-resource
   * + plant; `null` on an empty window (dash, not 0%).
   * @returns plant attainment + per-resource attainment + the resolved window bounds.
   */
  private async computePlantThroughput(
    tenantId: string,
    plantId: string,
  ): Promise<{ plant: number | null; byResource: Map<string, number | null>; windowStartMs: number; windowEndMs: number }> {
    const { authoritative, resourceIds, windowStartMs, windowEndMs } = await this.resolveContinuousActuals(tenantId, plantId)
    if (authoritative.length === 0) return { plant: null, byResource: new Map(), windowStartMs, windowEndMs }

    // Planned-at-execution: the executing op's plannedQty (across versions, by exact id).
    const plannedByOp = new Map((await this.repo.findOpsByIds(authoritative.map((a) => a.scheduledOperationId))).map((o) => [o.id, o.plannedQty]))

    let plantGood = 0
    let plantPlanned = 0
    const goodByRes = new Map<string, number>()
    const plannedByRes = new Map<string, number>()
    for (const a of authoritative) {
      const p = plannedByOp.get(a.scheduledOperationId) ?? 0
      plantGood += a.goodQty
      plantPlanned += p
      goodByRes.set(a.resourceId, (goodByRes.get(a.resourceId) ?? 0) + a.goodQty)
      plannedByRes.set(a.resourceId, (plannedByRes.get(a.resourceId) ?? 0) + p)
    }
    const byResource = new Map<string, number | null>()
    for (const rid of resourceIds) {
      const pl = plannedByRes.get(rid) ?? 0
      byResource.set(rid, pl > 0 ? (goodByRes.get(rid) ?? 0) / pl : null)
    }
    return { plant: plantPlanned > 0 ? plantGood / plantPlanned : null, byResource, windowStartMs, windowEndMs }
  }

  /**
   * Continuous **historical OEE** (A·P·Q) for the cockpit — aggregated from the seeded
   * `historical_outcome` (measured_historical) rows whose period overlaps the Reporting-Policy window.
   * The **same source** the scorecard's "Historical" baseline arm reads (no divergence), plan-independent
   * and present from `demo:reset` (the plant has a history) — so the cockpit OEE shows immediately and
   * never waits for a re-solve. `null` per scope when no in-window rows exist (the honest empty state).
   * @returns plant OEE + per-resource OEE (both `null` when the window has no rows for that scope).
   */
  private async computeHistoricalOee(
    tenantId: string,
    plantId: string,
  ): Promise<{ plant: OeeDto | null; byResource: Map<string, OeeDto | null> }> {
    const MS_PER_DAY = 86_400_000
    const { reportingWindowDays } = await this.config.resolveReporting(tenantId, plantId)
    const windowEndMs = startOfDayUtc(Date.now())
    const windowStartMs = windowEndMs - reportingWindowDays * MS_PER_DAY
    const rows = (await this.repo.listHistoricalOutcomes(tenantId, plantId)).filter(
      (r) => r.periodEnd.getTime() > windowStartMs && r.periodStart.getTime() < windowEndMs && r.oee != null,
    )
    type Row = (typeof rows)[number]
    const agg = (subset: Row[]): OeeDto | null => {
      if (subset.length === 0) return null
      const mean = (sel: (r: Row) => number | null): number => {
        const vals = subset.map(sel).filter((v): v is number => v != null)
        return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0
      }
      const availability = mean((r) => r.oeeAvailability)
      const performance = mean((r) => r.oeePerformance)
      const quality = mean((r) => r.oeeQuality)
      return { availability, performance, quality, oee: availability * performance * quality }
    }
    // Plant = aggregate ALL in-window rows (blend + per-line), the SAME scope the scorecard's
    // measured_historical baseline arm uses (`listHistoricalOutcomes(plantId)` with no resourceId) —
    // so the cockpit headline and the Historical baseline show the identical number (no divergence, #6).
    const plant = agg(rows)
    const byResource = new Map<string, OeeDto | null>()
    for (const rid of new Set(rows.filter((r) => r.resourceId != null).map((r) => r.resourceId as string))) {
      byResource.set(rid, agg(rows.filter((r) => r.resourceId === rid)))
    }
    return { plant, byResource }
  }

  /** Compute one version's metrics, optionally scoped to a single resource/line. */
  private async versionMetrics(
    tenantId: string,
    versionId: string,
    resourceId: string | undefined,
    resourceById: Map<string, ResourceDto>,
    partNoById: Map<string, string>,
    plantId: string,
    withChains: boolean,
  ): Promise<{ otif: number; costPerUnit: number | null; oee: OeeDto | null; scheduleAdherence: number | null; throughputAttainment: number | null; atRisk: AtRiskOrderDto[] }> {
    // Chains follow blockers across resources → built from the UNFILTERED ops even when drilled to one line.
    const allOps = await this.repo.operationsForVersion(versionId)
    const ops = resourceId ? allOps.filter((o) => o.resourceId === resourceId) : allOps
    if (ops.length === 0) return { otif: 1, costPerUnit: null, oee: null, scheduleAdherence: null, throughputAttainment: null, atRisk: [] }
    let actuals = await this.learning.listActualsForVersion(tenantId, versionId)
    if (resourceId) actuals = actuals.filter((a) => a.resourceId === resourceId)
    const hasActuals = actuals.length > 0
    const actualByOp = new Map(actuals.map((a) => [a.scheduledOperationId, a]))

    // OTIF is plan-based (the schedule's on-time fraction) — valid without actuals.
    const otif = ops.filter((o) => !o.atRisk).length / ops.length

    // OEE / throughput / adherence are EXECUTION metrics → accumulate over EXECUTED ops only (those
    // with an actual). Including the rolling window's unexecuted future ops would inflate the runtime
    // denominator with planned-duration that never produced → it diluted Performance to ~34%.
    let operating = 0 // machine-occupied minutes of executed ops (actual setup + run)
    let setupSum = 0 // actual setup (changeover) minutes — a textbook AVAILABILITY loss
    let downtime = 0 // recorded stop minutes — also an availability loss
    let idealRun = 0 // Σ std-cycle × good — the value-adding ideal (Performance numerator)
    let good = 0
    let scrap = 0
    let execPlanned = 0 // planned qty of EXECUTED ops (throughput denominator, not the unrun future)
    let execCount = 0
    let onTime = 0 // executed ops started within tolerance of planned start (Schedule Adherence)
    let cost = 0
    let costedGood = 0
    for (const o of ops) {
      const a = actualByOp.get(o.id)
      if (!a) continue
      const g = a.goodQty
      good += g
      scrap += a.scrapQty
      execPlanned += o.plannedQty
      execCount += 1
      const opMin = (new Date(a.actualEnd).getTime() - new Date(a.actualStart).getTime()) / 60_000
      operating += opMin
      setupSum += a.actualSetupTime ?? 0
      downtime += a.downtimeMinutes
      idealRun += o.cycleTime * g
      if (Math.abs(new Date(a.actualStart).getTime() - o.plannedStart.getTime()) <= ADHERENCE_TOLERANCE_MIN * 60_000) onTime += 1
      const res = resourceById.get(o.resourceId)
      if (res && (res.runCostPerHour != null || res.setupCost != null || res.overheadPerUnit != null) && g > 0) {
        // Tier-B op cost = changeover economics (setupCost) + machine time (opMin, incl.
        // setup; actual when known → drift raises cost) + overhead. cost/unit = Σcost / Σgood.
        cost += (res.setupCost ?? 0) + (res.runCostPerHour ?? 0) * (opMin / 60) + (res.overheadPerUnit ?? 0) * g
        costedGood += g
      }
    }
    // OEE needs actuals — null (not 0%/100%) when none (no data ≠ value). Setup (changeover) + recorded
    // stops are AVAILABILITY losses (textbook OEE); Performance then measures pure rate (std cycle vs net
    // run time), so a clean line reads ~99% — not ~80% understated by setup sitting in the denominator.
    let oee: OeeDto | null = null
    if (hasActuals) {
      const netRun = Math.max(0, operating - setupSum)
      const availability = operating + downtime > 0 ? netRun / (operating + downtime) : 0
      const performance = netRun > 0 ? Math.min(1, idealRun / netRun) : 0
      const quality = good + scrap > 0 ? good / (good + scrap) : 0
      oee = { availability, performance, quality, oee: availability * performance * quality }
    }
    const chains = withChains ? await this.latenessChainsFor(tenantId, plantId, allOps) : null
    const atRisk: AtRiskOrderDto[] = ops
      .filter((o) => o.atRisk)
      .map((o) => ({
        demandLineId: o.demandLineId,
        label: `${partNoById.get(o.partId) ?? o.partId} · ${o.demandLineId}`,
        detail: `op ${o.opSeq} · ${resourceById.get(o.resourceId)?.name ?? o.resourceId}`,
        reason: o.atRiskReason ?? 'at risk',
        resourceId: o.resourceId,
        chain: chains?.get(`${o.demandLineId}:${o.opSeq}`) ?? null,
      }))
    return {
      otif,
      costPerUnit: costedGood > 0 ? cost / costedGood : null,
      oee,
      // Schedule Adherence = executed ops started within tolerance of planned start / executed ops
      // (execution discipline — a distinct axis from OTIF's delivery outcome). Null without actuals.
      scheduleAdherence: hasActuals ? (execCount > 0 ? onTime / execCount : 1) : null,
      throughputAttainment: hasActuals && execPlanned > 0 ? good / execPlanned : null,
      atRisk,
    }
  }

  /**
   * View 2 · Service–Cost Scorecard — phase-3 metrics for **one schedule version**
   * (its OWN actuals), optionally **drilled to one line** (`resourceId`). Returns a
   * `previous` snapshot = the prior **committed** version this one supersedes, for
   * version-over-version ↑/↓ (NOT the manual baseline — that stays the Phase-5 stub;
   * the UI renders "—" when a previous metric is null, never a delta-from-null).
   * @throws AppException SCHEDULE_VERSION_NOT_FOUND
   */
  async scorecard(tenantId: string, plantId: string, versionId?: string, resourceId?: string): Promise<ScorecardDto> {
    const version = versionId
      ? await this.repo.findVersion(tenantId, versionId)
      : ((await this.repo.findCommittedVersion(tenantId, plantId)) ??
        (await this.repo.listVersions(tenantId, plantId))[0])
    if (versionId && !version) {
      throw new AppException(HttpStatus.NOT_FOUND, 'Schedule version not found', ERROR_CODES.SCHEDULE_VERSION_NOT_FOUND)
    }
    const resolvedPlant = version?.plantId ?? plantId
    if (!version) {
      return { plantId: resolvedPlant, scheduleVersionId: null, resourceId: resourceId ?? null, previous: null, otif: 1, costPerUnit: null, oee: null, scheduleAdherence: null, throughputAttainment: null, atRisk: [] }
    }
    const md = await this.resolveMasterData(tenantId)
    const resourceById = new Map((await md.listResources(tenantId)).map((r) => [r.id, r]))
    const partNoById = new Map((await md.listParts(tenantId)).map((p) => [p.id, p.partNo]))

    const cur = await this.versionMetrics(tenantId, version.id, resourceId, resourceById, partNoById, version.plantId, true)
    // Previous = the prior committed version this one supersedes (committed-to-committed).
    const prevVersion = version.supersedesVersionId
      ? await this.repo.findVersion(tenantId, version.supersedesVersionId)
      : null
    const previous = prevVersion
      ? await this.versionMetrics(tenantId, prevVersion.id, resourceId, resourceById, partNoById, prevVersion.plantId, false).then((m) => ({
          otif: m.otif,
          costPerUnit: m.costPerUnit,
          oee: m.oee,
          scheduleAdherence: m.scheduleAdherence,
          throughputAttainment: m.throughputAttainment,
        }))
      : null

    return {
      plantId: resolvedPlant,
      scheduleVersionId: version.id,
      resourceId: resourceId ?? null,
      previous,
      otif: cur.otif,
      costPerUnit: cur.costPerUnit,
      oee: cur.oee,
      scheduleAdherence: cur.scheduleAdherence,
      throughputAttainment: cur.throughputAttainment,
      atRisk: cur.atRisk,
    }
  }

  /**
   * View · Work List (D-worklist) — every order (demand line) in a version with a **computed**
   * lifecycle status (completed / at-risk / in-progress / scheduled) rolled up from its ops, plus the
   * status rollup counts that drive the filter chips. Single source: the at-risk subset uses the SAME
   * engine flag + causal chain the exception queue renders, so `counts.atRisk` equals that queue's row
   * count by construction. Statuses are computed here, never stored. Defaults to the plant's committed
   * version (else its newest).
   * @throws AppException SCHEDULE_VERSION_NOT_FOUND - an explicit `versionId` that doesn't exist
   */
  async workList(tenantId: string, plantId: string, versionId?: string): Promise<WorkListResponseDto> {
    const version = versionId
      ? await this.repo.findVersion(tenantId, versionId)
      : ((await this.repo.findCommittedVersion(tenantId, plantId)) ?? (await this.repo.listVersions(tenantId, plantId))[0])
    if (versionId && !version) {
      throw new AppException(HttpStatus.NOT_FOUND, 'Schedule version not found', ERROR_CODES.SCHEDULE_VERSION_NOT_FOUND)
    }
    const resolvedPlant = version?.plantId ?? plantId
    const empty = { total: 0, completed: 0, atRisk: 0, stranded: 0, inProgress: 0, scheduled: 0 }
    if (!version) return { plantId: resolvedPlant, scheduleVersionId: null, counts: empty, rows: [] }

    const md = await this.resolveMasterData(tenantId)
    const ops = await this.repo.operationsForVersion(version.id)
    const actuals = await this.learning.listActualsForVersion(tenantId, version.id)
    const actualOpIds = new Set(actuals.map((a) => a.scheduledOperationId))
    const resourceName = new Map((await md.listResources(tenantId)).map((r) => [r.id, r.name]))
    const partNoById = new Map((await md.listParts(tenantId)).map((p) => [p.id, p.partNo]))
    // Same computed chains the queue/board/Copilot read (built from the unfiltered ops).
    const chains = await this.latenessChainsFor(tenantId, version.plantId, ops)

    // Order metadata (customer / priority / due / firmness), keyed by demand line.
    const custCache = new Map<string, string>()
    const priorityCache = new Map<string, OrgPriority>()
    const orders = new Map<string, WorkListOrderMeta>()
    for (const d of (await this.repo.listDemand(tenantId, version.plantId)).filter((x) => x.isActive)) {
      let customerName = custCache.get(d.customerId)
      if (customerName === undefined) {
        customerName = (await this.org.getCustomer(tenantId, d.customerId))?.name ?? d.customerId
        custCache.set(d.customerId, customerName)
      }
      orders.set(d.demandLineId, {
        demandLineId: d.demandLineId,
        partNo: partNoById.get(d.partId) ?? d.partId,
        releaseReference: d.releaseReference,
        customerName,
        priority: await this.priorityFor(tenantId, d.customerId, d.programId, priorityCache),
        firmness: d.firmness,
        requiredDateIso: d.requiredDate.toISOString(),
        requiredQty: d.requiredQty,
      })
    }
    // An op whose demand line isn't active (edge): synthesize minimal meta so it isn't silently dropped.
    for (const o of ops) {
      if (orders.has(o.demandLineId)) continue
      orders.set(o.demandLineId, {
        demandLineId: o.demandLineId,
        partNo: partNoById.get(o.partId) ?? o.partId,
        releaseReference: null,
        customerName: '—',
        priority: 'standard',
        firmness: 'forecast',
        requiredDateIso: version.horizonEnd.toISOString(),
        requiredQty: o.plannedQty,
      })
    }

    const stranded = await this.strandedOpIds(tenantId, version.plantId, ops)
    const opInputs: WorkListOpInput[] = ops.map((o) => ({
      demandLineId: o.demandLineId,
      opSeq: o.opSeq,
      resourceId: o.resourceId,
      resourceName: resourceName.get(o.resourceId) ?? o.resourceId,
      plannedStartMs: o.plannedStart.getTime(),
      plannedEndMs: o.plannedEnd.getTime(),
      atRisk: o.atRisk,
      atRiskReason: o.atRiskReason,
      stranded: stranded.has(o.id),
      hasActual: actualOpIds.has(o.id),
      chain: chains.get(`${o.demandLineId}:${o.opSeq}`) ?? null,
    }))

    const { rows, counts } = buildWorkList(opInputs, orders, Date.now())
    return { plantId: resolvedPlant, scheduleVersionId: version.id, counts, rows }
  }

  /**
   * View 3 · Workforce coverage — operator×station (certification) grid with
   * next-shift readiness and a cert-gap → named-operator OT **confirmed proposal**
   * (D54; labor-aware, not rostering). Computed from master-data operators/certs/
   * qualifications + seeded `available` presence.
   */
  async coverage(tenantId: string, plantId: string): Promise<WorkforceCoverageDto> {
    const md = await this.resolveMasterData(tenantId)
    const operators = (await md.listOperators(tenantId)).filter((o) => o.isActive && o.homePlantId === plantId)
    // Stations relevant to THIS plant = certs at least one of its operators holds
    // (a stamping plant doesn't surface leak-test/weld it never staffs — that would
    // be a false gap). No plant↔cert table yet → operator possession is the proxy.
    const relevantCertIds = new Set(operators.flatMap((o) => o.certificationIds))
    const certs = (await md.listCertifications(tenantId)).filter((c) => c.isActive && relevantCertIds.has(c.id))

    const operatorAxis: CoverageAxisDto[] = operators.map((o) => ({ id: o.id, label: o.name, out: !o.available, outReason: o.available ? null : o.absenceReason }))
    const stationAxis: CoverageAxisDto[] = certs.map((c) => ({ id: c.id, label: c.code, certRequired: true }))
    const holds = (op: OperatorDto, certId: string) => op.certificationIds.includes(certId)
    const covered = (certId: string) => operators.some((op) => op.available && holds(op, certId))

    const cells: CoverageCell[][] = operators.map((op) =>
      certs.map((c): CoverageCell => {
        if (holds(op, c.id)) return 'qualified'
        // an uncovered station highlights the present non-qualified cells as the gap
        if (!covered(c.id) && op.available) return 'gap'
        return 'not_qualified'
      }),
    )

    const gapStations = certs.filter((c) => !covered(c.id))
    const proposals: CoverageProposalDto[] = gapStations
      .map((c): CoverageProposalDto | null => {
        // Candidates = qualified + absent; the ladder (pickCallIn) chooses by reason then cost.
        const fill = pickCallIn(
          operators
            .filter((op) => holds(op, c.id) && !op.available)
            .map((op) => ({ id: op.id, name: op.name, absenceReason: op.absenceReason, laborRate: op.laborRate })),
        )
        if (!fill) return null // only sick (or unknown-reason) absentees → honestly unfillable, no proposal
        return {
          id: c.id,
          station: c.name,
          operatorName: fill.name,
          reason: fill.tentative ? 'On vacation — confirm availability before calling in' : 'No certified operator present next shift',
          status: 'proposed',
          absenceReason: fill.absenceReason,
          tentative: fill.tentative,
        }
      })
      .filter((p): p is CoverageProposalDto => p != null)

    const readinessPct = certs.length > 0 ? (certs.length - gapStations.length) / certs.length : 1

    return {
      plantId,
      operators: operatorAxis,
      stations: stationAxis,
      cells,
      readinessPct,
      certGapCount: gapStations.length,
      proposals,
    }
  }
}

/** Adherence window: an op "on plan" if it started within this of planned (variance). */
const ADHERENCE_TOLERANCE_MIN = 15

/** A qualified-but-absent operator considered for an OT call-in to a gapped station (D54). */
export interface CallInCandidate {
  id: string
  name: string
  absenceReason: OperatorAbsenceReason | null
  laborRate: number | null
}

/** Call-in eligibility tiers: off-shift first, then vacation; sick is never callable. */
const CALLABLE_TIER: Record<OperatorAbsenceReason, number> = { not_scheduled: 0, vacation: 1, sick: Number.POSITIVE_INFINITY }

/**
 * Pure OT call-in selection (D54). From the qualified+absent candidates, pick by the eligibility
 * ladder: a `not_scheduled` (off-shift) operator first → a clean call-in; else one on `vacation` →
 * a TENTATIVE call-in (confirm first). `sick` (or an unknown/absent reason) is never callable. Ties
 * within a tier break by cheapest labor rate, then id (deterministic). Returns null when no one is
 * callable (the gap is honestly unfillable → no proposal).
 */
export function pickCallIn(
  candidates: CallInCandidate[],
): { id: string; name: string; absenceReason: Exclude<OperatorAbsenceReason, 'sick'>; tentative: boolean } | null {
  const fill = candidates
    .filter((c) => c.absenceReason === 'not_scheduled' || c.absenceReason === 'vacation')
    .sort(
      (a, b) =>
        CALLABLE_TIER[a.absenceReason!] - CALLABLE_TIER[b.absenceReason!] ||
        (a.laborRate ?? Number.POSITIVE_INFINITY) - (b.laborRate ?? Number.POSITIVE_INFINITY) ||
        a.id.localeCompare(b.id),
    )[0]
  if (!fill) return null
  const absenceReason = fill.absenceReason as Exclude<OperatorAbsenceReason, 'sick'>
  return { id: fill.id, name: fill.name, absenceReason, tentative: absenceReason === 'vacation' }
}

/** The part's attribute value that the op's changeover key points at (AS6). */
function changeoverValueFor(part: PartDto, key: string | null): string | null {
  switch (key) {
    case 'colour':
      return part.colour
    case 'material':
      return part.material
    case 'gauge':
      return part.gauge
    default:
      return null
  }
}
