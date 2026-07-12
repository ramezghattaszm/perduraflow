/**
 * Deterministic EDD changeover-aware sequencer — the SKIP-03 heuristic stand-in
 * for the real optimizer (D18/AQ6). Pure + reproducible (D2): same inputs →
 * identical output, no `Date.now()`, no randomness. The schedule timeline anchors
 * to a **deterministic origin** (start-of-day UTC of the earliest demand date).
 *
 * Rule (api-spec §11.4 / AS9, penalty term with **firm-lateness dominance**): an
 * EDD key (`dueHours`) ordered ascending, with a **forecast-only** changeover
 * pull-ahead bonus — a forecast job whose changeover attribute matches the
 * resource's current campaign may jump up to `CHANGEOVER_BONUS_HOURS` earlier to
 * avoid a changeover. **Firm jobs never receive the bonus** → they stay strict
 * EDD and are never deferred to save a changeover (firm dominance, D13/D23).
 * Each op is assigned to the **least-loaded** eligible resource (AS10). Total-order
 * tie-break keeps it deterministic.
 */

import { ALWAYS_ON, newOvertimeState, placeJob, type OvertimeState, type WorkingCalendar } from '../../common/utils/working-calendar'
import { ConstraintPipeline } from './constraints/pipeline'
import { materialFloorConstraint, minBatchFloorConstraint, precedenceFloorConstraint, releaseFloorConstraint } from './constraints/floor'
import { eligibilityCandidacyConstraint, readinessCandidacyConstraint } from './constraints/candidacy'
import { placementFeasibilityConstraint } from './constraints/feasibility'
import { changeoverSelectionConstraint, eddBaseSelectionConstraint, expediteSelectionConstraint, notReadySelectionConstraint } from './constraints/selection'
import type { Constraint, ScheduleModel } from './constraints/types'

/** Forecast job may pull ahead by at most this many hours to group a changeover (documented constant). */
export const CHANGEOVER_BONUS_HOURS = 24
/** Expedite pull-ahead for the what-if protect-delivery policy (front-loads the expedited lines). */
export const EXPEDITE_BONUS_HOURS = 100_000
/** Deferral applied to a not-yet-material-ready op under readyFirst (push it behind ready work). */
export const READY_DEFER_HOURS = 50_000
export const MS_PER_HOUR = 3_600_000
const MS_PER_MINUTE = 60_000

/** One unit of work to place (a demand line's routing operation). */
export interface SequencerItem {
  demandLineId: string
  partId: string
  /** For deterministic tie-break. */
  partNo: string
  routingOperationId: string
  opSeq: number
  /** The part's value for the op's changeover attribute (e.g. colour "Black"); null = no driver. */
  changeoverValue: string | null
  qty: number
  setupTime: number
  cycleTime: number
  /** Required date, epoch ms. */
  requiredDate: number
  firmness: 'firm' | 'forecast'
  /** 0 = highest (critical) … 2 = standard. */
  priorityRank: number
  /** Active eligible member resource ids for the op's group, **sorted ascending**. */
  eligibleResourceIds: string[]
  /**
   * Earliest the op may start (epoch ms) — the D36 material gate: the latest availability of
   * its consumed buy-components (on-hand + receipts). A floor on placement; absent/0 = no
   * material constraint. Resolved upstream from the §4.8 material-availability input.
   */
  earliestStartMs?: number
  /**
   * Order-**release** floor (epoch ms) — a planning floor distinct from the material gate: an order
   * isn't worked before its release day. The solve sets it to `min(today, startOfDay(requiredDate))`,
   * so PAST-dated demand sits on its own past day while today/future demand floors at today (the
   * front-loading-from-today behaviour is unchanged when no past demand exists, since this equals the
   * origin). Absent/0 = no floor. Unlike `earliestStartMs`, binding here does NOT mark the op
   * material-bound — release lateness is plain lateness.
   */
  releaseFloorMs?: number
}

/**
 * Source flag for a planning time (D7/SKIP-04): master-data baseline, an ML
 * correction from observed actuals (`ml_adjusted`), or an ML **prediction** acted on
 * ahead of the drift materialising (`ml_predicted` — what-if "defer" / phase-4
 * pre-adopt). Aligns with the contract `TimeSource`.
 */
export type TimeSource = 'standard' | 'ml_adjusted' | 'ml_predicted'

/** The effective times for an op on a specific resource (the learned overlay, phase 3). */
export interface EffectiveTimes {
  setupTime: number
  cycleTime: number
  setupSource: TimeSource
  cycleSource: TimeSource
  setupConfidence: number | null
  cycleConfidence: number | null
}

