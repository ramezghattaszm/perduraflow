/**
 * Pure KPI measure helpers — the configurable-measure seam (KPI / Metric Policy, Group 3) plus the
 * trend-bucketing math. No I/O, fully unit-tested. Both the continuous current-value folds and the
 * windowed trend folds in {@link ActualsRollupService} call these, so the tile and the trend can NEVER
 * disagree on what "late" means or where a period boundary falls.
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
