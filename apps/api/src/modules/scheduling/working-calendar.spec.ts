import { describe, expect, it } from 'vitest'
import {
  ALWAYS_ON,
  buildWorkingCalendar,
  newOvertimeState,
  nextWorkingSegment,
  placeJob,
  workingMinutesInRange,
  type WorkingCalendar,
} from './working-calendar'

const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

// Anchor on a known UTC week: 2024-01-01 is a Monday.
const MON = Date.UTC(2024, 0, 1)
const TUE = MON + DAY
const WED = MON + 2 * DAY
const SAT = MON + 5 * DAY
const SUN = MON + 6 * DAY
const NEXT_MON = MON + 7 * DAY
const at = (day: number, h: number, m = 0) => day + h * HOUR + m * MIN

/** Seed-shaped two-shift calendar: A 06:00–14:00 + B 14:00–22:00 (merge → 06:00–22:00), Mon–Sat. */
const twoShift = (over: Partial<Parameters<typeof buildWorkingCalendar>[0]> = {}): WorkingCalendar =>
  buildWorkingCalendar({ shiftPatterns: [{ start: '06:00', end: '14:00' }, { start: '14:00', end: '22:00' }], ...over })

describe('buildWorkingCalendar', () => {
  it('merges adjacent shifts into one window and defaults to Mon–Sat', () => {
    const cal = twoShift()
    expect(cal.dayWindows).toEqual([[360, 1320]]) // 06:00–22:00
    expect(cal.workingDays).toEqual([1, 2, 3, 4, 5, 6])
  })
})

describe('nextWorkingSegment', () => {
  it('returns the full daily span from before the shift', () => {
    expect(nextWorkingSegment(twoShift(), MON)).toEqual([at(MON, 6), at(MON, 22)])
  })

  it('clamps the start to a cursor inside the window', () => {
    expect(nextWorkingSegment(twoShift(), at(MON, 10))).toEqual([at(MON, 10), at(MON, 22)])
  })

  it('jumps to the next day when the cursor is after shift end', () => {
    expect(nextWorkingSegment(twoShift(), at(MON, 23))).toEqual([at(TUE, 6), at(TUE, 22)])
  })

  it('skips Sunday (closed weekday)', () => {
    expect(nextWorkingSegment(twoShift(), at(SAT, 23))).toEqual([at(NEXT_MON, 6), at(NEXT_MON, 22)])
  })

  it('skips a holiday', () => {
    const cal = twoShift({ holidays: ['2024-01-02'] }) // Tue
    expect(nextWorkingSegment(cal, at(MON, 23))).toEqual([at(WED, 6), at(WED, 22)])
  })

  it('splits a segment around a maintenance closure', () => {
    const cal = twoShift({ closedIntervals: [[at(MON, 10), at(MON, 12)]] })
    expect(nextWorkingSegment(cal, at(MON, 6))).toEqual([at(MON, 6), at(MON, 10)])
    expect(nextWorkingSegment(cal, at(MON, 10))).toEqual([at(MON, 12), at(MON, 22)])
  })

  it('returns a day-bounded segment for ALWAYS_ON (adjacency chained on demand by placeJob)', () => {
    const seg = nextWorkingSegment(ALWAYS_ON, at(MON, 10))!
    expect(seg).toEqual([at(MON, 10), TUE]) // [Mon 10:00, Tue 00:00); next day chained during placement
  })
})

describe('placeJob — non-split (default)', () => {
  it('places a job that fits inside the window', () => {
    const r = placeJob(twoShift(), at(MON, 6), 120 * MIN, newOvertimeState())
    expect(r).toEqual({ startMs: at(MON, 6), endMs: at(MON, 8), otSpentMinutes: 0 })
  })

  it('discards a too-short tail and moves to the next segment', () => {
    // Cursor 21:00 → only 60m left before 22:00; a 120m job cannot fit → next day 06:00.
    const r = placeJob(twoShift(), at(MON, 21), 120 * MIN, newOvertimeState())
    expect(r).toEqual({ startMs: at(TUE, 6), endMs: at(TUE, 8), otSpentMinutes: 0 })
  })

  it('fills the window exactly (16h)', () => {
    const r = placeJob(twoShift(), at(MON, 6), 960 * MIN, newOvertimeState())
    expect(r).toEqual({ startMs: at(MON, 6), endMs: at(MON, 22), otSpentMinutes: 0 })
  })

  it('returns null when longer than any segment and no OT (→ infeasible)', () => {
    expect(placeJob(twoShift(), at(MON, 6), 1000 * MIN, newOvertimeState())).toBeNull()
  })

  it('uses overtime to extend past shift-end, within the daily cap', () => {
    const cal = twoShift({ otCapMinutes: 120 })
    const r = placeJob(cal, at(MON, 21), 120 * MIN, newOvertimeState())
    expect(r).toEqual({ startMs: at(MON, 21), endMs: at(MON, 23), otSpentMinutes: 60 })
  })

  it('respects the OT cap (cannot extend beyond it)', () => {
    const cal = twoShift({ otCapMinutes: 30 })
    const r = placeJob(cal, at(MON, 21), 120 * MIN, newOvertimeState())
    expect(r).toEqual({ startMs: at(TUE, 6), endMs: at(TUE, 8), otSpentMinutes: 0 }) // OT too small → next day
  })
})

