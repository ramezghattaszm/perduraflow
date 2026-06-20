import { describe, expect, it } from 'vitest'
import { sequence, type SequencerItem } from './sequencer'
import { buildWorkingCalendar } from './working-calendar'

const HOUR = 3_600_000
const DAY = 86_400_000
const MON = Date.UTC(2024, 0, 1) // Monday
const at = (day: number, h: number) => day + h * HOUR

/** A minimal work item on resource `R1`; duration = cycleTime·qty minutes (no setup). */
const item = (id: string, partNo: string, cycleMin: number, qty: number): SequencerItem => ({
  demandLineId: id,
  partId: `p-${id}`,
  partNo,
  routingOperationId: `ro-${id}`,
  opSeq: 1,
  changeoverValue: null,
  qty,
  setupTime: 0,
  cycleTime: cycleMin,
  requiredDate: at(MON, 12),
  firmness: 'firm',
  priorityRank: 2,
  eligibleResourceIds: ['R1'],
})

const twoShift = buildWorkingCalendar({ shiftPatterns: [{ start: '06:00', end: '14:00' }, { start: '14:00', end: '22:00' }] })

describe('sequence — calendar integration', () => {
  it('24/7 fallback (no calendar map) places ops back-to-back from the origin', () => {
    const items = [item('a', 'A', 60, 2), item('b', 'B', 60, 2)] // 120m each
    const { placements } = sequence(items)
    const a = placements.find((p) => p.demandLineId === 'a')!
    const b = placements.find((p) => p.demandLineId === 'b')!
    expect(a.plannedStartMs).toBe(MON) // origin = start-of-day UTC
    expect(a.plannedEndMs).toBe(MON + 2 * HOUR)
    expect(b.plannedStartMs).toBe(a.plannedEndMs) // contiguous — unchanged legacy behavior
  })

  it('calendar-aware placement clamps to shift windows and pushes overflow to the next day', () => {
    const cals = new Map([['R1', twoShift]])
    // A fills the whole Mon working span (16h); B (2h) cannot fit Mon → next working day.
    const items = [item('a', 'A', 60, 16 * 60 / 60), item('b', 'B', 60, 2)] // A=960m, B=120m
    const { placements } = sequence(items, undefined, undefined, cals)
    const a = placements.find((p) => p.demandLineId === 'a')!
    const b = placements.find((p) => p.demandLineId === 'b')!
    expect(a.plannedStartMs).toBe(at(MON, 6)) // shift start, not midnight
    expect(a.plannedEndMs).toBe(at(MON, 22)) // shift end
    expect(b.plannedStartMs).toBe(at(MON + DAY, 6)) // pushed to Tuesday 06:00 (no overnight running)
  })

  it('is deterministic — identical inputs reproduce identical placements', () => {
    const cals = new Map([['R1', twoShift]])
    const items = [item('a', 'A', 60, 3), item('b', 'B', 90, 4)]
    expect(sequence(items, undefined, undefined, cals)).toEqual(sequence(items, undefined, undefined, cals))
  })
})

describe('sequence — operator performance (C5)', () => {
  it('divides run time by the performance factor on the assigned resource (setup untouched)', () => {
    const base = [item('a', 'A', 60, 2)] // 120m run, no setup
    const slow = sequence(base, undefined, undefined, undefined, () => 0.5).placements[0]! // 50% → ×2
    const fast = sequence(base, undefined, undefined, undefined, () => 2).placements[0]! // 200% → ÷2
    const std = sequence(base).placements[0]!
    expect(std.plannedEndMs - std.plannedStartMs).toBe(2 * HOUR)
    expect(slow.plannedEndMs - slow.plannedStartMs).toBe(4 * HOUR) // baseCycle / 0.5
    expect(fast.plannedEndMs - fast.plannedStartMs).toBe(1 * HOUR) // baseCycle / 2
    expect(slow.cycleTime).toBe(120) // 60 / 0.5 — effective run recorded on the placement
  })

  it('only affects the resource its operator is pinned to; factor 1.0 / undefined are no-ops', () => {
    const r2 = { ...item('b', 'B', 60, 2), eligibleResourceIds: ['R2'] }
    const items = [item('a', 'A', 60, 2), r2]
    const resolve = (resourceId: string) => (resourceId === 'R1' ? 0.5 : 1)
    const withFactor = sequence(items, undefined, undefined, undefined, resolve).placements
    const plain = sequence(items).placements
    const a1 = withFactor.find((p) => p.demandLineId === 'a')!
    const b1 = withFactor.find((p) => p.demandLineId === 'b')!
    const b0 = plain.find((p) => p.demandLineId === 'b')!
    expect(a1.plannedEndMs - a1.plannedStartMs).toBe(4 * HOUR) // R1 slowed
    expect(b1.plannedEndMs - b1.plannedStartMs).toBe(b0.plannedEndMs - b0.plannedStartMs) // R2 untouched
  })

  it('is deterministic with a resolver — identical inputs reproduce identical placements', () => {
    const items = [item('a', 'A', 60, 3), item('b', 'B', 90, 4)]
    const resolve = () => 0.85
    expect(sequence(items, undefined, undefined, undefined, resolve)).toEqual(
      sequence(items, undefined, undefined, undefined, resolve),
    )
  })
})