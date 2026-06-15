# Claude Code brief — Phase 3: execution actuals + the closed loop (learn-and-reflect)

| | |
|---|---|
| **Builds on** | Phases 0–2 (kernel+shell, Master Data, deterministic scheduling core) — all built. All prior invariants and boundary rules carry forward unchanged. |
| **This session** | Actuals arrive (from the simulator, not real IoT), the system **learns** true cycle/setup times from them, and the schedule + board reflect **learned values** — shown as **convergence, not motion**, bounded by the trust envelope. |
| **Working mode** | Propose-then-confirm. Draft the spec deltas, present, **wait for sign-off**, then implement. Same gate. |

## 0. Mission

Close the loop. Execution actuals (4.3) are ingested from a parameterized **simulator** (SKIP-51, not real IoT/MES); the learning mechanism (D5 / A14) derives true cycle/setup times; the `setup_source`/`cycle_source` fields wired empty in Phase 2 flip `standard → ml_adjusted` with confidence; the next schedule uses learned values; and deterministic performance variance (planned-vs-actual) plus the tool-wear flag (D56) surface. This is the demo's foreground (Collision 2) and the **first phase governed by A18** (autonomous learning under a trust envelope, Tier 1).

**The load-bearing principle (A18 + storyboard): learning is shown as convergence, not motion.** Learned values move in **considered, damped steps — slower than the raw signal** — never live-twitching per actual. One decisive step from standard to learned, then **held with rising confidence**. Phases 4 (prediction) and 5 (what-if/narration) will both sit directly on this mechanism, so the damping is the foundation they inherit — get it right here.

**Scope discipline — learn-and-reflect, NOT predict-and-explain.** Phase 3 *reacts to* actuals and learns from them. It does **not**: predict parameters ahead of time (Phase 4), do what-if/baseline/narration (Phase 5), connect to real IoT/MES (simulator only), or auto-act (A16, deferred). Hold this line **because** 4 and 5 stack on it — each phase must be independently provable before the next builds on it.

## 1. Read first

1. `docs/CLAUDE-CODE-BRIEF.md` §2, `-PHASE-1.md` §2, `-PHASE-2.md` §2 — invariants and contract-bound-module rules, still binding.
2. `docs/platform-architecture-spec.md` (v0.10) — **A18** (governing — the trust envelope, the autonomy gradient, the damping rule), A14 (ML parameter prediction = the Tier-1 mechanism).
3. `docs/production-scheduling-business-functional-spec.md` (v0.11) — §4.3 execution actuals, §4.4 committed schedule, D5 (closed loop), D3 (ML targets: changeover/cycle/downtime/scrap), D7 (standard baseline, ML overlays it), **D56** (tool-wear signal), §10/14.2 (KPIs).
4. `docs/PLATFORM-COMPLETION-LOG.md` (v0.3) — SKIP-51 (simulator/actuals source), SKIP-04 (source/confidence carry-through — now goes live), SKIP-15 (maintenance module deferred; D56 flag is not it), SKIP-23 (notifications presentational).
5. **`docs/VIEW-PLAN.md`** — the six-view build plan, the **no-hardcoding invariant** (binds every board), and the **cost model = Tier B** decision. **`docs/perduraflow-six-views.html`** — the view designs (build to them; sample numbers are representative, not literals). **`docs/perduraflow-phase3-board.html`** — the phase-3 board design. **`docs/GANTT-FIX-NOTE.md`** — the board's render fix + horizon mode (apply if not already done).

## 2. Invariants — prior rules carry, plus these Phase 3 specifics

All Phase 0–2 boundary rules apply unchanged (per-module schema + scoped Drizzle; lint fails build on cross-module `schema/` import; one Pool; contracts the only cross-module surface; EventBus for cross-module events; ULID PKs; tenant scope + index; soft-delete only; binding-resolved domain contract access). Additions:

- **A18 governs every learned value.** Each must be **reproducible** (same actuals → same learned value; provenance recorded — sample window, count, confidence), **explainable** (the inputs behind a learned value are retrievable), and **bounded** (a learned value passes guardrails before it reaches a committed schedule — it cannot move past sane limits or destabilize the committed near-horizon without a control). Tier 1 (parameters) is fully autonomous, continuous — no human approval — but **damped**.
- **Damping is mandatory, not optional.** Learned parameters update in considered steps via a deliberate rule (windowed/threshold — propose it, §5), with **confidence rising as samples accrue**. The board shows the **step**, not the stream. No parameter updates per-actual.
- **Determinism holds (D2).** Given the same actuals sequence, the learned values and the resulting schedule are reproducible. The simulator is **seeded**; learning is deterministic over a fixed actuals set.
- **The source/confidence carry-through goes live (SKIP-04) — behavior change, zero schema/board change.** `cycle_source`/`setup_source` flip `standard → ml_adjusted` and `*_confidence` populate when a learned value is used; the Phase 2 board already renders these (the `· std` tag becomes `· ml` + confidence). **No migration to add fields, no board rewrite** — that was the point of wiring them empty in Phase 2. Confirm this is a pure behavior change.
- **Learned values overlay the standard baseline (D7), don't replace it.** The routing's `std_cycle_time`/`std_setup_time` remain the baseline; the learned value is a separate, confidence-carrying overlay the scheduler prefers when present and trusted. Both are retained (the baseline is needed for the Phase 5 plan-comparison / frozen-engine baseline).
- **Simulator and real connectors stay separate (SKIP-51).** The simulator is a demo fixture emitting 4.3-shaped actuals; it is **not** a real MES/IoT connector and must be cleanly swappable for one later (same actuals contract). No real floor integration this phase.
- **No hardcoded data — boards render from seeded DB rows through the real query path.** Every value on every board/view (KPIs, costs, OEE, variance, counts, lists) **computes** from rows; **nothing is a literal in a component**. The test: replacing the seed with real inputs touches **no UI and no API**, only rows. Seed the *inputs* richly enough that outputs derive (seed actuals, rates, A·P·Q inputs — not the displayed figures). The gallery's sample numbers are representative, not values to embed. This is what makes the synthetic data legitimate rather than mimed.
- **Cost model = Tier B (this phase introduces it where the views need it).** Absolute cost-per-unit + decision-delta costing, computed from **seeded engineering inputs** (labor/OT rate — have MD15 labor_rate; changeover cost; run/machine rate; overhead; standard-cost basis). Cost **rates are Master-Data-owned** (seeded reference data); the cost **calculation lives in scheduling**. Tier C (margin/penalty/revenue) stays deferred and additive (`margin = price − cost`) — **do not** build it. Build Tier B only as far as the phase-3 views (Scorecard cost/unit) require; the full Cockpit costed-options can complete with D55 later.

## 3. This session — scope

**Likely module shape** (propose exact placement in your draft — actuals ingestion and learning are scheduling-adjacent; confirm whether they live in `scheduling` or a sibling):

