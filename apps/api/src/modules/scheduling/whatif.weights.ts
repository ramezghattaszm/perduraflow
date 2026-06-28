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
import { OBJECTIVE_DEFAULT_VERSION, OBJECTIVE_DEFAULTS } from '@perduraflow/contracts'

/** The shipped weight-set version (the `aps-w2` default). A config override resolves its own token
 *  (`obj:t<rev>`/`obj:p<rev>`) at solve time; this is the fallback/default identity. */
export const WEIGHT_SET_VERSION = OBJECTIVE_DEFAULT_VERSION

/**
 * The shipped per-factor objective weights (the `aps-w2` calibration) — now the canonical default in
 * `@perduraflow/contracts` ({@link OBJECTIVE_DEFAULTS}), so the config framework, the runtime guard,
 * and the UI share ONE source of truth. Calibration: lateness 10 dominates (others ≤ 4); cost (4)
 * stays a real discriminator yet far below lateness (a firm-late hour ~10 dwarfs the ≤2.0 option-to-
 * option cost discrimination), so cost can never pull a firm order late. Production reads the
 * RESOLVED weights via `ScoreContext.weights`; these are the fallback when none are threaded.
 */
export const WEIGHTS = OBJECTIVE_DEFAULTS

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
 * `wi-12` = operator labor folded into the cost factor (C6) — costPerUnit now includes `laborRate ·
 * working-hours` for the op's assigned operator, so an operator swap's true labor cost is scored
 * (a faster, pricier operator no longer rides for free). Scoring changed (placement unchanged), so
 * cached results must be invalidated. Honesty fix that lets cross-lever remediation rank on real $.
 * `wi-13` = window-overflow infeasibility folded into the lateness factor — a firm op that can't fit
 * any working segment (`placedFeasible=false`) counts as the worst firm-delivery outcome (a large
 * sentinel folded into lateness, weight 10), so a remediation that makes it FIT (faster operator)
 * earns scored credit. Additive on the infeasible case only — feasible-plan scores are unchanged —
 * but it's a scoring change, so bump. `firmLateHours` KPI stays honest; `infeasibleFirmOps` is the count.
 * `wi-14` = each option now carries its order-grain `atRiskOrders` set (the demand-change preview's
 * blast radius — the cockpit highlights it without persisting). Placement + scoring UNCHANGED; this is
 * additive data in the stored option payload, but a pre-wi-14 cached result lacks the field (→ would
 * replay an empty preview), so bump to invalidate stale caches. The banner count + board highlight both
 * read this set, so they cannot contradict.
 * `wi-15` = at-risk remediation ranking + comparatives are TARGET-AWARE — an option that clears the
 * target order ranks above (and is "preferred" over) one that doesn't, regardless of plant-wide score.
 * Fixes the contradiction where a lower-score option that left the target late read as "better than the
 * alternatives" while a different option was recommended for actually fixing it. Ranking/verdict output
 * changed for remediation change-sets, so bump to invalidate cached results.
 */
export const ENGINE_VERSION = 'wi-15'

/** Expedite pull-ahead for protect-delivery policy (large enough to front-load). */
export const EXPEDITE_BONUS_HOURS = 100_000
