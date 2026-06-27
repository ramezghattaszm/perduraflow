import type { ProposedAction, ActionTier } from '@perduraflow/contracts'

/**
 * The parameter predictor (api-spec §13.2 / AS19 — the A14 *predictive* arm).
 * **Pure + deterministic** (D2): same ordered actuals + same std/threshold → same
 * forecast, no `Date.now()`, no randomness. Satisfies A18 — reproducible, explainable
 * (the fit window + slope + R² are the basis), bounded (H_MAX, min-slope, band-entry, no-trend →
 * no forecast). The **simplest honest extrapolation**: an OLS linear trend on the
 * observed actuals window, projected to a threshold-crossing, with **confidence that
 * degrades with horizon**. A placeholder for a real predictive model later (as the
 * greedy heuristic stands in for the optimizer) — never a fabricated trend.
 */

/** Documented constants (D48 safe defaults; tenant-tunable bits live in policy config). */
export const PREDICT = {
  /** Trailing window of actuals the trend is fitted over. */
  WINDOW: 8,
  /** Min samples before a forecast is possible (no trend from too little data). */
  MIN_SAMPLES: 5,
  /** Confidence saturates at this sample count (mirrors the learner). */
  N_TRUST: 8,
  /**
   * Max horizon forecast, minutes — beyond this we say "no crossing within horizon". Tool/parameter
   * wear is inherently MULTI-DAY, so the honest forecast horizon is days, not one shift: a week of
   * clock time (10080 min). Keeps a far crossing legitimately low-confidence (horizon-decay) without
   * rejecting it as "no crossing". (A shift-length 480 was too short — a gentle wear trend that
   * crosses in a few days would be silently dropped.)
   */
  H_MAX_MIN: 10080,
  /** Confidence floor at the far horizon (never zero — a far forecast is weak, not absent). */
  CONF_FLOOR: 0.1,
  /** Minimum slope (value/event) to call a trend — below this the series is flat (no forecast). */
  MIN_SLOPE: 1e-4,
  /**
   * Signal-to-noise gate: the parameter must have measurably ENTERED its wear band before a crossing
   * is forecast — `fittedNow` at least this fraction of the way from std to threshold. Over a short
   * window a faint OLS slope on near-flat, noisy data fits as well (same R²/slope) as a genuine ramp,
   * so within-window fit quality can't tell them apart; but noise can't durably raise the LEVEL. A
   * crossing inferred while still sitting at the band floor is therefore a noise artifact, not wear.
   * Empirically separates the demo's flat ops (~10% into band → noise) from real wear (~40%+ →
   * adopted). Tenant-tunable later (policy config). 0 = old behaviour (forecast from the floor).
   */
  MIN_BAND_ENTRY: 0.25,
} as const

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x))

/** OLS slope/intercept/R² of y over its index 0..n-1 (the emission order). */
function fitLine(ys: number[]): { slope: number; intercept: number; r2: number } {
  const n = ys.length
  const xs = ys.map((_, i) => i)
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my)
    sxx += (xs[i]! - mx) ** 2
    syy += (ys[i]! - my) ** 2
  }
  const slope = sxx > 0 ? sxy / sxx : 0
  const intercept = my - slope * mx
  // R² = explained / total; a flat series (syy=0) is a perfect-but-meaningless fit → treat as 0.
  const r2 = syy > 0 ? clamp((sxy * sxy) / (sxx * syy), 0, 1) : 0
  return { slope, intercept, r2 }
}

/** The predictor's output for one parameter series. `crossing` null = no crossing within horizon. */
export interface PredictionResult {
  predictedValue: number
  threshold: number
  /** Events from "now" (the last sample) to the crossing; null when none. */
  eventsToCross: number | null
  horizonMinutes: number
  confidence: number
  fitSlope: number
  fitR2: number
  windowSize: number
  sampleCount: number
  proposedAction: ProposedAction
  actionTier: ActionTier
}

/**
 * Forecast a threshold-crossing for one `(resource, op, param)`.
 *
 * @param series - actual values in deterministic emission order (oldest→newest).
 * @param std - the parameter's standard baseline (the wear band floor).
 * @param threshold - the value a crossing is predicted against (std × (1+wearBand)).
 * @param cadenceMin - minutes per event (resource op cadence) → converts events→clock.
 * @returns a result, or null when there is no honest forecast (too few samples, flat/away
 *          trend, a parameter still at the band floor, or a crossing beyond H_MAX).
 */
export function predict(
  series: number[],
  std: number,
  threshold: number,
  cadenceMin: number,
): PredictionResult | null {
  const n = series.length
  if (n < PREDICT.MIN_SAMPLES) return null
  const window = series.slice(Math.max(0, n - PREDICT.WINDOW))
  const { slope, intercept, r2 } = fitLine(window)
  const fittedNow = intercept + slope * (window.length - 1)

  // Only forecast a crossing the trend is actually heading toward (rising to a ceiling).
  // A flat or declining series → no honest crossing forecast.
  if (slope < PREDICT.MIN_SLOPE || fittedNow >= threshold) return null

  // Signal-to-noise gate (MIN_BAND_ENTRY): a faint slope on a near-flat, noisy series fits as well
  // over a short window as a real ramp, so it would forecast a crossing while the parameter is still
  // at its band floor — a noise artifact, not wear. Require the level to have measurably entered the
  // band before projecting a crossing (noise fakes a slope, not a sustained level shift).
  const bandEntry = threshold > std ? (fittedNow - std) / (threshold - std) : 1
  if (bandEntry < PREDICT.MIN_BAND_ENTRY) return null

  const eventsToCross = (threshold - fittedNow) / slope
  const horizonMinutes = eventsToCross * cadenceMin
  if (horizonMinutes <= 0 || horizonMinutes > PREDICT.H_MAX_MIN) return null

  // Confidence = (samples × fit quality) × horizon-decay → honestly degrades with horizon.
  const fitConfidence = clamp(n / PREDICT.N_TRUST, 0, 1) * clamp(r2, 0, 1)
  const horizonDecay = clamp(1 - horizonMinutes / PREDICT.H_MAX_MIN, PREDICT.CONF_FLOOR, 1)
  const confidence = fitConfidence * horizonDecay

  return {
    predictedValue: threshold,
    threshold,
    eventsToCross,
    horizonMinutes,
    confidence,
    fitSlope: slope,
    fitR2: r2,
    windowSize: window.length,
    sampleCount: n,
    // This phase forecasts cycle/setup parameters → a Tier-1 pre-adjust. (Tier-2/3
    // consequence classification is a documented seam; see the gate, api-spec §13.3.)
    proposedAction: 'preadjust_parameter',
    actionTier: 'tier1',
  }
}