/**
 * Resolve the effective times for `(routingOperationId, resourceId)` — the
 * learning overlay (api-spec §12.5). Returns the held learned value where present
 * and trusted, else the std baseline. **Pure** (precomputed by the service) so the
 * sequencer stays deterministic.
 */
export type ResolveEffective = (
  routingOperationId: string,
  resourceId: string,
  stdSetup: number,
  stdCycle: number,
  /** The op's planned start (epoch ms), resolved at placement. Lets a forward-only forecast
   *  overlay (`ml_predicted`) gate itself by WHEN the op runs (D44 — not retroactive). */
  atMs?: number,
  /** The op's planned END (epoch ms), std-cycle estimate. A pre-adopted wear forecast (`ml_predicted`)
   *  applies iff the op is RUNNING AT/AFTER its crossing (`plannedEnd > crossingAt`) — so the straddle
   *  op (start < crossing < end) is worn while pre-crossing ops stay std. */
  opEndMs?: number,
) => EffectiveTimes

/**
 * Resolve the **operator performance factor** for the operator pinned to `resourceId` at the op's
 * start (`atMs`) — the C5 consumed labor input. Returns the assigned operator's `performanceFactor`
 * ("percent of standard": 1.0 = standard, >1.0 faster, <1.0 slower), or 1.0 when no operator covers
 * the op's start. The sequencer applies it to **run time only**: `effectiveCycle = baseCycle / factor`
 * — a DELIBERATE DIVIDE (higher factor = faster). Setup is untouched. **Pure** (built by the service
 * from the §4.8 assignment table + operator factors) so the sequencer stays deterministic.
 */
export type ResolveOperator = (
  resourceId: string,
  atMs: number,
) => { id: string; performanceFactor: number; laborRate: number | null } | null

/**
 * Which floor component set this op's start — the immediate, computed cause of its placement (D-late).
 * `resource`/`predecessor` point at a blocking op (recurse for the causal chain); the rest are roots:
 * `material` (a buy-component gate), `release`/`origin` (couldn't start before its day / the horizon),
 * `working_window` (couldn't fit any working segment), `resource_downtime` (a per-resource line-down /
 * maintenance closure delayed the start — carries the window id), `operator` (a slow operator inflated
 * the run so it overflows/finishes late where at STANDARD it would be on time — carries the operator id).
 * Recorded for EVERY op so the chain can pass through on-time blockers; null only when no binder.
 */
export type BindingKind =
  | 'resource'
  | 'predecessor'
  | 'material'
  | 'release'
  | 'origin'
  | 'working_window'
  | 'resource_downtime'
  | 'operator'

/** A placed operation (epoch-ms times; the service maps to rows). */
export interface Placement {
  demandLineId: string
  partId: string
  routingOperationId: string
  resourceId: string
  opSeq: number
  sequencePosition: number
  plannedStartMs: number
  plannedEndMs: number
  qty: number
  setupTime: number
  cycleTime: number
  setupSource: TimeSource
  cycleSource: TimeSource
  setupConfidence: number | null
  cycleConfidence: number | null
  atRisk: boolean
  atRiskReason: string | null
  /**
   * Did the op actually fit a working segment? `false` when `placeJob` returns null — the op is longer
   * than any working segment and can't split, so it CAN'T run as scheduled; the recorded start/end are a
   * defensive contiguous fallback (running through closed time — fictional). The scorer reads this to
   * penalize window-overflow infeasibility as firm-lateness (a fact `bindingKind` can't carry, since the
   * operator counterfactual overwrites it). `true` for every normally-placed op.
   */
  placedFeasible: boolean
  /** The floor component that set this op's start (causal-chain attribution). */
  bindingKind: BindingKind
  /** When `bindingKind` is `resource`/`predecessor`, the op that pushed this one (else null). */
  bindingBlockerDemandLineId: string | null
  bindingBlockerOpSeq: number | null
  /** When `bindingKind` is `resource_downtime`, the closure window that delayed the start (else null). */
  bindingDowntimeId: string | null
  /** When `bindingKind` is `operator`, the slow operator who inflated this op's run (else null). */
  bindingOperatorId: string | null
  /**
   * The hourly labor rate ($/hr) of the operator working this op, or null when no operator covers it
   * (then labor is cost-neutral). Carried so the cost objective folds operator LABOR into per-unit cost
   * (`laborRate · workingHours`) — so a faster, pricier operator's true cost is scored, not invisible.
   * Scoring-only: derived per-solve from the assignment table, NOT persisted on the row.
   */
  operatorLaborRate: number | null
  /** Required date (epoch ms) — carried through for lateness/earliness scoring. */
  requiredDateMs: number
  firmness: 'firm' | 'forecast'
  /** The part's changeover attribute value at this op — for changeover counting. */
  changeoverValue: string | null
}

