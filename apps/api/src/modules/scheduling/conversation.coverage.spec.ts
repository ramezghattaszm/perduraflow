import { describe, expect, it } from 'vitest'
import type { WorkforceCoverageDto } from '@perduraflow/contracts'
import { compactCoverage } from './conversation.service'

// 2 operators × 2 stations. LEAK is a gap (its only certified op, Luis, is OUT); WELD is covered.
const COV: WorkforceCoverageDto = {
  plantId: 'p1',
  operators: [
    { id: 'op-luis', label: 'Luis Cruz', out: true, outReason: 'not_scheduled' },
    { id: 'op-diego', label: 'Diego Hernández', out: false },
  ],
  stations: [
    { id: 'st-leak', label: 'LEAK', certRequired: true },
    { id: 'st-weld', label: 'WELD', certRequired: true },
  ],
  // cells[op][station]: Luis qualified LEAK (but OUT → gap); Diego qualified WELD.
  cells: [
    ['qualified', 'not_qualified'],
    ['not_qualified', 'qualified'],
  ],
  readinessPct: 0.5,
  certGapCount: 1,
  proposals: [
    {
      id: 'st-leak',
      station: 'LEAK',
      operatorName: 'Jorge Morales',
      reason: 'No certified operator present next shift',
      status: 'proposed',
      absenceReason: 'not_scheduled',
      tentative: false,
    },
  ],
}

/**
 * compactCoverage is the Pass D coverage artifact: the SAME grid the Workforce screen shows
 * (from SchedulingService.coverage). These lock the per-station present/out/gap derivation, the
 * call-in proposal, and the ADVISORY framing (a gap is an observation, not a schedule blocker).
 */
describe('compactCoverage — Pass D coverage artifact', () => {
  it('derives per-station qualified-present / qualified-out / gap', () => {
    const a = compactCoverage(COV, null)
    expect(a.focus).toBe('the whole plant')
    expect(a.readinessPct).toBe(0.5)
    const by = Object.fromEntries((a.stations ?? []).map((s) => [s.station, s]))
    expect(by['LEAK']).toMatchObject({
      covered: false,
      gap: true,
      qualifiedPresent: [],
      qualifiedOut: ['Luis Cruz'],
    })
    expect(by['WELD']).toMatchObject({
      covered: true,
      gap: false,
      qualifiedPresent: ['Diego Hernández'],
    })
  })

  it('frames a gap as advisory (not a schedule blocker) and carries the call-in proposal', () => {
    const a = compactCoverage(COV, { type: 'station', id: 'st-leak', label: 'LEAK' })
    expect(a.focus).toBe('station LEAK')
    expect(a.gapMeaning).toContain('do NOT block the schedule')
    expect(a.proposals).toEqual([
      {
        station: 'LEAK',
        suggestedCallIn: 'Jorge Morales',
        reason: 'No certified operator present next shift',
        absenceReason: 'not_scheduled',
        tentative: false,
      },
    ])
  })

  it('lists per-operator qualifications', () => {
    const a = compactCoverage(COV, { type: 'operator', id: 'op-diego', label: 'Diego Hernández' })
    expect(a.focus).toBe('operator Diego Hernández')
    const diego = (a.operators ?? []).find((o) => o.operator === 'Diego Hernández')
    expect(diego).toMatchObject({ available: true, qualifiedFor: ['WELD'] })
  })

  it('honest empty-state when the plant has no coverage data', () => {
    const a = compactCoverage(
      { ...COV, operators: [], stations: [], cells: [], proposals: [] },
      null
    )
    expect(a.emptyState).toBe(true)
    expect(a.note).toContain('No workforce coverage data')
    expect(a.stations).toBeUndefined()
  })
})
