# Seed scenario — Magna Mexico (the demo's one coherent dataset)

| | |
|---|---|
| **Purpose** | One coherent, plausible, Magna-Mexico-shaped dataset that drives **all six views and the four collisions**, authored against the canonical model. This is the platform's first real dataset — shaped exactly like real ingestion will produce. |
| **Type** | Design + seed authoring. The seed extends the existing `demo:reset` baseline command (one entry point; this becomes the scenario it resets to). |
| **Honesty posture** | Specific and realistic, **presented as an informed guess** — not claimed as Magna's actual data. Plausible to an automotive domain expert; not represented as their real plants/parts/customers. The mechanism is real; the data is an educated placeholder until pilot data replaces it. |

## Non-negotiable principles (from the build)

- **No hardcoding.** The seed populates **inputs**; every displayed figure (KPIs, cost, OEE, variance, counts) **computes** from them through the real path. Seed rates/actuals/demand — never seed the displayed outputs. Replacing this seed with real ingestion touches **no UI, no API** — only rows.
- **Authored against the canonical model.** Every seeded value must be something a real connector (MES/ERP/EDI/HR) could produce. No convenience values a real feed couldn't replicate.
- **One coherent scenario, not per-screen fixtures.** The same order, operator, line, and actuals thread through every view — the GP-1142 in the Cockpit is the same order at-risk on the Scorecard, scheduled on the Board, queued in the Exception Queue. If the data doesn't reconcile across views, the demo fragments.
- **Deterministic + idempotent** via `demo:reset` — same scenario every rehearsal.
- **Plausible, not absurd** — numbers a plant manager reads as "right order of magnitude" without being their actuals.

## Scenario shape (specific, an informed guess — adjust as you like)

**Company / region:** Magna International, Mexico (Coahuila cluster — Saltillo / Ramos Arizpe). Automotive Tier-1 stamping + welding.

**Plants (use realistic Magna-Mexico-style names):**
- **Saltillo Stamping** — body/structural stampings (presses).
- **Ramos Arizpe Assembly/Welding** — weldments / sub-assemblies.
- (a third for plant-group/allocation context if useful — e.g. **Monterrey**.)

**Customers (real OEMs Magna serves in Mexico — for priority tiers, View 5):**
- **GM** (Ramos Arizpe complex) — Tier 1 protect.
- **Stellantis** (Saltillo) — Tier 1 protect.
- secondary (Tier 2/3) for the priority story.