/**
 * Optional what-if policy knobs (phase 5). The default (no policy) is the live
 * engine. These are additive levers the what-if engine varies to generate distinct,
 * deterministic options — they never affect a normal `solve()`.
 */
export interface SequencePolicy {
  /** Apply the changeover pull-ahead bonus to firm jobs too (group aggressively). */
  changeoverBonusAllFirmness?: boolean
  /** These demand lines get an expedite pull-ahead (protect-delivery policy). */
  expediteDemandLineIds?: Set<string>
  /**
   * Re-sequence around a material gate: defer an op that isn't yet material-ready at its
   * resource's current free time, so ungated work fills the pre-arrival gap instead of the
   * cell idling. The "re-sequence-around" remediation vs. plain "wait".
   */
  readyFirst?: boolean
}

export interface SequencerResult {
  placements: Placement[]
  horizonStartMs: number
  horizonEndMs: number
  /**
   * S1.2 — the Option-A termination backstop's typed `all_vetoed` dispositions: ops force-placed (degraded to
   * an at-risk placement) because every remaining candidate vetoed on every eligible resource in an iteration.
   * **Empty while inert** (no veto is registered in S1.2, so the backstop never fires) — the observable proof
   * that the reselect primitive changed capability, not behavior.
   */
  allVetoedDispositions: { demandLineId: string; opSeq: number }[]
}

interface ResourceState {
  /** The resource's next-available wall-clock instant (the calendar-walking cursor). */
  freeMs: number
  currentAttr: string | null
  seq: number
  /** Per-day overtime ledger for this resource (only spent when its calendar allows OT). */
  ot: OvertimeState
  /** The last op placed on this resource — the blocker when `prevFree` binds a later op (causal chain). */
  lastOpKey: { demandLineId: string; opSeq: number } | null
}

const firmRank = (f: 'firm' | 'forecast') => (f === 'firm' ? 0 : 1)

