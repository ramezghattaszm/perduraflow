# ML Predictor — Requirements

Requirements for the **learned predictive model** that will replace the deterministic OLS
parameter predictor (`apps/api/src/modules/learning/learning.predictor.ts`). Scope is the
**predictor arm** (the A14 *predictive* arm — "where is this parameter heading"), not the
relearn arm (the *measured* arm — "what is it now"). See `docs/API-ARCHITECTURE.md` §AI
posture (A14–A19) and `docs/api-spec.md` §13 for the surrounding contracts.

> The OLS predictor is an explicit placeholder ("as the greedy heuristic stands in for the
> optimizer"). The model below **drops into the same seam**; this doc says what it must satisfy
> to be a safe, in-contract replacement — not how to train it.

---

## 1. The seam it plugs into (do not widen without cause)

Today the predictor is a **pure function** consumed by `LearningService.forecast()`:

```
predict(series, std, threshold, cadenceMin) : PredictionResult | null
   ↓
forecast() → gateDisposition(tier, confidence, threshold) → writeSettledPrediction → preAdopt
```

`PredictionResult` is the contract boundary:

| Field | Meaning | Model must produce |
|---|---|---|
| `predictedValue` | forecast parameter value (today pinned to `threshold`) | yes — may be the real trajectory value, not just the band |
| `threshold` | `std × (1 + wearBand)` — the crossing line | passthrough (engine-supplied) |
| `eventsToCross` / `horizonMinutes` | when the crossing lands | yes |
| `confidence` | `[0,1]`, gate input | yes — **calibrated** (see §4) |
| `fitSlope`, `fitR2`, `windowSize`, `sampleCount` | OLS provenance (the explanation today) | replace with model provenance (see §5) |
| `proposedAction`, `actionTier` | `preadjust_parameter` / `tier1` | passthrough (engine-owned classification) |
| `null` return | "no honest forecast" | yes — the model MUST be able to abstain |

**MLR-1.** The model is a drop-in for `predict()`. Everything downstream (the gate, the
overlay/pre-adopt, the snooze/damping, scheduling, the exception queue) consumes
`PredictionResult` and MUST NOT need changes. If a new field is required, it is **additive**
to `PredictionResult` and defaulted so the gate/UI are unaffected for non-ML callers.

---

## 2. What the model owns — and what it must NOT

**Owns (the parameter forecast):** the predicted value, the crossing horizon, and a calibrated
confidence — per the A14 posture *"ML predicts parameters, not decisions."*

**MLR-2 (stays engine-owned — out of scope for the model):**
- **The autonomy gate.** `gateDisposition(tier, confidence, tier1AutoThreshold)` stays
  deterministic; the model only supplies `confidence`. The model never decides auto-commit.
- **The overlay / pre-adopt** and the **bounded clamp** (`MAX_DEV`) — the safety envelope.
- **The damped / snooze behaviour** (convergence-not-motion, re-surface-only-if-worse).
- **The scheduling decision** — the deterministic engine consumes the overlay; the model
  never touches sequencing, lateness, or remediation.
- **Tier classification beyond Tier-1** — the Tier-2/3 consequence seam stays in the engine.

---

## 3. Functional requirements

- **MLR-3. Forecast a crossing.** Given a parameter's actuals series for one
  `(resource, routing-op, param)`, predict whether/when it crosses the wear band, in the same
  `horizonMinutes` / `eventsToCross` terms (the UI, gate, and `crossingAt` depend on it).
- **MLR-4. Abstain honestly.** Return `null` (no forecast) when there is no trustworthy signal
  — the OLS guards (`MIN_SAMPLES`, flat/declining trend, `MIN_BAND_ENTRY` noise floor,
  crossing beyond `H_MAX_MIN`) encode the *intent*: never fabricate a trend from noise. The
  model MUST reproduce that intent (no false wear from near-flat noisy series).
- **MLR-5. Richer value (optional, additive).** The model MAY predict the actual future
  trajectory value rather than pinning `predictedValue` to `threshold`. If so, the pre-adopt
  overlay must still be bounded by `MAX_DEV` and the crossing semantics preserved.
- **MLR-6. Both params.** Cover `cycle` and `setup` (the two `LearningParam`s), or abstain
  cleanly on the one it doesn't model.

---

## 4. Confidence calibration (the hardest requirement)

The gate auto-commits when `confidence ≥ tier1AutoThreshold`. A point estimate is not enough.

- **MLR-7. Calibrated `[0,1]`.** `confidence` MUST be a calibrated probability / well-ranked
  uncertainty, not an unbounded score. Target: in a held-out set, forecasts emitted at
  confidence *c* cross as predicted ≈ *c* of the time (reliability-curve calibration).
- **MLR-8. Horizon-honest.** Confidence MUST degrade with horizon (a 5-day-out crossing is
  legitimately less certain than a 4-hour one) — the OLS `horizonDecay` captures this; the
  model's uncertainty must too, or be composed with it.
- **MLR-9. Monotone trust.** More corroborating evidence (samples, signal strength) ⇒ higher
  confidence, never lower — so the gate behaves predictably as data accrues.

---

## 5. Explainability (A18/A19 — the trust envelope)

Auto-commit is only acceptable if it's explainable. Today the "basis" is *"forecast from the
trend over N actuals"* with `fitSlope`/`fitR2`/`sampleCount` as the carried provenance.

- **MLR-10. Carry a basis.** The model MUST emit a human-renderable basis (top features /
  attribution / "why now") that the exception-queue auto-handled card and the board wear card
  can show. The OLS provenance fields are replaced or supplemented; the **narration stays
  translation-only** (it renders the basis, never invents one).
- **MLR-11. No black-box auto-commit.** A forecast with no explainable basis MUST NOT be
  eligible for Tier-1 auto-commit (it may still surface as advisory / queued).

---

## 6. Determinism, reproducibility, versioning (D2)

- **MLR-12. Deterministic inference.** Same model **version** + same ordered inputs ⇒ same
  output. No wall-clock, no RNG at inference. `demo:reset` stays byte-identical.
- **MLR-13. Versioned artifact.** The model is a versioned artifact (like the weight-set
  version token). The version is stamped onto the prediction row for audit/repro and so a
  model change is traceable. Training is **offline**; only inference runs in-request.
- **MLR-14. Pluggable provider.** Selected by env/config behind the `predict()` boundary
  (the §10 pluggable-provider pattern) — OLS remains the built-in fallback (see §9).

---

## 7. Grain decision (open — see §11)

Today everything is **per `(resource, routing-op, param)`**: detection, forecast, gate,
overlay, and even the D56 tool-wear flag. The remediation action (`wear_remediation`) is the
only **per-resource** surface — the asymmetry behind divergent per-op predictions on one tool.

- **MLR-15. State the grain.** The model MUST declare whether it forecasts per-op (drop-in,
  inherits the asymmetry) or **per-tool/resource** (consumes cross-op features → one forecast
  per tool, closing the aggregation gap). Per-tool is preferred for the *decision* grain; per-op
  overlays are still needed for the scheduling math. If per-tool, define how one tool forecast
  fans out to per-op overlays.
- **MLR-16. Shared-cause vs isolated.** If per-tool, the model (or a pre-step) MUST distinguish
  correlated tool wear (roll up) from isolated op-specific drift (keep per-op), so it doesn't
  misattribute a bad fixture/operator as tool wear.

---

## 8. Data & features

- **MLR-17. Inputs available today.** Ordered per-op actuals (`execution_actual`:
  cycle/setup, good/scrap, span), the std baseline, the wear band, op cadence, and — when the
  grain-aware seam carries it — `cycle_batch` per-piece records (`cycle_record`). Features MUST
  come from persisted, replayable data (no live-only signals) to preserve MLR-12.
- **MLR-18. Labels.** Crossing/no-crossing and time-to-cross derived from historical actuals;
  define the labelling window and the censoring rule (ops that never crossed).
- **MLR-19. Tenant scoping.** Training and inference respect tenant scope (no cross-tenant
  leakage); a cold-start tenant falls back to the global/OLS model.

---

## 9. Rollout & fallback

- **MLR-20. Shadow first.** The model runs in **shadow mode** (compute + log, do not gate)
  against the OLS predictor until calibration (MLR-7) is demonstrated on real actuals.
- **MLR-21. OLS is the floor.** If the model is unavailable, errors, or abstains, the system
  falls back to the OLS predictor — never to "no forecast" by failure. (Pluggable provider,
  MLR-14.)
- **MLR-22. Reversible.** Auto-committed ML forecasts remain reversible exactly as today —
  the `ml_predicted` overlay is held and re-stepped if actuals don't materialise.

---

## 10. Acceptance criteria

A model is promotable from shadow to gating when, on a held-out window of real actuals:

1. **Calibration:** reliability-curve error within an agreed bound (e.g. ECE ≤ target).
2. **Precision at the gate:** of forecasts auto-committed at `≥ tier1AutoThreshold`, the
   realised crossing rate meets the trust bar (few costly false pre-adjusts).
3. **Recall / lead time:** catches real crossings with enough horizon to act, beating OLS.
4. **No-trend safety:** false-positive rate on flat/noisy series ≤ OLS (MLR-4).
5. **Determinism:** byte-identical re-inference across runs (MLR-12).
6. **Explainability:** every gated forecast carries a renderable basis (MLR-10/11).

---

## 11. Open decisions

- **D-ML-1. Grain.** Per-op drop-in vs per-tool aggregation (§7). Recommendation: build at
  resource grain to close the aggregation gap and the prediction-quality gap together.
- **D-ML-2. Value semantics.** Keep `predictedValue = threshold` (crossing-only) or predict the
  real trajectory (MLR-5)?
- **D-ML-3. Hosting.** In-process inference vs a prediction service behind the provider seam;
  latency budget for `forecast()` (called per actual ingest).
- **D-ML-4. Confidence source.** Native model uncertainty vs OLS-style composition; how it
  composes with `horizonDecay`.
- **D-ML-5. Relearn arm.** Does the *measured* arm (`learning.rule.ts`) also become learned, or
  stay the deterministic damped rule? (Out of scope here; flagged for sequencing.)

---

## Revision History

| Version | Date | Notes |
|---|---|---|
| 1.0 | 2026-06-29 | Initial requirements — the ML predictor as an in-contract drop-in for the OLS `predict()` seam: owns the parameter forecast + calibrated confidence; gate/overlay/bounds/determinism stay engine-owned. |
