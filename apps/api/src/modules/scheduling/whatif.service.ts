import { createHash } from 'node:crypto'
import { HttpStatus, Injectable } from '@nestjs/common'
import {
  type Change,
  type ChangeSet,
  type LearningReadContract,
  type ObjectiveWeights,
  type OptionComparative,
  type RationaleFactor,
  type RequestedChange,
  type ResourceDowntimeDto,
  type ScheduleVersionDto,
  type StructuredRationale,
  type WhatIfOption,
  type WhatIfResultDto,
  type WhatIfUnremediable,
} from '@perduraflow/contracts'
import { Inject } from '@nestjs/common'
import { AppException, ERROR_CODES } from '../../common/exceptions/app.exception'
import { LEARNING_READ } from '../learning/learning-read.service'
import { toScheduleVersionDto } from './scheduling.mapper'
import { SchedulingRepository } from './scheduling.repository'
import { SchedulingService, type BaseContext } from './scheduling.service'
import { sequence, type Placement, type ResolveEffective, type ResolveOperator, type SequencePolicy, type SequencerItem } from './sequencer'
import { buildLatenessChain, type LatenessOp } from './lateness'
import type { WorkingCalendar } from './working-calendar'
import { placementSignature } from './whatif.signature'
import { scorePlan, type ResourceRate, type ScoredPlan } from './whatif.scoring'
import { pickFasterOperator, type OperatorRosterEntry } from './whatif.operator-lever'
import { ENGINE_VERSION, RATIONALE_SCHEMA_VERSION, WEIGHT_SET_VERSION } from './whatif.weights'

/**
 * The result of a goal-seek (decide-support, resource-scoped). Overtime on a resource is judged
 * against the firm at-risk of the work THAT RESOURCE carries — not plant-wide (a single-resource
 * lever can't clear a material gate or a different line's bottleneck, so a plant-wide predicate
 * wrongly returns "not achievable"). Outcomes:
 *  - `achieved`    — `hours` = the minimal OT that clears R's firm at-risk; `resultId` is appliable.
 *  - `already_clear` — nothing is firm-at-risk anywhere.
 *  - `elsewhere`   — R carries no firm at-risk; the late firm work is on other resources (named) —
 *                    OT on R can't change it. (More useful than a bare "not achievable".)
 *  - `unachievable`— R carries firm at-risk that OT can't clear (capacity exhausted, or the cause
 *                    is material/upstream, not capacity — `reason` says which).
 * All fields engine-derived — never a model guess.
 */
