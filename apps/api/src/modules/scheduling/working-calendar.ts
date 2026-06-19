/**
 * Working-calendar placement primitives — the calendar-aware core of the shift model.
 *
 * The sequencer used to treat every resource as a single continuous 24/7 timeline. This
 * module replaces that with a **calendar-walking cursor**: a job consumes *working* time
 * only, skipping nights, closed weekdays (Sunday), holidays, maintenance windows and
 * time-boxed line-down intervals. Everything is **pure and deterministic** (D2): all math
 * is integer epoch-ms + the normalized {@link WorkingCalendar}; weekday/date come from
 * `Date` getters that take an explicit ms (no `Date.now()`), so identical inputs always
 * produce identical placements.
 *
 * Two placement modes (locked design):
 * - **non-split** (default): the whole op must fit one contiguous working segment; a
 *   too-short tail is discarded and the op moves to the next segment.
 * - **split** (resource-type `splittable`): the op pauses across closed gaps, only its
 *   working minutes count toward duration, so it may span several days of wall-clock.
 *
 * **Overtime** extends a segment past shift-end into closed time, capped per day
 * (`otCapMinutes`); a normal `solve()` passes no OT budget (cap 0) — OT is funded only by
 * an explicit what-if policy.
 */

const MS_PER_MINUTE = 60_000
const MS_PER_DAY = 86_400_000
const MINUTES_PER_DAY = 1440
/** Safety horizon so segment scanning always terminates (≈5y of closed days → infeasible). */
const MAX_SCAN_DAYS = 366 * 5

/**
 * A normalized, pure calendar for placement (built once per resource from master data via
 * {@link buildWorkingCalendar}). All ms are epoch-UTC; minutes are from UTC midnight.
 */
export interface WorkingCalendar {
  /** UTC weekdays that are working (0=Sun … 6=Sat). Default Mon–Sat; Sunday excluded. */
  workingDays: number[]
  /** Working intervals within a day as `[startMin, endMin)`, merged and sorted ascending. */
  dayWindows: Array<[number, number]>
  /** `YYYY-MM-DD` (UTC) full-day closures. */
  holidays: Set<string>
  /** Epoch-ms closed intervals `[start, end)` (maintenance + line-down), sorted and merged. */
  closedIntervals: Array<[number, number]>
  /** Interruptible ops may pause across closed gaps (resource-type level). */
  splittable: boolean
  /** Max OT minutes the resource may run past its windows into closed time, **per UTC day**. */
  otCapMinutes: number
}

/** Per-resource overtime ledger — minutes already spent on a given UTC day (mutated in place). */
export interface OvertimeState {
  usedByDay: Map<number, number>
}

/** A fresh, empty overtime ledger. */
export const newOvertimeState = (): OvertimeState => ({ usedByDay: new Map() })

/**
 * An always-on 24/7 calendar — the fallback for resources without a calendar, so existing
 * behaviour (and tests that supply no calendar) is preserved exactly: one all-day window
 * every weekday merges across midnight into a single unbounded continuous timeline.
 */
export const ALWAYS_ON: WorkingCalendar = {
  workingDays: [0, 1, 2, 3, 4, 5, 6],
  dayWindows: [[0, MINUTES_PER_DAY]],
  holidays: new Set(),
  closedIntervals: [],
  splittable: false,
  otCapMinutes: 0,
}

/** UTC midnight (epoch ms) of the day containing `ms`. */
export function startOfDayUtc(ms: number): number {
  return Math.floor(ms / MS_PER_DAY) * MS_PER_DAY
}

/** Parse an `HH:MM` clock string to minutes-from-midnight (`24:00` → 1440). */
function parseClock(s: string): number {
  const [h = '0', m = '0'] = s.split(':')
  return Number(h) * 60 + Number(m)
}

/** Sort + merge `[start, end)` intervals (adjacent/overlapping coalesce). */
function mergeIntervals(intervals: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...intervals].filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const out: Array<[number, number]> = []
  for (const [s, e] of sorted) {
    const last = out[out.length - 1]
    if (last && s <= last[1]) last[1] = Math.max(last[1], e)
    else out.push([s, e])
  }
  return out
}

/**
 * Build a normalized {@link WorkingCalendar} from raw master-data inputs (pure). Shift
 * patterns are `HH:MM` strings; `workingDays` defaults to Mon–Sat. Reused by the service
 * (resource-type `splittable` / `otCapMinutes` resolved by the caller) and by tests.
 */