function startOfDayUtc(ms: number): number {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/**
 * Produces a deterministic schedule from work items. Assumes every item has at
 * least one eligible resource (the service performs the feasibility hard gate
 * before calling this).
 */
export function sequence(
  items: SequencerItem[],
  resolveEffective?: ResolveEffective,
  policy?: SequencePolicy,
  resourceCalendars?: Map<string, WorkingCalendar>,
  resolveOperator?: ResolveOperator,
  minBatchByResource?: Map<string, number>,
  /**
   * Per-resource downtime windows (line-down / maintenance) for binder attribution. The windows
   * are ALSO baked into `resourceCalendars` as closed intervals (that's what displaces ops); this
   * map only lets the binder name the closure that delayed a start (→ `resource_downtime` root +
   * the window id). Omitted → no downtime tagging (placement is identical either way).
   */
  downtimeByResource?: Map<string, Array<{ id: string; startMs: number; endMs: number }>>,
  /**
   * S1.2 — the veto-registration seam for the Option-A reselect primitive. Registers a resource-aware
   * pre-place CANDIDACY veto and/or a post-place FEASIBILITY reject-form constraint into the placement
   * pipeline. **Unused by every production caller (undefined → no veto → byte-identical).** Its sole purpose
   * is to let the synthetic-veto unit test exercise reselect/defer/backstop determinism OFF the demo path,
   * without registering a veto in the production solve (the D28/D9/JIS consumers are S2/S3).
   */
  vetoConstraints?: { preplaceVeto?: Constraint[]; feasibilityReject?: Constraint[] },
): SequencerResult {
  // A resource's operating calendar (working windows / closures / OT). Resources without
  // one fall back to ALWAYS_ON (24/7) so existing callers and tests are unaffected.
  const calFor = (resourceId: string): WorkingCalendar => resourceCalendars?.get(resourceId) ?? ALWAYS_ON
  const effectiveFor = (item: SequencerItem, resourceId: string, atMs?: number): EffectiveTimes => {
    // The op's planned END, std-cycle estimate — the reference for the wear overlay's "running at/after
    // the crossing" gate. Std times (no perf/min-batch/calendar) keep it free of the cycle the overlay
    // itself decides (no circularity); accurate enough vs the multi-hour crossing horizon.
    const opEndMs = atMs != null ? atMs + (item.setupTime + item.cycleTime * item.qty) * MS_PER_MINUTE : undefined
    return (
      resolveEffective?.(item.routingOperationId, resourceId, item.setupTime, item.cycleTime, atMs, opEndMs) ?? {
        setupTime: item.setupTime,
        cycleTime: item.cycleTime,
        setupSource: 'standard',
        cycleSource: 'standard',
        setupConfidence: null,
        cycleConfidence: null,
      }
    )
  }
  if (items.length === 0) {
    const now0 = 0
    return { placements: [], horizonStartMs: now0, horizonEndMs: now0, allVetoedDispositions: [] }
  }
  const origin = startOfDayUtc(Math.min(...items.map((i) => i.requiredDate)))
  const state = new Map<string, ResourceState>()
  const stateFor = (id: string): ResourceState => {
    let s = state.get(id)
    if (!s) {
      s = { freeMs: origin, currentAttr: null, seq: 0, ot: newOvertimeState(), lastOpKey: null }
      state.set(id, s)
    }
    return s
  }

  // Least-loaded eligible member (min freeMs; tie-break by id — ids are pre-sorted).
  const assignResource = (item: SequencerItem): string => {
    let best = item.eligibleResourceIds[0]!
    let bestFree = stateFor(best).freeMs
    for (const id of item.eligibleResourceIds) {
      const free = stateFor(id).freeMs
      if (free < bestFree) {
        best = id
        bestFree = free
      }
    }
    return best
  }

  // S1.2 — the op's eligible resources in the Option-A reselect order: least-loaded `freeMs` ascending, ties
  // broken by the pre-sorted `eligibleResourceIds` order (a STABLE sort, made explicit via the original index).
  // Its FIRST element is byte-identical to `assignResource`'s strict-`<` first-seen pick, so the inert single-
  // pass reselect (which only ever takes `[0]`, no veto registered) places exactly where `assignResource`
  // does — the demo digest is unchanged. Used ONLY by the reselect loop; the scan's rank still calls
  // `assignResource` unchanged (its selection state is not re-timed).
  const orderedResources = (item: SequencerItem): string[] =>
    item.eligibleResourceIds
      .map((id, i) => ({ id, i, free: stateFor(id).freeMs }))
      .sort((a, b) => (a.free !== b.free ? a.free - b.free : a.i - b.i))
      .map((e) => e.id)

  const placements: Placement[] = []
  const allVetoedDispositions: { demandLineId: string; opSeq: number }[] = [] // S1.2 backstop log — empty inert
  let horizonEndMs = origin

  // Linear intra-routing precedence (single-level, C3): within a demand line, an op follows
  // the prior opSeq. An op is a placement candidate only once its predecessor is placed, and
  // its start is floored by the predecessor's end — reusing the cursor-floor like the material
  // gate. Single-op routings have no predecessor → ready immediately, unchanged.
  const opSeqsByLine = new Map<string, number[]>()
  for (const it of items) {
    const arr = opSeqsByLine.get(it.demandLineId) ?? []
    if (!arr.includes(it.opSeq)) arr.push(it.opSeq)
    opSeqsByLine.set(it.demandLineId, arr)
  }
  for (const arr of opSeqsByLine.values()) arr.sort((a, b) => a - b)
  const predKey = (it: SequencerItem): string | null => {
    const arr = opSeqsByLine.get(it.demandLineId)!
    const idx = arr.indexOf(it.opSeq)
    return idx > 0 ? `${it.demandLineId}:${arr[idx - 1]}` : null
  }
  const endByLineOp = new Map<string, number>()
  const predecessorEnd = (it: SequencerItem): number => {
    const k = predKey(it)
    return k ? (endByLineOp.get(k) ?? 0) : 0
  }
  const isReady = (it: SequencerItem): boolean => {
    const k = predKey(it)
    return k === null || endByLineOp.has(k)
  }

  // S1.1: the placement loop routes through the two-scope constraint registry (all mechanisms extracted
  // byte-identical; each INVOKES the same untouched arithmetic/logic — D-S1-5, only the decision moves).
  //  • SELECTION scope (stateful, per step) — the sole ordering mechanism: the composite scorer folds
  //    `(requiredDate−origin)/hr − changeoverBonus(currentAttr) − expedite + notReady`. EDD is its base term;
  //    changeover is a SELECTION rank term reading the resource's LIVE currentAttr (not a placement cost).
  //  • PLACEMENT scope (per job) — CANDIDACY: readiness = isReady(item) [reused closure], eligibility =
  //    item.eligibleResourceIds.length>0 (group→members data path stays in buildBaseContext); FLOOR: material
  //    = item.earliestStartMs, release = item.releaseFloorMs, precedence = predecessorEnd(item), min-batch =
  //    minBatchByResource.get(res) (folded with Math.max, base floor prevFree/origin inline); FEASIBILITY:
  //    the placeJob null-degrade. The floor inputs also stay inline for the causal attribution (bindMs) — a
  //    separate diagnostic mechanism, not a constraint. There is no ORDERING scope (input order proven inert).
  const pipeline = new ConstraintPipeline(
    [], // no ORDERING scope — the input order is proven inert (the `order()` seam is an identity no-op)
    {
      candidacy: [readinessCandidacyConstraint(isReady), eligibilityCandidacyConstraint()],
      floor: [materialFloorConstraint(), releaseFloorConstraint(), precedenceFloorConstraint(predecessorEnd)],
      quantityFloor: [minBatchFloorConstraint(minBatchByResource ?? new Map())],
      // S1.2 — the veto seam: resource-aware pre-place CANDIDACY + post-place FEASIBILITY reject-form. Both
      // undefined for every production caller (→ empty → the reselect branch is dead → byte-identical); only
      // the synthetic-veto test populates them to exercise reselect/defer/backstop off the demo.
      preplaceVeto: vetoConstraints?.preplaceVeto,
      feasibility: [placementFeasibilityConstraint()], // Commit 5 — degrade form (veto-and-reselect is S1.2)
      feasibilityReject: vetoConstraints?.feasibilityReject,
    },
    // SELECTION (Commit 4) — the stateful per-step composite scorer, the sole ordering mechanism. Registration
    // order is load-bearing: [eddBase, changeover, expedite, notReady] folds bit-for-bit as the inline
    // `(requiredDate−origin)/hr − bonus − expedite + notReady`. Changeover is a SELECTION rank term ONLY.
    [eddBaseSelectionConstraint(), changeoverSelectionConstraint(policy), expediteSelectionConstraint(policy), notReadySelectionConstraint(policy)],
  )
  const remaining = [...pipeline.order(items)] // inert identity seam — no ORDERING scope (input order proven inert)

  // S1.2 — the Option-A per-op placement attempt: try `item` on its eligible resources in the reselect order
  // (`orderedResources`: least-loaded then pre-sorted id; `[0]` === `assignResource`'s pick). Take the FIRST
  // resource that neither pre-place-vetoes (resource-aware CANDIDACY) nor post-place-rejects (FEASIBILITY
  // reject-form); mutate state + push ONLY for that resource. Returns false if EVERY eligible resource vetoed
  // (→ the caller defers the op). `force` = the termination backstop: place on the primary resource ignoring
  // vetoes (a degraded at-risk placement). INERT: no veto registered → the first resource is always taken on
  // the first pass, and the mutation/push arithmetic below is the prior inline block verbatim (bestRes→res),
  // so the plan is byte-identical.
  const tryPlace = (item: SequencerItem, force: boolean): boolean => {
    const resourceOrder = force ? [orderedResources(item)[0]!] : orderedResources(item)
    for (const res of resourceOrder) {
      // pre-place veto — resource-aware CANDIDACY (D28-shaped): reads the assigned resource's LIVE currentAttr
      // / freeMs. A veto (degree>0) → skip to the next resource. Inert (no constraint) → returns false, the
      // lambda is never invoked, and computation proceeds exactly as before.
      if (!force && pipeline.preplaceVeto(() => ({ item, resourceId: res, candidateStartMs: 0, originMs: origin, resourceFreeMs: stateFor(res).freeMs, currentAttr: stateFor(res).currentAttr }))) continue
      const st = stateFor(res)
      const cal = calFor(res)
      // The op can't start before its consumed buy-components are available (the D36 material
      // gate, resolved upstream into earliestStartMs) — a third floor on the cursor, alongside
      // the resource's free time and the schedule origin. placeJob then walks that floor into
      // working time exactly as it does the others; the gate adds no placement machinery.
      const earliest = item.earliestStartMs ?? 0
      const release = item.releaseFloorMs ?? 0 // order-release floor (past demand → its day; today/future → today)
      const predEnd = predecessorEnd(item) // C3 precedence: can't start before the prior op ends
      const prevFree = st.freeMs
      // PLACEMENT · FLOOR — the base floor (resource free time + schedule origin) stays inline; the registered
      // FLOOR constraints (material / release / precedence) fold their contributions on top via the pipeline
      // (D-S1-5 — the fold DECISION moved; each constraint invokes the same arithmetic as `earliest`/`release`/
      // `predEnd` above). Result === the prior Math.max(prevFree, origin, earliest, predEnd, release). The
      // schedule-model is built once here and reused by the quantity-floor tier below.
      const baseFloorMs = Math.max(prevFree, origin)
      const model: ScheduleModel = { item, resourceId: res, candidateStartMs: baseFloorMs, originMs: origin, resourceFreeMs: prevFree }
      const floor = pipeline.floor(baseFloorMs, () => model)
      // Resolve the effective times AT the op's start floor — a forward-only forecast overlay
      // (`ml_predicted`, D44) gates itself by when the op actually runs, so an op landing on a
      // past day falls back to its std/measured cycle instead of carrying the pre-adopted forecast.
      const eff = effectiveFor(item, res, floor)
      // Operator performance (C5): the operator pinned to this resource at op start scales RUN time.
      // effectiveCycle = baseCycle / performanceFactor — a DELIBERATE DIVIDE (higher factor = faster);
      // setup is untouched. Point-resolved at the cursor floor (the op's start), like the material
      // gate — one factor per placement, no intra-op split. No assignment → factor 1.0 (no-op).
      const operator = resolveOperator?.(res, floor) ?? null
      const perf = operator?.performanceFactor ?? 1
      const effCycle = perf > 0 ? eff.cycleTime / perf : eff.cycleTime
      // Minimum batch floor (C4): an op won't run below its resource type's minimum batch — a die
      // setup isn't worth a 3-part run. effectiveRunQty = max(demandQty, minBatch); when it binds it
      // RUNS TO MINIMUM (the realistic production behavior). A pure per-op floor, no batch merging.
      // 0 / no entry → no floor (effRunQty = demandQty). Drives both duration and run qty. Where the
      // surplus (effRunQty − demandQty) goes (inventory/netting) is a documented future refinement —
      // the seed keeps demand ≥ minBatch so it never binds by default, so no disposition is needed.
      // PLACEMENT · FLOOR (quantity) — min-batch folds into the run qty via the pipeline's quantity-floor tier
      // (same arithmetic: max(demandQty, minBatch), reusing the built `model`). === the prior inline Math.max.
      const effRunQty = pipeline.quantityFloor(item.qty, () => model)
      const durMs = (eff.setupTime + effCycle * effRunQty) * MS_PER_MINUTE
      // Calendar-aware placement: advance the cursor through working time only (skipping
      // nights / Sundays / holidays / maintenance / down). A null result means the op cannot
      // fit (non-split op longer than any working segment, no OT) — the service feasibility
      // gate is responsible for rejecting those; fall back to contiguous + at-risk defensively.
      // PLACEMENT · place → FEASIBILITY — placeJob runs, then the registered FEASIBILITY constraint evaluates
      // the outcome (`placedFeasible = placed !== null`). Degrade form (Commit 5): the placement is returned
      // unchanged; the contiguous-fallback arithmetic below is invoked as-is.
      const placedRaw = placeJob(cal, floor, durMs, st.ot)
      const placed = pipeline.feasibility(placedRaw, () => ({ item, resourceId: res, candidateStartMs: floor, originMs: origin, resourceFreeMs: prevFree, placedFeasible: placedRaw !== null }))
      // post-place veto — FEASIBILITY reject-form (D9-shaped): a reject (degree>0) → skip to the next resource
      // (the degrade-form verdict above is still recorded). Inert (no reject-form constraint) → returns false,
      // the lambda is never invoked, and the placement below stands exactly as before.
      if (!force && pipeline.feasibilityRejects(() => ({ item, resourceId: res, candidateStartMs: floor, originMs: origin, resourceFreeMs: prevFree, placedFeasible: placed !== null }))) continue
      const startMs = placed?.startMs ?? floor
      const endMs = placed?.endMs ?? startMs + durMs
      const atRisk = endMs > item.requiredDate || placed === null
      // Causal attribution (D-late): which floor component set the start — the immediate cause, recorded
      // so a late order can be traced through its blockers to a root. placeJob may push the start past
      // `floor` for the working calendar (→ working_window root). Tie priority favors the more specific
      // cause: material > predecessor > resource > release > origin. `resource`/`predecessor` name the
      // blocking op; the rest are roots. atRiskReason is derived from the SAME binder (one source).
      const bindMs = Math.max(prevFree, origin, earliest, predEnd, release)
      let bindingKind: BindingKind
      let blocker: { demandLineId: string; opSeq: number } | null = null
      if (placed === null) {
        bindingKind = 'working_window'
      } else if (earliest > 0 && earliest === bindMs) {
        bindingKind = 'material'
      } else if (predKey(item) !== null && predEnd === bindMs) {
        bindingKind = 'predecessor'
        const arr = opSeqsByLine.get(item.demandLineId)!
        blocker = { demandLineId: item.demandLineId, opSeq: arr[arr.indexOf(item.opSeq) - 1]! }
      } else if (st.lastOpKey !== null && prevFree === bindMs) {
        bindingKind = 'resource'
        blocker = st.lastOpKey
      } else if (release === bindMs) {
        bindingKind = 'release'
      } else {
        bindingKind = 'origin'
      }
      // Resource-downtime tag (line-down / maintenance): when a per-resource closure delayed this op's
      // start — it couldn't start at `floor` because the line was down — the closure IS the binder, not
      // whichever floor component the cursor happened to sit on. The window also lives in the calendar
      // (that's what displaced the op); this records WHICH window so the lateness chain narrates the
      // stored closure (from/to/reason). A root: clears any blocking-op attribution.
      let bindingDowntimeId: string | null = null
      const dtWindows = downtimeByResource?.get(res)
      if (dtWindows && dtWindows.length > 0 && (placed === null || startMs > floor)) {
        const upper = placed === null ? Number.POSITIVE_INFINITY : startMs
        let bound: { id: string; startMs: number; endMs: number } | null = null
        for (const w of dtWindows) {
          // the window must overlap the delayed gap [floor, startMs) (or the no-fit horizon)
          if (w.startMs < upper && w.endMs > floor) {
            // attribute to the closure that ends latest (the dominant delay); ties by id for determinism
            if (bound === null || w.endMs > bound.endMs || (w.endMs === bound.endMs && w.id < bound.id)) bound = w
          }
        }
        if (bound) {
          bindingKind = 'resource_downtime'
          blocker = null
          bindingDowntimeId = bound.id
        }
      }
      // Operator-performance root (C5): when this op is late because a SLOW operator inflated its run —
      // at STANDARD (factor 1.0) it would NOT be at-risk — the operator is the marginal cause, not whichever
      // floor the cursor sat on. Counterfactual: re-place the op at its standard cycle; if that fits the
      // window AND finishes by due, the operator made the difference. Overrides only the op's OWN run-time
      // bindings (working_window / release / origin — the late-finish cases), never an upstream cause
      // (material / predecessor / resource / resource_downtime stand). Analog of the downtime tag.
      let bindingOperatorId: string | null = null
      if (atRisk && perf < 1 && operator && (bindingKind === 'working_window' || bindingKind === 'release' || bindingKind === 'origin')) {
        const stdDurMs = (eff.setupTime + eff.cycleTime * effRunQty) * MS_PER_MINUTE
        const placedStd = placeJob(cal, floor, stdDurMs, st.ot)
        const endStd = placedStd ? placedStd.endMs : floor + stdDurMs
        const stdAtRisk = placedStd === null || endStd > item.requiredDate
        if (!stdAtRisk) {
          bindingKind = 'operator'
          blocker = null
          bindingOperatorId = operator.id
        }
      }
      st.freeMs = endMs
      st.lastOpKey = { demandLineId: item.demandLineId, opSeq: item.opSeq }
      endByLineOp.set(`${item.demandLineId}:${item.opSeq}`, endMs) // precedence: successor floors on this
      st.currentAttr = item.changeoverValue
      st.seq += 1
      placements.push({
        demandLineId: item.demandLineId,
        partId: item.partId,
        routingOperationId: item.routingOperationId,
        resourceId: res,
        opSeq: item.opSeq,
        sequencePosition: st.seq,
        plannedStartMs: startMs,
        plannedEndMs: endMs,
        qty: effRunQty, // C4: the actual run quantity (≥ demand when the minimum-batch floor binds)
        setupTime: eff.setupTime,
        cycleTime: effCycle, // operator-adjusted run time (std → ml → ÷ performanceFactor); what actually ran
        setupSource: eff.setupSource,
        cycleSource: eff.cycleSource,
        setupConfidence: eff.setupConfidence,
        cycleConfidence: eff.cycleConfidence,
        atRisk,
        placedFeasible: placed !== null, // false → window-overflow infeasibility (can't run as scheduled)
        atRiskReason: !atRisk
          ? null
          : bindingKind === 'resource_downtime'
            ? 'resource_down'
            : bindingKind === 'operator'
              ? 'slow_operator'
              : bindingKind === 'material'
                ? 'material'
                : bindingKind === 'working_window'
                  ? 'exceeds_working_window'
                  : 'late',
        bindingKind,
        bindingBlockerDemandLineId: blocker?.demandLineId ?? null,
        bindingBlockerOpSeq: blocker?.opSeq ?? null,
        bindingDowntimeId,
        bindingOperatorId,
        operatorLaborRate: operator?.laborRate ?? null, // labor cost input (scoring-only); null = no operator
        requiredDateMs: item.requiredDate,
        firmness: item.firmness,
        changeoverValue: item.changeoverValue,
      })
      if (endMs > horizonEndMs) horizonEndMs = endMs
      return true
    }
    return false
  }

  while (remaining.length > 0) {
    // S1.2 — Option-A reselect within one iteration: `deferred` holds the indices of ops that vetoed on EVERY
    // eligible resource this pass, so the scan re-picks the next-best DIFFERENT candidate by the total order.
    // Empty while inert (no veto registered) → the scan + place behave exactly as the prior single-pass loop
    // (the inner `while` runs its body once and commits).
    const deferred = new Set<number>()
    let committed = false
    while (!committed) {
      let bestIdx = -1
      let bestRank = Number.POSITIVE_INFINITY
      let bestItem: SequencerItem | null = null
      for (let i = 0; i < remaining.length; i++) {
        if (deferred.has(i)) continue // S1.2: deferred this pass (vetoed on all resources) — try another op
        const item = remaining[i]!
        // PLACEMENT · CANDIDACY — the registered readiness + eligibility constraints (Commit 3). Evaluated
        // BEFORE resource assignment (order preserved), so the candidacy model carries no resource yet
        // (resourceId/candidateStart/freeMs are placeholders the candidacy constraints do not read).
        if (!pipeline.candidacy(() => ({ item, resourceId: '', candidateStartMs: 0, originMs: origin, resourceFreeMs: 0 }))) continue
        const res = assignResource(item) // least-loaded eligible member (selection state; reads st.freeMs) — reproduced inline, not reordered
        const st = stateFor(res)
        // SELECTION · the stateful per-step composite score — the registered SELECTION constraints fold
        // `(requiredDate−origin)/hr − changeoverBonus(currentAttr) − expedite + notReady`. Reads the resource's
        // LIVE currentAttr / freeMs (mutated after each placement — line ~500). === the prior inline `rank`.
        const rank = pipeline.selectionScore({ item, resourceId: res, candidateStartMs: 0, originMs: origin, resourceFreeMs: st.freeMs, currentAttr: st.currentAttr })
        if (bestItem === null || rank < bestRank || (rank === bestRank && tieBreakLess(item, bestItem))) {
          bestRank = rank
          bestIdx = i
          bestItem = item
        }
      }

      if (bestItem === null) {
        // S1.2 termination backstop: no ready candidate remains that hasn't vetoed on every resource. Force-
        // place the total-order-best (the tieBreakLess-min of the still-ready ops) on its primary resource,
        // degrading it to an at-risk placement — guarantees termination. NEVER fires while inert (`deferred`
        // stays empty → `bestItem` is non-null every pass). Records a typed `all_vetoed` disposition.
        let forcedIdx = -1
        for (let i = 0; i < remaining.length; i++) {
          const item = remaining[i]!
          if (!pipeline.candidacy(() => ({ item, resourceId: '', candidateStartMs: 0, originMs: origin, resourceFreeMs: 0 }))) continue
          if (forcedIdx === -1 || tieBreakLess(item, remaining[forcedIdx]!)) forcedIdx = i
        }
        if (forcedIdx === -1) throw new Error('sequencer: no ready candidate while work remains (invariant violation)')
        const forcedItem = remaining[forcedIdx]!
        allVetoedDispositions.push({ demandLineId: forcedItem.demandLineId, opSeq: forcedItem.opSeq })
        tryPlace(forcedItem, true)
        remaining.splice(forcedIdx, 1)
        committed = true
        break
      }

      if (tryPlace(bestItem, false)) {
        remaining.splice(bestIdx, 1)
        committed = true
      } else {
        deferred.add(bestIdx) // all resources vetoed → defer; the scan takes the next-best candidate
      }
    }
  }

  return { placements, horizonStartMs: origin, horizonEndMs, allVetoedDispositions }
}

/** Total-order tie-break: firm first → earlier due → higher priority → partNo → demandLineId. */
function tieBreakLess(a: SequencerItem, b: SequencerItem): boolean {
  if (firmRank(a.firmness) !== firmRank(b.firmness)) return firmRank(a.firmness) < firmRank(b.firmness)
  if (a.requiredDate !== b.requiredDate) return a.requiredDate < b.requiredDate
  if (a.priorityRank !== b.priorityRank) return a.priorityRank < b.priorityRank
  if (a.partNo !== b.partNo) return a.partNo < b.partNo
  return a.demandLineId < b.demandLineId
}
