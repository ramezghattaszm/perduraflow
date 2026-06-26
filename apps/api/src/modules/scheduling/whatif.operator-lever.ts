/**
 * Part B — the "assign a faster operator" remediation lever (C5).
 *
 * When a firm at-risk order's lateness chain roots at the OPERATOR (a slow operator inflated the run so
 * it finishes late — Part A's `operator` root), the matched fix is to put a FASTER operator on that line.
 * This module is the pure, deterministic core: given the contended resource, the op's window, the current
 * operator's factor, and the plant roster + live assignments, it picks the candidate (or returns null =
 * honest-unavailable, so the option is simply not offered). The what-if engine overlays the candidate on
 * the resource and re-solves; the score now reflects the candidate's LABOR cost honestly (wi-12), so this
 * lever ranks against overtime / reroute on real $ — never preferred just because its labor was invisible.
 *
 * Pure + deterministic (no `Date.now()`, total-order tie-break) so `evaluate` and `applyOption` compute
 * the SAME candidate from the same inputs — the what-if determinism contract.
 */

/** A plant operator the lever may draw on (slim projection of `OperatorDto`). */
export interface OperatorRosterEntry {
  id: string
  name: string
  homePlantId: string
  performanceFactor: number
  laborRate: number | null
  available: boolean
  isActive: boolean
}

/** A live operator→resource assignment window (epoch ms; null = open bound), for the double-booking guard. */
export interface OperatorAssignmentWindow {
  resourceId: string
  operatorId: string
  effectiveFromMs: number | null
  effectiveToMs: number | null
}

/** Do `[aFrom, aTo)` and `[bFrom, bTo)` overlap? null bound = open (±∞). Mirrors the service guard. */
function windowsOverlapMs(aFrom: number | null, aTo: number | null, bFrom: number | null, bTo: number | null): boolean {
  const af = aFrom ?? Number.NEGATIVE_INFINITY
  const at = aTo ?? Number.POSITIVE_INFINITY
  const bf = bFrom ?? Number.NEGATIVE_INFINITY
  const bt = bTo ?? Number.POSITIVE_INFINITY
  return af < bt && bf < at
}

/** Would assigning `operatorId` to `resourceId` over `[from,to)` clash with another line they cover? */
function isDoubleBooked(
  operatorId: string,
  resourceId: string,
  windowFromMs: number | null,
  windowToMs: number | null,
  assignments: OperatorAssignmentWindow[],
): boolean {
  return assignments.some(
    (a) =>
      a.operatorId === operatorId &&
      a.resourceId !== resourceId && // same resource is the replace-open switch, not a clash
      windowsOverlapMs(windowFromMs, windowToMs, a.effectiveFromMs, a.effectiveToMs),
  )
}

/**
 * Pick the faster-operator candidate for a slow-operator-rooted op, or null (honest-unavailable).
 *
 * A candidate must be: **active**, **present next shift** (`available`), **home to the op's plant**
 * (we only float in same-plant operators — matches the lane lever's plant scope), **strictly faster**
 * than the current operator, and **not double-booked** in the op's window. Among those, the FASTEST
 * wins; ties break to **cheaper labor**, then id — so the pick is deterministic AND cost-aware.
 *
 * @returns the candidate, or null when no eligible faster operator exists (the option is then not offered).
 */
export function pickFasterOperator(args: {
  resourceId: string
  plantId: string
  /** The op's placed window — bounds the assignment + the double-booking check. */
  windowFromMs: number | null
  windowToMs: number | null
  /** The current operator's performance factor on the resource (1.0 = standard). */
  currentFactor: number
  roster: OperatorRosterEntry[]
  assignments: OperatorAssignmentWindow[]
}): OperatorRosterEntry | null {
  const { resourceId, plantId, windowFromMs, windowToMs, currentFactor, roster, assignments } = args
  const eligible = roster.filter(
    (o) =>
      o.isActive &&
      o.available &&
      o.homePlantId === plantId &&
      o.performanceFactor > currentFactor &&
      !isDoubleBooked(o.id, resourceId, windowFromMs, windowToMs, assignments),
  )
  if (eligible.length === 0) return null
  eligible.sort(
    (a, b) =>
      b.performanceFactor - a.performanceFactor || // fastest first
      (a.laborRate ?? Number.POSITIVE_INFINITY) - (b.laborRate ?? Number.POSITIVE_INFINITY) || // then cheaper
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0), // total-order tie-break
  )
  return eligible[0]!
}
