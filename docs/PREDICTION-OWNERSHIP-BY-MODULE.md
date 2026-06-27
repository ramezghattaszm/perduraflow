# Prediction ownership — by module (where each predictive capability belongs)

> **The organizing principle:** prediction belongs to the module that **owns the thing being predicted** — not to the scheduler that consumes it. The scheduling kernel is the **integrator/optimizer**, not the oracle. Each domain module owns its data + its prediction and exposes the result (fact *or* forecast, with confidence) through a **stable consumed-input seam**; the scheduler reads the seam agnostic to whether the value is known or predicted. Anything genuinely ambiguous defaults to the scheduler (last section).
>
> **Why this matters:** keeps each module cohesive, keeps the scheduling kernel from bloating, makes the platform modular/sellable (adopt the scheduler first, add demand-forecasting later), and matches the boundaries already drawn (BOM→Master Data not the kernel; net-requirements separate; rostering external; material/operators/downtime already consumed through seams). The vision is NOT "the scheduler predicts more things" — it's "**each domain module gains predictive intelligence; the scheduler integrates ever-richer forecasts through the same seams it already uses.**"
>
> **The pattern is uniform:** every predictive capability is the same `observe-actuals → forecast → confidence-gate → propose → adopt-on-confirm` loop the tool-wear lifecycle already implements. The wear lifecycle is the **template**; each domain applies the same shape to its own input. And every one stays under the authority model: ML **predicts within bounds**, the deterministic engine **decides**, the human **confirms** consequential changes, autonomy is **earned** by measured outcomes (confidence × tier).

---

## Domain modules — each owns its data AND its prediction

### Demand / Net-Requirements module
**Owns:** OEM demand signals, EDI releases, CUM-based netting, the order book.
**Predicts:**
- **Demand forecasting** — project OEM release quantities/timing before the signal firms (release-pattern learning, seasonality, pull-ahead/push-out likelihood). *The central automotive problem (JIS/JIT volatility).*
- **CUM/netting projection** — forward net-requirements as demand evolves.
**Scheduler consumes:** the demand (forecast or firm) as its order input — agnostic to which.
**Status:** net-requirements module is **spec'd, not built** (D20, distinct from the scheduler material gate). Demand forecasting is a future capability within it.

### Supply / Inventory module (and Master Data for the requirement structure)
**Owns:** on-hand inventory, inbound scheduled receipts, supplier records, the BOM/requirement structure (Master Data).
**Predicts:**
- **Material-arrival prediction** — forecast `availableAt` with a confidence band from supplier historical reliability ("PV-22 will likely land [date ± variance]; this supplier runs 2 days late 30% of the time").
- **Supply-risk flagging** — surface inbound risk *before* a supplier misses.
**Scheduler consumes:** `availableAt` through the §4.8/D35 seam (today seeded; production = ERP/inventory feed; full = supplier-reliability forecast). The scheduler's material gate doesn't change — its *source* gets smarter.
**Status:** material gate built (seeded `availableAt`); real ERP input + supplier-reliability prediction are future. Full BOM (SKIP-45) retires the interim `material_requirement` link.

