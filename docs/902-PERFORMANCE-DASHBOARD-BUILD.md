# 902 Performance Dashboard — build spec

> Full monitoring tiles + trends. Commit-per-part. **STOP FOR REVIEW after Part 1 (chart toolkit).**
> Foundations before assembly. This is the last major item in the deferred set.

## Scope
**KPIs (v1 tiles):** On-time, OEE (a/p/q legs), throughput, scrap, adherence, churn, cost — the universal Tier-1 set.
**Configurable measures (NEW — design in from the start, Group 3 KPI/Metric Policy):** a KPI's **measure definition** — *what components compose it* — is itself configurable, not just its thresholds. The canonical example: **On-Time** — a client configures the **basis** (production-complete vs. ship date), a **tolerance** window, and the **due-date field** it's measured against. v1 ships defaults that reproduce today's locked values byte-identical and proves configurability **on On-Time** (the live example); other KPIs ship a single default definition, structured uniformly so adding options later is wiring, not rework. See `CONFIG-FRAMEWORK-DESIGN.md` Group 3.
**Out of scope:** WIP (net-new metric, only if a client asks), the AI-performance surface (§1003 — its own model-monitoring track, needs write-path event capture, separate L).

## Foundation decisions (settled — do not re-litigate)
- **Charts:** hand-built `react-native-svg` primitives, matching the `ScheduleGantt` rendering pattern (real SVG on web via react-native-web — already proven cross-platform). **No charting-framework dependency.** Web-only escape hatch (a dedicated web chart lib for one surface) is a *future policy* if an exotic chart ever needs it — not built now.
- **Chart placement:** a **`charts/` subdirectory inside the existing shared UI components directory** — grouped with the other components, first-class. **NOT a separate monorepo/workspace package, and NOT inside the dashboard feature.**
- **Data:** windowed time-series as additive methods on `ActualsRollupService` (reads via `learning.read`, stays in `scheduling` — the boundary just cleaned in the actuals/grain work). §12.6 places these KPIs in scheduling.
- **KPI / Metric Policy:** a new policy domain on the **existing** config cascade (defaults→tenant→plant, audited) — beside reporting policy and objective policy — registered in `config.groups.ts` + a `ConfigReadService.resolveKpiPolicy()` read method (cascade/reset/audit/versioning automatic). Not a new config system; a new domain on the one that exists. It carries **two layers** per KPI: (1) **measure definition** (what composes the metric — the configurable-measures requirement) and (2) **thresholds** (green/amber/red bands + direction). Defaults reproduce current behavior exactly.

