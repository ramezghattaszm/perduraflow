# Six demo views — build plan (the demo minimum)

| | |
|---|---|
| **Source** | `magna-demo-USER_views.pptx` — six role-based views, the demo's user-facing layer |
| **Design reference** | `docs/perduraflow-six-views.html` — **build to these layouts; do not invent screens** |
| **Scope ruling** | All six are the **demo minimum**. Other components may be added as we build out, but these six must exist. |
| **Decision (cost)** | **Cost model ships at Tier B now; Tier C is a named roadmap extension (timing open — before or after demo, decided when commercial data is real).** **Tier B** = absolute cost-per-unit + decision-delta costing, computed from seeded engineering inputs (labor/OT rate, changeover cost, expedite cost, machine/run rate, overhead, standard-cost basis). Unlocks every cost figure the views display (Cockpit costed options + cost/unit tile; Scorecard cost/unit and cost-vs-baseline; Objective-Policy OT/expedite economics). **Tier C** (deferred, additive) = margin / penalty / revenue → profit-aware allocation; `margin = price − cost(B)`, penalty as an order attribute, allocation-by-margin in NMA. **Why C waits:** its inputs are *commercial* data (per-customer margin, penalty schedules) that can't be honestly seeded pre-pilot — and the no-hardcoding rule forbids inventing them. B's inputs are *engineering* facts that seed honestly. B→C is an additive layer, not a rebuild. **Placement:** cost *rates* are reference data, **Master-Data-owned** (alongside MD15 labor_rate); the cost *calculation* lives in **scheduling** (it costs the schedule it produces). |
| **Naming** | The deck says "Cadence"; our build is "PerduraFlow". Both are placeholders — **reconcile to one name** before the demo. (Not a build blocker.) |

## Organizing principle

The six views **are the operational app**, role-tailored. They slot into the operational sidebar (from the shell revision) and are **RBAC-gated** by the role model seeded in phase 0: a planner lands on Cockpit + Exception Queue, a plant manager on Scorecard, a supervisor on Workforce, an ops leader on Objective Policy, IT on How-It-Connects. Configuration stays behind the admin gear. No new nav concept — these populate the operational nav.

## Load-bearing invariant — no hardcoded data (binds all six views)

**Every value on every board renders from seeded DB rows through the production query path — never from literals in a component.** KPIs, costs, counts, option-deltas, OEE, at-risk lists, the "47 auto-handled" — all **compute** from rows. The test: replacing the seed with real inputs touches **no UI and no API**, only rows. If swapping the data source requires editing a component, the data was in the wrong place.

- **Corollary — seed the inputs, compute the outputs.** The seed must be rich enough that every displayed figure is *derived*, not asserted: seed labor/run rates, changeover costs, availability/performance/quality inputs, actuals-vs-plan, and real exception records (47 rows with a resolution status, not the number "47"). The sequencer costs real seeded demand; OTIF computes from seeded actuals; cost-per-unit computes from seeded rates.
- **This is what makes "synthetic data" legitimate rather than mimed.** Seeded-rows-through-the-real-path runs the actual mechanism; hardcoded-in-the-component fakes it — identical on screen, opposite in substance. The sample numbers in the gallery are **representative, not literals to embed.**

## Cockpit horizon & controls (View 1)

