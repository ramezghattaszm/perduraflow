/**
 * Pure scale + tick helpers for the chart toolkit — no React, no SVG, fully unit-testable.
 * The charts (line/bar/area/sparkline) layer SVG primitives on top of these; keeping the math
 * here means the rendering components stay declarative and the numeric edges are tested once.
 */

/** Inclusive numeric extent of an array; `[0, 0]` for an empty array (a safe, drawable default). */
export function extent(values: number[]): [number, number] {
  if (values.length === 0) return [0, 0]
  let min = values[0]!
  let max = values[0]!
  for (const v of values) {
    if (v < min) min = v
    if (v > max) max = v
  }
  return [min, max]
}

/**
 * A linear scale mapping a numeric `domain` onto a pixel `range` (clamping is the caller's job).
 * A zero-width domain maps everything to the range start (avoids divide-by-zero → NaN bars).
 *
 * @example const x = linearScale([0, 10], [0, 200]); x(5) // 100
 */
export function linearScale(domain: [number, number], range: [number, number]): (v: number) => number {
  const [d0, d1] = domain
  const [r0, r1] = range
  const span = d1 - d0
  if (span === 0) return () => r0
  const k = (r1 - r0) / span
  return (v: number) => r0 + (v - d0) * k
}

/** Round a raw step up to the nearest "nice" number (1, 2, 5 × 10ⁿ) — the standard axis-step basis. */
function niceStep(raw: number): number {
  if (raw <= 0) return 1
  const exp = Math.floor(Math.log10(raw))
  const pow = Math.pow(10, exp)
  const frac = raw / pow
  const niceFrac = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10
  return niceFrac * pow
}

/**
 * Round a raw `[min, max]` outward to nice round bounds aligned to a nice step — so an axis
 * starts/ends on a round number rather than the data's ragged extremes. A flat range (min===max)
 * is padded by ±1 (or to `[0, 1]` at zero) so the axis still has extent.
 */
export function niceDomain(min: number, max: number, count = 5): [number, number] {
  if (min === max) {
    if (min === 0) return [0, 1]
    const pad = Math.abs(min) * 0.1 || 1
    return [min - pad, max + pad]
  }
  const step = niceStep((max - min) / Math.max(1, count))
  return [Math.floor(min / step) * step, Math.ceil(max / step) * step]
}

/**
 * Evenly spaced "nice" tick values spanning `[min, max]` (~`count` ticks, aligned to a nice step).
 * Returned ascending and inclusive of the rounded bounds; values are rounded to kill float dust
 * (e.g. `0.30000000000000004` → `0.3`) so tick labels render clean.
 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) return [min]
  const step = niceStep((max - min) / Math.max(1, count))
  // Epsilon-guard the boundary rounding: `min/step` can land at e.g. 1.9999998 (float), so a bare
  // floor would emit a stray tick a whole step below the domain. Nudge before floor/ceil.
  const start = Math.floor(min / step + 1e-9) * step
  const end = Math.ceil(max / step - 1e-9) * step
  const ticks: number[] = []
  // Round to the step's decimal precision so floating accumulation doesn't leak into labels.
  const decimals = Math.max(0, -Math.floor(Math.log10(step)))
  for (let v = start; v <= end + step / 2; v += step) {
    ticks.push(Number(v.toFixed(decimals)))
  }
  return ticks
}

/** Build an SVG polyline `points` string from x/y pixel pairs (e.g. "0,10 5,12 10,8"). */
export function toPolylinePoints(points: Array<{ x: number; y: number }>): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ')
}