## Architectural invariants (hold throughout)
- ⚠️ **KPI current-value parity unchanged.** Trend work is additive; the demo's current numbers — including the **locked OEE** (Ramos 0.7435 / Saltillo Press-weak, read from seeded `historical_outcome`) — must stay **byte-identical**. Re-confirm on the standard baseline (Ramos + Saltillo, clean reset, today = Mon Jun 29).
- ⚠️ **Configurable measures must default-reproduce.** Making a measure configurable (On-Time basis/tolerance) means the computation now reads its definition from resolved config — so the **shipped default definition must reproduce today's hardcoded rule exactly** (On-Time default = `delivery(max actual_end) > requiredDate`, zero tolerance, production-complete basis). With no override, every current value is byte-identical. This is the same seed-now/real-input-later discipline as the material gate. The default IS the current behavior; configurability only changes outcomes when a tenant/plant overrides.
- **O1/O2:** the dashboard reads actuals only via the rollup (`learning.read`) and thresholds only via the config contract — **no cross-module table reads** (a cross-module join can't compile anyway).
- **Determinism** preserved; **typecheck + tests green per commit.**
- Charts in the shared UI components dir (`charts/` subdir); no charting-framework dependency.

---

## Part 1 — chart primitives (the reusable toolkit) ⛔ STOP FOR REVIEW AFTER THIS
- Hand-built on `react-native-svg`, matching the `ScheduleGantt` pattern (renders real SVG on web).
- **Location:** `charts/` subdirectory **inside the existing shared UI components directory** (alongside the other components — not a new package, not in the dashboard feature).
- Bounded toolkit the 902 needs and future modules reuse: **line, bar, area, sparkline**; axes/scales/gridlines, tick + value formatting, hover/tooltip, responsive sizing.
- Keep the API **generic** (data-in, not KPI-specific) so any module can use it.
- This is the front-loaded cost: chart #1 *is* building the toolkit; later charts are cheap.
- **Commit:** `feat(ui): cross-platform svg chart primitives (line/bar/area/sparkline) under components/charts`
- **Report at the gate (then WAIT for review):**
  1. The primitive API.
  2. A rendered sample on **both web and native**.
  3. Confirm it renders cleanly at **dashboard tile size**.
  - The whole cross-platform bet rides on the web render looking right — this is why it's the stop-gate.

---

## Part 2 — windowed time-series for trends (net-new data, parity-safe)
- Add windowed-series methods to `ActualsRollupService` — **additive**; must NOT touch the existing folds. Current-value parity must hold.
- ⚠️ **Per-KPI trend source differs — identify and report, don't assume one source:**
  - *Pure-actuals (throughput, scrap):* bucket `execution_actual` by period (day/week) via `learning.read`.
  - *Version-based (on-time, adherence, churn, cost):* already computed per-version → a trend is the **series across the version sequence**, not a new computation.
  - ⚠️ **OEE — flag, don't force.** OEE reads the **seeded `historical_outcome` snapshot** (single period, locked). A real OEE trend can't come from one snapshot, and deriving it from raw actuals would **move the locked current value**. **v1: OEE is a current-value tile only — NO trend.** Do NOT derive an OEE trend from actuals this pass. Report this explicitly; do not silently produce a flat or fabricated OEE line.
- **Report:** which KPIs trend cleanly from existing data; confirm OEE (and any other single-source KPI) is current-value-tile-only; confirm current-value parity unchanged.
- **Measure-definition seam:** when Part 3 lands, the On-Time series (continuous + version-sequence) computes through the same resolved On-Time definition as the current-value tile — a trend of On-Time uses the configured rule, not a second hardcoded one. (Build Part 2 with the late-test already factored behind `isOrderLate` so Part 3 only injects the definition.)
- **Commit:** `feat(scheduling): windowed KPI time-series on ActualsRollupService (additive)`

## Part 3 — KPI / Metric Policy domain: measure definitions + thresholds (on the existing config cascade)
New **KPI / Metric Policy** domain on the existing config system (defaults→tenant→plant, **audited**), registered in `config.groups.ts` + `ConfigReadService.resolveKpiPolicy(tenantId, plantId)`. Two layers:

**(a) Thresholds** (the original Part 3) — each KPI carries a **direction** + green/amber/red bands:
- higher-better: on-time, OEE, throughput, adherence
- lower-better: scrap, churn, cost
- Ship sensible Tier-1 defaults; tenant/plant overrides inherit cascade + audit for free.

**(b) Measure definitions (the configurable-measures requirement) — prove on On-Time:**
- **On-Time definition fields:** `basis` (`production_complete` = max `actual_end`, the default | `ship_date` = delivery + ship/transit offset), `toleranceMinutes` (grace before "late"; default 0), `dueDateField` (`requiredDate` default | future: `promisedDate`/`shipBy`). These are the "what components count toward On-Time" the requirement calls for.
- **⚠️ Default = current behavior, byte-identical.** Default `{ basis: production_complete, toleranceMinutes: 0, dueDateField: requiredDate }` reproduces today's `delivery > requiredDate` exactly. Parity holds with no override.
- **⚠️ One rule, two consumers.** BOTH On-Time homes must read the **same** resolved definition: `ActualsRollupService.computePlantOnTime` (continuous/dashboard) and `versionMetrics` OTIF (per-version scorecard). Extract a shared pure `isOrderLate(delivery, due, def)` so the two can't disagree (the same discipline as the wear-overlay gate consistency). The per-version path keeps its at-risk-OR-late composition; only the *late* test becomes definition-driven.
- **Other KPIs:** ship a single default definition each (current formula), modeled in the same shape so adding options later (e.g. configurable scrap inclusion, cost components) is wiring, not rework. Do NOT expose knobs for them in v1 — just structure for it.
- **Verification:** with defaults, every value byte-identical to baseline; override On-Time to `ship_date` or `tolerance=120` on one plant → that plant's On-Time changes, the other plant unchanged, audit row written.
- **Commit:** `feat(config): KPI/Metric Policy domain — On-Time measure definition + thresholds (defaults→tenant→plant, audited)`

## Part 4 — dashboard read endpoint
- One read endpoint serving: current-value tiles (existing rollup) + trend series (Part 2, KPIs that trend) + **resolved threshold status** per KPI (value vs cascade-resolved bands → green/amber/red).
- Scheduling read surface; consumes the **KPI / Metric Policy via its contract** (`CONFIG_READ.resolveKpiPolicy`) — both the measure definitions (feeding the computation) and the threshold bands (feeding status) — no cross-module table reads (O1/O2). Resolves per plant so a plant's overrides apply.
- **Commit:** `feat(scheduling): dashboard read endpoint (tiles + trends + threshold status)`

## Part 5 — dashboard screen
- Populate the `dashboard-screen.tsx` stub: tile grid (reuse the KPI-tile / VarianceStrip pattern) with threshold-colored status + trend charts (Part 1 primitives).
- OEE renders as a current-value tile (a/p/q legs), **no trend**.
- Plant/tenant scoped (cascade resolves per plant); honest empty-state where a series is unavailable.
- **Commit:** `feat(dashboard): 902 performance screen (tiles + trends)`

---

## Staging
Single go-ahead, all 5 parts, **but stop for review after Part 1** with the toolkit review (web + native render). Then proceed 2–5, reporting the Part-2 per-KPI trend availability and the final parity re-confirm.

## What to watch on report-back
- **Part 1 web render** — the cross-platform bet rides on the primitives looking right on web, not just native. The stop-gate.
- **Part 2 OEE handling** — must come back "OEE is current-value-only, parity unchanged." An OEE trend means it either touched the locked source or fabricated a line — that's a stop.
- **Final parity re-confirm** — current values (esp. locked OEE) byte-identical vs baseline.
