import type { LearnedStatus } from '@perduraflow/contracts'

/**
 * The damped learned-parameter rule (api-spec §12.3 / AS14 — the load-bearing
 * decision). **Pure + deterministic** (D2): same ordered actuals + same standard →
 * same output, no `Date.now()`, no randomness. Satisfies A18 — reproducible
 * (constants below), bounded (guardrails), damped (decisive step, then hold).
 *
 * Shape: **windowed snap-on-gate with hysteresis.** Confidence rises with samples
 * and falls with dispersion. A learned value is **adopted in one decisive step**
 * once min-samples + confidence + step-band clear, then **held** — further actuals
 * inside the re-step band do NOT move it (convergence, not motion). EWMA was
 * rejected: a slow factor still moves the number every actual, fighting the
 * storyboard. The damping lives in the GATE, so the displayed value is a settled
 * step. A value beyond `MAX_DEV` is **rejected** (kept standard, flagged), never
 * silently committed.
 */

/** Documented constants (D48 safe defaults; per-tenant configurable later, D42). */
export const RULE = {
  /** Trailing window for the mean/dispersion. */
  WINDOW: 8,
  /** Confidence saturates at this sample count. */
  N_TRUST: 8,
  /** Coefficient-of-variation at which dispersion zeroes confidence. */
  CV_MAX: 0.5,
  /** Min samples before the first decisive step is possible. */
  MIN_SAMPLES: 5,
  /** Confidence needed to adopt (and, since confidence only rises, to keep using). */
  CONF_ADOPT: 0.6,
  /** First step requires the window to diverge from standard by ≥ this fraction. */
  STEP_BAND: 0.05,
  /** A held value re-steps only when the window diverges from it by ≥ this fraction. */
  RESTEP_BAND: 0.08,
  /** Guardrail (A18 bounded): a learned value beyond this deviation from standard is rejected. */
  MAX_DEV: 0.5,
} as const

/** Prior settled state (from the persisted `learned_parameter` row). */
export interface PriorState {
  learnedValue: number | null
  status: LearnedStatus
}

/** The rule's output for one parameter over its actuals series. */
export interface RuleResult {
  learnedValue: number | null
  source: 'standard' | 'ml_adjusted'
  confidence: number | null
  sampleCount: number
  windowSize: number
  windowMean: number
  windowStddev: number
  status: LearnedStatus
  /** True when this evaluation took a decisive step/re-step (drives events + lastSteppedAt). */
  stepped: boolean
}

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x))

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function stddev(xs: number[], m: number): number {
  if (xs.length < 2) return 0
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length)
}

/**
 * Evaluate the rule for one `(resource, op, param)`.
 *
 * @param series - the actual values **in deterministic emission order** (oldest→newest).
 * @param std - the master-data standard baseline (D7).
 * @param prior - the previously persisted settled state (for the hysteresis hold).
 */
export function evaluate(series: number[], std: number, prior: PriorState): RuleResult {
  const n = series.length
  const window = series.slice(Math.max(0, n - RULE.WINDOW))
  const wMean = window.length > 0 ? mean(window) : std
  const wStd = stddev(window, wMean)
  const cv = wMean > 0 ? wStd / wMean : 0
  const confidence = clamp(n / RULE.N_TRUST, 0, 1) * (1 - clamp(cv / RULE.CV_MAX, 0, 1))

  const base = {
    sampleCount: n,
    windowSize: window.length,
    windowMean: wMean,
    windowStddev: wStd,
    confidence,
  }
  const keepStandard = (status: LearnedStatus): RuleResult => ({
    ...base,
    learnedValue: null,
    source: 'standard',
    status,
    stepped: false,
  })

  const devFromStd = std > 0 ? Math.abs(wMean - std) / std : 0

  // Guardrail (A18 bounded): an absurd window mean is rejected — keep standard, flag.
  if (devFromStd > RULE.MAX_DEV || wMean <= 0) {
    return { ...keepStandard('rejected'), stepped: prior.status !== 'rejected' }
  }

  // Already holding a learned value → hysteresis: only re-step on a new sustained
  // material drift measured FROM THE HELD VALUE; otherwise hold (convergence, not motion).
  if (prior.status === 'held' && prior.learnedValue != null) {
    const held = prior.learnedValue
    const devFromHeld = held > 0 ? Math.abs(wMean - held) / held : 0
    if (devFromHeld >= RULE.RESTEP_BAND && confidence >= RULE.CONF_ADOPT) {
      return { ...base, learnedValue: wMean, source: 'ml_adjusted', status: 'held', stepped: true }
    }
    return { ...base, learnedValue: held, source: 'ml_adjusted', status: 'held', stepped: false }
  }

  // Not yet adopted → adopt in ONE decisive step once the gate clears.
  if (n >= RULE.MIN_SAMPLES && confidence >= RULE.CONF_ADOPT && devFromStd >= RULE.STEP_BAND) {
    return { ...base, learnedValue: wMean, source: 'ml_adjusted', status: 'held', stepped: true }
  }

  return keepStandard('learning')
}
