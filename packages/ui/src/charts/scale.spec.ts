import { describe, expect, it } from 'vitest'
import { extent, linearScale, niceDomain, niceTicks, toPolylinePoints } from './scale'

describe('extent', () => {
  it('returns min/max of a numeric array', () => {
    expect(extent([3, 1, 4, 1, 5, 9, 2])).toEqual([1, 9])
  })
  it('handles a single value', () => {
    expect(extent([7])).toEqual([7, 7])
  })
  it('returns a safe drawable default for an empty array', () => {
    expect(extent([])).toEqual([0, 0])
  })
})

describe('linearScale', () => {
  it('maps the domain onto the range linearly', () => {
    const s = linearScale([0, 10], [0, 200])
    expect(s(0)).toBe(0)
    expect(s(5)).toBe(100)
    expect(s(10)).toBe(200)
  })
  it('supports an inverted range (SVG y grows downward)', () => {
    const y = linearScale([0, 100], [180, 0]) // 0 at the bottom, 100 at the top
    expect(y(0)).toBe(180)
    expect(y(100)).toBe(0)
    expect(y(50)).toBe(90)
  })
  it('maps a zero-width domain to the range start (no NaN)', () => {
    const s = linearScale([5, 5], [0, 200])
    expect(s(5)).toBe(0)
    expect(Number.isNaN(s(5))).toBe(false)
  })
})

describe('niceDomain', () => {
  it('rounds ragged bounds outward to round numbers', () => {
    expect(niceDomain(2, 97)).toEqual([0, 100])
  })
  it('pads a flat non-zero range so the axis has extent', () => {
    const [lo, hi] = niceDomain(50, 50)
    expect(lo).toBeLessThan(50)
    expect(hi).toBeGreaterThan(50)
  })
  it('maps a flat zero range to [0, 1]', () => {
    expect(niceDomain(0, 0)).toEqual([0, 1])
  })
})

describe('niceTicks', () => {
  it('produces evenly spaced round ticks across the range', () => {
    expect(niceTicks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100])
  })
  it('kills floating-point dust in fractional ticks', () => {
    // 0..1 by 0.2 — naive accumulation would leak 0.30000000000000004
    expect(niceTicks(0, 1, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1])
  })
  it('returns a single tick for a flat range', () => {
    expect(niceTicks(42, 42)).toEqual([42])
  })
  it('does not emit a stray tick below the domain from float dust (0.02..0.06)', () => {
    // Math.floor(0.02 / 0.01) is 1 (float), which would wrongly seed a 0.01 tick — the epsilon guard
    // keeps the axis inside its domain.
    expect(niceTicks(0.02, 0.06, 4)).toEqual([0.02, 0.03, 0.04, 0.05, 0.06])
  })
})

describe('toPolylinePoints', () => {
  it('serializes x/y pairs to an SVG points string', () => {
    expect(toPolylinePoints([{ x: 0, y: 10 }, { x: 5, y: 12 }, { x: 10, y: 8 }])).toBe('0,10 5,12 10,8')
  })
})