**Resources / lines:** Press lines (e.g. Press Line A/B — stamping), Weld cells (Weld Cell 1/2). Realistic cycle/setup times for stamping/welding. Cost rates (run cost/hr, setup cost, overhead) plausible for the operation type — these drive Tier-B cost-per-unit, so they must be sane (a stamping $/unit a domain expert won't wince at).

**Parts:** specific-ish automotive stampings/weldments (e.g. body bracket, cross-member, reinforcement, welded sub-assembly) with part numbers (FG-1001 etc. or realistic). Physical attributes (material/gauge/colour) that drive changeover. **Specific, labelled as an informed guess.**

**Operators + certifications (drives Workforce, View 3 + Collision 4):** Mexican names. Cert structure with the **leak-test / torque / CMM** certifications. **Coherent cert-gap setup:** the leak-cert operator who is **OUT** next shift creates the gap; a **different** leak-certified operator is **available** to be called in on OT. (Fixes the current Jorge-is-both-out-and-the-fill contradiction.)

**Cost rates (Tier-B, Master-Data-owned):** run_cost_per_hour, setup_cost per resource; overhead_per_unit. Sane for stamping/welding so cost-per-unit computes plausibly.

## The rolling window — past · today · future (always anchored to today)

The seed is a **rolling window** recomputed from `baseDay` (today 00:00 UTC) on every `demo:reset`. Nothing is a fixed calendar date. Every run produces the same *shape* — **N completed past days → today → future horizon** — sliding forward with the wall clock so the past stays in the past, today is today, future stays future.

### Shape
| Segment | Range (working days, rel. today) | What it holds | Actuals? |
|---|---|---|---|
| **Past — completed** | −N … −1 | One committed, fully-executed schedule version per working day. Every operation carries actuals. The board's view-only past-day nav walks these. | **Yes** — every op |
| **Today — live** | 0 | The plan the planner acts on: the collision spine — DL-1006 (Saltillo, due 00:45, computed-late before the shift opens) and ST-8830 (Ramos, due 20:00, **material-gated** on PV-22 until 14:00). At-risk tensions are live now. | In-flight / partial |
| **Future — planned** | +1 … month-end | The planned horizon: remaining collision-spine due dates (+1…+5) + month-fill load to month-end. Std / learned-projected times; no actuals yet. | No |

Calendar: Mon–Sat working, Sunday closed (`workingDays [1..6]`), so N working days ≈ N × 7⁄6 calendar days. All offsets are computed via the existing `at(offsetDays, h, m)` helper off `baseDay` — past days are simply **negative** offsets, the symmetric extension of what the historical-outcomes rows already do.

### N — how many completed past days
**Decision: N = 10 completed working days (~2 calendar weeks).**

Driven by the learning gate, not by looks. Adoption needs `MIN_SAMPLES = 5` and confidence ≥ `CONF_ADOPT 0.6`; confidence saturates at `N_TRUST = 8`; the trailing mean/dispersion uses `WINDOW = 8`; wear prediction needs `MIN_SAMPLES = 5` over the same window (`learning.rule.ts`, `learning.predictor.ts`). The wear-story parameter (Press Line A, one representative part) accrues **one actual per completed day**. So:
- **8** is the hard floor — fills the trailing window, saturates confidence, gives a clean slope.
- **10** is chosen — 8 in-window samples all post-wear-onset **plus 2 days of margin**, so the wear signal and predicted trend stay unambiguous as the window slides forward each reseed.
- Reads as "a running system with a fortnight of completed production" — credible, not a token few days; not so long it bloats the dataset or the past-day nav.

Lever, if a shorter calendar past is ever wanted: run the wear part 2×/day on Press Line A → 4–5 days clears the gate. Kept at 1×/day here for realism and a clean day↔sample mapping.

### What the past actuals carry — and fuel
"Seed past completed days" and "seed actuals" are the same task. Each past op's actuals — `actualStart`, `actualEnd`, `actualCycleTime`, `goodQty`, `scrapQty`, `downtimeMinutes` — are seeded **inputs**; everything downstream computes through the real path (no hardcoded outputs):
- **(a) Credible history** — completed committed versions on the board's past days; the system has visibly been running.
- **(b) Live wear prediction (advisory, not adopted)** — Press Line A's cycle is worn with a convex/accelerating trend that leaves the trailing-window mean with **comfortable margin below** the `STEP_BAND 0.05` adopt threshold (≈ +1.8%), so it does **not** step to `ml_adjusted` — while the steeper recent slope projects a threshold-crossing **~2 days out** → a live, **queued (advisory)** wear prediction on the cycle param. The demo tenant is **advisory-first** (high Tier-1 auto-adopt threshold) so the prediction stays queued rather than auto-pre-adopting. Result: the board is **all `std` at reset** with a forward-looking "Press Line A wear will cross in ~2 days" signal — *predicting, not yet adopted*.
- **(c) Adoption is the live-drift beat** — the actual std→`ml_adjusted` adoption is the payoff of the live-drift demo (collision 2): a **defined injected step** drives the actuals across the band and the rule adopts — reproducibly, because the crossing is an injected value, not a noise nudge.
- **(d) Execution OEE (measured-historical arm)** — per-op actuals roll up to per-version execution OEE; the weekly `historicalOutcome` rows become **roll-ups of these same actuals** (recent weeks), optionally plus coarser older representative rows for a longer trend. Monterrey / Press Line B stay empty → honest "no history yet" state.

### The warm-start implication (run-of-show note)
With past actuals seeded, a fresh `demo:reset` is **not a cold start** — Press Line A already shows a live (advisory) wear prediction and execution variance, and the board has completed history behind it. It is **not yet adopted** (the board stays `std`): adoption is the live-drift beat that layers on top — a defined injected step drives the actuals across the band and the rule adopts. A cold-start variant is the same seed with the past-window length set to 0.

### Determinism
The drift curve and every per-op actual are generated deterministically from `baseDay` + a fixed per-day function (no `Math.random`), so each reseed reproduces identical learned values, prediction, and OEE — same window, same story, every rehearsal.

## The four collisions (the demo's spine — all must be seeded coherently)

The seed must support the demo's four disruption beats, each driven by real seeded data through the real mechanism:
1. **Demand change** — e.g. GM **GP-1142** raised 100→120 (drives Cockpit costed options + Scorecard at-risk + Exception Queue row — **same order everywhere**).
2. **Cycle drift / tool-wear** — Press Line A cycle creeps ~8% (the simulator drift; drives the closed loop, board std→ml, variance, tool-wear flag).
3. **Material shortage / allocation** — a component short forces allocation by priority (Stellantis vs others) — NMA, sign-off (drives Exception Queue allocation row).
4. **Cert gap** — leak-test cert gap from the OUT operator → OT call-in proposal (Workforce + Exception Queue).

Each collision's data must reconcile across every view it appears in.

## Open choices for RG
- **Part specificity:** how specific the parts/part-numbers get (generic "stamped bracket" vs named component families). RG chose **specific, labelled a guess** — confirm the level.
- **Third plant:** include Monterrey (for plant-group/allocation) or keep two for now.
- **Collision timing:** are all four seeded "ready to trigger," or staged in sequence for the run-of-show (staging concern — likely later).

## Done when
- `demo:reset` restores this scenario deterministically as the rolling window (see *The rolling window*): the **future** horizon is all-`std`/projected, while the **past** window has driven Press Line A to a live, advisory wear **prediction** (~2 days out) + execution variance — **not yet adopted** (board stays `std`; the live-drift demo is where it crosses and adopts). Deterministic: the simulator's noise is seeded on stable keys, so every reseed is byte-identical. A cold-start variant is the same seed with past-window N = 0.
- Every view draws from it and reconciles (same order/operator/line across Cockpit, Scorecard, Workforce, Exception Queue, Board).
- All four collisions are seeded and trigger through the real mechanism on real seeded inputs.
- Cost/OEE/variance all **compute** (no hardcoded outputs); a domain expert finds the numbers plausible.
- Honesty: the dataset is realistic-but-clearly-illustrative; nothing represents it as Magna's actual data.

---

## Addendum — historical-outcomes dataset (for the measured-historical baseline, Phase 5)

The **measured-historical baseline arm** (D57) computes from past recorded outcomes. It's a real product feature that **activates on data presence** — fed by a real MES/historian in production, and **fed by seed now** so it works in the demo (honestly labelled representative seed, swapped for real data later, same path, zero code change).

**Seed a historical-outcomes dataset** — the "before" the platform compares against:
- **Past plans + their actual results** for the demo plants/lines: prior committed schedules with recorded actual OTIF, cost/unit, OEE, late orders — i.e. "here's how prior shifts/periods actually went."
- Plausible and consistent with the scenario (same plants, parts, lines), and **clearly representative** — not claimed as Magna's real history.
- Authored against the canonical model so a real historian/MES later writes the same row shape.
- Enough history that the measured arm shows a meaningful comparison (a few periods), and the empty-state path is still testable (a plant/line with no history → "no historical baseline yet").

**Honesty:** the measured-historical comparison in the demo is **seeded representative history**, stated as such — "this computes from your historical data the moment your historian is connected; today it's representative seed." Same posture as the rest of the platform.

**Done when:** the measured-historical arm computes a real comparison from seeded historical rows; a no-history scope shows the honest empty state; the dataset is swappable for real historian data with no code change.

> **Superseded sourcing (see *The rolling window*):** these weekly rows are no longer hand-authored aggregates — they are **roll-ups of the per-op actuals** from the N completed past days (recent weeks), optionally plus coarser older representative rows for a longer trend. Same row shape, same arm, but now consistent with the board's past-day actuals and the learning fuel — one set of actuals feeds history, learning, and OEE.
