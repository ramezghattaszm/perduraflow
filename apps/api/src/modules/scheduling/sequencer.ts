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

/** Forecast job may pull ahead by at most this many hours to group a changeover (documented constant). */
export const CHANGEOVER_BONUS_HOURS = 24
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
}

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
  atRisk: boolean
  atRiskReason: string | null
}

export interface SequencerResult {
  placements: Placement[]
  horizonStartMs: number
  horizonEndMs: number
}

interface ResourceState {
  freeMs: number
  currentAttr: string | null
  seq: number
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
export function sequence(items: SequencerItem[]): SequencerResult {
  if (items.length === 0) {
    const now0 = 0
    return { placements: [], horizonStartMs: now0, horizonEndMs: now0 }
  }
  const origin = startOfDayUtc(Math.min(...items.map((i) => i.requiredDate)))
  const state = new Map<string, ResourceState>()
  const stateFor = (id: string): ResourceState => {
    let s = state.get(id)
    if (!s) {
      s = { freeMs: origin, currentAttr: null, seq: 0 }
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
      const bonus = item.firmness === 'forecast' && sameAttr ? CHANGEOVER_BONUS_HOURS : 0
      const rank = (item.requiredDate - origin) / MS_PER_HOUR - bonus
      if (rank < bestRank || (rank === bestRank && tieBreakLess(item, bestItem))) {
        bestRank = rank
        bestIdx = i
        bestItem = item
        bestRes = res
      }
    }

    const item = bestItem
    const st = stateFor(bestRes)
    const startMs = Math.max(st.freeMs, origin)
    const durMs = (item.setupTime + item.cycleTime * item.qty) * MS_PER_MINUTE
    const endMs = startMs + durMs
    st.freeMs = endMs
    st.currentAttr = item.changeoverValue
    st.seq += 1
    const atRisk = endMs > item.requiredDate
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
      setupTime: item.setupTime,
      cycleTime: item.cycleTime,
      atRisk,
      atRiskReason: atRisk ? 'late' : null,
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
