import type { OeeDto } from '@perduraflow/contracts'

/**
 * Pure KPI measure helpers — the configurable-measure seam (KPI / Metric Policy, Group 3), the
 * trend-bucketing math, and the OEE-from-actuals fold. No I/O, fully unit-tested. Both the continuous
 * current-value folds and the windowed trend folds in {@link ActualsRollupService} call these, so the
 * tile and the trend can NEVER disagree on what "late" means, where a period boundary falls, or how OEE
 * is computed.
 */

const MS_PER_MINUTE = 60_000
const MS_PER_DAY = 86_400_000

/**
 * The configurable **On-Time measure definition** (Part 3 wires this from the config cascade). The
 * default reproduces today's hardcoded rule **byte-identical**: production-complete delivery (the order's
 * latest actual finish), zero tolerance, measured against the demand line's required date. Overriding a
 * field (e.g. a tolerance window, or later a ship-date basis) is what changes the measure per tenant/plant.
 */
export interface OnTimeDefinition {
  /** Grace period (minutes) added to the due date before an order counts late. Default 0. */
  toleranceMinutes: number
}

/** The shipped default — equals the current behavior, so On-Time is parity-stable until overridden. */
export const DEFAULT_ON_TIME_DEFINITION: OnTimeDefinition = { toleranceMinutes: 0 }

/**
 * Whether an order delivered **late** under the On-Time definition. `dueMs == null` (no due on record)
 * → never judged late (matches the current rule). With the default (tolerance 0) this is exactly
 * `delivery > due` — byte-identical to the prior inline test; a tolerance grants grace before "late".
 *
 * @param deliveryMs the order's delivery instant (production-complete basis: latest actual finish)
 * @param dueMs the order's due instant, or `null` if none is on record
 */
export function isOrderLate(
  deliveryMs: number,
  dueMs: number | null,
  def: OnTimeDefinition = DEFAULT_ON_TIME_DEFINITION,
): boolean {
  if (dueMs == null) return false
  return deliveryMs > dueMs + def.toleranceMinutes * MS_PER_MINUTE
}

/** A KPI's status against its threshold band, or `none` (no value / no configured band). */
export type KpiStatus = 'green' | 'amber' | 'red' | 'none'

/**
 * A value's status against a threshold band. Higher-better: ≥green → green, ≥amber → amber, else red.
 * Lower-better: ≤green → green, ≤amber → amber, else red. A `null` value or `null` band → `none` (the
 * honest "no judgement" state — e.g. an empty window, or a metric with no configured band like cost).
 */
export function kpiStatus(
  value: number | null,
  band: { direction: 'higher' | 'lower'; green: number; amber: number } | null,
): KpiStatus {
  if (value == null || band == null) return 'none'
  if (band.direction === 'higher') {
    if (value >= band.green) return 'green'
    if (value >= band.amber) return 'amber'
    return 'red'
  }
  if (value <= band.green) return 'green'
  if (value <= band.amber) return 'amber'
  return 'red'
}

/** Trend bucket granularity. */
export type TrendBucket = 'day' | 'week'

/** Whole days a bucket spans (week = 7) — the trend's bucket stride. */
export function bucketDays(bucket: TrendBucket): number {
  return bucket === 'week' ? 7 : 1
}

/** UTC start of the period bucket containing `ms` — midnight for `day`, Monday-midnight for `week`. */
export function bucketStartUtc(ms: number, bucket: TrendBucket): number {
  const day = Math.floor(ms / MS_PER_DAY) * MS_PER_DAY
  if (bucket === 'day') return day
  const dowFromMonday = (new Date(day).getUTCDay() + 6) % 7 // 0 = Monday … 6 = Sunday
  return day - dowFromMonday * MS_PER_DAY
}

/** The ordered bucket-start instants spanning `[startMs, endMs)` — so empty periods still appear as
 *  points (a gap/null), not a collapsed axis. */
export function bucketStartsInRange(startMs: number, endMs: number, bucket: TrendBucket): number[] {
  const stride = bucketDays(bucket) * MS_PER_DAY
  const starts: number[] = []
  for (let b = bucketStartUtc(startMs, bucket); b < endMs; b += stride) starts.push(b)
  return starts
}

// --- OEE from actuals (A·P·Q) — the same fold as the per-version scorecard, over any op set ----------

/** Running totals for OEE over a set of executed ops (a plant window, a resource, or one period bucket). */
export interface OeeAccumulator {
  /** Machine-occupied minutes (actual end − start, includes setup). */
  operating: number
  /** Actual setup / changeover minutes — an availability loss. */
  setupMinutes: number
  /** Recorded stop minutes — an availability loss. */
  downtimeMinutes: number
  /** Σ std-cycle × good — the value-adding ideal (performance numerator). */
  idealRunMinutes: number
  good: number
  scrap: number
  /** Executed ops folded in — 0 ⇒ no data ⇒ OEE is `null` (not 0%). */
  ops: number
}

/** A fresh zeroed OEE accumulator. */
export function emptyOeeAccumulator(): OeeAccumulator {
  return { operating: 0, setupMinutes: 0, downtimeMinutes: 0, idealRunMinutes: 0, good: 0, scrap: 0, ops: 0 }
}

/** Fold one executed op's actuals into an accumulator (in place). `stdCycle` is the op's std cycle
 *  time per unit (the performance reference); `opMinutes` the op's actual wall-clock duration. */
export function accumulateOee(
  acc: OeeAccumulator,
  x: { opMinutes: number; setupMinutes: number; downtimeMinutes: number; stdCycle: number; good: number; scrap: number },
): void {
  acc.operating += x.opMinutes
  acc.setupMinutes += x.setupMinutes
  acc.downtimeMinutes += x.downtimeMinutes
  acc.idealRunMinutes += x.stdCycle * x.good
  acc.good += x.good
  acc.scrap += x.scrap
  acc.ops += 1
}

/**
 * OEE (A·P·Q) from an accumulator — the SAME formula as the per-version fold (SchedulingService). Setup
 * + downtime are availability losses; performance is pure rate (Σ std-cycle·good ÷ net run time); quality
 * is good ÷ produced. `null` when no ops contributed (no data ≠ 0%).
 */
export function oeeFromAccumulator(acc: OeeAccumulator): OeeDto | null {
  if (acc.ops === 0) return null
  const netRun = Math.max(0, acc.operating - acc.setupMinutes)
  const availability = acc.operating + acc.downtimeMinutes > 0 ? netRun / (acc.operating + acc.downtimeMinutes) : 0
  const performance = netRun > 0 ? Math.min(1, acc.idealRunMinutes / netRun) : 0
  const quality = acc.good + acc.scrap > 0 ? acc.good / (acc.good + acc.scrap) : 0
  return { availability, performance, quality, oee: availability * performance * quality }
}
