import { HttpStatus, Inject, Injectable } from '@nestjs/common'
import {
  MASTERDATA_READ_CONTRACT,
  type AtRiskOrderDto,
  type CalendarDto,
  type CoverageAxisDto,
  type CoverageCell,
  type CoverageProposalDto,
  type LearnedParameterDto,
  type LearningReadContract,
  type MasterDataReadContract,
  type OeeDto,
  type OperatorDto,
  type OrgPriority,
  type OrgReadContract,
  type PartDto,
  type PerformanceVarianceDto,
  type ResourceDto,
  type ResourceVarianceDto,
  type ScheduleVersionDetailDto,
  type ScheduleVersionDto,
  type ScorecardDto,
  type WorkforceCoverageDto,
  type WorkingWindowDto,
} from '@perduraflow/contracts'
import { AppException, ERROR_CODES } from '../../common/exceptions/app.exception'
import { EVENTS } from '../../events'
import { BindingResolver } from '../binding/binding.resolver'
import { EventBus } from '../eventbus/event-bus'
import { LEARNING_READ } from '../learning/learning-read.service'
import { ORG_READ } from '../org/org-read.service'
import {
  toDemandInputDto,
  toOptimizerRunDto,
  toScheduledOperationDto,
  toScheduleVersionDto,
} from './scheduling.mapper'
import { SchedulingRepository } from './scheduling.repository'
import type { DemandInput } from './schema'
import { sequence, type EffectiveTimes, type ResolveEffective, type SequencerItem } from './sequencer'
import { buildWorkingCalendar, type WorkingCalendar } from './working-calendar'

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
/** Maintenance windows (`{start,end}` ISO) → epoch-ms `[start,end]` closed intervals. */
function maintenanceToIntervals(v: unknown): Array<[number, number]> {
  if (!Array.isArray(v)) return []
  const out: Array<[number, number]> = []
  for (const w of v) {
    const s = w && typeof w.start === 'string' ? Date.parse(w.start) : NaN
    const e = w && typeof w.end === 'string' ? Date.parse(w.end) : NaN
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) out.push([s, e])
  }
  return out
}

/**
 * The daily working window spanning a set of resource calendars — the earliest shift
 * open to the latest shift close (minutes from midnight), for the Gantt axis (D-shift).
 * Null when no calendar has any window (24/7 fallback → the Gantt uses the horizon range).
 */
