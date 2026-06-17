# Claude Code brief — Phase 5: explain & compare (what-if, baseline, narration)

| | |
|---|---|
| **Builds on** | Phases 0–4. All prior invariants carry. Sits on: the deterministic solver (P2), the learning record (P3), the predictor + structured-action data (P4). |
| **This session** | The platform **evaluates change-sets** (what-if), **compares plans to baselines**, and **explains itself** in plain language — deterministically, honestly, with the LLM strictly translating never deciding. |
| **Next** | **Phase 6 (conversational Q&A + open scenario exploration) is imminent — within this demo cycle.** Phase 5 must build its structured rationale **rich and queryable** as phase-6's substrate. Hooks here are load-bearing, not someday. |
| **Working mode** | Propose-then-confirm. Draft deltas + §5 choices, **stop for sign-off**, then implement. |

## 0. Mission

Three capabilities, each on an existing hook:
- **What-if evaluation (D55)** — apply an arbitrary **change-set**, solve/cost/rank options, structured rationale, feasibility-honest.
- **Plan-comparison / baseline (D57)** — **both arms**: `frozen_engine_snapshot` (engine with learning/stability off) and `measured_historical` (from historical-outcome rows; seeded now, real later).
- **Narration (A19)** — render + summarize the structured rationale into prose. **Translation only. Never computes, ranks, decides, or invents.**

Lights up: **Cockpit** costed options + Apply (View 1), **Scorecard** baseline arms, the **prediction "so what"** (predict → impact → costed options → narrate).

**Scope discipline — EVALUATE / COMPARE / EXPLAIN, exposed through DEFINED triggers (collisions, predictions, Cockpit). NOT conversational, NOT open user-driven exploration — that's Phase 6.** The what-if engine *accepts* arbitrary change-sets, but phase 5 does not build the conversational front-end or scenario-builder UI. Hold the line.

