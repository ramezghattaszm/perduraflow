import { describe, expect, it } from 'vitest'
import { pickFasterOperator, type OperatorAssignmentWindow, type OperatorRosterEntry } from './whatif.operator-lever'

const op = (over: Partial<OperatorRosterEntry> & Pick<OperatorRosterEntry, 'id'>): OperatorRosterEntry => ({
  name: over.id,
  homePlantId: 'P-SALT',
  performanceFactor: 1,
  laborRate: 30,
  available: true,
  isActive: true,
  ...over,
})

const ARGS = {
  resourceId: 'pressA',
  plantId: 'P-SALT',
  windowFromMs: 100,
  windowToMs: 200,
  currentFactor: 0.5, // the slow operator running today
}

describe('pickFasterOperator — the faster-operator remediation candidate (Part B)', () => {
  it('picks the FASTEST eligible same-plant, present, faster, free operator', () => {
    const roster = [
      op({ id: 'slow', performanceFactor: 0.5 }), // not faster than current
      op({ id: 'mid', performanceFactor: 1.0 }),
      op({ id: 'fast', performanceFactor: 1.5 }),
    ]
    expect(pickFasterOperator({ ...ARGS, roster, assignments: [] })?.id).toBe('fast')
  })

  it('ties on speed break to CHEAPER labor, then id (deterministic + cost-aware)', () => {
    const roster = [
      op({ id: 'b-pricey', performanceFactor: 1.2, laborRate: 50 }),
      op({ id: 'a-cheap', performanceFactor: 1.2, laborRate: 35 }),
    ]
    expect(pickFasterOperator({ ...ARGS, roster, assignments: [] })?.id).toBe('a-cheap')
  })

  it('returns null (honest-unavailable) when no one is strictly faster than the current operator', () => {
    const roster = [op({ id: 'same', performanceFactor: 0.5 }), op({ id: 'slower', performanceFactor: 0.4 })]
    expect(pickFasterOperator({ ...ARGS, roster, assignments: [] })).toBeNull()
  })

  it('excludes out / inactive / other-plant operators', () => {
    const roster = [
      op({ id: 'out', performanceFactor: 2, available: false }),
      op({ id: 'inactive', performanceFactor: 2, isActive: false }),
      op({ id: 'ramos', performanceFactor: 2, homePlantId: 'P-RAMOS' }),
      op({ id: 'ok', performanceFactor: 1.3 }),
    ]
    expect(pickFasterOperator({ ...ARGS, roster, assignments: [] })?.id).toBe('ok')
  })

  it('excludes a candidate already covering ANOTHER line in the op window (double-booking)', () => {
    const roster = [op({ id: 'busy', performanceFactor: 2 }), op({ id: 'free', performanceFactor: 1.3 })]
    const assignments: OperatorAssignmentWindow[] = [
      { resourceId: 'pressB', operatorId: 'busy', effectiveFromMs: 50, effectiveToMs: 300 }, // overlaps [100,200)
    ]
    expect(pickFasterOperator({ ...ARGS, roster, assignments })?.id).toBe('free')
  })

  it('an assignment to the SAME resource is not a clash (the replace-open switch)', () => {
    const roster = [op({ id: 'fast', performanceFactor: 2 })]
    const assignments: OperatorAssignmentWindow[] = [
      { resourceId: 'pressA', operatorId: 'fast', effectiveFromMs: null, effectiveToMs: null },
    ]
    expect(pickFasterOperator({ ...ARGS, roster, assignments })?.id).toBe('fast')
  })

  it('a non-overlapping assignment elsewhere does not exclude (window-precise)', () => {
    const roster = [op({ id: 'fast', performanceFactor: 2 })]
    const assignments: OperatorAssignmentWindow[] = [
      { resourceId: 'pressB', operatorId: 'fast', effectiveFromMs: 500, effectiveToMs: 600 }, // after [100,200)
    ]
    expect(pickFasterOperator({ ...ARGS, roster, assignments })?.id).toBe('fast')
  })
})
