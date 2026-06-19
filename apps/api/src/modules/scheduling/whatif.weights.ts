/**
 * What-if objective weights (phase 5, D55) — documented constants applied to score
 * an evaluated plan. `contribution = rawValue · weight` per factor; the option
 * **score is the sum of the factor contributions** (lower is better, matching the
 * sequencer). Firm-lateness dominance (D13/D23) is preserved: lateness is computed
 * on **firm** orders only and weighted far above changeover, so a firm order's
 * lateness is never traded for a changeover.
 *
 * `WEIGHT_SET_VERSION` is stamped into every {@link StructuredRationale} so a stored
 * rationale's contributions stay interpretable against the exact weights that
 * produced them if these ever re-tune (the value depends on the weights).
 */
export const WEIGHT_SET_VERSION = 'aps-w1'

/** The per-factor objective weights (documented constants); `contribution = rawValue · weight`. */
export const WEIGHTS = {
  /** Per firm-late hour — dominant (firm delivery effectively protected). */
  lateness: 10,
  /** Per changeover switch. */
  changeover: 1,
  /** Per overtime hour (labour premium). */
  overtime: 4,
  /** Per early hour finished ahead of need (holding/inventory pressure). */
  inventory: 0.2,
  /** Per operation displaced vs the current plan (D44 nervousness discipline). */
  displacement: 2,
} as const

/** The structured-rationale shape version (independent of the weight-set version). */
export const RATIONALE_SCHEMA_VERSION = '1.0'

/**
 * What-if **engine version** — stamped into the determinism key so a change to the
 * option-generation/scoring/collapse logic **invalidates cached results** (a stored
 * result is only re-used when the inputs AND the engine that produced it match).
 * Bump on any behavioural change. `wi-2` = distinct-plan de-duplication;
 * `wi-3` = line-down option set (bare resource_window → reroute/overtime, no defer);
 * `wi-4` = calendar-aware placement (shift windows / Sundays / holidays / line-down
 * time-boxed as closures + OT) — supersedes all 24/7-era cached results;
 * `wi-5` = material gate (D36) — earliest-start floor on the consuming op from component
 * availability — changes placement, so re-narrate/re-evaluate.
 */
export const ENGINE_VERSION = 'wi-5'

/** Expedite pull-ahead for protect-delivery policy (large enough to front-load). */
export const EXPEDITE_BONUS_HOURS = 100_000
