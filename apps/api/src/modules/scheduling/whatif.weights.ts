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
export const WEIGHT_SET_VERSION = 'aps-w2'

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
  /**
   * Per unit of `costPerUnit` (C6, aps-w2). Cost is a real economic factor — it must matter vs
   * changeover/overtime/holding/displacement, yet sit FAR below lateness so firm-lateness dominance
   * holds (cost can never pull a firm order late). Calibrated against measured magnitudes:
   * costPerUnit ≈ 1.7–1.9 (absolute term ≈ 7, in the changeover/displacement/overtime band, well
   * below lateness ~95 and holding ~87); option-to-option deltas 0.01–0.16 (≤0.5 worst case) →
   * 0.04–0.64 (≤2.0) discrimination, i.e. a fraction of a changeover up to ~one displaced op.
   * Dominance proof: overriding even 0.5 h firm lateness (penalty 5) needs a cost delta > 1.25/unit
   * — ~8× the largest observed delta — so it cannot happen. The OT premium is also reflected in
   * costPerUnit, a small (~0.6 vs the overtime factor's ~32) and same-signed ACCEPTED double-count.
   */
  cost: 4,
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
 * availability — changes placement, so re-narrate/re-evaluate;
 * `wi-6` = inspection station (C3) — finite resource + linear intra-routing precedence
 * (successor floors on predecessor end) — changes placement;
 * `wi-7` = operator performance (C5) — consumed pinned assignment divides run time by the
 * assigned operator's performanceFactor (setup untouched) — changes placement;
 * `wi-8` = minimum batch (C4) — run-quantity floor per resource type (effRunQty = max(demandQty,
 * minBatchQty)); run-to-minimum extends duration when it binds — changes placement;
 * `wi-9` = cost factor (C6) — costPerUnit added to the objective (aps-w2); scoring changed, so
 * cached results must be invalidated even though placement is unchanged;
 * `wi-10` = additive option families + explicit overtime consumed as a per-resource given with
 * honored hours (conversation Pass A) — compound change-sets now compose instead of collapsing,
 * so option sets/placements differ for compound and overtime-bearing change-sets.
 * `wi-11` = order-release floor (rolling window) — each item floors at `min(today, startOfDay(due))`
 * so PAST-dated demand sits on its past day while today/future still front-loads from today. A
 * no-op for all-future demand (equals the origin), but the placement floor changed, so bump.
 */
export const ENGINE_VERSION = 'wi-11'

/** Expedite pull-ahead for protect-delivery policy (large enough to front-load). */
export const EXPEDITE_BONUS_HOURS = 100_000
