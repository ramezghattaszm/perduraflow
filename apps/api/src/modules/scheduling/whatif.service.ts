import { createHash } from 'node:crypto'
import { HttpStatus, Injectable } from '@nestjs/common'
import {
  type Change,
  type ChangeSet,
  type LearningReadContract,
  type OptionComparative,
  type RationaleFactor,
  type ScheduleVersionDto,
  type StructuredRationale,
  type WhatIfOption,
  type WhatIfResultDto,
} from '@perduraflow/contracts'
import { Inject } from '@nestjs/common'
import { AppException, ERROR_CODES } from '../../common/exceptions/app.exception'
import { LEARNING_READ } from '../learning/learning-read.service'
import { toScheduleVersionDto } from './scheduling.mapper'
import { SchedulingRepository } from './scheduling.repository'
import { SchedulingService, type BaseContext } from './scheduling.service'
import { sequence, type Placement, type ResolveEffective, type SequencePolicy, type SequencerItem } from './sequencer'
import type { WorkingCalendar } from './working-calendar'
import { placementSignature } from './whatif.signature'
import { scorePlan, type ResourceRate, type ScoredPlan } from './whatif.scoring'
import { ENGINE_VERSION, RATIONALE_SCHEMA_VERSION, WEIGHT_SET_VERSION } from './whatif.weights'

/** An option recipe: how to transform the base, what policy, and any OT. */
interface OptionSpec {
  id: string
  labelKey: string
  policy?: SequencePolicy
  overtimeHours: number
  /** Transform the (already change-set-applied) items; may drop a resource → infeasible. */
  itemTransform: (items: SequencerItem[]) => SequencerItem[]
  /** Wrap the learned overlay (e.g. inflate a worn line's cycle for "defer"). */
  overlayWrap?: (base: ResolveEffective) => ResolveEffective
}

/**
 * What-if evaluation engine (phase 5, D55). Accepts an arbitrary **change-set**,
 * applies it to the live scheduling base, generates a small set of **deterministic,
 * feasibility-honest options**, costs and ranks them, and attaches a **structured
 * rationale** to each (factors + binding constraints + comparatives). It reuses the
 * exact item assembly + learned overlay from {@link SchedulingService} so a what-if
 * plan is the same engine the live sequence comes from — only the inputs differ.
 * **Evaluation-only**: nothing commits here (that is `apply`, a human action).
 */
@Injectable()
export class WhatIfService {
  constructor(
    private readonly repo: SchedulingRepository,
    private readonly scheduling: SchedulingService,
    @Inject(LEARNING_READ) private readonly learning: LearningReadContract,
  ) {}

  /**
   * Evaluate a change-set → a ranked, costed option-set with structured rationale.
   * Deterministic: the same change-set + base + overlay + weights reproduces the
   * same `determinismKey` and the same options (a prior result with that key is
   * re-used). Feasibility-honest: an option whose change-set can't be scheduled is
   * returned as `feasible:false` with a reason, never silently mangled.
   * @throws CHANGE_SET_INVALID a change references an unknown line/resource
   * @throws WHATIF_INFEASIBLE every option is infeasible (the whole set can't schedule)
   */
  async evaluate(
    tenantId: string,
    plantId: string,
    changeSet: ChangeSet,
    baseVersionId: string | undefined,
    userId: string | null,
  ): Promise<WhatIfResultDto> {
    const ctx = await this.scheduling.buildBaseContext(tenantId, plantId)
    if (ctx.infeasibleReason) {
      throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ctx.infeasibleReason, ERROR_CODES.WHATIF_INFEASIBLE)
    }
    const committed = baseVersionId
      ? baseVersionId
      : (await this.repo.findCommittedVersion(tenantId, plantId))?.id ?? 'live'

    // The live (current) plan — the comparison anchor + displacement reference. Uses the
    // plain (pre-disruption) calendars; the option world adds any line-down closures.
    const baseOverlay = await this.scheduling.buildLearnedOverlay(tenantId, ctx.items)
    const basePlacements = sequence(ctx.items, baseOverlay, undefined, ctx.resourceCalendars).placements