### Workforce module
**Owns:** the roster (who's employed, certified, scheduled to work each shift), operator records, certifications.
**Predicts:**
- **Operator-performance derivation** — seed the factor from external, then derive the *observed* factor from actuals (same learning-overlay shape as cycle times: measured, confidence-weighted, settled/drifting).
- **Performance-trajectory forecasting** — a new operator's learning curve ("hits 100% in ~3 weeks"); a downward trend (fatigue/disengagement signal).
**Scheduler consumes:** the operator performance factor + the assignment, through `resource_operator_assignment` / `resolveOperator`. Roster *generation* is external (workforce mgmt); **crew-to-line *allocation* is the scheduler's** (see the sharpened labor boundary in ENGINE-CONSTRAINTS 1E).
**Status:** performance *consumed* (C5 built); derivation-from-actuals + trajectory forecasting are future. Workforce module otherwise external by design.

### Quality module
**Owns:** defect/scrap/rework data, process capability, inspection results.
**Predicts:**
- **Yield / scrap / rework prediction** — forecast a run's defect rate *before* it runs (this part on this line at this speed historically scraps X%), so the plan accounts for rework loops and **true good-output**, not nominal quantity.
**Scheduler consumes:** "expected good-output = qty × predicted-yield" — so durations/quantities reflect real yield, not an implicit 100%.
**Status:** **not modeled at all today** (the engine assumes 100% yield — a real simplification, plans are routinely wrong because of it). A genuinely new module/capability. *High product value — arguably the most impactful missing predictor.*

### Asset / Maintenance module
**Owns:** equipment health, machine sensor data (vibration/temp/cycle-count), tooling/die life, maintenance history.
**Predicts:**
- **Equipment-failure prediction** — forecast a breakdown *before* it happens → predicted downtime window (so a line-down is **predicted and pre-positioned around**, not just reacted to — the ultimate extension of the wear beat).
- **Tooling/die-life prediction** — die replacement timing (stroke-life), fixture/changeover-tooling availability.
- **Tool-wear prediction** — cycle-time drift toward out-of-spec (the built beat — see the straddle note below).
**Scheduler consumes:** *predicted downtime* is the **same shape as an injected `resource_downtime`** — the Asset module writes predicted downtime windows / cycle-adjustments; the scheduler reads them through the existing downtime/cycle seams. Predict the failure → write the window → the scheduler displaces around it (preemptively, the same mechanism as a reactive line-down).
**Status:** tool-wear *lifecycle* built (predict→pre-adjust→adopt, OLS linear-trend stand-in); full predictive maintenance / failure prediction / die-life are future. The failure→predicted-downtime loop is a natural, high-value extension of the existing `resource_downtime` mechanism.

---

## Scheduling kernel — predicts about the PLAN (the things it owns)

The scheduler doesn't predict *inputs* (the domains do). It predicts *outcomes of the plan it owns*, and integrates the domain forecasts into one optimized, deterministic, auditable, human-confirmed schedule.

**The scheduler predicts:**
- **At-risk forecasting** — which orders will miss their due date, ahead of execution, with causal attribution (material / capacity / working-window / line-down / slow-operator roots). *Fully real today — the deterministic engine forecasting placement outcomes, no ML stand-in.*
- **What-if forecasting** — the outcome (lateness/cost/KPIs) of a hypothetical change (reroute / OT / assign-operator / expedite) *before* commit. *Fully real today.*
- **Cascade / ripple forecasting** — second-order propagation of a disruption forward across the horizon (the causal chain runs backward today; forward propagation is a future extension).
- **Bottleneck-migration forecasting** — where the constraint will move as the mix changes ("next week stamping → weld cells"), to pre-position capacity. *Future.*
- **Schedule-stability / nervousness prediction** — which commitments are fragile vs. solid (high-volatility orders/suppliers/lines). *Future; the `displacement` factor is the seed of this.*
- **Forward KPI trajectory** (boundary — see below) — OTIF / cost / utilization *trends* vs. targets.

**Stays authoritative + deterministic:** the kernel integrates all domain predictions into the plan; ML/forecasts *feed* it, never decide for it; the human confirms consequential changes. *Reproducible, auditable (IATF).*

---

## Boundary / questionable cases → default to the scheduler

Where ownership is genuinely ambiguous, the value lives in the scheduler (it's the integrator and the most-developed module), with a note on the cleaner long-term home if the platform grows.

- **Cycle-time learning (std → ml_adjusted).** Straddles process/execution-data (cycle-time-by-process is a manufacturing-process fact other systems care about) and scheduling (the effective cycle is the kernel's core placement datum). **Today: scheduler** (built there). Cleaner long-term: a process/execution-data layer *derives* the learned cycle; the scheduler *consumes* it — same domain-owns-value / scheduler-consumes split. Flagged, not urgent.
- **Tool-wear prediction.** Straddles Asset/Maintenance (the *wear* is an asset fact) and scheduling (the *cycle effect* drives placement). **Today: scheduler** (the wear lifecycle is built there). Cleaner long-term: the **Asset/Maintenance module predicts wear → writes a cycle-adjustment / predicted-downtime the scheduler consumes** (same as material/operators/downtime). The straddle is why it's the most interesting boundary case — it's currently the scheduler's headline predictive beat but architecturally belongs to Asset.
- **Forward KPI trajectory (OTIF/cost/utilization trends).** Straddles a BI/analytics layer and scheduling. **Today: scheduler-adjacent** (it owns the plan the KPIs derive from). Cleaner long-term: an analytics/monitor layer. Default scheduler for now.

---

## The platform thesis (one paragraph)

PerduraFlow is **not** "a scheduler with AI bolted on." It is a **manufacturing-ops platform of cohesive domain modules — Demand, Supply, Workforce, Quality, Asset/Maintenance — each owning its data and gaining predictive intelligence, feeding a deterministic scheduling kernel that integrates them into one optimized, auditable, human-confirmed plan.** Prediction is **distributed to where the data lives**; the scheduler **consumes forecasts through stable seams** (the same seams it already uses for material, operators, and downtime) and predicts only **about the plan itself** (at-risk, what-if, cascade, bottleneck). The architectural question for any new predictive feature is simply: **which domain owns the predicted thing?** — and that is where its prediction lives. Anything genuinely ambiguous defaults to the scheduler. This keeps each module cohesive, the kernel lean and authoritative, and the platform modular (adopt the scheduler first; add domain predictors over time) — and it matches the boundaries already drawn in the build (BOM→Master Data, net-requirements separate, rostering external, crew-allocation internal, downtime/material/operators as consumed seams).
