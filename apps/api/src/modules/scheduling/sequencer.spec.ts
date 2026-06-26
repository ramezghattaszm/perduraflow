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
    const slow = sequence(base, undefined, undefined, undefined, () => ({ id: 'op-slow', performanceFactor: 0.5, laborRate: null })).placements[0]! // 50% → ×2
    const fast = sequence(base, undefined, undefined, undefined, () => ({ id: 'op-fast', performanceFactor: 2, laborRate: null })).placements[0]! // 200% → ÷2
    const std = sequence(base).placements[0]!
    expect(std.plannedEndMs - std.plannedStartMs).toBe(2 * HOUR)
    expect(slow.plannedEndMs - slow.plannedStartMs).toBe(4 * HOUR) // baseCycle / 0.5
    expect(fast.plannedEndMs - fast.plannedStartMs).toBe(1 * HOUR) // baseCycle / 2
    expect(slow.cycleTime).toBe(120) // 60 / 0.5 — effective run recorded on the placement
  })

  it('only affects the resource its operator is pinned to; factor 1.0 / undefined are no-ops', () => {
    const r2 = { ...item('b', 'B', 60, 2), eligibleResourceIds: ['R2'] }
    const items = [item('a', 'A', 60, 2), r2]
    const resolve = (resourceId: string) => ({ id: `op-${resourceId}`, performanceFactor: resourceId === 'R1' ? 0.5 : 1, laborRate: null })
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
    const resolve = () => ({ id: 'op-x', performanceFactor: 0.85, laborRate: null })
    expect(sequence(items, undefined, undefined, undefined, resolve)).toEqual(
      sequence(items, undefined, undefined, undefined, resolve),
    )
  })
})

describe('sequence — effective-time resolution carries the op start (forward-only forecast gate)', () => {
  it('passes the placed start (atMs) to resolveEffective so a time-gated overlay can branch on it', () => {
    const seen: number[] = []
    // Two back-to-back ops on R1 from the origin (60m each). The resolver records the atMs it
    // receives and only applies a "predicted" cycle once the op starts at/after a boundary — the
    // first op (origin) stays std, the second (origin + 1h) gets the overlay.
    const boundary = at(MON, 0) + HOUR
    const resolve = (_op: string, _res: string, stdSetup: number, stdCycle: number, atMs?: number) => {
      seen.push(atMs ?? -1)
      const applyPredicted = atMs != null && atMs >= boundary
      return {
        setupTime: stdSetup,
        cycleTime: applyPredicted ? stdCycle * 2 : stdCycle,
        setupSource: 'standard' as const,
        cycleSource: applyPredicted ? ('ml_predicted' as const) : ('standard' as const),
        setupConfidence: null,
        cycleConfidence: null,
      }
    }
    const items = [item('a', 'A', 60, 1), item('b', 'B', 60, 1)] // a→origin, b→origin+60m
    const { placements } = sequence(items, resolve)
    const a = placements.find((p) => p.demandLineId === 'a')!
    const b = placements.find((p) => p.demandLineId === 'b')!
    // The resolver received real start instants (not undefined) — the gate has the data it needs.
    expect(seen.every((m) => m >= 0)).toBe(true)
    expect(a.plannedStartMs).toBe(MON) // before the boundary → std, no overlay
    expect(a.cycleSource).toBe('standard')
    expect(b.plannedStartMs).toBe(at(MON, 1)) // at the boundary → predicted overlay applied
    expect(b.cycleSource).toBe('ml_predicted')
    expect(b.cycleTime).toBe(120) // std 60 doubled by the time-gated overlay
  })
})

