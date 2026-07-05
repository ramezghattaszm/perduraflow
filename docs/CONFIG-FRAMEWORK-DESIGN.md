# Hierarchical Configuration Framework — design

> A reusable mechanism for tenant/plant/sub-plant-scoped settings, so configuration is **never hardcoded** and every setting resolves through one consistent path. Built once; setting groups plug into it. Live groups: **Objective Policy** (the engine weights), **Reporting Policy** (the KPI reporting window), **Autonomy** (the tier-1 gate). Documented-next groups: **KPI / Metric Policy** and **Solver Policy**. Future settings use the same framework.
>
> **The overarching platform tenet (D42, A7): everything is configurable, nothing is hardcoded.** Anything that is a *policy* or *preference* (not physics) is configured, resolves hierarchically, cascades with override + reset, is versioned, and is audited. The framework makes that the **default** for all such settings rather than bespoke per-setting plumbing. Configuration resolves at the **most specific *coherent* level** — tenant → plant → (where the group is coherent there) line/resource. The level a group *stops* at is a property of the group, not the framework: the framework reaches sub-plant, and each group declares how far down it is meaningful (see "Resolution depth is per-group" below).

---

## The framework (build once)

### Hierarchy: global → tenant → plant → (line/resource)
Resolution: **most specific override wins** — line/resource → plant → tenant → global default (global is the shipped-default floor). Reset-to-parent at any level (a resource resets to plant, a plant to tenant, a tenant to global).

### Resolution depth is per-group (the policy-vs-physics boundary)
The framework **reaches sub-plant** (line/resource scope rows are first-class). How far down a given group is *meaningful* is declared **per group**, because the answer is governed by the **policy-vs-physics boundary**:

- **Policy that scores a whole-plant outcome stops at plant** — going lower is *incoherent*, not merely undesirable. The objective weights are the canonical case: they score one plant schedule against one objective; per-line weights would score one schedule against two objectives ("best plan" undefined). Reporting windows stop at plant for a *different* reason — coherent below but undesirable (comparability). Each group records its reason.
- **Physics / operating parameters go to the resource** — these already do, today, via `resource_type_config` (per-resource OT cap, min-batch, rates). The tenet formalizes `resource_type_config` as the **sub-plant config tier**: it *is* the framework reaching the resource level for physics, and admin write-paths/cascade/audit should be brought onto it (the section-G work in `REMAINING-ITEMS.md`).
- **Display preferences may go to the line** where comparability is preserved — e.g. a lane-level KPI target is coherent below plant (see KPI / Metric Policy).

So "everything configurable at every level" is true of the **framework**; the **stop level is the group's own coherence call**, recorded with each group. This is the reconciliation of the platform tenet ("configurable even below plant") with the long-standing weights rule ("policy stops at plant").

### Generic mechanism
- **Storage** — a config store keyed by `(settingGroup, level, scopeId)`; each row holds the group's settings payload + a version. Global rows seed the shipped defaults. Soft-delete/transition per the standing rule.
- **Resolution** — a generic `resolveConfig(settingGroup, tenantId, plantId)`: plant → tenant → global, returning the effective settings + **which level each field resolved from** (so the UI can show "inherited from tenant" vs "overridden at plant").
- **Cascade + reset** — set an override at a level; clear it → falls back to the level above. Reset-to-parent at any level.
- **Versioning** — each group's settings carry a version, stamped where the setting is consumed (so a stored artifact stays interpretable against the exact settings that produced it).
- **Audit** — every config change is a recorded, attributable event (who, when, group, field, old→new). IATF: behavior traces to a stated, dated policy.
- **UI** — a config surface per group + level: the group's fields, an "inherited / overridden" indicator per field, the **effective resolved values** shown alongside, and **reset-to-parent**.

### Why a framework, not bespoke-per-setting
Three settings already want this: **weights**, the **prediction-snooze thresholds** (shipped as autonomy config), and the **reporting window**. That's a pattern. Build the resolve-cascade-reset-audit mechanism once; each setting group is a thin plug-in (its fields + defaults + where it's consumed). Future tenant/plant settings slot in with no new plumbing. (The existing `AutonomyConfigDto` — `tier1AutoThreshold`, `snoozeConfDelta`, `snoozeUrgencyMinutes` — is effectively the first instance of this pattern and can be folded into the framework or kept as a sibling group.)

---