    // Apply the change-set to the items (feasibility-honest).
    const changed = this.applyChangeSet(ctx.items, changeSet)
    const rateByResource = this.rates(ctx.resourceById)
    const predicted = await this.predictedCycles(tenantId, changeSet)
    const optionCalendars = await this.optionCalendars(tenantId, ctx, changeSet)

    const specs = this.optionSpecs(changeSet, predicted)
    const evaluated = specs.map((spec) => this.runOption(spec, changed, baseOverlay, basePlacements, rateByResource, optionCalendars))

    const feasible = evaluated.filter((e) => e.feasible)
    if (feasible.length === 0) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'No feasible option for the change-set',
        ERROR_CODES.WHATIF_INFEASIBLE,
      )
    }

    // Collapse options that produce the SAME plan (identical placement signature) so a
    // planner only ever sees DISTINCT alternatives — conditional, data-dependent: an
    // option that genuinely re-sequences keeps its own signature and survives. Survivor
    // per group = lowest score, then lowest id (deterministic, no arbitrariness).
    // Infeasible options have no plan → never collapsed (each keeps its reason).
    const infeasible = evaluated.filter((e) => !e.feasible)
    const groups = new Map<string, typeof feasible>()
    for (const e of feasible) {
      const sig = placementSignature(e.placements)
      const g = groups.get(sig)
      if (g) g.push(e)
      else groups.set(sig, [e])
    }
    const survivors = [...groups.values()].map(
      (g) => [...g].sort((a, b) => a.scored!.score - b.scored!.score || a.spec.id.localeCompare(b.spec.id))[0]!,
    )
    const distinct = [...survivors, ...infeasible]

    // Rank by score (asc); infeasible sink to the end. The id tie-break now only ever
    // separates genuinely-distinct same-score plans (legitimate).
    const ranked = [...distinct].sort((a, b) => {
      if (a.feasible !== b.feasible) return a.feasible ? -1 : 1
      if (a.scored && b.scored && a.scored.score !== b.scored.score) return a.scored.score - b.scored.score
      return a.spec.id.localeCompare(b.spec.id)
    })

    const baseKpis = scorePlan(basePlacements, { rateByResource, basePlacements, overtimeHours: 0 }).kpis
    const options = this.buildOptions(ranked)
    const recommendedOptionId = options.find((o) => o.feasible)?.id ?? null
    const determinismKey = this.determinismKey(committed, changeSet, changed, baseOverlay)

    const prior = await this.repo.findWhatIfByDeterminismKey(tenantId, determinismKey)
    if (prior) {
      return this.toDto(prior.id, plantId, committed, changeSet, prior.baseKpis, prior.options as WhatIfOption[], prior.recommendedOptionId, determinismKey, prior.createdAt)
    }

    const row = await this.repo.createWhatIfResult({
      tenantId,
      plantId,
      baseVersionId: committed,
      changeSet,
      baseKpis,
      options,
      recommendedOptionId,
      determinismKey,
      createdBy: userId,
    })
    return this.toDto(row.id, plantId, committed, changeSet, baseKpis, options, recommendedOptionId, determinismKey, row.createdAt)
  }

  /**
   * Fetch a stored what-if result — the phase-6 substrate read (rationale answers
   * "why not X / what drove the cost" without re-running the engine, DoD proof #8).
   * @throws WHATIF_RESULT_NOT_FOUND
   */
  async get(tenantId: string, id: string): Promise<WhatIfResultDto> {
    const row = await this.repo.findWhatIfResult(tenantId, id)
    if (!row) throw new AppException(HttpStatus.NOT_FOUND, 'What-if result not found', ERROR_CODES.WHATIF_RESULT_NOT_FOUND)
    return this.toDto(row.id, row.plantId, row.baseVersionId, row.changeSet as ChangeSet, row.baseKpis as WhatIfResultDto['baseKpis'], row.options as WhatIfOption[], row.recommendedOptionId, row.determinismKey, row.createdAt)
  }

  /**
   * Apply a selected option → persist a new **draft** schedule version (D26 human
   * action; the planner commits it separately through the existing guardrail).
   * Re-runs the option deterministically (no stored placements) so the applied plan
   * is exactly the evaluated one.
   * @throws WHATIF_RESULT_NOT_FOUND / WHATIF_OPTION_NOT_FOUND / WHATIF_INFEASIBLE
   */
  async applyOption(tenantId: string, resultId: string, optionId: string, userId: string | null): Promise<ScheduleVersionDto> {
    const result = await this.repo.findWhatIfResult(tenantId, resultId)
    if (!result) throw new AppException(HttpStatus.NOT_FOUND, 'What-if result not found', ERROR_CODES.WHATIF_RESULT_NOT_FOUND)
    const changeSet = result.changeSet as ChangeSet
    const plantId = result.plantId

    const ctx = await this.scheduling.buildBaseContext(tenantId, plantId)
    if (ctx.infeasibleReason) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ctx.infeasibleReason, ERROR_CODES.WHATIF_INFEASIBLE)
    const baseOverlay = await this.scheduling.buildLearnedOverlay(tenantId, ctx.items)
    const basePlacements = sequence(ctx.items, baseOverlay, undefined, ctx.resourceCalendars).placements
    const changed = this.applyChangeSet(ctx.items, changeSet)
    const rateByResource = this.rates(ctx.resourceById)
    const predicted = await this.predictedCycles(tenantId, changeSet)
    const optionCalendars = await this.optionCalendars(tenantId, ctx, changeSet)

    const spec = this.optionSpecs(changeSet, predicted).find((s) => s.id === optionId)
    if (!spec) throw new AppException(HttpStatus.NOT_FOUND, 'Option not found', ERROR_CODES.WHATIF_OPTION_NOT_FOUND)
    const run = this.runOption(spec, changed, baseOverlay, basePlacements, rateByResource, optionCalendars)
    if (!run.feasible) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'Option is infeasible', ERROR_CODES.WHATIF_INFEASIBLE)

    const startedAt = new Date()
    const horizonStartMs = Math.min(...run.placements.map((p) => p.plannedStartMs))
    const horizonEndMs = Math.max(...run.placements.map((p) => p.plannedEndMs))
    const optimizerRun = await this.repo.createRun({
      tenantId,
      plantId,
      trigger: 'what_if',
      objectiveSummary: `what-if apply: ${optionId}`,
      status: 'success',
      stopReason: `applied option ${optionId} from what-if ${resultId} (by ${userId ?? 'system'})`,
      startedAt,
      finishedAt: new Date(),
      inputDemandCount: ctx.demand.length,
    })
    const version = await this.repo.createVersionWithOps(
      { tenantId, plantId, status: 'draft', horizonStart: new Date(horizonStartMs), horizonEnd: new Date(horizonEndMs), optimizerRunId: optimizerRun.id },
      run.placements.map((p) => ({
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
    return toScheduleVersionDto(version)
  }

  // --- change-set application (feasibility-honest) ----------------------------
  /** Apply each change to a deep copy of the items. Unknown refs → CHANGE_SET_INVALID. */
  private applyChangeSet(items: SequencerItem[], changeSet: ChangeSet): SequencerItem[] {
    let out = items.map((i) => ({ ...i, eligibleResourceIds: [...i.eligibleResourceIds] }))
    for (const change of changeSet.changes) {
      out = this.applyChange(out, change)
    }
    return out
  }

  private applyChange(items: SequencerItem[], change: Change): SequencerItem[] {
    switch (change.kind) {
      case 'demand_qty': {
        if (!items.some((i) => i.demandLineId === change.demandLineId)) {
          throw new AppException(HttpStatus.BAD_REQUEST, `Unknown demand line ${change.demandLineId}`, ERROR_CODES.CHANGE_SET_INVALID)
        }
        return items.map((i) => (i.demandLineId === change.demandLineId ? { ...i, qty: change.to } : i))
      }
      case 'demand_date': {
        const ms = new Date(change.to).getTime()
        if (Number.isNaN(ms)) throw new AppException(HttpStatus.BAD_REQUEST, 'Invalid demand_date', ERROR_CODES.CHANGE_SET_INVALID)
        if (!items.some((i) => i.demandLineId === change.demandLineId)) {
          throw new AppException(HttpStatus.BAD_REQUEST, `Unknown demand line ${change.demandLineId}`, ERROR_CODES.CHANGE_SET_INVALID)
        }
        return items.map((i) => (i.demandLineId === change.demandLineId ? { ...i, requiredDate: ms } : i))
      }
      // resource_window / overtime / material_arrival are option-level levers (handled by
      // option specs) and the material gate lives in the data — pass through unchanged.
      case 'resource_window':
      case 'overtime':
      case 'wear_remediation':
      case 'material_arrival':
        return items
    }
  }

  // --- option specs -----------------------------------------------------------
  /**
   * The candidate option set for a change-set, branched by **trigger**:
   * - **wear / prediction** (`wear_remediation`, or origin `prediction`) → the
   *   remediation set **service / defer / overtime** (defer = keep running on the
   *   *worn-but-up* line, valid here).
   * - **line down** (a bare `resource_window`, no wear) → **reroute / overtime** —
   *   **no defer** (the line is *down*; you can't keep running on it). Reroute drops
   *   the line and re-solves onto the rest (honestly infeasible if no alternative).
   * - anything else (demand change, …) → the sequencing trade-off set
   *   **balanced / protect-delivery / minimise-changeover**.
   */
  private optionSpecs(changeSet: ChangeSet, predicted: Map<string, number>): OptionSpec[] {
    const wearChanges = changeSet.changes.filter((c): c is Extract<Change, { kind: 'wear_remediation' }> => c.kind === 'wear_remediation')
    const windowChanges = changeSet.changes.filter((c): c is Extract<Change, { kind: 'resource_window' }> => c.kind === 'resource_window')
    const materialChanges = changeSet.changes.filter((c): c is Extract<Change, { kind: 'material_arrival' }> => c.kind === 'material_arrival')
    const isWear = changeSet.origin.type === 'prediction' || wearChanges.length > 0

    // Material gate (D36): the component-availability floor is already in the data, so both
    // options re-solve against it — wait (accept the gated plan; the cell idles until the
    // component arrives) vs re-sequence-around (run ungated work into the pre-arrival gap).
    // NO "expedite material" (deferred). Honest to the trigger, like wear→service/defer.
    if (materialChanges.length > 0) {
      return [
        { id: 'wait', labelKey: 'whatif.option.wait', overtimeHours: 0, itemTransform: (i) => i },
        { id: 'resequence', labelKey: 'whatif.option.resequence', overtimeHours: 0, itemTransform: (i) => i, policy: { readyFirst: true } },
      ]
    }

    // Wear / prediction remediation set: service / defer / overtime.
    if (isWear) {
      const downResources = [...wearChanges, ...windowChanges].map((c) => c.resourceId)
      const rid = downResources[0] ?? ''
      return [
        {
          id: 'service',
          labelKey: 'whatif.option.service',
          overtimeHours: 0,
          // Take every worn/windowed resource offline → re-solve; infeasible (honestly)
          // if that starves an operation with no other eligible resource.
          itemTransform: (items) => downResources.reduce((acc, r) => dropResource(acc, r), items),
        },
        {
          id: 'defer',
          labelKey: 'whatif.option.defer',
          overtimeHours: 0,
          itemTransform: (items) => items,
          overlayWrap: (base) => inflateCycle(base, rid, predicted),
        },
        { id: 'overtime', labelKey: 'whatif.option.overtime', overtimeHours: 8, itemTransform: (items) => items },
      ]
    }

    // Line-down set (a bare resource_window, no wear): reroute / overtime — no defer.
    // The down window is a **time-boxed closure** on the resource's calendar (applied to
    // every option via optionCalendars), so the sequencer reroutes to other eligible lines
    // or flows work around the window — honestly infeasible only if an op is fully starved.
    if (windowChanges.length > 0) {
      return [
        { id: 'reroute', labelKey: 'whatif.option.reroute', overtimeHours: 0, itemTransform: (items) => items },
        { id: 'overtime', labelKey: 'whatif.option.overtime', overtimeHours: 8, itemTransform: (items) => items },
      ]
    }

    return [
      { id: 'balanced', labelKey: 'whatif.option.balanced', overtimeHours: 0, itemTransform: (i) => i },
      {
        id: 'protect_delivery',
        labelKey: 'whatif.option.protectDelivery',
        overtimeHours: 0,
        itemTransform: (i) => i,
        policy: { expediteDemandLineIds: new Set(firmLineIds(changeSet)) },
      },
      {
        id: 'minimize_changeover',
        labelKey: 'whatif.option.minimizeChangeover',
        overtimeHours: 0,
        itemTransform: (i) => i,
        policy: { changeoverBonusAllFirmness: true },
      },
    ]
  }

  // --- running + scoring one option ------------------------------------------
  /**
   * Calendars for the option ("with the disruption") world — the base calendars plus any
   * `resource_window` (line-down) intervals applied as **time-boxed closures** so the
   * sequencer flows work around the down period (D-shift). No windows → the base calendars.
   */
  private async optionCalendars(tenantId: string, ctx: BaseContext, changeSet: ChangeSet): Promise<Map<string, WorkingCalendar>> {
    const windows = changeSet.changes.filter((c): c is Extract<Change, { kind: 'resource_window' }> => c.kind === 'resource_window')
    if (windows.length === 0) return ctx.resourceCalendars
    const extra = new Map<string, Array<[number, number]>>()
    for (const w of windows) {
      const from = Date.parse(w.downFrom)
      const to = Date.parse(w.downTo)
      if (Number.isFinite(from) && Number.isFinite(to) && to > from) {
        const arr = extra.get(w.resourceId) ?? []
        arr.push([from, to])
        extra.set(w.resourceId, arr)
      }
    }
    return this.scheduling.resolveResourceCalendars(tenantId, [...ctx.resourceById.values()], extra)
  }

  private runOption(
    spec: OptionSpec,
    changed: SequencerItem[],
    baseOverlay: ResolveEffective,
    basePlacements: Placement[],
    rateByResource: Map<string, ResourceRate>,
    resourceCalendars: Map<string, WorkingCalendar>,
  ): { spec: OptionSpec; feasible: boolean; infeasibleReasonKey: string | null; scored: ScoredPlan | null; placements: Placement[] } {
    const items = spec.itemTransform(changed)
    const starved = items.find((i) => i.eligibleResourceIds.length === 0)
    if (starved) {
      return { spec, feasible: false, infeasibleReasonKey: 'whatif.infeasible.noResource', scored: null, placements: [] }
    }
    const overlay = spec.overlayWrap ? spec.overlayWrap(baseOverlay) : baseOverlay
    // The overtime option grants the day's OT budget so placement may run past shift-end
    // into closed time — the requested hours, clamped to each resource's policy ceiling
    // (otCeilingMinutes). A normal solve spends none; this is the lever that opts in (D-shift).
    const cals =
      spec.overtimeHours > 0
        ? new Map([...resourceCalendars].map(([id, c]) => [id, { ...c, otCapMinutes: Math.min(spec.overtimeHours * 60, c.otCeilingMinutes) }]))
        : resourceCalendars
    const placements = sequence(items, overlay, spec.policy, cals).placements
    const scored = scorePlan(placements, { rateByResource, basePlacements, overtimeHours: spec.overtimeHours })
    return { spec, feasible: true, infeasibleReasonKey: null, scored, placements }
  }

  // --- assembling options + comparatives + rationale --------------------------
  private buildOptions(
    ranked: ReturnType<WhatIfService['runOption']>[],
  ): WhatIfOption[] {
    const feasible = ranked.filter((r) => r.feasible && r.scored)
    return ranked.map((r, idx) => {
      const rank = idx + 1
      if (!r.feasible || !r.scored) {
        return {
          id: r.spec.id,
          rank,
          labelKey: r.spec.labelKey,
          feasible: false,
          infeasibleReasonKey: r.infeasibleReasonKey,
          kpis: { otif: 0, costPerUnit: null, oee: null, lateOrders: 0, throughput: null, churn: null },
          score: Number.POSITIVE_INFINITY,
          rationale: emptyRationale(r.spec.id),
        }
      }
      const comparatives = this.comparatives(r, feasible)
      const rationale: StructuredRationale = {
        schemaVersion: RATIONALE_SCHEMA_VERSION,
        weightSetVersion: WEIGHT_SET_VERSION,
        optionId: r.spec.id,
        score: r.scored.score,
        headlineKey: 'whatif.headline.option',
        headlineParams: {
          label: r.spec.labelKey,
          lateOrders: r.scored.kpis.lateOrders,
          costPerUnit: r.scored.kpis.costPerUnit ?? 0,
        },
        factors: r.scored.factors,
        constraints: r.scored.constraints,
        comparatives,
      }
      return {
        id: r.spec.id,
        rank,
        labelKey: r.spec.labelKey,
        feasible: true,
        infeasibleReasonKey: null,
        kpis: r.scored.kpis,
        score: r.scored.score,
        rationale,
      }
    })
  }

  /** Why this option beats/loses each other feasible option — computed once, queryable later. */
  private comparatives(
    self: ReturnType<WhatIfService['runOption']>,
    feasible: ReturnType<WhatIfService['runOption']>[],
  ): OptionComparative[] {
    if (!self.scored) return []
    const out: OptionComparative[] = []
    for (const other of feasible) {
      if (other.spec.id === self.spec.id || !other.scored) continue
      const deltaScore = Number((self.scored.score - other.scored.score).toFixed(4))
      const deciding = factorDeltas(self.scored.factors, other.scored.factors)
      out.push({
        vsOptionId: other.spec.id,
        deltaScore,
        verdict: dominanceVerdict(self.scored.factors, other.scored.factors),
        decidingFactors: deciding,
      })
    }
    return out
  }

  // --- helpers ----------------------------------------------------------------
  private rates(resourceById: Map<string, { setupCost: number | null; runCostPerHour: number | null; overheadPerUnit: number | null }>): Map<string, ResourceRate> {
    const out = new Map<string, ResourceRate>()
    for (const [id, r] of resourceById) {
      out.set(id, {
        setupCost: r.setupCost ?? 0,
        runCostPerHour: r.runCostPerHour ?? 0,
        overheadPerUnit: r.overheadPerUnit ?? 0,
      })
    }
    return out
  }

  /** Predicted cycle per `resource::op` for the "defer" (keep-running-worn) option. */
  private async predictedCycles(tenantId: string, changeSet: ChangeSet): Promise<Map<string, number>> {
    const wear = changeSet.changes.find((c) => c.kind === 'wear_remediation' || c.kind === 'resource_window')
    const rid = wear?.kind === 'wear_remediation' ? wear.resourceId : wear?.kind === 'resource_window' ? wear.resourceId : null
    const map = new Map<string, number>()
    if (!rid) return map
    for (const p of await this.learning.listPredictions(tenantId)) {
      if (p.resourceId === rid && p.param === 'cycle') map.set(`${p.resourceId}::${p.routingOperationId}`, p.predictedValue)
    }
    return map
  }

  private determinismKey(baseVersionId: string, changeSet: ChangeSet, items: SequencerItem[], overlay: ResolveEffective): string {
    const overlayDigest = items
      .flatMap((i) => i.eligibleResourceIds.map((rid) => {
        const e = overlay(i.routingOperationId, rid, i.setupTime, i.cycleTime)
        return `${i.demandLineId}:${i.routingOperationId}:${rid}:${e.setupTime}:${e.cycleTime}`
      }))
      .sort()
    const canonical = JSON.stringify({
      baseVersionId,
      changeSet,
      items: items.map((i) => ({
        d: i.demandLineId, o: i.routingOperationId, q: i.qty, r: i.requiredDate, f: i.firmness, e: i.eligibleResourceIds, c: i.changeoverValue,
      })),
      overlayDigest,
      weights: WEIGHT_SET_VERSION,
      engine: ENGINE_VERSION,
    })
    return createHash('sha256').update(canonical).digest('hex')
  }

  private toDto(
    id: string,
    plantId: string,
    baseVersionId: string,
    changeSet: ChangeSet,
    baseKpis: WhatIfResultDto['baseKpis'],
    options: WhatIfOption[],
    recommendedOptionId: string | null,
    determinismKey: string,
    createdAt: Date,
  ): WhatIfResultDto {
    return { id, plantId, baseVersionId, changeSet, baseKpis, options, recommendedOptionId, determinismKey, createdAt: createdAt.toISOString() }
  }
}

// --- pure item/overlay transforms --------------------------------------------
/** Take a resource offline (service window): drop it from every op's eligible set. */
function dropResource(items: SequencerItem[], resourceId: string): SequencerItem[] {
  return items.map((i) => ({ ...i, eligibleResourceIds: i.eligibleResourceIds.filter((r) => r !== resourceId) }))
}

/** Keep running worn: inflate the resource's cycle to its predicted value (ml_predicted). */
function inflateCycle(base: ResolveEffective, resourceId: string, predicted: Map<string, number>): ResolveEffective {
  return (opId, resId, stdSetup, stdCycle) => {
    const eff = base(opId, resId, stdSetup, stdCycle)
    if (resId !== resourceId) return eff
    const pv = predicted.get(`${resId}::${opId}`)
    if (pv == null || pv <= eff.cycleTime) return eff
    return { ...eff, cycleTime: pv, cycleSource: 'ml_predicted' }
  }
}

function firmLineIds(changeSet: ChangeSet): string[] {
  return changeSet.changes
    .filter((c): c is Extract<Change, { demandLineId: string }> => 'demandLineId' in c)
    .map((c) => c.demandLineId)
}

/** Top-2 factors by absolute contribution difference (the deciding factors). */
function factorDeltas(a: RationaleFactor[], b: RationaleFactor[]): OptionComparative['decidingFactors'] {
  const byKeyB = new Map(b.map((f) => [f.key, f]))
  return a
    .map((f) => ({ key: f.key, delta: Number((f.contribution - (byKeyB.get(f.key)?.contribution ?? 0)).toFixed(4)) }))
    .filter((d) => d.delta !== 0)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
    .slice(0, 2)
}

/** Dominance: preferred if ≤ on all factors (some <); dominated if ≥ on all (some >); else tradeoff. */
function dominanceVerdict(a: RationaleFactor[], b: RationaleFactor[]): OptionComparative['verdict'] {
  const byKeyB = new Map(b.map((f) => [f.key, f.contribution]))
  let anyLess = false
  let anyMore = false
  for (const f of a) {
    const other = byKeyB.get(f.key) ?? 0
    if (f.contribution < other) anyLess = true
    if (f.contribution > other) anyMore = true
  }
  if (anyLess && !anyMore) return 'preferred'
  if (anyMore && !anyLess) return 'dominated'
  return 'tradeoff'
}

function emptyRationale(optionId: string): StructuredRationale {
  return {
    schemaVersion: RATIONALE_SCHEMA_VERSION,
    weightSetVersion: WEIGHT_SET_VERSION,
    optionId,
    score: Number.POSITIVE_INFINITY,
    headlineKey: 'whatif.headline.infeasible',
    headlineParams: {},
    factors: [],
    constraints: [],
    comparatives: [],
  }
}
