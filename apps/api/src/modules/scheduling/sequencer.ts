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
export type ResolveEffective = (routingOperationId: string, resourceId: string, stdSetup: number, stdCycle: number) => EffectiveTimes

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
): SequencerResult {
  // A resource's operating calendar (working windows / closures / OT). Resources without
  // one fall back to ALWAYS_ON (24/7) so existing callers and tests are unaffected.
  const calFor = (resourceId: string): WorkingCalendar => resourceCalendars?.get(resourceId) ?? ALWAYS_ON
  const effectiveFor = (item: SequencerItem, resourceId: string): EffectiveTimes =>
    resolveEffective?.(item.routingOperationId, resourceId, item.setupTime, item.cycleTime) ?? {
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
      s = { freeMs: origin, currentAttr: null, seq: 0, ot: newOvertimeState() }
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

  while (remaining.length > 0) {
    let bestIdx = 0
    let bestRank = Number.POSITIVE_INFINITY
    let bestItem = remaining[0]!
    let bestRes = assignResource(bestItem)
    for (let i = 0; i < remaining.length; i++) {
      const item = remaining[i]!
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
      if (rank < bestRank || (rank === bestRank && tieBreakLess(item, bestItem))) {
        bestRank = rank
        bestIdx = i
        bestItem = item
        bestRes = res
      }
    }

    const item = bestItem
    const st = stateFor(bestRes)
    const eff = effectiveFor(item, bestRes)
    const cal = calFor(bestRes)
    const durMs = (eff.setupTime + eff.cycleTime * item.qty) * MS_PER_MINUTE
    // The op can't start before its consumed buy-components are available (the D36 material
    // gate, resolved upstream into earliestStartMs) — a third floor on the cursor, alongside
    // the resource's free time and the schedule origin. placeJob then walks that floor into
    // working time exactly as it does the others; the gate adds no placement machinery.
    const earliest = item.earliestStartMs ?? 0
    const prevFree = st.freeMs
    const floor = Math.max(prevFree, origin, earliest)
    // The material gate is the binding constraint when it set the floor (later than the
    // resource's free time and the origin) — names the cause for the board/narration (D36).
    const materialBound = earliest > 0 && earliest >= prevFree && earliest >= origin
    // Calendar-aware placement: advance the cursor through working time only (skipping
    // nights / Sundays / holidays / maintenance / down). A null result means the op cannot
    // fit (non-split op longer than any working segment, no OT) — the service feasibility
    // gate is responsible for rejecting those; fall back to contiguous + at-risk defensively.
    const placed = placeJob(cal, floor, durMs, st.ot)
    const startMs = placed?.startMs ?? floor
    const endMs = placed?.endMs ?? startMs + durMs
    st.freeMs = endMs
    st.currentAttr = item.changeoverValue
    st.seq += 1
    const atRisk = endMs > item.requiredDate || placed === null
    placements.push({
      demandLineId: item.demandLineId,
      partId: item.partId,
      routingOperationId: item.routingOperationId,
      resourceId: bestRes,
      opSeq: item.opSeq,
      sequencePosition: st.seq,
      plannedStartMs: startMs,
      plannedEndMs: endMs,
      qty: item.qty,
      setupTime: eff.setupTime,
      cycleTime: eff.cycleTime,
      setupSource: eff.setupSource,
      cycleSource: eff.cycleSource,
      setupConfidence: eff.setupConfidence,
      cycleConfidence: eff.cycleConfidence,
      atRisk,
      atRiskReason: placed === null ? 'exceeds_working_window' : atRisk ? (materialBound ? 'material' : 'late') : null,
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
