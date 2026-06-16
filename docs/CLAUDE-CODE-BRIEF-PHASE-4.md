# Claude Code brief — Phase 4: parameter prediction (anticipatory, confidence-gated)

| | |
|---|---|
| **Builds on** | Phases 0–3 (kernel+shell, Master Data, scheduling core, the closed loop). All prior invariants carry forward. Phase 4 sits on the phase-3 learning mechanism + structured learned-value record. |
| **This session** | The system **predicts where a parameter is heading** (not just learns where it's been), surfaces forecasts with **confidence + horizon**, and acts or proposes via **confidence-gated, tier-bounded** autonomy. |
| **Working mode** | Propose-then-confirm. Draft the deltas, present, **wait for sign-off**, then implement. Same gate. |

## 0. Mission

Phase 3 *learned from* actuals (reactive — adopted a value after evidence accrued). Phase 4 *predicts ahead* (anticipatory — forecasts where a parameter is heading before it gets there). It extends A14's learning into its predictive arm: extrapolate an **observed drift** to forecast a future threshold-crossing (e.g. tool-wear trajectory → "cycle will cross threshold ~14:00"), attach **confidence + horizon**, and route the forecast through **confidence-gated autonomy bounded by consequence tier**.

**Scope discipline — predict-and-(act-or-propose), NOT explain-or-compare.** Phase 4 does **not**: what-if option-sets, plan-comparison/baseline, or narration (all Phase 5); and does **not** auto-act outside the confidence×tier gate. Hold the line — Phase 5 stacks on this.

## 1. Read first

1. `docs/CLAUDE-CODE-BRIEF-PHASE-3.md` §2 (+ prior briefs) — invariants, still binding.
2. `docs/platform-architecture-spec.md` (v0.10) — **A18** (the trust envelope + autonomy gradient — phase 4 operationalizes the *predictive* case), **A14** (ML parameter prediction — this is its predictive arm), A16/A17 (boundary widens with track record).
3. `docs/production-scheduling-business-functional-spec.md` (v0.11) — D5 (closed loop), D3 (ML targets), D56 (tool-wear signal — the drift this predicts the continuation of), D26 (human-disposes posture), D44 (stability — predictive action must not destabilize the committed near-horizon).
4. The phase-3 learned-value record (structured: value, source, confidence, sample basis, provenance) — the substrate prediction reads/extends.
5. `docs/VIEW-PLAN.md` + `docs/perduraflow-six-views.html` — predictions feed **View 4 (Exception Queue)** rows and **View 1 (Cockpit)** forward-looking elements; the threshold is configured in **View 5 (Objective Policy)**.

## 2. Invariants — prior rules carry, plus these Phase 4 specifics

All phase 0–3 boundary/no-hardcoding/contract rules apply unchanged. Additions:

- **Prediction extrapolates an *observed* drift — never forecasts from nothing.** The honest scope: take a real, measured trend (the phase-3 drift / actuals trajectory) and project it forward. On synthetic data the *mechanism* is real even though the signal is seeded — same honesty posture as phase 3 (show the mechanism; the depth comes from real history in the pilot). No fabricated forecasts with no underlying trend.
- **Every prediction carries confidence AND horizon, both shown.** Confidence (how sure) and horizon (how far out). **Confidence degrades with horizon** — predicting 1h out is more reliable than 8h, and the numbers must reflect that honestly. Display both.
- **Prediction renders as a settled statement, not motion (convergence-not-motion, forward form).** "Predicted to cross threshold ~14:00 · confidence 0.8 · 2h horizon" — a claim that holds, **not** a gauge creeping toward a threshold in real time. Re-forecast in considered steps (damped), like learned values. No live ticker.
- **Confidence-gated autonomy, BOUNDED BY CONSEQUENCE TIER (the spine).** A configurable per-tenant **confidence threshold** decides auto-commit vs. propose — BUT **gated within the A18 tier, never across it**:
  - **Tier 1 (parameters)** — a predictive parameter adjustment with confidence ≥ threshold **auto-commits**; below → proposes.
  - **Tier 2 (soft policies)** — within configured bounds + advisory-first default; confidence can raise it to auto within those bounds, still auditable.
  - **Tier 3 (hard/commercial/safety)** — **always human, regardless of confidence.** A 99%-confident prediction still cannot auto-commit a Tier-3 action (allocation, who-gets-shorted, safety sequencing).
  - **Confidence is the dial *inside* a tier, not a bypass *around* the gradient.** Confidence raises certainty, the tier sets authority.
- **Auto-committed predictions must be reversible + transparent.** Acting on a *forecast* (not-yet-happened) is a real escalation from acting on an *actual*. So: (a) **reversible** — if the predicted drift doesn't materialize, the next actuals correct it (the closed loop catches a wrong prediction); (b) **transparent** — every auto-committed predictive action is logged and visible (Exception Queue "auto-handled: pre-emptively adjusted for predicted wear · confidence X"), so a human can see what the system did on a forecast even when it didn't need approval. Never irreversible, never silent.
- **Predictive action respects D44.** A pre-emptive adjustment must not thrash the committed near-horizon; same stability discipline as reactive rescheduling.
- **Determinism (D2).** Given the same actuals history, the same prediction (value, confidence, horizon) — reproducible, seeded.

## 3. This session — scope

- **Predictor (A14 predictive arm)** — on the phase-3 learned-value series per (resource, op, param), fit/extrapolate the observed trend to forecast: the predicted future value, the **threshold-crossing time** (horizon), and a **confidence** that degrades with horizon. Reproducible, damped, bounded. Likely lives in the phase-3 **learning module** (it reads the same series) — confirm placement.
- **Confidence×tier gate** — route each prediction's proposed action: Tier-1 → confidence-threshold auto-commit/propose; Tier-2 → bounded/advisory; Tier-3 → always human. Threshold is per-tenant config (safe default), set in Objective Policy.
- **Pre-emptive action** — when a prediction auto-commits (Tier-1, ≥threshold) or is approved, the scheduler adjusts ahead of the drift (uses the predicted parameter on next solve, D44-stable). Reversible by subsequent actuals.
- **Surfacing** — predictions feed the **Exception Queue**: auto-handled ones (acted, logged, with confidence) and queued ones (below threshold or higher tier, awaiting approval, with prediction+confidence+horizon+proposed action). Forward-looking flags on the board (predicted threshold-crossing) as **settled statements**.
- **Config** — the confidence threshold + tier behavior exposed in Objective Policy (View 5) — this is part of building that view's autonomy controls.

**Forward-hooks (Phase 5 — name seams, build nothing):** a prediction's proposed action + confidence + horizon is structured so the **narration surface (A19)** can later verbalize it; predictions and their outcomes are retained so a **prediction-accuracy** measure (did the forecast come true?) can later compute — don't build it, don't discard the data.

**Out of scope (Phase 5+):** what-if option-sets, plan-comparison/baseline, narration, auto-action outside the gate, real IoT, Tier-C cost.

## 4. Working protocol
1. **Draft the deltas** (api-spec + frontend-spec + PROJECT-SUMMARY): the predictor, the confidence×tier gate, pre-emptive action, Exception-Queue surfacing, the Objective-Policy threshold config. **Present and stop for sign-off. Do not implement.**
2. On sign-off: predictor → gate → pre-emptive action (D44-stable, reversible) → surfacing → config.
3. Verify against §6.
4. Propose before any large/irreversible move.

## 5. Items to propose (genuine design choices)
- **The prediction model** — how the observed series is extrapolated (linear trend on the drift? a simple regression over the learned-value window?), how the **threshold-crossing horizon** is computed, and how **confidence degrades with horizon**. Must be deterministic, damped, explainable. Keep it the simplest honest extrapolation — a placeholder for a real predictive model later (like the heuristic was for the optimizer).
- **The confidence threshold mechanics** — default value, how it's configured per tier in Objective Policy, what "auto-commit" concretely does for a Tier-1 parameter.
- **Re-forecast cadence / damping** — how often predictions update and how they avoid live-ticking (settled re-forecast in steps).
- **Exception-Queue row shape** — how auto-handled vs. needs-approval predictions render (confidence, horizon, proposed action, the act/approve control).

## 6. Definition of done — Phase 4
- `bun run check` green; API builds/boots; `next build` + Expo render.
- **Proofs:**
  1. **Predicts from an observed drift** — feed a drift; the predictor forecasts a threshold-crossing with confidence + horizon, both shown as settled statements (no live ticker).
  2. **Confidence×tier gate** — a Tier-1 prediction ≥ threshold **auto-commits** (and is logged/visible); below threshold **proposes** (queues). A Tier-3 action **stays human even at high confidence** — demonstrate the tier bound holds (confidence does not bypass it).
  3. **Reversible** — a prediction that doesn't materialize is corrected by subsequent actuals (show a wrong forecast self-correcting, not stuck).
  4. **Transparent** — auto-committed predictive actions appear in the Exception Queue as auto-handled with their confidence/horizon/reason.
  5. **Determinism (D2)** — same actuals history → same prediction (value/confidence/horizon), twice.
  6. **Confidence degrades with horizon** — a far-horizon prediction carries lower confidence than a near one, honestly.
  7. **Boundary + no-hardcoding** — predictor in its module (scoped schema, negative-lint clean); predictions/confidence compute from rows, nothing literal.
- **Browser-verified (web + native):** drift → prediction appears (settled) → Tier-1 auto-commit logged in Exception Queue → a below-threshold/Tier-3 case routes to human → the threshold is configurable in Objective Policy.
- Forward-hooks present (prediction structured for narration; predictions+outcomes retained for a later accuracy measure) — but **no** narration/what-if/baseline built.
- Docs updated; completion log. Stop at this checkpoint. Do not start Phase 5.

---

*Phase 5 (what-if option-sets + plan-comparison/baseline + narration — the explain-and-compare layer) gets its own brief once Phase 4 is signed off. It attaches to the hooks above.*