- **Actuals ingestion (4.3):** receive execution actuals (actual cycle/setup, good/scrap qty, downtime) keyed to a scheduled operation; persist them. Tenant-scoped, append-only (actuals are history — they feed Phase 5's measured baseline later).
- **Parameterized simulator (SKIP-51):** emits normal actuals (near standard) by default, with a **triggerable drift** on a chosen resource (the Collision-2 tool-wear: cycle creeps ~8% over a window). Seeded/deterministic. A demo fixture, clearly separable from a real connector. Driven on cue (an endpoint/control to trigger drift), not a fixed replay.
- **The learning mechanism (D5/A14, Tier-1):** accumulate actuals per (resource, part/operation); derive the learned cycle/setup time via the **damped update rule** (§5); attach **confidence** (rising with sample count). Record provenance (window, count) for reproducibility/explainability. Bounded by guardrails before use.
- **Learned values into the schedule:** on re-solve, the sequencer prefers the learned value where present and trusted; `*_source = ml_adjusted`, `*_confidence` set. The board renders `ml` + confidence (no board change). Re-sequencing on a learned drift is where "re-sequenced to avoid starvation" comes from.
- **Performance variance (deterministic, no ML):** planned-vs-actual on the 4.4↔4.3 delta — throughput attainment and the variance that surfaces "Line A is running N% behind", schedule adherence, and the **churn metric** (D57). Core demo set; defer the fuller OEE dashboard if not demo-critical (note what's deferred).
- **Tool-wear flag (D56):** when learned-vs-standard cycle deviation crosses a configurable sustained threshold, emit a typed drift/wear **event** to the notification surface (SKIP-23). A signal only — not maintenance scheduling (SKIP-15).

**Forward-hooks for Phases 4–5 (name the seams, build nothing speculative):**
- The learned-value record carries `confidence` and provenance in a shape a **predictor (Phase 4)** can later read/extend — don't build prediction, but don't make the record predictor-hostile.
- The learned value is a structured object (value, source, confidence, sample basis) that a **narration surface (Phase 5 / A19)** could later verbalize — keep it structured, not a bare float.
- Actuals are retained append-only so Phase 5's **measured-historical baseline (D57)** can read them — don't discard actuals after learning.
- The standard baseline is retained alongside learned overlays so Phase 5's **frozen-engine baseline** can run on standards — don't overwrite standards in place.

**Out of scope (Phase 4–5):** parameter *prediction* (ahead-of-time forecasting), what-if option-sets, plan-comparison/baseline runs, narration/LLM, the agentic auto-action (A16), real IoT/MES connectors, the fuller OEE dashboard if deferred. Build the hooks above; build none of these.

## 3a. UI surfaces — what's new (designs: `docs/perduraflow-phase3-board.html` + `docs/perduraflow-six-views.html`)

Phase 3 adds **new components on the existing board**, **two of the six demo views** (their data lands now), and **one demo-only control** — built to the gallery designs, **no invented screens**, all values computed from seeded rows (no hardcoding).

**On the board (existing screen):**
- **Board bars: `std`→`ml` + confidence (existing component, behavior change).** The phase-2 source/confidence rendering goes live — tag flips `std`→`ml`, a thin confidence bar fills per bar. No new component, no board restructure (proof #1).
- **Variance strip (NEW component, on the board).** Board-adjacent chips: affected resource "N% behind plan", throughput attainment, churn, learned-param count. The affected lane label also carries a "behind" chip.
- **Learned-parameter detail panel (NEW component, on the board).** Selected op: the learned value as **one settled step** (standard → learned, struck-through standard, two-point track — *not* a time-series), rising confidence, sample basis, and the **triggering signal** (tool-wear). This *is* the convergence beat **and** the structured "why" (forward-hook for Phase 5 narration). Decide with RG: panel (click-to-understand) vs. inline-on-bar (live reveal).
- **Tool-wear flag** lands in the notification bell / toast (SKIP-23) — no new screen.
- **`ml` bar colour** — distinct colour vs tag-only: propose; RG's aesthetic call.

**Two demo views land this phase (designs in the gallery — build to them):**
- **View 2 · Service–Cost Scorecard** (plant manager) — **the full performance screen**, with phase-3-computable metrics: OTIF, OEE + A·P·Q breakdown, throughput attainment, cost-per-unit (Tier-B cost model), at-risk orders. **The baseline-comparison arm ("vs manual baseline", baseline→optimized) is a Phase-5 hook (D57) — leave it as a named seam, do not fake it.** The board's variance strip is this screen's operational summary; both exist.
- **View 3 · Workforce coverage** (supervisor) — the operator×station coverage view: **reuse `QualificationMatrix` (BUILT phase 1)**, re-skinned to coverage/readiness, + next-shift readiness % + the cert-gap → OT-call-in **confirmed proposal** (D54). Labor-*aware* (cert coverage + confirmed fill), **not** rostering (D43).

**Demo-only control:** the simulator **drift trigger** is staging scaffolding — a clearly-separate demo/dev control or scripted endpoint, **never** in the operational or admin nav.

**Deferred (not this phase):** Views 1/4/5 (Cockpit costed options, Exception Queue, Objective Policy — phases 4–5); the Scorecard baseline arm (phase 5); Tier-C cost.

## 4. Working protocol

1. **Draft the deltas** (api-spec + frontend-spec + PROJECT-SUMMARY): actuals ingestion, the simulator, the damped learning mechanism + the update rule (§5), learned-values-into-schedule, performance variance, the tool-wear flag, and the board changes (source/confidence going live, variance display). **Present and stop for sign-off. Do not implement.**
2. On sign-off: implement in dependency order — actuals ingestion + simulator → learning mechanism (damped) → learned values into re-solve + source/confidence live → performance variance + tool-wear flag.
3. Verify against §6.
4. Propose before any large or irreversible move.

## 5. Items to propose in your draft (genuine design choices — don't just pick)

- **The damped update rule (the load-bearing one).** How a learned parameter updates: window size / minimum sample count before the first step, the step rule (does it move in one decisive step past a confidence threshold, then hold? EWMA with a slow factor? a confidence band that must be cleared?), and how confidence is computed and rises. Must satisfy A18 (reproducible, bounded, damped) and the storyboard (convergence not motion — the board shows a settled step, never a live-updating number). **This is the most important decision in the phase.**
- **Guardrail bounds on learned values.** What sane limits a learned value must pass before it reaches a committed schedule (e.g. max deviation from standard, must-clear-confidence-threshold), and what happens when it doesn't (reject? cap? flag?).
- **Simulator drift control.** How drift is triggered and parameterized (which resource, magnitude, ramp), kept deterministic/seeded and clearly a demo fixture.
- **Performance-variance display.** Where "Line A running N% behind" surfaces (on the board? a strip? a small panel?) — and confirm the OEE-dashboard cut (what's in vs deferred).

## 6. Definition of done — Phase 3

- `bun run check` green; API builds/boots; `next build` + Expo render (board shows learned values on web **and** native).
- The simulator emits actuals; the loop learns; on re-solve the schedule uses learned values and the board shows `· ml` + confidence where it showed `· std`.
- **Proofs (show in the hand-back):**
  1. **Source/confidence went live with zero schema/board change** — no migration added the fields (they exist from Phase 2's `0004`), the board component wasn't restructured; only behavior changed. Show the diff is behavior-only.
  2. **Damping / convergence** — feeding a drift, the learned value makes a **damped, settled** move (not per-actual twitch); confidence rises with samples. Demonstrate the update rule holds steady once converged (a stream of further actuals near the learned value does **not** keep moving it visibly).
  3. **Determinism (D2)** — same seeded actuals sequence → identical learned values and identical resulting schedule (byte-identical signatures), twice.
  4. **Bounded (A18)** — a learned value that would breach the guardrail (e.g. absurd deviation) is rejected/capped, not silently committed — show it.
  5. **Boundary intact** — actuals/learning live in their module with a scoped schema; no cross-module `schema/` import (negative-tested); master-data still reached only through the bound contract.
- **Browser-verified (web + native):** trigger drift → loop learns → board flips to `ml`+confidence on the affected op → re-solve re-sequences → tool-wear flag appears in notifications → performance variance shows "behind plan". Determinism spot-check (two runs, diff).
- **The two phase-3 views render (web + native), built to the gallery:** Scorecard (OTIF/OEE/A·P·Q/throughput/cost-per-unit/at-risk, baseline arm left as a named Phase-5 seam) and Workforce coverage (QualificationMatrix re-skinned + readiness + cert-gap → OT confirmed-proposal).
- **No-hardcoding proof:** every value on the board and both views resolves from seeded DB rows through the real endpoint — show that the displayed figures are computed (e.g. change a seed row → the KPI/cost/variance changes), with **no literals in components**. Tier-B cost-per-unit computes from seeded rates (Master-Data-owned), not typed in.
- Forward-hooks present (learned-value record is structured with confidence+provenance; actuals retained append-only; standards retained alongside overlays; Tier-C cost is an additive seam `margin = price − cost`) — but **no** prediction/narration/baseline/Tier-C built.
- Docs updated; completion log (SKIP-51 simulator built, SKIP-04 live, D56 flag built, SKIP-23 used; Tier-B cost noted). Stop at this checkpoint. Do not start Phase 4.

---

*Phase 4 (parameter prediction — forecasting ahead of time, on top of this learning mechanism) gets its own brief once Phase 3 is signed off. Phase 5 (what-if + plan-comparison/baseline + narration) follows. Both attach to the hooks above.*