## Group 1 — Objective Policy (the engine weights)
The objective-function weights (`lateness, changeover, overtime, inventory, displacement, cost`). Full design in `WEIGHT-CONFIG-DESIGN.md`; in framework terms:
- **Fields:** the factor weights.
- **Stops at plant because line-level is INCOHERENT** — weights are an objective function scoring a *whole plant schedule* against *one* objective; per-line weights would score one schedule against two objectives ("best plan" undefined). What varies per line is *operating parameters* (physics, `resource_type_config`), not weights (policy).
- **Special guard:** the **firm-lateness-dominance guard** — a configurable weight set must not break the invariant that firm-lateness dominates (reject/hard-warn a set where it doesn't). The locked unit test protects the default; the runtime guard protects custom sets.
- **Consumed:** `scorePlan`/sequencer read the resolved weights via base context.

## Group 2 — Reporting Policy (the KPI reporting window)
The trailing window over which **continuous plant throughput** (and sibling continuous KPIs) is reported.
- **Fields:** `reportingWindow` — the trailing period for plant-performance KPIs (e.g. trailing N days, or shift/week-to-date). Default: a sensible platform default (e.g. trailing 14 days).
- **Stops at plant because line-level is COHERENT BUT UNDESIRABLE** (different reason from weights — record it): a reporting window *could* differ per line (it's a display preference, not an objective, so not incoherent), BUT you want **one consistent window across a plant's lanes** so the KPI strip's lanes are **comparable** (Press A over 7 days vs Press B over 14 would make the strip unreadable). So the plant's reporting window applies to the plant headline AND its lane breakdown — shared window = comparable lanes. Per-line reporting windows break comparability → excluded.
- **Consumed:** the continuous-throughput metric (`plantThroughput`) takes `windowStart` from the resolved reporting policy — **NOT hardcoded.** 
  - **Demo:** the resolved window happens to cover the warm-start's seeded rolling history (≈ today−12 → today). The `today−12` is a *seed artifact* (how much backdated execution the seed creates), not a rule — it falls out of the seed, the metric just reads the configured window.
  - **Production:** the resolved window is the plant's configured reporting period (trailing N days / shift / week) — real continuous execution history, reported over the stated period.
- **Note:** this is a *reporting/display* policy (affects what KPIs show), distinct from Objective Policy (a *scheduling* policy). Same framework, different concern — which is exactly why a general framework (not weight-specific config) is the right build.

## Group 3 — KPI / Metric Policy (which KPIs, targets, thresholds, dashboard composition)
*Documented-next (not yet built). The configurable extension of Reporting Policy: that group sets the **window**; this sets **which metrics**, their **targets/thresholds**, and **where they show**.*
- **Fields:** the **metric set** surfaced on each dashboard (cockpit / scorecard / the fuller 902 dashboard), each metric's **target + threshold bands** (green/amber/red), and **dashboard composition** (which metrics, in what order, on which surface/role). Metric *definitions* (formula, unit, axis) are reference data the modules register; this group selects and parameterizes them per scope.
- **Resolution depth — plant, optionally line for targets/thresholds.** *Which* metrics show and *how* a dashboard is composed resolve at plant (one consistent operational view per plant). **Targets/thresholds may resolve to the line** — a lane-level target (Press A vs Press B different OEE goal) is coherent below plant because it's a display preference against a per-line reality, not a whole-plant objective. (Contrast Objective Policy, incoherent below plant.)
- **Consumed:** the dashboard-registration framework (A7) reads composition; each KPI tile reads its target/threshold from the resolved policy — **not hardcoded** curated constants. Today's cockpit/scorecard curation (4 distinct-axis KPIs each) becomes the *default* composition, overridable per tenant/plant.
- **Ties to:** `REMAINING-ITEMS.md` → "Performance / KPI dashboard (902…)" (the surface) and the `Constraints control panel` (the sibling configure-and-see pattern). Blocked on **Q20** (which KPIs the client actually tracks, at what level, with what targets) — but the framework makes "they are all configurable" the structural answer regardless of Q20's content.

## Group 4 — Solver Policy (the optimizing-engine parameters, incl. CP-SAT)
*Documented-next (not yet built). The parameters that tune the optimizer itself — distinct from Objective Policy, which sets what the optimizer optimizes *for*.*
- **Fields:** solver run parameters — **time limit / solve budget**, **optimality gap** (accept a provably-near-optimal plan to bound runtime), **search workers / parallelism**, **deterministic seed**, and the **engine selection** (heuristic stand-in ↔ CP-SAT/OR-Tools, the `external_solver` binding). The objective **weights stay in Objective Policy** (Group 1); Solver Policy references them, it does not own them.
- **Resolution depth — tenant/plant; selected params to the line.** Engine selection + global budget resolve at plant (one engine, one budget per plant solve). Some operating params (a line's allowed search window) can resolve per-resource alongside `resource_type_config`.
- **Determinism (D2) preserved:** these are **resolved config stamped at solve**, not live runtime knobs — same resolved Solver Policy + same inputs → byte-identical plan. A deterministic seed and a fixed optimality gap are *part of* the determinism contract, not a threat to it.
- **Consumed:** the sequencer / `scorePlan` today, and the CP-SAT/OR-Tools flexible-job-shop optimizer when it drops in behind the `external_solver` binding (the provider/contract swap is **already designed** — see `ENGINE-CONSTRAINTS-AND-PRODUCTION.md §Engine` and `REMAINING-ITEMS.md` "Full optimizer" / "Optimizer selection AQ6"). Solver Policy is the config half of that swap; the binding is the provider half.

---

## The reframe that motivated this (recorded)
The continuous-throughput fix initially risked hardcoding `today−12` as the window. That's a *demo seed artifact*, not a production rule. Rather than hardcode it (or parameterize it ad-hoc), the window becomes a **Reporting Policy** field in the config framework — config-driven from the start, hierarchical, per the no-hardcoding principle. The demo passes the seed-derived window; production passes the configured reporting period. Same metric mechanism, window sourced from resolved config.

---

## Build sequencing
1. **The framework** — generic `resolveConfig(group, tenant, plant)` + store + cascade + reset + audit + the "resolved-from-which-level" introspection. (Fold or sibling the existing autonomy config.)
2. **Group 1 — Objective Policy (weights)** — fields + the firm-lateness-dominance guard + wire into scoring. (Per `WEIGHT-CONFIG-DESIGN.md`.)
3. **Group 2 — Reporting Policy (reporting window)** — the `reportingWindow` field + wire into the continuous-throughput metric (`windowStart` from resolved config, not hardcoded).
4. **UI** — the per-group config surface (inherited/overridden indicators, effective values, reset-to-parent).
5. **Group 3 — KPI / Metric Policy** (post-demo, with the 902 dashboard) — metric set + targets/thresholds + dashboard composition; line-level targets where coherent. Unblocks "configurable KPIs" (Q20).
6. **Group 4 — Solver Policy** (post-demo, with the CP-SAT swap) — solve budget / optimality gap / workers / seed / engine selection; the config half of the `external_solver` binding. Determinism stamped at solve.
7. **Sub-plant write-paths** — bring `resource_type_config` (per-resource physics: OT cap, min-batch, rates) onto the framework's cascade + audit + admin CRUD (the section-G gap in `REMAINING-ITEMS.md`), making the resource level a first-class config tier in practice, not just in design.

**Verification (per group + framework):**
- Resolution cascade: plant override wins → clear → tenant → clear → global. Reset-to-parent at each level.
- Config-driven proof: change a plant's weight → that plant's schedule re-scores (responds to config); change a plant's reporting window → that plant's throughput KPI reports over the new window; other plants unchanged.
- Weights: firm-lateness-dominance guard rejects a breaking set.
- Reporting window: NOT hardcoded — the metric reads the resolved window; demo window covers seeded history, a configured override changes the reported period.
- Audit: every change recorded (who/when/group/field/old→new).
- Versioning: each group's version bumps on change; stored artifacts keep their version's interpretation.

---

## Open decisions
- **Fold autonomy config into the framework, or keep as a sibling group?** It's already the pattern (tenant-level, nullable-with-constant-fallback). Folding unifies; keeping-sibling avoids touching working code. Lean: keep working as-is, register it as a group conceptually, migrate opportunistically.
- **Demo scope:** build the full framework now, or build Reporting Policy minimally (just the window, config-driven) + defer the full weights framework? The reporting window is needed for the throughput fix; the weights framework is a larger separate build (still pending its own build-vs-document decision). Possible: build the framework + Reporting Policy now (small, unblocks throughput), and bring weights through it when the weights build is greenlit.
