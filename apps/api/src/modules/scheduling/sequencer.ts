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

import { ALWAYS_ON, newOvertimeState, placeJob, type OvertimeState, type WorkingCalendar } from './working-calendar'

/** Forecast job may pull ahead by at most this many hours to group a changeover (documented constant). */
export const CHANGEOVER_BONUS_HOURS = 24
/** Expedite pull-ahead for the what-if protect-delivery policy (front-loads the expedited lines). */
export const EXPEDITE_BONUS_HOURS = 100_000
/** Deferral applied to a not-yet-material-ready op under readyFirst (push it behind ready work). */
export const READY_DEFER_HOURS = 50_000
const MS_PER_HOUR = 3_600_000
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
): SequencerResult {
  // A resource's operating calendar (working windows / closures / OT). Resources without
  // one fall back to ALWAYS_ON (24/7) so existing callers and tests are unaffected.
  const calFor = (resourceId: string): WorkingCalendar => resourceCalendars?.get(resourceId) ?? ALWAYS_ON
  const effectiveFor = (item: SequencerItem, resourceId: string, atMs?: number): EffectiveTimes =>
    resolveEffective?.(item.routingOperationId, resourceId, item.setupTime, item.cycleTime, atMs) ?? {
      setupTime: item.setupTime,
      cycleTime: item.cycleTime,
      setupSource: 'standard',
      cycleSource: 'standard',
      setupConfidence: null,
      cycleConfidence: null,
    }
  if (items.length === 0) {
    const now0 = 0
    return { placements: [], horizonStartMs: now0, horizonEndMs: now0 }
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

  const remaining = [...items]
  const placements: Placement[] = []
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

  while (remaining.length > 0) {
    let bestIdx = -1
    let bestRank = Number.POSITIVE_INFINITY
    let bestItem: SequencerItem | null = null
    let bestRes = ''
    for (let i = 0; i < remaining.length; i++) {
      const item = remaining[i]!
      if (!isReady(item)) continue // precedence: predecessor not placed yet → not a candidate
      const res = assignResource(item)
      const st = stateFor(res)
      const sameAttr =
        st.currentAttr !== null && item.changeoverValue !== null && st.currentAttr === item.changeoverValue
      const allowBonus = item.firmness === 'forecast' || policy?.changeoverBonusAllFirmness === true
      const bonus = allowBonus && sameAttr ? CHANGEOVER_BONUS_HOURS : 0
      const expedite = policy?.expediteDemandLineIds?.has(item.demandLineId) ? EXPEDITE_BONUS_HOURS : 0
      // readyFirst: an op not yet material-ready at this resource's free time is deferred so
      // ready (ungated) work takes the early slots — fills the pre-arrival gap (re-sequence-around).
      const notReady = policy?.readyFirst === true && (item.earliestStartMs ?? 0) > st.freeMs ? READY_DEFER_HOURS : 0
      const rank = (item.requiredDate - origin) / MS_PER_HOUR - bonus - expedite + notReady
      if (bestItem === null || rank < bestRank || (rank === bestRank && tieBreakLess(item, bestItem))) {
        bestRank = rank
        bestIdx = i
        bestItem = item
        bestRes = res
      }
    }

    const item = bestItem! // at least one item is always ready (the lowest unplaced opSeq per line)
    const st = stateFor(bestRes)
    const cal = calFor(bestRes)
    // The op can't start before its consumed buy-components are available (the D36 material
    // gate, resolved upstream into earliestStartMs) — a third floor on the cursor, alongside
    // the resource's free time and the schedule origin. placeJob then walks that floor into
    // working time exactly as it does the others; the gate adds no placement machinery.
    const earliest = item.earliestStartMs ?? 0
    const release = item.releaseFloorMs ?? 0 // order-release floor (past demand → its day; today/future → today)
    const predEnd = predecessorEnd(item) // C3 precedence: can't start before the prior op ends
    const prevFree = st.freeMs
    const floor = Math.max(prevFree, origin, earliest, predEnd, release)
    // Resolve the effective times AT the op's start floor — a forward-only forecast overlay
    // (`ml_predicted`, D44) gates itself by when the op actually runs, so an op landing on a
    // past day falls back to its std/measured cycle instead of carrying the pre-adopted forecast.
    const eff = effectiveFor(item, bestRes, floor)
    // Operator performance (C5): the operator pinned to this resource at op start scales RUN time.
    // effectiveCycle = baseCycle / performanceFactor — a DELIBERATE DIVIDE (higher factor = faster);
    // setup is untouched. Point-resolved at the cursor floor (the op's start), like the material
    // gate — one factor per placement, no intra-op split. No assignment → factor 1.0 (no-op).
    const operator = resolveOperator?.(bestRes, floor) ?? null
    const perf = operator?.performanceFactor ?? 1
    const effCycle = perf > 0 ? eff.cycleTime / perf : eff.cycleTime
    // Minimum batch floor (C4): an op won't run below its resource type's minimum batch — a die
    // setup isn't worth a 3-part run. effectiveRunQty = max(demandQty, minBatch); when it binds it
    // RUNS TO MINIMUM (the realistic production behavior). A pure per-op floor, no batch merging.
    // 0 / no entry → no floor (effRunQty = demandQty). Drives both duration and run qty. Where the
    // surplus (effRunQty − demandQty) goes (inventory/netting) is a documented future refinement —
    // the seed keeps demand ≥ minBatch so it never binds by default, so no disposition is needed.
    const effRunQty = Math.max(item.qty, minBatchByResource?.get(bestRes) ?? 0)
    const durMs = (eff.setupTime + effCycle * effRunQty) * MS_PER_MINUTE
    // Calendar-aware placement: advance the cursor through working time only (skipping
    // nights / Sundays / holidays / maintenance / down). A null result means the op cannot
    // fit (non-split op longer than any working segment, no OT) — the service feasibility
    // gate is responsible for rejecting those; fall back to contiguous + at-risk defensively.
    const placed = placeJob(cal, floor, durMs, st.ot)
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
    const dtWindows = downtimeByResource?.get(bestRes)
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
      resourceId: bestRes,
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
    remaining.splice(bestIdx, 1)
  }

  return { placements, horizonStartMs: origin, horizonEndMs }
}

/** Total-order tie-break: firm first → earlier due → higher priority → partNo → demandLineId. */
function tieBreakLess(a: SequencerItem, b: SequencerItem): boolean {
  if (firmRank(a.firmness) !== firmRank(b.firmness)) return firmRank(a.firmness) < firmRank(b.firmness)
  if (a.requiredDate !== b.requiredDate) return a.requiredDate < b.requiredDate
  if (a.priorityRank !== b.priorityRank) return a.priorityRank < b.priorityRank
  if (a.partNo !== b.partNo) return a.partNo < b.partNo
  return a.demandLineId < b.demandLineId
}