## 1. Read first
1. Prior briefs (esp. P2 solver, P3 learning, P4 predictor) — invariants binding.
2. `platform-architecture-spec.md` — **A19** (narration surface — translation-only), A18 (trust envelope), A14.
3. `production-scheduling-business-functional-spec.md` — **D55** (what-if option-sets + structured rationale), **D57** (plan-comparison primitive + baseline-as-frozen-engine-mode), D2 (reproducible/explainable), D26 (human disposes).
4. `PHASE-5-SOWHAT-HOOK.md` — the prediction→decision scene (the integration test).
5. `SEED-SCENARIO-SPEC.md` — incl. the **historical-outcomes dataset** (the measured-historical arm's rows). The four collisions are the what-if/baseline exercises.
6. `VIEW-PLAN.md` + `perduraflow-six-views.html` — View 1 (Cockpit), View 2 (Scorecard baseline), View 6 (How-It-Connects).

## 2. Invariants — prior rules carry, plus these

- **Narration translates, never reasons (the load-bearing rule).** The LLM takes a **computed structured rationale** and renders/summarizes it as prose. It adds **no fact** not in the rationale. Test: delete the narration → no decision-relevant information lost. If a fact appears only in narration, the boundary is violated.
- **Structured rationale is the source of truth and always visible.** Narration renders **alongside** it (both present), never replacing it. A wrong/slow/absent model never removes the real answer.
- **Narration is async, non-blocking, never in the commit path.** Option-set + structured rationale render immediately; the Apply/Commit control is live the moment the rationale exists, regardless of narration state. Narration failure → "explanation unavailable", zero functional impact. Nothing commits because of narration; nothing waits on it.
- **The decision is deterministic; the LLM explains it.** The engine decides (auditable, reproducible — D2). The LLM reasons only about *language*. Same change-set → same costed result + same structured rationale, always.
- **What-if is change-set-general but evaluation-only here.** The engine accepts an arbitrary change-set (one or many changes) → solves/costs/ranks/rationale. **Feasibility-honest:** infeasible scenarios are caught and reported plainly ("can't be scheduled because…"), never silently mangled. Phase 5 *calls* it with defined changes; phase 6 *drives* it openly. Determinism + feasibility hold for ANY change-set.
- **Baseline = a mode of the engine, not a separate model.** `frozen_engine_snapshot` = the same engine with learning/stability frozen + naive policies; the gap to the live engine = the value of the live layers. **Honest labelling: "the lift our intelligence adds" — NOT "vs your manual process."** `measured_historical` computes from historical-outcome rows (seeded now, labelled representative; real MES later, same path); **"no historical baseline yet" empty state** when no rows. Never fabricate a baseline.
- **Structured rationale built rich + queryable for Phase 6.** Shape it so phase 6 can ground answers in it: addressable by **factor** (changeover/lateness/OT…), by **option**, by **constraint**; rich enough to answer "why not X" / "what drove the cost" **from the rationale without re-running the engine** (only *new* what-ifs re-run). This is a deliberate design target, not generic.
- **Human disposes (D26).** What-if proposes; baseline compares; narration explains. **Nothing auto-commits.** Apply is a human action.

## 3. This session — scope
- **What-if evaluation engine** — accepts a change-set; produces a ranked **option-set**, each option with a **structured rationale** (factors + numeric contributions + binding constraints + score/rank) and feasibility status. Deterministic, reproducible. Module placement: propose (likely a `whatif`/scheduling-adjacent surface that calls the solver) — contract-bound, no cross-module schema imports.
- **Plan-comparison primitive + both baseline arms** — snapshot a plan, diff KPIs (OTIF/cost/OEE/late-orders) vs a baseline; `frozen_engine_snapshot` (computed) and `measured_historical` (from seeded historical rows, empty-state when absent). Wires into Scorecard "vs baseline" and Cockpit option deltas.
- **Narration surface (A19)** — given a structured rationale (single option or across-options), render prose + an across-options summary. Async, non-blocking, alongside the rationale. **Render + summarize only** — no Q&A, no fabrication.
- **Surfaces** — Cockpit (View 1): the change → costed options + structured rationale + narration + Apply. Scorecard: both baseline arms. Prediction "so what": the P4 prediction → quantified impact (D57) → costed options (D55) → narration — **the integration test**.

**Forward-hooks (Phase 6 — name, build nothing):** structured rationale is queryable (factor/option/constraint addressable); the what-if engine accepts arbitrary change-sets (phase 6 routes conversational change-sets to it); narration is a render surface a conversation layer can later call. **Do NOT build:** conversational Q&A, intent-routing, open scenario-builder UI.

**Out of scope (Phase 6+):** conversational Q&A / open exploration, real connectors/IoT, agentic auto-action, Tier-C cost.

## 4. Working protocol
1. **Draft deltas** (api-spec + frontend-spec + PROJECT-SUMMARY): what-if engine, plan-comparison + both baseline arms, narration surface, Cockpit/Scorecard wiring. **Present, stop, do not implement.**
2. On sign-off: what-if engine → plan-comparison/baselines → narration → surfaces → the so-what integration scene.
3. Verify against §6.
4. Propose before any large/irreversible move.

## 5. Items to propose (genuine design choices)
- **Structured rationale schema** — the shape of the rationale object (factors, contributions, constraints, score). **This is the most important design choice — phase 6 consumes it.** Make it addressable/queryable per the invariant.
- **What-if engine placement** — how it calls the solver for a change-set without owning scheduling; module/contract boundary.
- **`frozen_engine_snapshot` mechanics** — how the engine runs in frozen-naive mode (which layers off, which naive policies), and how the snapshot is taken/stored.
- **`measured_historical` data shape** — the historical-outcomes row shape (past plan + actual result) the seed populates and a real historian later fills.
- **Narration integration** — the LLM call (model, prompt that enforces translate-only + structured input), streaming/async render, the failure→"unavailable" path. Enforce: structured rationale in, prose out, no new facts.
- **Cockpit option-set UX** — options + structured rationale + narration + Apply; how the rationale stays visible alongside narration.

## 6. Definition of done — Phase 5
- `bun run check` green; API builds/boots; `next build` + Expo render.
- **Proofs:**
  1. **What-if evaluates a change-set** — apply a demand change (GP-1142 100→120) → ranked costed option-set with structured rationale; deterministic (same change-set → same result twice).
  2. **Feasibility-honest** — an infeasible change-set is reported as infeasible with reason, not silently mangled.
  3. **Frozen-engine baseline** — Scorecard/Cockpit shows the live plan vs the frozen-naive engine; the delta is the live-layer lift; labelled as engine-lift (not "manual process").
  4. **Measured-historical** — computes from seeded historical rows (labelled representative); shows **"no historical baseline yet"** when rows absent. Never fabricated.
  5. **Narration is translate-only** — every fact in the prose traces to the structured rationale; deleting narration loses no decision info; structured rationale visible alongside.
  6. **Narration is non-blocking** — Apply works with narration slow/failed; failure shows "unavailable", no functional impact.
  7. **The so-what integration** — a P4 prediction flows to quantified impact → costed options → narration on one surface (the scene).
  8. **Rationale is queryable** — demonstrate the rationale is addressable by factor/option/constraint (the phase-6 substrate) — e.g. retrieve "why not option B" from the structured form without re-running the engine.
  9. **Boundary + no-hardcoding** — what-if/baseline/narration modules contract-bound, negative-lint clean; all values compute from rows; baselines never fabricated.
- **Browser-verified (web + native):** Cockpit change → options + rationale + narration + Apply; Scorecard both baseline arms (frozen computed, historical from seed, empty-state honest); the prediction so-what scene.
- Forward-hooks present (queryable rationale, change-set-general engine, callable narration) — **no conversational/exploration built.**
- Docs updated; completion log. **This is the last core-engine phase.** Stop. Phase 6 (conversational) is next, separately.

---

*Phase 6 (conversational Q&A + open scenario exploration) gets its own brief after Phase 5 is signed off. It adds language + exploration + grounding/routing on this verified substrate — no engine rework. Both ship before the demo; the boundary stays intact (engine decides, LLM explains/routes, nothing auto-commits).*