export function buildWorkingCalendar(input: {
  workingDays?: number[]
  shiftPatterns: Array<{ start: string; end: string }>
  holidays?: string[]
  closedIntervals?: Array<[number, number]>
  splittable?: boolean
  otCapMinutes?: number
}): WorkingCalendar {
  return {
    workingDays: input.workingDays ?? [1, 2, 3, 4, 5, 6],
    dayWindows: mergeIntervals(input.shiftPatterns.map((p) => [parseClock(p.start), parseClock(p.end)])),
    holidays: new Set(input.holidays ?? []),
    closedIntervals: mergeIntervals(input.closedIntervals ?? []),
    splittable: input.splittable ?? false,
    otCapMinutes: input.otCapMinutes ?? 0,
  }
}

/** Is `dayStartMs` (a UTC midnight) a working day for this calendar (weekday + not holiday)? */
function dayIsWorking(cal: WorkingCalendar, dayStartMs: number): boolean {
  const d = new Date(dayStartMs)
  if (!cal.workingDays.includes(d.getUTCDay())) return false
  return !cal.holidays.has(d.toISOString().slice(0, 10))
}

/** Raw epoch working windows for a single UTC day (before closed-interval subtraction). */
function dayEpochWindows(cal: WorkingCalendar, dayStartMs: number): Array<[number, number]> {
  if (!dayIsWorking(cal, dayStartMs)) return []
  return cal.dayWindows.map(([s, e]) => [dayStartMs + s * MS_PER_MINUTE, dayStartMs + e * MS_PER_MINUTE] as [number, number])
}

/** First open `[start, end)` sub-interval of `[from, limit)` not covered by closures. */
function firstOpenSubinterval(closed: Array<[number, number]>, from: number, limit: number): [number, number] | null {
  let cur = from
  for (const [cs, ce] of closed) {
    if (ce <= cur) continue
    if (cs >= limit) break
    if (cs <= cur) {
      cur = Math.max(cur, ce)
      if (cur >= limit) return null
      continue
    }
    return [cur, Math.min(cs, limit)]
  }
  return cur < limit ? [cur, limit] : null
}

/**
 * The next **day-bounded** working interval whose end is `> fromMs` (start may be `< fromMs`
 * when `fromMs` lands inside it). Shift windows are merged within a day and closed intervals
 * subtracted; segments are intentionally **not** merged across midnight here — adjacency
 * (a 24/7 or night-shift calendar) is chained on demand by {@link placeJob}, which keeps the
 * cost bounded by the job duration rather than the horizon. Returns `null` only if no working
 * time exists within the safety horizon.
 */
export function nextWorkingSegment(cal: WorkingCalendar, fromMs: number): [number, number] | null {
  let day = startOfDayUtc(fromMs)
  for (let scanned = 0; scanned < MAX_SCAN_DAYS; scanned++, day += MS_PER_DAY) {
    const wins = dayEpochWindows(cal, day)
    for (let w = 0; w < wins.length; w++) {
      let [segStart, segEnd] = wins[w]!
      if (segEnd <= fromMs) continue
      // Extend across adjacent windows within the same day (e.g. shift A + shift B).
      let nw = w + 1
      while (nw < wins.length && wins[nw]![0] <= segEnd) {
        segEnd = Math.max(segEnd, wins[nw]![1])
        nw++
      }
      const sub = firstOpenSubinterval(cal.closedIntervals, Math.max(segStart, fromMs), segEnd)
      if (sub) return sub
      // The whole window is closed (maintenance/down) — continue past it.
      return nextWorkingSegment(cal, segEnd)
    }
  }
  return null
}

/**
 * The maximal **contiguous** working run starting at the first working instant ≥ `fromMs`,
 * chaining day-bounded segments while each is adjacent to the last (so 24/7 / night shifts
 * read as one block). Stops as soon as the run reaches `needMs` of length (bounded cost) or
 * a non-working gap appears. Returns `{ start, end }` of the run (end may be the gap, capped
 * once it is long enough to satisfy `needMs`), or `null` if no working time exists.
 */