The cockpit Gantt has an explicit **horizon** and **range**: **default Day** (hour axis + individual operations — the existing board), **toggle to Week** (day columns Mon–Fri + **aggregate load per resource per day**, drilling into the day view for detail — *not* every operation across a week). The header shows the **explicit range** with prev/next stepping (e.g. "Mon Jun 15" or "Jun 15–19"), and the **plant selector** — **reused from the phase-2 board, already built** (the chip selector in today's screenshot). `ScheduleGantt` takes a `horizon` mode (`day | week`); week's per-day load is computed from the *same* scheduled rows the day view uses — same data, two renderings. (See the `ScheduleGantt` horizon note.)

## Per-view plan

### 1 · Decision Cockpit — Planner
- **Nav:** operational, primary planner landing. **Phase:** board now (2/3); costed options 4–5.
- **Components:** KPI tile row `NEW`; `ScheduleGantt` **BUILT** with **horizon mode (Day default / Week toggle)** + **explicit range with prev/next** + **plant selector (BUILT, reused)** + frozen-horizon shading (D44, phase 3); **Decision-needed panel** with 3 costed options + Apply&re-solve `NEW` (D55 what-if + A19 rationale).
- **Data:** schedule (built); KPIs (OTIF/cost-per-unit/OEE/line-stops — need the cost model + phase-3 metrics); the 3 options need D55 + the cost model.
- **Demo-min:** board + KPI row + a 3-option costed decision on the seeded GP-1142 change. **Deferred-detail:** arbitrary dynamic option generation (demo uses the shaped change).

### 2 · Service–Cost Scorecard — Plant manager  *(this is the "full performance" screen)*
- **Nav:** operational. **Phase:** metrics phase 3; **baseline-comparison arm phase 5** (D57).
- **Components:** 3 KPI tiles vs-baseline `NEW`; OEE breakdown bars (A·P·Q) `NEW`; service-vs-cost baseline→optimized `NEW`; at-risk orders list `NEW`.
- **Data:** OTIF/OEE/cost from phase-3 actuals + cost model; **"vs manual baseline" + baseline→optimized = D57 plan-comparison (phase 5)**; at-risk from scheduling.
- **Demo-min:** the full screen with phase-3-computable metrics; the baseline arm fills in phase 5. The board's **variance strip** is this screen's operational summary (both exist — strip on the board, screen in nav).

### 3 · Workforce — Shift supervisor
- **Nav:** operational. **Phase:** matrix built (1); operational coverage + proposal at the labor-constraint phase (D54 consumption, 3-demo).
- **Components:** operator×station coverage grid — **`QualificationMatrix` BUILT** (phase 1), re-skinned to a coverage/readiness view; next-shift readiness % `NEW`; **re-balance/OT-call-in proposal** `NEW` (D54 confirmed fill).
- **Data:** quals/certs/operators **BUILT** (MD15, phase 1); availability/out-status (seeded/D35); cert-gap detection (D54); OT proposal (D54, human-confirmed).
- **Demo-min:** coverage grid + readiness + the leak-test cert-gap → J. Morales OT proposal (Collision 4). **Note:** this is labor-*aware* (cert coverage + confirmed proposal), not rostering (D43).

### 4 · Exception Queue — Planner  *(the autonomy-demonstrated screen)*
- **Nav:** operational, planner. **Phase:** 4–5 (needs the upstream events to populate it).
- **Components:** "N need you · M auto-handled" header `NEW` (**the "autonomy demonstrated, not named" beat — the auto-handled count carries it**); prioritized exception list with per-row action (Review/Approve/Sign-off/View/Schedule) `NEW`.
- **Data:** aggregates events from across the system — demand change (D55), cert gap (D54), allocation (NMA), cycle-drift auto-resequence (phase 3), predictive maintenance (phase 4). Each row's severity/action reflects the **A18 gradient** (low-impact auto-handled, high-consequence queued).
- **Demo-min:** the five seeded exceptions + a credible auto-handled count. This view is where graduated autonomy becomes *visible* without being narrated.

### 5 · Objective Policy — Ops leader
- **Nav:** operational (or admin-adjacent), ops-leader, RBAC-gated. **Phase:** 5 (the policy/config surface over A18).
- **Components:** objective statement (service floor / cost-subject-to-floor) `NEW`; **customer priority tiers** — uses the **customer/program priority BUILT** (phase 1) `NEW` UI; trade-off controls (service floor %, max OT, churn tolerance, expedite premium) `NEW`; **autonomy settings** (auto-apply low-impact; sign-off thresholds) `NEW` = the A18 Tier-2/Tier-3 boundary as config.
- **Data:** priority **BUILT** (phase 1); trade-off + autonomy params (config, D42; safe defaults D48).
- **Note:** a *config* screen legitimately **names** the autonomy rules (the customer operates them) — this does not conflict with the live-demo "don't narrate the model" principle; different contexts.

### 6 · How It Connects — IT / technical
- **Nav:** operational/info, IT. **Phase:** static — buildable anytime (no engine dependency).
- **Components:** architecture flow (inputs → engine + pluggable solver → surfaces) + cloud-native footer `NEW` (static/presentational).
- **Data:** none live — it depicts A2 providers, A8 binding/pluggable solver, D35 integration, A19 copilot. Keep provider-agnostic (AWS as first set), and keep the talk-track honest (managed service, not "owned"; labor-aware, not "co-optimized").
- **Demo-min:** the static diagram. Lowest-risk view.

## Net-new components (what Claude Code builds, beyond reuse)
KPI tile row · costed-option decision panel · OEE-breakdown bars · service-vs-cost (baseline→optimized) · at-risk-orders list · next-shift-readiness + re-balance-proposal panel · exception-queue list (severity + action) · objective/trade-off/autonomy policy controls · priority-tier list · architecture diagram. **Reuse:** `ScheduleGantt`, `QualificationMatrix`, `DataTable`, `StatusPill`, `PageHeader`, `FormField`/`SelectField`.

## Cross-cutting dependencies this surfaces
- **Cost model** (overtime/changeover/expedite → cost-per-unit) — new, gates Views 1/2/5. Draws on MD15 labor-rate + changeover model.
- **D57 plan-comparison / baseline** (phase 5) — gates View 2's baseline arm and View 1's "vs baseline" framing.
- **D55 what-if + A19 narration** (phase 4–5) — gates View 1's options and the copilot in View 6.
- **D54 labor constraint** — gates View 3's gap/proposal and View 4's cert-gap row.

## Open decisions for RG
1. **Name:** Cadence vs PerduraFlow — pick one.
2. **Tier C timing:** cost ships at B now (resolved); decide *when* to build C (before or after demo) once commercial data is real.
3. **Convergence render** (from phase-3 board): detail panel vs inline-on-bar for the learning reveal.
4. **`ml` bar colour:** distinct colour vs tag-only.
