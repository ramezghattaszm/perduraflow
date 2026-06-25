# Hierarchical Configuration Framework — design

> A reusable mechanism for tenant/plant-scoped settings, so configuration is **never hardcoded** and every setting resolves through one consistent path. Built once; setting groups plug into it. First two groups: **Objective Policy** (the engine weights) and **Reporting Policy** (the KPI reporting window). Future settings (display thresholds, more KPI preferences) use the same framework.
>
> **The principle:** no hardcoding. Anything that is a *policy* or *preference* (not physics) is configured, resolves hierarchically, cascades with override + reset, and is audited. The framework makes that the default for all such settings rather than bespoke per-setting plumbing.

---

## The framework (build once)

### Hierarchy: global → tenant → plant
Resolution: **plant override → tenant override → global default** (most specific wins; global is the shipped-default floor). Reset-to-parent at any level (a plant resets to tenant, a tenant resets to global).

**Stops at plant.** Sub-plant (line) config is excluded — but the *reason* differs by setting group, so it's recorded per group (see each group). The framework supports an optional scope level below plant only if a group ever needs it (none do today).

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

---

## The reframe that motivated this (recorded)
The continuous-throughput fix initially risked hardcoding `today−12` as the window. That's a *demo seed artifact*, not a production rule. Rather than hardcode it (or parameterize it ad-hoc), the window becomes a **Reporting Policy** field in the config framework — config-driven from the start, hierarchical, per the no-hardcoding principle. The demo passes the seed-derived window; production passes the configured reporting period. Same metric mechanism, window sourced from resolved config.

---

## Build sequencing
1. **The framework** — generic `resolveConfig(group, tenant, plant)` + store + cascade + reset + audit + the "resolved-from-which-level" introspection. (Fold or sibling the existing autonomy config.)
2. **Group 1 — Objective Policy (weights)** — fields + the firm-lateness-dominance guard + wire into scoring. (Per `WEIGHT-CONFIG-DESIGN.md`.)
3. **Group 2 — Reporting Policy (reporting window)** — the `reportingWindow` field + wire into the continuous-throughput metric (`windowStart` from resolved config, not hardcoded).
4. **UI** — the per-group config surface (inherited/overridden indicators, effective values, reset-to-parent).

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