describe('placeJob — split (interruptible)', () => {
  const splitCal = (over = {}) => twoShift({ splittable: true, ...over })

  it('pauses across the overnight gap, counting working minutes only', () => {
    // 16h (fills Mon) + 2h spill → resumes Tue 06:00, ends Tue 08:00; start stays Mon 06:00.
    const r = placeJob(splitCal(), at(MON, 6), (960 + 120) * MIN, newOvertimeState())
    expect(r).toEqual({ startMs: at(MON, 6), endMs: at(TUE, 8), otSpentMinutes: 0 })
  })

  it('skips Sunday while accumulating working time', () => {
    // Start Sat 20:00 (2h to 22:00), 4h more → Mon 06:00 + 4h = Mon 10:00.
    const r = placeJob(splitCal(), at(SAT, 20), (2 * 60 + 4 * 60) * MIN, newOvertimeState())
    expect(r).toEqual({ startMs: at(SAT, 20), endMs: at(NEXT_MON, 10), otSpentMinutes: 0 })
  })
})

describe('placeJob — edge + determinism', () => {
  it('zero-duration snaps to the next working instant', () => {
    const r = placeJob(twoShift(), at(MON, 3), 0, newOvertimeState())
    expect(r).toEqual({ startMs: at(MON, 6), endMs: at(MON, 6), otSpentMinutes: 0 })
  })

  it('is deterministic — identical inputs, identical output', () => {
    const a = placeJob(twoShift(), at(MON, 21), 120 * MIN, newOvertimeState())
    const b = placeJob(twoShift(), at(MON, 21), 120 * MIN, newOvertimeState())
    expect(a).toEqual(b)
  })

  it('ALWAYS_ON behaves like a continuous 24/7 timeline', () => {
    const r = placeJob(ALWAYS_ON, at(MON, 20), 8 * 60 * MIN, newOvertimeState())
    expect(r).toEqual({ startMs: at(MON, 20), endMs: at(TUE, 4), otSpentMinutes: 0 }) // runs straight through midnight
  })
})

describe('workingMinutesInRange — utilization denominator (D-util)', () => {
  it('one full working day = the shift span (06:00–22:00 = 960 min)', () => {
    expect(workingMinutesInRange(twoShift(), MON, MON + DAY)).toBe(960)
  })

  it('sums only working days across a range (Sat counts, Sun does not)', () => {
    // Sat 06:00 → Mon 06:00: Sat (960) + Sun (0, closed weekday) = 960.
    expect(workingMinutesInRange(twoShift(), SAT, SAT + 2 * DAY)).toBe(960)
  })

  it('excludes holidays', () => {
    const cal = twoShift({ holidays: ['2024-01-02'] }) // Tue
    expect(workingMinutesInRange(cal, MON, WED)).toBe(960) // Mon 960 + Tue 0
  })

  it('subtracts maintenance / line-down closures', () => {
    const cal = twoShift({ closedIntervals: [[at(MON, 10), at(MON, 12)]] })
    expect(workingMinutesInRange(cal, MON, MON + DAY)).toBe(960 - 120)
  })

  it('clips to a partial range', () => {
    expect(workingMinutesInRange(twoShift(), at(MON, 10), at(MON, 14))).toBe(240)
  })

  it('excludes overtime — no regular minutes past shift end', () => {
    expect(workingMinutesInRange(twoShift(), at(MON, 22), at(TUE, 2))).toBe(0)
  })

  it('empty/inverted range = 0', () => {
    expect(workingMinutesInRange(twoShift(), MON, MON)).toBe(0)
    expect(workingMinutesInRange(twoShift(), MON + DAY, MON)).toBe(0)
  })
})