function workingWindowOf(cals: Map<string, WorkingCalendar>): WorkingWindowDto | null {
  let start = Number.POSITIVE_INFINITY
  let end = Number.NEGATIVE_INFINITY
  for (const cal of cals.values()) {
    if (cal.dayWindows.length === 0) continue
    start = Math.min(start, cal.dayWindows[0]![0])
    end = Math.max(end, cal.dayWindows[cal.dayWindows.length - 1]![1])
  }
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? { startMinute: start, endMinute: end } : null
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
    return {
      version: toScheduleVersionDto(version),
      run: toOptimizerRunDto(run!),
      workingWindow,
      operations: ops.map((o) => {
        const a = actualByOp.get(o.id)
        return {
          ...toScheduledOperationDto(o),
          actual: a
            ? {
                actualStart: a.actualStart,
                actualEnd: a.actualEnd,
                actualCycleTime: a.actualCycleTime,
                goodQty: a.goodQty,
                scrapQty: a.scrapQty,
              }
            : null,
        }
      }),
    }
  }

  /** Lists the plant's seeded demand (read-only). */
  async listDemand(tenantId: string, plantId: string) {
    return (await this.repo.listDemand(tenantId, plantId)).map(toDemandInputDto)
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
    orders: { demandLineId: string; customer: string; part: string; qty: number; firmness: string; due: string }[]
    resources: { id: string; name: string; status: string }[]
  }> {
    const md = await this.resolveMasterData(tenantId)
    const partNo = new Map((await md.listParts(tenantId)).map((p) => [p.id, p.partNo]))
    const resources = (await md.listResources(tenantId))
      .filter((r) => r.plantId === plantId)
      .map((r) => ({ id: r.id, name: r.name, status: r.status }))
    const custCache = new Map<string, string>()
    const demand = (await this.repo.listDemand(tenantId, plantId)).filter((d) => d.isActive)
    const orders = []
    for (const d of demand) {
      let customer = custCache.get(d.customerId)
      if (customer === undefined) {
        customer = (await this.org.getCustomer(tenantId, d.customerId))?.name ?? d.customerId
        custCache.set(d.customerId, customer)
      }
      orders.push({ demandLineId: d.demandLineId, customer, part: partNo.get(d.partId) ?? d.partId, qty: d.requiredQty, firmness: d.firmness, due: d.requiredDate.toISOString() })
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
    const resolveEffective = await this.buildLearnedOverlay(tenantId, items)
    const result = sequence(items, resolveEffective, undefined, ctx.resourceCalendars)
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
      })),
    )
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
        })
      }
      if (infeasibleReason) break
    }
    const resourceCalendars = await this.resolveResourceCalendars(tenantId, resources)
    return { items, infeasibleReason, demand, resourceById, partNoById, resourceCalendars }
  }

  /**
   * Resolve each resource's operating calendar into a normalized {@link WorkingCalendar}
   * for the calendar-aware sequencer (D-shift): the org calendar (working days / shift
   * windows / holidays / maintenance) plus the resource-type shift config (splittable /
   * OT cap, with a per-resource OT override). `extraClosedByResource` injects time-boxed
   * closures (e.g. a what-if line-down window) as additional closed intervals. A resource
   * whose calendar can't be resolved is omitted → the sequencer falls back to 24/7.
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
          closedIntervals: [...maintenanceToIntervals(calDto.maintenanceWindows), ...(extraClosedByResource?.get(r.id) ?? [])],
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
   * resolver the deterministic sequencer calls. Only `held` values clearing
   * `LEARNED_CONF_USE` are used (A18 bounded); otherwise the std baseline. Public so
   * the what-if engine reuses the identical overlay (determinism, phase 5).
   */
  async buildLearnedOverlay(tenantId: string, items: SequencerItem[]): Promise<ResolveEffective> {
    const usable = (p: LearnedParameterDto | null): p is LearnedParameterDto =>
      !!p && p.status === 'held' && p.learnedValue != null && (p.confidence ?? 0) >= LEARNED_CONF_USE
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
    return (routingOperationId, resourceId, stdSetup, stdCycle): EffectiveTimes => {
      const rec = learned.get(`${resourceId}::${routingOperationId}`)
      const c = rec?.cycle ?? null
      const s = rec?.setup ?? null
      return {
        setupTime: usable(s) ? s.learnedValue! : stdSetup,
        cycleTime: usable(c) ? c.learnedValue! : stdCycle,
        setupSource: usable(s) ? 'ml_adjusted' : 'standard',
        cycleSource: usable(c) ? 'ml_adjusted' : 'standard',
        setupConfidence: usable(s) ? s.confidence : null,
        cycleConfidence: usable(c) ? c.confidence : null,
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
    const nameById = new Map((await md.listResources(tenantId)).map((r) => [r.id, r.name]))

    const byResource = new Map<string, typeof ops>()
    for (const op of ops) {
      const list = byResource.get(op.resourceId) ?? []
      list.push(op)
      byResource.set(op.resourceId, list)
    }
    const resources: ResourceVarianceDto[] = [...byResource.entries()]
      .map(([resourceId, list]) => {
        const planned = list.reduce((s, o) => s + o.plannedQty, 0)
        const good = list.reduce((s, o) => s + (actualByOp.get(o.id)?.goodQty ?? 0), 0)
        const withActual = list.filter((o) => actualByOp.has(o.id))
        const onTime = withActual.filter((o) => {
          const a = actualByOp.get(o.id)!
          return Math.abs(new Date(a.actualStart).getTime() - o.plannedStart.getTime()) <= ADHERENCE_TOLERANCE_MIN * 60_000
        }).length
        const attainment = planned > 0 && withActual.length > 0 ? good / planned : 1
        return {
          resourceId,
          resourceName: nameById.get(resourceId) ?? resourceId,
          throughputAttainment: attainment,
          behindPlanPct: Math.max(0, 1 - attainment),
          scheduleAdherence: withActual.length > 0 ? onTime / withActual.length : 1,
        }
      })
      .sort((a, b) => a.resourceName.localeCompare(b.resourceName))

    const hasActuals = actuals.length > 0
    const totalPlanned = ops.reduce((s, o) => s + o.plannedQty, 0)
    const totalGood = ops.reduce((s, o) => s + (actualByOp.get(o.id)?.goodQty ?? 0), 0)
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
      // null when no actuals yet — the board hides the chip (no data ≠ 100%).
      throughputAttainment: hasActuals && totalPlanned > 0 ? totalGood / totalPlanned : null,
      churn,
      learnedParamCount,
      opCount: ops.length,
    }
  }

  /** Compute one version's metrics, optionally scoped to a single resource/line. */
  private async versionMetrics(
    tenantId: string,
    versionId: string,
    resourceId: string | undefined,
    resourceById: Map<string, ResourceDto>,
    partNoById: Map<string, string>,
  ): Promise<{ otif: number; costPerUnit: number | null; oee: OeeDto | null; throughputAttainment: number | null; atRisk: AtRiskOrderDto[] }> {
    let ops = await this.repo.operationsForVersion(versionId)
    if (resourceId) ops = ops.filter((o) => o.resourceId === resourceId)
    if (ops.length === 0) return { otif: 1, costPerUnit: null, oee: null, throughputAttainment: null, atRisk: [] }
    let actuals = await this.learning.listActualsForVersion(tenantId, versionId)
    if (resourceId) actuals = actuals.filter((a) => a.resourceId === resourceId)
    const hasActuals = actuals.length > 0
    const actualByOp = new Map(actuals.map((a) => [a.scheduledOperationId, a]))

    // OTIF is plan-based (the schedule's on-time fraction) — valid without actuals.
    const otif = ops.filter((o) => !o.atRisk).length / ops.length

    let runtime = 0
    let downtime = 0
    let idealRun = 0
    let good = 0
    let scrap = 0
    let planned = 0
    let cost = 0
    let costedGood = 0
    for (const o of ops) {
      planned += o.plannedQty
      const a = actualByOp.get(o.id)
      const g = a?.goodQty ?? 0
      good += g
      scrap += a?.scrapQty ?? 0
      const runMin = a ? (new Date(a.actualEnd).getTime() - new Date(a.actualStart).getTime()) / 60_000 : o.setupTime + o.cycleTime * o.plannedQty
      runtime += runMin
      downtime += a?.downtimeMinutes ?? 0
      idealRun += o.cycleTime * g
      const res = resourceById.get(o.resourceId)
      if (res && (res.runCostPerHour != null || res.setupCost != null || res.overheadPerUnit != null) && g > 0) {
        // Tier-B op cost = changeover economics (setupCost) + machine time (runMin, incl.
        // setup; actual when known → drift raises cost) + overhead. cost/unit = Σcost / Σgood.
        cost += (res.setupCost ?? 0) + (res.runCostPerHour ?? 0) * (runMin / 60) + (res.overheadPerUnit ?? 0) * g
        costedGood += g
      }
    }
    // OEE/throughput/cost need actuals — null (not 0%/100%) when none (no data ≠ value).
    let oee: OeeDto | null = null
    if (hasActuals) {
      const availability = runtime + downtime > 0 ? runtime / (runtime + downtime) : 0
      const performance = runtime > 0 ? Math.min(1, idealRun / runtime) : 0
      const quality = good + scrap > 0 ? good / (good + scrap) : 0
      oee = { availability, performance, quality, oee: availability * performance * quality }
    }
    const atRisk: AtRiskOrderDto[] = ops
      .filter((o) => o.atRisk)
      .map((o) => ({
        demandLineId: o.demandLineId,
        label: `${partNoById.get(o.partId) ?? o.partId} · ${o.demandLineId}`,
        detail: `op ${o.opSeq} · ${resourceById.get(o.resourceId)?.name ?? o.resourceId}`,
        reason: o.atRiskReason ?? 'at risk',
        resourceId: o.resourceId,
      }))
    return {
      otif,
      costPerUnit: costedGood > 0 ? cost / costedGood : null,
      oee,
      throughputAttainment: hasActuals && planned > 0 ? good / planned : null,
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
      return { plantId: resolvedPlant, scheduleVersionId: null, resourceId: resourceId ?? null, previous: null, otif: 1, costPerUnit: null, oee: null, throughputAttainment: null, atRisk: [] }
    }
    const md = await this.resolveMasterData(tenantId)
    const resourceById = new Map((await md.listResources(tenantId)).map((r) => [r.id, r]))
    const partNoById = new Map((await md.listParts(tenantId)).map((p) => [p.id, p.partNo]))

    const cur = await this.versionMetrics(tenantId, version.id, resourceId, resourceById, partNoById)
    // Previous = the prior committed version this one supersedes (committed-to-committed).
    const prevVersion = version.supersedesVersionId
      ? await this.repo.findVersion(tenantId, version.supersedesVersionId)
      : null
    const previous = prevVersion
      ? await this.versionMetrics(tenantId, prevVersion.id, resourceId, resourceById, partNoById).then((m) => ({
          otif: m.otif,
          costPerUnit: m.costPerUnit,
          oee: m.oee,
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
      throughputAttainment: cur.throughputAttainment,
      atRisk: cur.atRisk,
    }
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

    const operatorAxis: CoverageAxisDto[] = operators.map((o) => ({ id: o.id, label: o.name, out: !o.available }))
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
        // Call in the CHEAPEST off-shift qualified operator (an OT call-in is for
        // absent staff); tie-break by id for determinism (D54 confirmed-fill).
        const fill =
          operators
            .filter((op) => holds(op, c.id) && !op.available)
            .sort((a, b) => (a.laborRate ?? Number.POSITIVE_INFINITY) - (b.laborRate ?? Number.POSITIVE_INFINITY) || a.id.localeCompare(b.id))[0] ??
          operators.find((op) => holds(op, c.id))
        if (!fill) return null
        return {
          id: c.id,
          station: c.name,
          operatorName: fill.name,
          reason: 'No certified operator present next shift',
          status: 'proposed',
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
