import { describe, expect, it } from 'vitest'
import {
  bucketStartUtc,
  bucketStartsInRange,
  DEFAULT_ON_TIME_DEFINITION,
  isOrderLate,
  kpiStatus,
} from './kpi-measures'

const DAY = 86_400_000
const MIN = 60_000
// 2024-01-01 is a Monday (UTC) — anchor the bucket tests on a known week.
const MON = Date.UTC(2024, 0, 1)
const WED = MON + 2 * DAY
const SUN = MON + 6 * DAY

describe('isOrderLate — default reproduces the current rule', () => {
  const due = Date.UTC(2026, 5, 29, 12)
  it('on time when delivery <= due', () => {
    expect(isOrderLate(due - 1, due)).toBe(false)
    expect(isOrderLate(due, due)).toBe(false) // exactly on due is NOT late (delivery > due)
  })
  it('late when delivery > due (default tolerance 0)', () => {
    expect(isOrderLate(due + 1, due)).toBe(true)
  })
  it('never late when there is no due on record', () => {
    expect(isOrderLate(due + DAY, null)).toBe(false)
  })
  it('the default definition is zero tolerance', () => {
    expect(DEFAULT_ON_TIME_DEFINITION.toleranceMinutes).toBe(0)
  })
})

describe('isOrderLate — tolerance grants grace', () => {
  const due = Date.UTC(2026, 5, 29, 12)
  it('within the tolerance window is on time', () => {
    expect(isOrderLate(due + 90 * MIN, due, { toleranceMinutes: 120 })).toBe(false)
  })
  it('past the tolerance window is late', () => {
    expect(isOrderLate(due + 121 * MIN, due, { toleranceMinutes: 120 })).toBe(true)
  })
})

describe('bucketStartUtc', () => {
  it('day bucket = UTC midnight of the instant', () => {
    expect(bucketStartUtc(WED + 13 * 3_600_000, 'day')).toBe(WED)
  })
  it('week bucket = the Monday of that week (Wed → Mon)', () => {
    expect(bucketStartUtc(WED + 13 * 3_600_000, 'week')).toBe(MON)
  })
  it('week bucket maps Sunday back to the same Monday', () => {
    expect(bucketStartUtc(SUN + 5 * 3_600_000, 'week')).toBe(MON)
  })
})

describe('bucketStartsInRange', () => {
  it('lists daily bucket starts across the range (empty periods still appear)', () => {
    expect(bucketStartsInRange(MON, MON + 3 * DAY, 'day')).toEqual([MON, MON + DAY, MON + 2 * DAY])
  })
  it('lists weekly bucket starts aligned to Monday', () => {
    expect(bucketStartsInRange(WED, MON + 9 * DAY, 'week')).toEqual([MON, MON + 7 * DAY])
  })
})

describe('kpiStatus', () => {
  const higher = { direction: 'higher' as const, green: 0.95, amber: 0.9 }
  const lower = { direction: 'lower' as const, green: 0.02, amber: 0.05 }
  it('higher-better: green/amber/red by band', () => {
    expect(kpiStatus(0.97, higher)).toBe('green')
    expect(kpiStatus(0.92, higher)).toBe('amber')
    expect(kpiStatus(0.8, higher)).toBe('red')
    expect(kpiStatus(0.95, higher)).toBe('green') // exactly green edge
  })
  it('lower-better: green/amber/red by band (inverted)', () => {
    expect(kpiStatus(0.01, lower)).toBe('green')
    expect(kpiStatus(0.04, lower)).toBe('amber')
    expect(kpiStatus(0.09, lower)).toBe('red')
  })
  it('null value or null band → none (no judgement)', () => {
    expect(kpiStatus(null, higher)).toBe('none')
    expect(kpiStatus(0.9, null)).toBe('none')
  })
})
