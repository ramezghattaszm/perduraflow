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
- `demo:reset` restores this scenario deterministically; baseline board is all-`std`, 0 learned, no variance.
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