describe('sequence — resource downtime (line-down / maintenance) attribution + displacement', () => {
  // R1 down the WHOLE Monday working span (a "rest of today" line-down): closed interval baked
  // into the calendar (what displaces) + the id-bearing window passed for binder attribution.
  const downAllMon = buildWorkingCalendar({
    shiftPatterns: [{ start: '06:00', end: '14:00' }, { start: '14:00', end: '22:00' }],
    closedIntervals: [[at(MON, 6), at(MON, 22)]],
  })
  const dt = new Map([['R1', [{ id: 'dt1', startMs: at(MON, 6), endMs: at(MON, 22) }]]])

  it('displaces (not excludes): a down line pushes its ops past the window, op count preserved', () => {
    const items = [item('a', 'A', 60, 2), item('b', 'B', 60, 2)] // two 2h ops
    const cals = new Map([['R1', downAllMon]])
    const { placements } = sequence(items, undefined, undefined, cals, undefined, undefined, dt)
    // Nothing dropped — both ops still in the plan, just relocated past the outage.
    expect(placements).toHaveLength(2)
    for (const p of placements) expect(p.plannedStartMs).toBeGreaterThanOrEqual(at(MON + DAY, 6)) // Tuesday
  })

  it('binder roots a delayed start at resource_downtime + records the window id', () => {
    const cals = new Map([['R1', downAllMon]])
    const a = sequence([item('a', 'A', 60, 2)], undefined, undefined, cals, undefined, undefined, dt).placements[0]!
    expect(a.bindingKind).toBe('resource_downtime')
    expect(a.bindingDowntimeId).toBe('dt1')
    expect(a.bindingBlockerDemandLineId).toBeNull() // a root: no blocking op
    expect(a.atRisk).toBe(true) // due Mon 12:00, pushed to Tuesday
    expect(a.atRiskReason).toBe('resource_down')
  })

  it('does NOT tag downtime when the op fits before the window (no false attribution)', () => {
    // Afternoon-only outage; a 2h op floored at 06:00 runs 06:00–08:00, before the closure.
    const pmDown = buildWorkingCalendar({
      shiftPatterns: [{ start: '06:00', end: '14:00' }, { start: '14:00', end: '22:00' }],
      closedIntervals: [[at(MON, 14), at(MON, 22)]],
    })
    const dtPm = new Map([['R1', [{ id: 'dt2', startMs: at(MON, 14), endMs: at(MON, 22) }]]])
    const a = sequence([item('a', 'A', 60, 2)], undefined, undefined, new Map([['R1', pmDown]]), undefined, undefined, dtPm)
      .placements[0]!
    expect(a.plannedStartMs).toBe(at(MON, 6))
    expect(a.bindingKind).not.toBe('resource_downtime')
    expect(a.bindingDowntimeId).toBeNull()
  })
})

describe('sequence — minimum batch floor (C4)', () => {
  it('runs to the minimum batch when demand is below it (run qty + duration floored)', () => {
    const below = [item('a', 'A', 1, 10)] // demand 10 < min 100 → runs 100
    const minBatch = new Map([['R1', 100]])
    const floored = sequence(below, undefined, undefined, undefined, undefined, minBatch).placements[0]!
    const naive = sequence(below).placements[0]!
    expect(naive.qty).toBe(10)
    expect(floored.qty).toBe(100) // run-to-minimum
    expect(floored.plannedEndMs - floored.plannedStartMs).toBe(100 * 60_000) // 1 min/unit × 100
  })

  it('does not bind when demand is at or above the minimum (no surplus)', () => {
    const at = [item('a', 'A', 1, 250)] // 250 > min 100 → unchanged
    const minBatch = new Map([['R1', 100]])
    const p = sequence(at, undefined, undefined, undefined, undefined, minBatch).placements[0]!
    expect(p.qty).toBe(250)
  })

  it('floor is per resource type (only the mapped resource); 0 / no entry is a no-op', () => {
    const r2 = { ...item('b', 'B', 1, 10), eligibleResourceIds: ['R2'] }
    const items = [item('a', 'A', 1, 10), r2]
    const minBatch = new Map([['R1', 100]]) // R2 absent → no floor
    const out = sequence(items, undefined, undefined, undefined, undefined, minBatch).placements
    expect(out.find((p) => p.demandLineId === 'a')!.qty).toBe(100)
    expect(out.find((p) => p.demandLineId === 'b')!.qty).toBe(10)
  })
})