function contiguousRun(cal: WorkingCalendar, fromMs: number, needMs: number): { start: number; end: number } | null {
  const first = nextWorkingSegment(cal, fromMs)
  if (!first) return null
  const start = Math.max(first[0], fromMs)
  let end = first[1]
  while (end - start < needMs) {
    const next = nextWorkingSegment(cal, end)
    if (!next || next[0] > end) break // gap → run ends here
    end = next[1]
  }
  return { start, end }
}

/** A placed job: wall-clock start/end (closed gaps may sit between for split jobs) + OT used. */
export interface PlaceResult {
  startMs: number
  endMs: number
  otSpentMinutes: number
}

const otRemainingMs = (cal: WorkingCalendar, ot: OvertimeState, dayMs: number): number =>
  Math.max(0, cal.otCapMinutes - (ot.usedByDay.get(dayMs) ?? 0)) * MS_PER_MINUTE
const spendOt = (ot: OvertimeState, dayMs: number, ms: number): void => {
  ot.usedByDay.set(dayMs, (ot.usedByDay.get(dayMs) ?? 0) + ms / MS_PER_MINUTE)
}

/** Non-split: the op runs in one contiguous working run (OT may extend it to fit). */
function placeNonSplit(cal: WorkingCalendar, cursorMs: number, durMs: number, ot: OvertimeState): PlaceResult | null {
  let from = cursorMs
  for (let guard = 0; guard < MAX_SCAN_DAYS; guard++) {
    const run = contiguousRun(cal, from, durMs)
    if (!run) return null
    const avail = run.end - run.start
    if (avail >= durMs) return { startMs: run.start, endMs: run.start + durMs, otSpentMinutes: 0 }
    // The run is too short — try to extend past its end into closed time with the OT budget.
    const dayMs = startOfDayUtc(run.end - 1)
    const need = durMs - avail
    if (otRemainingMs(cal, ot, dayMs) >= need) {
      spendOt(ot, dayMs, need)
      return { startMs: run.start, endMs: run.start + durMs, otSpentMinutes: need / MS_PER_MINUTE }
    }
    from = run.end // discard the short tail, try the next run
  }
  return null
}

/** Split: the op pauses across closed gaps; only working minutes count toward `durMs`. */
function placeSplit(cal: WorkingCalendar, cursorMs: number, durMs: number, ot: OvertimeState): PlaceResult | null {
  const first = nextWorkingSegment(cal, cursorMs)
  if (!first) return null
  const startMs = Math.max(first[0], cursorMs)
  let remaining = durMs
  let otSpentMs = 0
  let from = startMs
  for (let guard = 0; guard < MAX_SCAN_DAYS; guard++) {
    const seg = nextWorkingSegment(cal, from)
    if (!seg) return null
    const cur = Math.max(seg[0], from)
    const avail = seg[1] - cur
    if (avail >= remaining) return { startMs, endMs: cur + remaining, otSpentMinutes: otSpentMs / MS_PER_MINUTE }
    remaining -= avail
    // Extend this day's segment past shift-end with its remaining OT budget.
    const dayMs = startOfDayUtc(seg[0])
    const otAvail = otRemainingMs(cal, ot, dayMs)
    if (otAvail > 0) {
      const use = Math.min(otAvail, remaining)
      spendOt(ot, dayMs, use)
      otSpentMs += use
      remaining -= use
      if (remaining <= 0) return { startMs, endMs: seg[1] + use, otSpentMinutes: otSpentMs / MS_PER_MINUTE }
    }
    from = seg[1]
  }
  return null
}

/**
 * Place a job of `durMs` **working** time on this calendar starting no earlier than
 * `cursorMs`. Splits or runs contiguously per `cal.splittable`; spends OT (capped per day,
 * mutating `ot`) when needed. Returns `null` when the job cannot be placed within the
 * horizon (e.g. non-split op longer than any segment with no OT → caller treats as
 * infeasible). `durMs <= 0` snaps to the next working instant with zero length.
 */
export function placeJob(cal: WorkingCalendar, cursorMs: number, durMs: number, ot: OvertimeState): PlaceResult | null {
  if (durMs <= 0) {
    const seg = nextWorkingSegment(cal, cursorMs)
    const s = seg ? Math.max(seg[0], cursorMs) : cursorMs
    return { startMs: s, endMs: s, otSpentMinutes: 0 }
  }
  return cal.splittable ? placeSplit(cal, cursorMs, durMs, ot) : placeNonSplit(cal, cursorMs, durMs, ot)
}