export interface GoalSeekResult {
  outcome: 'achieved' | 'already_clear' | 'elsewhere' | 'unachievable'
  resourceName: string
  hours: number | null
  resultId: string | null
  baseFirmLateOnResource: number
  ceilingHours: number
  elsewhereResources?: string[]
  reason?: string
}

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
  /** Wrap the operator resolver (the faster-operator lever pins a faster operator on the contended line). */
  operatorWrap?: (base: ResolveOperator) => ResolveOperator
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
    const basePlacements = sequence(ctx.items, baseOverlay, undefined, ctx.resourceCalendars, ctx.resolveOperator, ctx.minBatchByResource).placements

    // Apply the change-set to the items (feasibility-honest).
    const changed = this.applyChangeSet(ctx.items, changeSet)
    const rateByResource = this.rates(ctx.resourceById)
    const predicted = await this.predictedCycles(tenantId, changeSet)
    const optionCalendars = await this.optionCalendars(tenantId, ctx, changeSet)
    const givenOt = this.givenOvertimeHours(ctx, changeSet)
    const requestedChanges = this.buildLedger(ctx, changeSet)

    const specs = this.optionSpecs(changeSet, predicted, ctx.items, basePlacements, ctx)
    const evaluated = specs.map((spec) =>
      this.runOption(spec, changed, baseOverlay, basePlacements, rateByResource, optionCalendars, ctx.resolveOperator, ctx.minBatchByResource, givenOt, ctx.weights, ctx.downtimeByResource),
    )

    // NOTE: all-options-infeasible no longer throws here — it flows through to a stored result whose
    // `toDto` derives the honest-unachievable `unremediable` outcome (Decision 2/3: a graceful structured
    // verdict on every path, never a dead-end error). `feasible` below = options with a PLAN (not starved)
    // — used only to collapse identical placements; the stricter SELECTABLE predicate (a plan that RUNS)
    // is applied in `toDto`, so cached + fresh results transform identically (no engine bump).
    const feasible = evaluated.filter((e) => e.feasible)

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

    const baseKpis = scorePlan(basePlacements, { rateByResource, basePlacements, overtimeHours: 0, weights: ctx.weights }).kpis
    const targetDemandLineId = changeSet.changes.find((c) => c.kind === 'at_risk_remediation')?.demandLineId ?? null
    const options = this.buildOptions(ranked, ctx.weightSetVersion, targetDemandLineId)
    const recommendedOptionId = options.find((o) => o.feasible)?.id ?? null
    const determinismKey = this.determinismKey(committed, changeSet, changed, baseOverlay, ctx.weightSetVersion, ctx.downtime, ctx.baseInputsDigest)

    const prior = await this.repo.findWhatIfByDeterminismKey(tenantId, determinismKey)
    if (prior) {
      return this.toDto(prior.id, plantId, committed, changeSet, prior.baseKpis, prior.options as WhatIfOption[], determinismKey, prior.createdAt, requestedChanges)
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
    return this.toDto(row.id, plantId, committed, changeSet, baseKpis, options, determinismKey, row.createdAt, requestedChanges)
  }

  /**
   * Goal-seek (decide-support, grounded by construction): find the **minimal overtime hours** on a
   * resource that **clears the firm at-risk** — the ENGINE searches, the caller never picks the
   * value. A discrete ascending scan over the resource's OT range (config ceiling), each candidate
   * run through the real `sequence()` and checked for firm-lateness; the first that clears is the
   * minimum (the prior candidate, implicitly, does not — the two-sided minimality). When found, a
   * real `evaluate()` at that value produces a persisted, **appliable** result. Bounded + honest:
   * if no value within the OT ceiling clears it, returns `achieved:false` with the grounded reason —
   * never a fabricated out-of-bounds value. Deterministic (D2): same plant+resource → same value.
   * @throws WHATIF_INFEASIBLE the base plan can't be scheduled
   */
  async goalSeek(tenantId: string, plantId: string, resourceId: string, userId: string | null): Promise<GoalSeekResult> {
    const ctx = await this.scheduling.buildBaseContext(tenantId, plantId)
    if (ctx.infeasibleReason) throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ctx.infeasibleReason, ERROR_CODES.WHATIF_INFEASIBLE)
    const resourceName = ctx.resourceById.get(resourceId)?.name ?? resourceId
    const ceilingHours = (ctx.resourceCalendars.get(resourceId)?.otCeilingMinutes ?? 0) / 60
    const overlay = await this.scheduling.buildLearnedOverlay(tenantId, ctx.items)
    // Firm-late placements (firm-lateness dominance, D13 — forecast lateness is acceptable). The
    // predicate is RESOURCE-SCOPED: count only the firm-late work ON this resource, since adding R's
    // overtime can only affect R's own work.
    const firmLatePlacements = (cals: Map<string, WorkingCalendar>) =>
      sequence(ctx.items, overlay, undefined, cals, ctx.resolveOperator, ctx.minBatchByResource).placements.filter((p) => p.firmness === 'firm' && p.atRisk)
    const onR = (p: Placement) => p.resourceId === resourceId

    const baseFirmLate = firmLatePlacements(ctx.resourceCalendars)
    const baseOnR = baseFirmLate.filter(onR)

    // Nothing at risk anywhere → already clear.
    if (baseFirmLate.length === 0) return { outcome: 'already_clear', resourceName, hours: 0, resultId: null, baseFirmLateOnResource: 0, ceilingHours }
    // The at-risk is elsewhere — OT on R can't touch it. Name where the binding work is (more useful
    // than a bare "not achievable").
    if (baseOnR.length === 0) {
      const elsewhereResources = [...new Set(baseFirmLate.map((p) => ctx.resourceById.get(p.resourceId)?.name ?? p.resourceId))]
      return { outcome: 'elsewhere', resourceName, hours: null, resultId: null, baseFirmLateOnResource: 0, ceilingHours, elsewhereResources, reason: `no firm at-risk runs on ${resourceName}; the late firm work is on ${elsewhereResources.join(', ')}` }
    }
    if (ceilingHours <= 0) return { outcome: 'unachievable', resourceName, hours: null, resultId: null, baseFirmLateOnResource: baseOnR.length, ceilingHours, reason: `${resourceName} has no overtime allowance` }

    const withOt = (h: number): Map<string, WorkingCalendar> =>
      new Map([...ctx.resourceCalendars].map(([id, c]) => (id === resourceId ? [id, { ...c, otCapMinutes: Math.min(h * 60, c.otCeilingMinutes) }] : [id, c])))

    // Discrete ascending scan over the OT range (1h steps + the fractional ceiling). Small range →
    // a scan is correct and cheap; no monotonicity assumption (binary search would need one). The
    // first achieving value is the minimum (the prior step, by construction, did not clear it).
    const steps: number[] = []
    for (let h = 1; h <= Math.floor(ceilingHours); h++) steps.push(h)
    if (!Number.isInteger(ceilingHours)) steps.push(ceilingHours)

    for (const h of steps) {
      if (firmLatePlacements(withOt(h)).filter(onR).length === 0) {
        const res = await this.evaluate(tenantId, plantId, { origin: { type: 'manual' }, changes: [{ kind: 'overtime', resourceId, hours: h }] }, undefined, userId)
        return { outcome: 'achieved', resourceName, hours: h, resultId: res.id, baseFirmLateOnResource: baseOnR.length, ceilingHours }
      }
    }
    // R's own firm at-risk can't be cleared by OT. If it's all material/precedence-gated, the cause
    // is upstream, not capacity — say so (OT genuinely can't help); else capacity is exhausted.
    const reasons = new Set(baseOnR.map((p) => p.atRiskReason))
    const nonCapacity = [...reasons].every((r) => r === 'material' || r === 'precedence')
    const reason = nonCapacity
      ? `the firm at-risk on ${resourceName} is gated by ${reasons.has('material') ? 'material availability' : 'an upstream step'}, not capacity — overtime can't clear it`
      : `even ${ceilingHours}h overtime on ${resourceName} does not clear its firm at-risk`
    return { outcome: 'unachievable', resourceName, hours: null, resultId: null, baseFirmLateOnResource: baseOnR.length, ceilingHours, reason }
  }

  /**
   * Fetch a stored what-if result — the phase-6 substrate read (rationale answers
   * "why not X / what drove the cost" without re-running the engine, DoD proof #8).
   * @throws WHATIF_RESULT_NOT_FOUND
   */
  async get(tenantId: string, id: string): Promise<WhatIfResultDto> {
    const row = await this.repo.findWhatIfResult(tenantId, id)
    if (!row) throw new AppException(HttpStatus.NOT_FOUND, 'What-if result not found', ERROR_CODES.WHATIF_RESULT_NOT_FOUND)
    // The persisted read returns a basic ledger (raw summaries) — the rich applied/clamped ledger
    // is computed and surfaced at evaluation time (the conversation echo); no consumer needs to
    // re-derive it on read, so this avoids rebuilding the full base context per what-if GET.
    return this.toDto(row.id, row.plantId, row.baseVersionId, row.changeSet as ChangeSet, row.baseKpis as WhatIfResultDto['baseKpis'], row.options as WhatIfOption[], row.determinismKey, row.createdAt, basicLedger(row.changeSet as ChangeSet))
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
    const basePlacements = sequence(ctx.items, baseOverlay, undefined, ctx.resourceCalendars, ctx.resolveOperator, ctx.minBatchByResource).placements
    const changed = this.applyChangeSet(ctx.items, changeSet)
    const rateByResource = this.rates(ctx.resourceById)
    const predicted = await this.predictedCycles(tenantId, changeSet)
    const optionCalendars = await this.optionCalendars(tenantId, ctx, changeSet)

    const spec = this.optionSpecs(changeSet, predicted, ctx.items, basePlacements, ctx).find((s) => s.id === optionId)
    if (!spec) throw new AppException(HttpStatus.NOT_FOUND, 'Option not found', ERROR_CODES.WHATIF_OPTION_NOT_FOUND)
    const run = this.runOption(spec, changed, baseOverlay, basePlacements, rateByResource, optionCalendars, ctx.resolveOperator, ctx.minBatchByResource, this.givenOvertimeHours(ctx, changeSet), ctx.weights, ctx.downtimeByResource)
    // Apply guard (correctness, not UX): you can never commit a plan you can't run — starved (no plan)
    // OR window-overflow (a firm op can't be placed). The offer-filter hides these; this rejects them
    // even via a stale/crafted optionId. Same predicate as `isSelectable`, on the freshly re-run plan.
    if (!run.feasible || (run.scored?.kpis.infeasibleFirmOps ?? 0) > 0)
      throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, 'Option does not produce a runnable plan', ERROR_CODES.WHATIF_INFEASIBLE)

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
        // Persist the causal-chain binding the sequencer computed (mirror solve()) — without this the
        // applied plan's at-risk orders have no lateness chain (binding_kind null → buildLatenessChain
        // returns null). With it, applied/committed plans trace the same as solved ones.
        bindingKind: p.bindingKind,
        bindingBlockerDemandLineId: p.bindingBlockerDemandLineId,
        bindingBlockerOpSeq: p.bindingBlockerOpSeq,
        bindingDowntimeId: p.bindingDowntimeId,
        bindingOperatorId: p.bindingOperatorId,
      })),
    )
    // Faster-operator lever: the placements above already run the faster operator, but that's only in
    // THIS version — a later fresh solve would revert to the slow operator and re-break the order. So
    // persist the assignment too, bounding it to the op window, so who-runs-the-line sticks (and the
    // committed plan's lane shows the faster operator, matching its cycle times). Recomputed from the
    // same (changeSet, ctx, basePlacements) → the same candidate the evaluated option scored. The
    // candidate was already vetted (present, same-plant, faster, not double-booked) at selection.
    if (optionId === 'faster_operator') {
      const targets = this.fasterOperatorTargets(changeSet, ctx, basePlacements)
      for (const [resourceId, t] of targets ?? []) {
        await this.repo.setResourceOperatorAssignment(
          tenantId,
          plantId,
          resourceId,
          t.candidate.id,
          new Date(t.windowFromMs),
          new Date(t.windowToMs),
        )
      }
    }
    // Auto-reap prior uncommitted drafts (same as solve) so applying options doesn't accumulate
    // stale drafts in the version list — keep only this newest draft. Committed/superseded untouched.
    await this.repo.discardDraftsForPlant(tenantId, plantId, version.id)
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
      // resource_window / line_down / overtime / material_arrival / at_risk_remediation are
      // option-level levers (handled by option specs — the reroute family's targeted re-routing of the
      // at-risk order happens in the option's itemTransform, not here) and the material gate lives in
      // the data — pass through unchanged.
      case 'resource_window':
      case 'line_down':
      case 'overtime':
      case 'wear_remediation':
      case 'material_arrival':
      case 'at_risk_remediation':
        return items
    }
  }

  // --- standing at-risk reroute (order-scoped) --------------------------------
  /**
   * For an `at_risk_remediation` change, the per-op contended resource the reroute family should move
   * the at-risk order OFF — but ONLY for a firm at-risk op whose causal chain roots at reroutable
   * **capacity contention** AND whose op is **multi-eligible** (an alternative line exists). Returns a
   * `${demandLineId}:${opSeq}` → contended-resourceId map, or null when no such op exists.
   *
   * Null ⇒ the reroute family is NOT emitted (honest-unavailable): a `material` root → expedite, a
   * `due_before_start` root → renegotiate (structurally unfixable), a `resource_downtime` root is the
   * line-down condition flow (not standing), and a single-eligible op can't be rerouted at all. Built
   * from the committed base plan (`basePlacements`) so it matches the causal chain the planner sees.
   * Pure given (changeSet, items, basePlacements).
   */
  private standingRerouteTarget(changeSet: ChangeSet, items: SequencerItem[], basePlacements: Placement[]): Map<string, string> | null {
    const targetLines = new Set(
      changeSet.changes.filter((c): c is Extract<Change, { kind: 'at_risk_remediation' }> => c.kind === 'at_risk_remediation').map((c) => c.demandLineId),
    )
    if (targetLines.size === 0) return null

    // opByKey over ALL placements (the chain walk follows blockers across orders). Minimal lookups —
    // only the chain ROOT is needed, which depends on binding kinds + at-risk state, not names/detail.
    const opByKey = new Map<string, LatenessOp>(basePlacements.map((p) => [`${p.demandLineId}:${p.opSeq}`, p]))
    const lk = { resourceName: (id: string) => id, partNo: (id: string) => id, materialComponent: () => null, downtime: () => null, operator: () => null }
    const eligByKey = new Map<string, string[]>(items.map((i) => [`${i.demandLineId}:${i.opSeq}`, i.eligibleResourceIds]))

    const drop = new Map<string, string>()
    for (const p of basePlacements) {
      if (!targetLines.has(p.demandLineId) || p.firmness !== 'firm' || !p.atRisk) continue
      const chain = buildLatenessChain(p, opByKey, lk)
      if (!chain || chain.root !== 'capacity') continue // reroutable contention only — NOT material/due/downtime
      const elig = eligByKey.get(`${p.demandLineId}:${p.opSeq}`) ?? []
      if (elig.length <= 1) continue // single-eligible: no alternative line → reroute impossible
      drop.set(`${p.demandLineId}:${p.opSeq}`, p.resourceId)
    }
    return drop.size > 0 ? drop : null
  }

  // --- faster-operator lever (order-scoped, Part B) ---------------------------
  /**
   * For an `at_risk_remediation` change, the contended resources to put a FASTER operator on — but ONLY
   * where a firm at-risk op's lateness ROOTS at the operator (Part A's `operator` binding: a slow operator
   * inflated the run so it finishes late, where at STANDARD it would be on time) AND a faster, present,
   * same-plant, un-double-booked operator actually exists. Returns `resourceId → candidate` (+ the op
   * window the apply path assigns over), or null when no such op/candidate exists (honest-unavailable →
   * the faster-operator option is simply not offered). Deterministic given (changeSet, ctx, basePlacements)
   * so `evaluate` and `applyOption` pick the SAME candidate. Mirrors {@link standingRerouteTarget}, but the
   * `operator` root is terminal (the op itself), so it needs no chain walk.
   */
  private fasterOperatorTargets(
    changeSet: ChangeSet,
    ctx: BaseContext,
    basePlacements: Placement[],
  ): Map<string, { candidate: OperatorRosterEntry; windowFromMs: number; windowToMs: number }> | null {
    const targetLines = new Set(
      changeSet.changes.filter((c): c is Extract<Change, { kind: 'at_risk_remediation' }> => c.kind === 'at_risk_remediation').map((c) => c.demandLineId),
    )
    if (targetLines.size === 0) return null

    const roster: OperatorRosterEntry[] = ctx.operators.map((o) => ({
      id: o.id,
      name: o.name,
      homePlantId: o.homePlantId,
      performanceFactor: o.performanceFactor,
      laborRate: o.laborRate,
      available: o.available,
      isActive: o.isActive,
    }))
    const assignments = ctx.operatorAssignments.map((a) => ({
      resourceId: a.resourceId,
      operatorId: a.operatorId,
      effectiveFromMs: a.effectiveFrom?.getTime() ?? null,
      effectiveToMs: a.effectiveTo?.getTime() ?? null,
    }))

    const targets = new Map<string, { candidate: OperatorRosterEntry; windowFromMs: number; windowToMs: number }>()
    for (const p of basePlacements) {
      if (!targetLines.has(p.demandLineId) || p.firmness !== 'firm' || !p.atRisk || p.bindingKind !== 'operator') continue
      if (targets.has(p.resourceId)) continue // one candidate per contended line
      const plantId = ctx.resourceById.get(p.resourceId)?.plantId
      if (!plantId) continue
      const currentFactor = ctx.resolveOperator(p.resourceId, p.plannedStartMs)?.performanceFactor ?? 1
      const candidate = pickFasterOperator({
        resourceId: p.resourceId,
        plantId,
        windowFromMs: p.plannedStartMs,
        windowToMs: p.plannedEndMs,
        currentFactor,
        roster,
        assignments,
      })
      if (candidate) targets.set(p.resourceId, { candidate, windowFromMs: p.plannedStartMs, windowToMs: p.plannedEndMs })
    }
    return targets.size > 0 ? targets : null
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
   * - **standing at-risk** (`at_risk_remediation`, no injected disruption) whose order's chain roots
   *   at reroutable capacity contention on a multi-eligible op → **reroute / overtime** (the reroute
   *   moves that order off its contended line via a targeted eligibility transform). Composes with the
   *   base trade-offs below (protect-delivery = expedite is also a valid lever here).
   * - anything else (demand change, …) → the sequencing trade-off set
   *   **balanced / protect-delivery / minimise-changeover**.
   */
  private optionSpecs(changeSet: ChangeSet, predicted: Map<string, number>, items: SequencerItem[], basePlacements: Placement[], ctx: BaseContext): OptionSpec[] {
    const wearChanges = changeSet.changes.filter((c): c is Extract<Change, { kind: 'wear_remediation' }> => c.kind === 'wear_remediation')
    const windowChanges = changeSet.changes.filter((c): c is Extract<Change, { kind: 'resource_window' }> => c.kind === 'resource_window')
    // `line_down` = the persisted-window line-down (the closure is already in base calendars); it selects
    // the SAME reroute/overtime family as a hypothetical `resource_window`, but injects no closure here.
    const lineDownChanges = changeSet.changes.filter((c): c is Extract<Change, { kind: 'line_down' }> => c.kind === 'line_down')
    const materialChanges = changeSet.changes.filter((c): c is Extract<Change, { kind: 'material_arrival' }> => c.kind === 'material_arrival')
    const demandChanges = changeSet.changes.filter((c) => c.kind === 'demand_qty' || c.kind === 'demand_date')
    const isWear = changeSet.origin.type === 'prediction' || wearChanges.length > 0
    const isLineDown = windowChanges.length > 0 || lineDownChanges.length > 0
    const downResources = [...wearChanges, ...windowChanges, ...lineDownChanges].map((c) => c.resourceId)
    const rid = downResources[0] ?? ''
    // Standing at-risk reroute target (order-scoped) — only computed in the no-injected-disruption
    // case, so a real condition's reroute (above) is never double-emitted. Null ⇒ not reroutable.
    const rerouteDrop = !isWear && !isLineDown ? this.standingRerouteTarget(changeSet, items, basePlacements) : null
    const isStandingReroute = rerouteDrop !== null
    // Faster-operator lever (Part B): a standing at-risk order rooted at a slow operator → offer a faster
    // operator on the contended line. Same no-injected-disruption gate as reroute; null ⇒ not offered.
    const operatorTargets = !isWear && !isLineDown ? this.fasterOperatorTargets(changeSet, ctx, basePlacements) : null

    // ADDITIVE (conversation Pass A): a compound change-set composes the option families of
    // EVERY trigger it spans instead of collapsing to one. The change EFFECTS are GIVENS applied
    // to every option — demand mutations (applyChangeSet), window closures + explicit overtime
    // (optionCalendars) — and the remediation MENU below is the de-duplicated UNION of the
    // families the present triggers imply, each evaluated against that full given-world. (Identical
    // plans collapse downstream by placement signature, so a redundant union member self-prunes.)
    const specs: OptionSpec[] = []
    const seen = new Set<string>()
    const add = (s: OptionSpec): void => {
      if (!seen.has(s.id)) {
        seen.add(s.id)
        specs.push(s)
      }
    }

    // Material gate (D36): wait (accept the gated plan) vs re-sequence-around (fill the gap).
    // NO "expedite material" (deferred). Honest to the trigger.
    if (materialChanges.length > 0) {
      add({ id: 'wait', labelKey: 'whatif.option.wait', overtimeHours: 0, itemTransform: (i) => i })
      add({ id: 'resequence', labelKey: 'whatif.option.resequence', overtimeHours: 0, itemTransform: (i) => i, policy: { readyFirst: true } })
    }
    // Wear / prediction remediation: service / defer / overtime.
    if (isWear) {
      // Take every worn/windowed resource offline → re-solve; honestly infeasible if that
      // starves an op with no other eligible resource.
      add({ id: 'service', labelKey: 'whatif.option.service', overtimeHours: 0, itemTransform: (items) => downResources.reduce((acc, r) => dropResource(acc, r), items) })
      add({ id: 'defer', labelKey: 'whatif.option.defer', overtimeHours: 0, itemTransform: (items) => items, overlayWrap: (base) => inflateCycle(base, rid, predicted) })
      add({ id: 'overtime', labelKey: 'whatif.option.overtime', overtimeHours: 8, itemTransform: (items) => items })
    } else if (isLineDown) {
      // Line down — reroute / overtime — no defer (the line is down). The closure that displaces work
      // lives in the calendars (a hypothetical `resource_window` adds it in optionCalendars; a persisted
      // `line_down` already has it in the base), so the sequencer flows around the down period either way.
      add({ id: 'reroute', labelKey: 'whatif.option.reroute', overtimeHours: 0, itemTransform: (items) => items })
      add({ id: 'overtime', labelKey: 'whatif.option.overtime', overtimeHours: 8, itemTransform: (items) => items })
    } else if (isStandingReroute) {
      // Standing at-risk reroute — no closure here (the line isn't down, just saturated), so an identity
      // reroute would reproduce the base plan. Instead, drop the contended resource from the at-risk
      // order's binding op so the sequencer must place it on an alternative line (a genuine reroute →
      // a distinct plan). Overtime composes (add hours on the contended line instead of moving the work).
      add({
        id: 'reroute',
        labelKey: 'whatif.option.reroute',
        overtimeHours: 0,
        itemTransform: (items) =>
          items.map((i) => {
            const contended = rerouteDrop!.get(`${i.demandLineId}:${i.opSeq}`)
            return contended ? { ...i, eligibleResourceIds: i.eligibleResourceIds.filter((r) => r !== contended) } : i
          }),
      })
      add({ id: 'overtime', labelKey: 'whatif.option.overtime', overtimeHours: 8, itemTransform: (items) => items })
    }
    // Operator-rooted at-risk (a slow operator inflated the run) → the FULL cross-lever menu, all scored
    // on real $ (wi-12 folds operator labor into cost, so they compare honestly):
    //  - faster_operator: put a faster candidate on the contended line (overlay → re-solve). Adds the
    //    candidate's LABOR but shortens the run.
    //  - overtime: keep the slow operator, buy hours to finish on time (OT cost, already scored).
    //  - reroute: move the slow op to a faster eligible line (only if multi-eligible — else not offered).
    if (operatorTargets) {
      add({
        id: 'faster_operator',
        labelKey: 'whatif.option.fasterOperator',
        overtimeHours: 0,
        itemTransform: (items) => items,
        operatorWrap:
          (base) =>
          (resourceId, atMs) => {
            const t = operatorTargets.get(resourceId)
            return t ? { id: t.candidate.id, performanceFactor: t.candidate.performanceFactor, laborRate: t.candidate.laborRate } : base(resourceId, atMs)
          },
      })
      add({ id: 'overtime', labelKey: 'whatif.option.overtime', overtimeHours: 8, itemTransform: (items) => items })
      // Reroute the slow-operator op(s) off the contended line — only the multi-eligible ones (an
      // alternative line exists); the transform drops the contended resource so the sequencer re-places.
      const eligByKey = new Map<string, string[]>(items.map((i) => [`${i.demandLineId}:${i.opSeq}`, i.eligibleResourceIds]))
      const opReroute = new Map<string, string>()
      for (const p of basePlacements) {
        if (p.bindingKind !== 'operator' || p.firmness !== 'firm' || !p.atRisk || !operatorTargets.has(p.resourceId)) continue
        if ((eligByKey.get(`${p.demandLineId}:${p.opSeq}`) ?? []).length > 1) opReroute.set(`${p.demandLineId}:${p.opSeq}`, p.resourceId)
      }
      if (opReroute.size > 0) {
        add({
          id: 'reroute',
          labelKey: 'whatif.option.reroute',
          overtimeHours: 0,
          itemTransform: (items) =>
            items.map((i) => {
              const contended = opReroute.get(`${i.demandLineId}:${i.opSeq}`)
              return contended ? { ...i, eligibleResourceIds: i.eligibleResourceIds.filter((r) => r !== contended) } : i
            }),
        })
      }
    }
    // Base trade-off family: a demand change — or NO disruption at all — yields the sequencing
    // trade-off set. In a compound (e.g. "delay X and take line Y down") this composes WITH the
    // disruption menu above so neither the delay's rebalance nor the line-down coping is dropped.
    if (demandChanges.length > 0 || (materialChanges.length === 0 && !isWear && !isLineDown)) {
      add({ id: 'balanced', labelKey: 'whatif.option.balanced', overtimeHours: 0, itemTransform: (i) => i })
      add({ id: 'protect_delivery', labelKey: 'whatif.option.protectDelivery', overtimeHours: 0, itemTransform: (i) => i, policy: { expediteDemandLineIds: new Set(firmLineIds(changeSet)) } })
      add({ id: 'minimize_changeover', labelKey: 'whatif.option.minimizeChangeover', overtimeHours: 0, itemTransform: (i) => i, policy: { changeoverBonusAllFirmness: true } })
    }
    return specs
  }

  // --- running + scoring one option ------------------------------------------
  /**
   * Calendars for the option ("with the disruption") world — the base calendars plus any
   * `resource_window` (line-down) intervals applied as **time-boxed closures** so the
   * sequencer flows work around the down period (D-shift). No windows → the base calendars.
   */
  private async optionCalendars(tenantId: string, ctx: BaseContext, changeSet: ChangeSet): Promise<Map<string, WorkingCalendar>> {
    const windows = changeSet.changes.filter((c): c is Extract<Change, { kind: 'resource_window' }> => c.kind === 'resource_window')
    const overtimes = changeSet.changes.filter((c): c is Extract<Change, { kind: 'overtime' }> => c.kind === 'overtime')
    if (windows.length === 0 && overtimes.length === 0) return ctx.resourceCalendars

    // Window closures (line-down): time-boxed closed intervals on the resource's calendar.
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
    const cals =
      windows.length > 0
        ? await this.scheduling.resolveResourceCalendars(tenantId, [...ctx.resourceById.values()], extra)
        : new Map(ctx.resourceCalendars)

    // Explicit overtime is a GIVEN (conversation Pass A): grant the named resource its requested
    // OT budget — honored hours clamped to the resource's policy ceiling (otCeilingMinutes) — in
    // EVERY option, so a compounded "add Nh OT on R" is actually spendable by placement, not
    // silently dropped. (A resource with a 0 ceiling can't be granted any — surfaced in the ledger.)
    const otByResource = new Map<string, number>()
    for (const o of overtimes) otByResource.set(o.resourceId, Math.max(otByResource.get(o.resourceId) ?? 0, o.hours))
    for (const [resourceId, hours] of otByResource) {
      const c = cals.get(resourceId)
      if (!c) continue
      cals.set(resourceId, { ...c, otCapMinutes: Math.min(hours * 60, c.otCeilingMinutes) })
    }
    return cals
  }

  /**
   * Total honored explicit-overtime hours — each `overtime` change's hours clamped to its
   * resource's policy ceiling. This is the OT a compound STIPULATES and the engine actually
   * grants; used as the OT magnitude for scoring (factor + cost) so stipulated OT is costed,
   * not free. Separate from an option's own proposed OT (`spec.overtimeHours`).
   */
  private givenOvertimeHours(ctx: BaseContext, changeSet: ChangeSet): number {
    let total = 0
    for (const c of changeSet.changes) {
      if (c.kind !== 'overtime') continue
      const ceilingHours = (ctx.resourceCalendars.get(c.resourceId)?.otCeilingMinutes ?? 0) / 60
      total += Math.min(c.hours, ceilingHours)
    }
    return total
  }

  /**
   * The never-silently-drop ledger (conversation Pass A): for each requested change, a human
   * summary + whether the engine honored it. With additive specs + overtime-as-given every
   * well-formed change is `applied`; the residual honest cases are an overtime change `clamped`
   * to the resource ceiling (`partial`) or a resource with no OT allowance (`unapplied`). The
   * conversation renders a structure-derived echo from this — faithfulness the engine can prove.
   */
  private buildLedger(ctx: BaseContext, changeSet: ChangeSet): RequestedChange[] {
    const resName = (id: string): string => ctx.resourceById.get(id)?.name ?? id
    const orderRef = (lineId: string): string => {
      const d = ctx.demand.find((x) => x.demandLineId === lineId)
      return d?.releaseReference ? `${lineId} (${d.releaseReference})` : lineId
    }
    return changeSet.changes.map((c): RequestedChange => {
      switch (c.kind) {
        case 'demand_qty':
          return { kind: c.kind, summary: `set ${orderRef(c.demandLineId)} quantity to ${c.to}`, status: 'applied', note: null }
        case 'demand_date':
          return { kind: c.kind, summary: `move ${orderRef(c.demandLineId)} due date to ${shortDate(c.to)}`, status: 'applied', note: null }
        case 'resource_window':
          return { kind: c.kind, summary: `take ${resName(c.resourceId)} down ${shortDate(c.downFrom)}–${shortDate(c.downTo)}`, status: 'applied', note: null }
        case 'line_down': {
          // The situation, sourced from the persisted window in base (not re-applied here).
          const w = ctx.downtime.find((d) => d.resourceId === c.resourceId)
          const when = w ? ` ${shortDate(w.from)}–${shortDate(w.to)}` : ''
          return { kind: c.kind, summary: `${resName(c.resourceId)} down${when}`, status: 'applied', note: null }
        }
        case 'wear_remediation':
          return { kind: c.kind, summary: `${c.action} on ${resName(c.resourceId)}`, status: 'applied', note: null }
        case 'material_arrival':
          return { kind: c.kind, summary: `${c.componentPartId} arrives ${shortDate(c.availableAt)}`, status: 'applied', note: null }
        case 'at_risk_remediation':
          return { kind: c.kind, summary: `remediate at-risk ${orderRef(c.demandLineId)}`, status: 'applied', note: null }
        case 'overtime': {
          const ceilingHours = (ctx.resourceCalendars.get(c.resourceId)?.otCeilingMinutes ?? 0) / 60
          const summary = `add ${c.hours}h overtime on ${resName(c.resourceId)}`
          if (ceilingHours <= 0) return { kind: c.kind, summary, status: 'unapplied', note: `${resName(c.resourceId)} has no overtime allowance` }
          if (c.hours > ceilingHours) return { kind: c.kind, summary, status: 'partial', note: `clamped to ${ceilingHours}h — ${resName(c.resourceId)} overtime ceiling` }
          return { kind: c.kind, summary, status: 'applied', note: null }
        }
      }
    })
  }

  private runOption(
    spec: OptionSpec,
    changed: SequencerItem[],
    baseOverlay: ResolveEffective,
    basePlacements: Placement[],
    rateByResource: Map<string, ResourceRate>,
    resourceCalendars: Map<string, WorkingCalendar>,
    resolveOperator: ResolveOperator,
    minBatchByResource: Map<string, number>,
    givenOvertimeHours: number,
    weights: ObjectiveWeights,
    downtimeByResource: BaseContext['downtimeByResource'],
  ): { spec: OptionSpec; feasible: boolean; infeasibleReasonKey: string | null; scored: ScoredPlan | null; placements: Placement[] } {
    const items = spec.itemTransform(changed)
    const starved = items.find((i) => i.eligibleResourceIds.length === 0)
    if (starved) {
      return { spec, feasible: false, infeasibleReasonKey: 'whatif.infeasible.noResource', scored: null, placements: [] }
    }
    const overlay = spec.overlayWrap ? spec.overlayWrap(baseOverlay) : baseOverlay
    const operatorResolver = spec.operatorWrap ? spec.operatorWrap(resolveOperator) : resolveOperator
    // The overtime option grants the day's OT budget so placement may run past shift-end
    // into closed time — the requested hours, clamped to each resource's policy ceiling
    // (otCeilingMinutes). A normal solve spends none; this is the lever that opts in (D-shift).
    // `resourceCalendars` already carries any explicit-overtime givens (optionCalendars).
    const cals =
      spec.overtimeHours > 0
        ? new Map([...resourceCalendars].map(([id, c]) => [id, { ...c, otCapMinutes: Math.min(spec.overtimeHours * 60, c.otCeilingMinutes) }]))
        : resourceCalendars
    const placements = sequence(items, overlay, spec.policy, cals, operatorResolver, minBatchByResource, downtimeByResource).placements
    // OT magnitude for scoring = the larger of this option's proposed OT and the compound's
    // stipulated (given) OT, so stipulated overtime is costed in the factor + cost, never free.
    const scored = scorePlan(placements, { rateByResource, basePlacements, overtimeHours: Math.max(spec.overtimeHours, givenOvertimeHours), weights })
    return { spec, feasible: true, infeasibleReasonKey: null, scored, placements }
  }

  // --- assembling options + comparatives + rationale --------------------------
  private buildOptions(
    ranked: ReturnType<WhatIfService['runOption']>[],
    weightSetVersion: string,
    /** The `at_risk_remediation` target order, or null — drives each option's per-order `targetOutcome`. */
    targetDemandLineId: string | null,
  ): WhatIfOption[] {
    const feasible = ranked.filter((r) => r.feasible && r.scored)
    return ranked.map((r, idx) => {
      const rank = idx + 1
      const targetOutcome = targetOutcomeOf(r.placements, targetDemandLineId)
      if (!r.feasible || !r.scored) {
        return {
          id: r.spec.id,
          rank,
          labelKey: r.spec.labelKey,
          feasible: false,
          infeasibleReasonKey: r.infeasibleReasonKey,
          kpis: { otif: 0, costPerUnit: null, oee: null, lateOrders: 0, firmLateHours: null, infeasibleFirmOps: null, throughput: null, churn: null },
          score: Number.POSITIVE_INFINITY,
          rationale: emptyRationale(r.spec.id),
          targetOutcome,
        }
      }
      const comparatives = this.comparatives(r, feasible)
      const rationale: StructuredRationale = {
        schemaVersion: RATIONALE_SCHEMA_VERSION,
        weightSetVersion,
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
        targetOutcome,
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

  private determinismKey(
    baseVersionId: string,
    changeSet: ChangeSet,
    items: SequencerItem[],
    overlay: ResolveEffective,
    weightSetVersion: string,
    downtime: ResourceDowntimeDto[],
    baseInputsDigest: string,
  ): string {
    const overlayDigest = items
      .flatMap((i) => i.eligibleResourceIds.map((rid) => {
        const e = overlay(i.routingOperationId, rid, i.setupTime, i.cycleTime)
        return `${i.demandLineId}:${i.routingOperationId}:${rid}:${e.setupTime}:${e.cycleTime}`
      }))
      .sort()
    // Persisted downtime (line-down / maintenance) is a BASE-CONTEXT input that the change-set does
    // NOT carry (the `line_down` marker has no window times; a windowed resource stays `active`, so
    // `items` are unchanged). Without this, every line-down window hashes identically → the first
    // result is replayed for all of them (a stale cache that disagrees with solve). Hash the active
    // windows (resource + bounds + kind) so the cache busts per-window.
    const downtimeDigest = downtime
      .map((d) => `${d.resourceId}:${d.from}:${d.to}:${d.kind}`)
      .sort()
    const canonical = JSON.stringify({
      baseVersionId,
      changeSet,
      items: items.map((i) => ({
        d: i.demandLineId, o: i.routingOperationId, q: i.qty, r: i.requiredDate, f: i.firmness, e: i.eligibleResourceIds, c: i.changeoverValue,
        // material gate + sequencing floors (persisted base inputs the change-set doesn't carry)
        m: i.earliestStartMs ?? null, pr: i.priorityRank, rf: i.releaseFloorMs ?? null,
      })),
      overlayDigest,
      downtimeDigest,
      baseInputsDigest,
      weights: weightSetVersion,
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
    determinismKey: string,
    createdAt: Date,
    requestedChanges: RequestedChange[],
  ): WhatIfResultDto {
    // Derive selectability HERE (read/DTO layer), not at store time — so a cached result transforms
    // identically to a fresh one (no engine bump). The stored options carry the raw scores +
    // `infeasibleFirmOps`; this re-labels non-options `feasible:false` and emits `unremediable`.
    const { options: shown, recommendedOptionId, unremediable } = applySelectability(options, changeSet)
    return { id, plantId, baseVersionId, changeSet, baseKpis, options: shown, recommendedOptionId, unremediable, determinismKey, createdAt: createdAt.toISOString(), requestedChanges }
  }
}

/** A YYYY-MM-DD label from an ISO date (ledger summaries; deterministic, no locale). */
function shortDate(iso: string): string {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : iso
}

/** A plan you can RUN: feasible (placeable) AND no firm op overflows the working window. */
const isSelectable = (o: WhatIfOption): boolean => o.feasible && (o.kpis.infeasibleFirmOps ?? 0) === 0

/**
 * How the TARGET order fares in a plan: `feasible` (all its ops placeable) + `firmLate` (any firm op
 * past due). Null when there's no target or it isn't in this plan. The per-order verdict input.
 */
function targetOutcomeOf(
  placements: Placement[],
  targetDemandLineId: string | null,
): { feasible: boolean; firmLate: boolean } | null {
  if (!targetDemandLineId) return null
  const ops = placements.filter((p) => p.demandLineId === targetDemandLineId)
  if (ops.length === 0) return null
  return {
    feasible: ops.every((p) => p.placedFeasible),
    firmLate: ops.some((p) => p.firmness === 'firm' && p.plannedEndMs > p.requiredDateMs),
  }
}

/** Does a SELECTABLE option leave the target order feasible AND on-time? (the per-order "fix") */
const fixesTarget = (o: WhatIfOption): boolean => isSelectable(o) && o.targetOutcome?.feasible === true && o.targetOutcome?.firmLate === false

/**
 * Turn the raw scored option set into the SELECTABLE set + verdict (Decision 1–3). Pure; applied in
 * `toDto` so cached and fresh results transform identically (no engine bump):
 * - ≥1 selectable → offer only selectable; the rest are re-labeled `feasible:false` (window-overflow
 *   gets `unrunnableOp` reason; starved keeps its own) and demoted by consumers to a stat-less line.
 *   `recommendedOptionId` = best (first) selectable.
 * - 0 selectable → honest-unachievable: `unremediable` set (tailored levers for at-risk remediation,
 *   generic otherwise); options stay (all `feasible:false`) so the base/problem state is still context,
 *   but consumers show the message, not a list of non-options.
 */
export function applySelectability(
  options: WhatIfOption[],
  changeSet: ChangeSet,
): { options: WhatIfOption[]; recommendedOptionId: string | null; unremediable: WhatIfUnremediable | null } {
  // Re-label EVERY non-selectable option feasible:false (window-overflow gets the unrunnable reason;
  // starved keeps its own). Done unconditionally so the unremediable case ALSO ends up all-feasible:false
  // — then any consumer that filters on `feasible` gets no tiles/stats, consistent with "show the verdict,
  // not a list of non-options". Inert when all selectable (relabeled === options → byte-identical).
  const relabeled = options.map((o) =>
    isSelectable(o)
      ? o
      : { ...o, feasible: false, infeasibleReasonKey: o.feasible ? 'whatif.infeasible.unrunnableOp' : o.infeasibleReasonKey },
  )
  const selectable = relabeled.filter(isSelectable)
  const isRemediation = changeSet.changes.some((c) => c.kind === 'at_risk_remediation')

  // PER-ORDER verdict (at_risk_remediation, when targetOutcome was computed — i.e. not an old cached
  // result). The verdict is the TARGET order's own, never a plant-wide infeasibility leak from unrelated
  // orders. Three states, each with its own honest message:
  //  - has-options    → a SELECTABLE option leaves the target feasible AND on-time → recommend it.
  //  - can't-be-on-time → target runs in some option but no selectable option clears its lateness
  //                       (structurally late, e.g. due-before-start / a material gate) → renegotiate/expedite.
  //  - can't-run      → the target can't be placed in ANY option → no runnable plan → split/re-promise.
  if (isRemediation && relabeled.some((o) => o.targetOutcome != null)) {
    const fixer = relabeled.find(fixesTarget)
    if (fixer) return { options: relabeled, recommendedOptionId: fixer.id, unremediable: null }
    const targetEverFeasible = relabeled.some((o) => o.targetOutcome?.feasible === true)
    return {
      options: relabeled,
      recommendedOptionId: null,
      unremediable: targetEverFeasible
        ? { reasonKey: 'whatif.unremediable.cantBeOnTime', leversKey: 'whatif.unremediable.cantBeOnTimeLevers' }
        : { reasonKey: 'whatif.unremediable.atRisk', leversKey: 'whatif.unremediable.atRiskLevers' },
    }
  }

  // Plant-wide fallback — non-remediation change-sets, and old cached results without targetOutcome.
  if (selectable.length === 0) {
    return {
      options: relabeled,
      recommendedOptionId: null,
      unremediable: isRemediation
        ? { reasonKey: 'whatif.unremediable.atRisk', leversKey: 'whatif.unremediable.atRiskLevers' }
        : { reasonKey: 'whatif.unremediable.generic', leversKey: null },
    }
  }
  return { options: relabeled, recommendedOptionId: selectable[0]!.id, unremediable: null }
}

/** A raw ledger (no entity-name/ceiling resolution) for the persisted read path — see {@link WhatIfService.get}. */
function basicLedger(changeSet: ChangeSet): RequestedChange[] {
  return changeSet.changes.map((c): RequestedChange => {
    switch (c.kind) {
      case 'demand_qty':
        return { kind: c.kind, summary: `set ${c.demandLineId} quantity to ${c.to}`, status: 'applied', note: null }
      case 'demand_date':
        return { kind: c.kind, summary: `move ${c.demandLineId} due date to ${shortDate(c.to)}`, status: 'applied', note: null }
      case 'resource_window':
        return { kind: c.kind, summary: `take ${c.resourceId} down ${shortDate(c.downFrom)}–${shortDate(c.downTo)}`, status: 'applied', note: null }
      case 'line_down':
        return { kind: c.kind, summary: `${c.resourceId} down`, status: 'applied', note: null }
      case 'overtime':
        return { kind: c.kind, summary: `add ${c.hours}h overtime on ${c.resourceId}`, status: 'applied', note: null }
      case 'wear_remediation':
        return { kind: c.kind, summary: `${c.action} on ${c.resourceId}`, status: 'applied', note: null }
      case 'material_arrival':
        return { kind: c.kind, summary: `${c.componentPartId} arrives ${shortDate(c.availableAt)}`, status: 'applied', note: null }
      case 'at_risk_remediation':
        return { kind: c.kind, summary: `remediate at-risk ${c.demandLineId}`, status: 'applied', note: null }
    }
  })
}

// --- pure item/overlay transforms --------------------------------------------
/** Take a resource offline (service window): drop it from every op's eligible set. */
function dropResource(items: SequencerItem[], resourceId: string): SequencerItem[] {
  return items.map((i) => ({ ...i, eligibleResourceIds: i.eligibleResourceIds.filter((r) => r !== resourceId) }))
}

/** Keep running worn: inflate the resource's cycle to its predicted value (ml_predicted). */
function inflateCycle(base: ResolveEffective, resourceId: string, predicted: Map<string, number>): ResolveEffective {
  return (opId, resId, stdSetup, stdCycle, atMs) => {
    const eff = base(opId, resId, stdSetup, stdCycle, atMs)
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
