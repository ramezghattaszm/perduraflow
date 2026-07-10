import { describe, expect, it } from 'vitest'
import { matchesLocation } from './location'

/**
 * The resource location matcher (Scheduling S0a) that all six consumer filter sites route through
 * (scheduling.service ×5 + actuals-rollup ×1). The load-bearing property: **plant-grain is unchanged when
 * no lineId is in context** (the pre-S0 behavior) — the line clause short-circuits to a pure plant compare.
 */

const R = (plantId: string, lineId: string | null) => ({ plantId, lineId })

describe('matchesLocation — the S0a line dimension', () => {
  it('no lineId → plant-grain (inert): matches on plant regardless of the resource line', () => {
    expect(matchesLocation(R('p1', null), 'p1')).toBe(true)
    expect(matchesLocation(R('p1', 'l1'), 'p1')).toBe(true) // a lined resource still matches its plant
    expect(matchesLocation(R('p2', 'l1'), 'p1')).toBe(false) // different plant never matches
  })

  it('with lineId → narrows to that line within the plant', () => {
    expect(matchesLocation(R('p1', 'l1'), 'p1', 'l1')).toBe(true)
    expect(matchesLocation(R('p1', 'l2'), 'p1', 'l1')).toBe(false) // wrong line
    expect(matchesLocation(R('p1', null), 'p1', 'l1')).toBe(false) // plant-only resource excluded when a line is asked
    expect(matchesLocation(R('p2', 'l1'), 'p1', 'l1')).toBe(false) // right line id but wrong plant
  })
})
