# Session Handoff — PerduraFlow (for the next Claude Code session)

> **Purpose:** brief a fresh Claude Code session (which starts with no memory of this one). Captures what's done, the **decisions made this session** (so they're not re-litigated), what's committed, the open threads, and the immediate next step. Pair this with the design docs in `/mnt/user-data/outputs/` (the durable record) and `CLAUDE.md` (the repo's entry point).

## Working model (unchanged)
RG builds PerduraFlow (client-agnostic manufacturing scheduling; demo client Magna Mexico — Saltillo Stamping = Press A + Press B; Ramos Welding = Weld Cell 1/2 + Leak-Test). Stack: Tamagui+Expo+Next+Solito+Zustand+TanStack; NestJS+Drizzle+Postgres; bun/Turborepo. **Propose-then-confirm gate** (Claude Code proposes/builds; RG reviews). Deterministic engine is authoritative; ML predicts/proposes within bounds; LLM explains, never fabricates; human confirms consequential changes; everything auditable (IATF).

## STATUS ANCHOR
Engine ~`wi-11`, weights default `aps-w2` (now `OBJECTIVE_DEFAULTS` in contracts), migrations through **0017** (line-down `resource_downtime` + `binding_downtime_id`; dropped `calendar.maintenance_windows`). Branch in flight: `exception-queue-messaging`. **Confirm before continuing: commit + push everything; `git status` clean; `bun run check` green.**

---

## DECISIONS MADE THIS SESSION (do not re-litigate)

### Causal lateness chain (BUILT, committed)
The binding floor (argmax of placement-floor components) is recorded at solve in the sequencer, persisted (migration 0013), `atRiskReason` derived from the SAME binder (one source). `LatenessChainService` walks predecessor/resource hops to a root (material / working_window / capacity / due_before_start), visited-set + MAX_DEPTH=8, acyclic-by-time-ordering, flags `truncated`. One `LatenessChainDto` feeds board bar-panel (summary+expander), exception queue, scorecard, and Copilot `explain_lateness`. Grounded: LLM narrates stored hops, never infers. Verified: DL-2002 full C2×C3 cascade (→ST-8830 inspection→weld→PV-22 material root); DL-1006 single-hop own root.

### Cockpit components (BUILT, committed)
- **KPI strip** — On-time, Utilization, At-risk, Throughput. **Utilization tone DECISION: don't amber the healthy 90–100% band** (<60 info, 60–100 ok, >100 bad). Throughput null-when-no-actuals (never faked).
- **Per-lane utilization** — busy(engine processing min) / available(regular working min, OT excluded), forward window, reconcile-by-construction (plant = capacity-weighted lane avg), >100% red = real overload, down lane → DOWN.
- **Work-list table** — order-grain, status taxonomy (completed→at_risk→in_progress→scheduled, precedence, computed not stored), summary counts. **DECISION: order grain (not op grain)** — fixed an existing KPI-tile(order)-vs-exception-queue(op) at-risk MISMATCH; now KPI tile = work-list at-risk chip = exception queue (reconciles). Exception queue = the at-risk filter of the work-list (single source). Workforce prediction proposals stay on the at-risk view for now.

### Goal-seek demo beat (DECISION: ship honest-unachievable only)
Exhaustively tested 6 inducers. **Structural finding:** the healthy plant's ~10% slack + ~1-day buffer absorbs moderate disruption, and the load-balanced press group physically SPREADS any overload to both press lines — so a clean, confined, ≤4h-OT-clearable induced "achieved→apply" case is structurally impossible without degrading the baseline or accepting both-press-line collateral. **Decision: do NOT contort the healthy plant for a staged achieved beat.** Ship **ST-8830 → honest-unachievable** ("OT can't clear this — it's the PV-22 material gate; expedite/re-promise") — ties to the causal chain, the credibility beat. Achieved path is proven by 10 unit tests; the engine returns achieved whenever a real ≤4h single-line overload exists (the demo plant just doesn't manufacture one). Recorded in REMAINING-ITEMS.md.

### Copilot scenario-construction (BUILT — A+B+C)
Natural follow-ups ("give me a 4th option using overtime") were failing — routed to retrieve, and context not carried. Fix: (A) routing prompt — "give me/add another option with [lever]" = construction; amount-less lever → goal_seek (engine finds the value, **never invent a number**). (B) CURRENT SCENARIO block carries the active changeSet + at-risk line; construction tools inherit the line (active-result→screen→ask), echoed so the inferred line is visible. (C) tests.

### Tool-wear predictive lifecycle (BUILT, committed — the deep walk; many integration bugs fixed)
The recurring root was **`ml_predicted` (forecast you're acting on) vs `ml_adjusted` (measured/materialized)** conflation, fixed at every layer:
- **Wear-card 3-state:** (1) forecast/advisory, (2) **pre-adjusted ahead of crossing** (NEW — honest "acting on the forecast, not yet crossed"), (3) **crossed** (only on real materialization). Earlier bug: pre-adjust wrongly fired "crossed."
- **Pre-adjust now actually applies:** the scheduler's `usable()` confidence floor (0.6) was silently filtering a deliberate human pre-adjust (conf 0.47). Fix: **bypass the floor ONLY for `ml_predicted`** (human decision); `ml_adjusted` still gated. Verified +5% applies and re-sequences.
- **Forward-only gate:** the overlay was retroactively stamping `ml_predicted` on PAST completed days. Fix: time-aware `resolveEffective(atMs)`; drop `ml_predicted` when `atMs < startOfToday` (the same past/future line variance/utilization use). Scoped to `ml_predicted` only. Past stays history.
- **Per-op provenance:** propagate real `c.source` (was hardcoded `ml_adjusted`); third `'predicted'` state (amber bar/badge/panel, distinct from purple measured); op panel reads per-op `cycleSource` (not the shared, date-agnostic overlay row).
- **Adopted ≠ applied (the subtlest):** the learner adopts a value the moment actuals justify it; the committed plan only changes on **re-solve**. After 588 actuals @8% the learner ADOPTED (`ml_adjusted`, +5.6%, conf 0.998, 168 samples) but the committed plan was STALE (still standard). The op-panel "not enough to adopt" was wrong (it adopted; plan stale). Fix: a **`wearApplied`** signal — every "action done" claim conditional on whether the plan actually carries the overlay (`triggerBodyStale`, `downstreamStale`, `learned.staleAdopted` copy). Verified end-to-end: predicting → pre-adjust (amber) → 588 actuals → adopted → **re-solve → applied** (purple/measured, +6%).
- **Two clocks principle (load-bearing):** the LEARNING clock (adopts when actuals justify) ≠ the PLANNING clock (changes only on re-solve). "Adopted" ≠ "applied." Predicted (amber) ≠ measured (purple). The UI must distinguish all of these honestly.

### Prediction queue (BUILT, committed)
- **Approve/Dismiss legibility:** Approve → "Pre-adjust" + action note ("adopt predicted cycle in next re-solve to protect downstream; current plan unchanged; reversible"); Dismiss → snooze copy.
- **Handled/Adopted bucket split:** auto_committed (system) vs approved (human) distinguishable (graduated-autonomy story).
- **Snooze-until-worse:** dismiss = snooze; re-surfaces ONLY on 4 triggers — confidence rose ≥ delta, urgency (crossing enters imminent band, "was above" guard), escalation (≥auto-threshold→auto-commit), materialized (safety floor). Per-tenant config `snoozeConfDelta` (0.15) + `snoozeUrgencyMinutes` (1440). Breadcrumb ("set aside at X%/Yh; now X'%/Y'h"). Migration 0015.

### Delete-draft (BUILT/approved)
DELETE /admin/scheduling/versions/:id; `discardDraft()` guarded `status==='draft'` ONLY (committed + **superseded** both immutable — superseded is the audit trail of what ran); soft-delete (`discarded` status); auto-reap previous draft on solve (keep latest per plant). Keeps the demo version dropdown clean.

### Continuous throughput — the version reframe (BUILT, committed — Stage 1)
Throughput dashed after re-solve+commit because it was **per-version plan attainment** (new version → new op ids → no actuals). **DECISION/REFRAME:** the KPI strip wants **continuous plant-performance** (a fact about reality, not a plan) — should NOT reset on re-solve. Two metrics, two homes:
- **KPI strip = continuous plant throughput:** good ÷ planned-at-execution over the executed-past window, **cross-version exact-id resolution** (mirrors the learner, which already reads actuals by (resource, op) across versions), latest-committed authority (double-count-proof), actuals never moved (audit-clean — read across, don't re-associate), null→dash. **Verified: holds 93.0% across re-solve** while per-version dashes.
- **Scorecard = per-version attainment** (plan-quality retrospective; reconciles as the weighted roll-up of the continuous number).
- Lane "behind plan" chip also aligned to continuous (same gap, same surface — consistency).
- Production scaling note: `actualStart` not indexed (fine at demo volume; index when data grows).

### Configuration framework (BUILT, committed — Stages 1 & 2; Stage 3 deferred)
**Principle: no hardcoding** — policy/preference is configured, hierarchical, audited. Full design in `CONFIG-FRAMEWORK-DESIGN.md`.
- **Framework (once):** generic `ConfigService.resolve/setOverride/resetToParent` — **global → tenant → plant** cascade, per-field provenance, revision versioning, audit (append-only), soft-delete. `config_override` (sparse, per-field) + `config_audit` tables (migration 0016). Descriptor registry — the ONLY per-group code is defaults + field metadata + optional guard (proves it generalizes). **Global = in-code read-only floor** (every DB row stays tenant-scoped — tenancy rule holds).
- **Group: Objective Policy (weights)** — slider + exact-entry (`AppSlider`), **live dominance guard**: one shared `firmLatenessDominates(weights)` in contracts (lateness ≥ 2× every other weight; aps-w2 passes 10≥2×4) used by the locked test, runtime guard (400 on breach), AND the UI (warns/blocks Save as you drag — invariant visible, firm delivery can't be weighted away). Resolved weights threaded via `ScoreContext` into `scorePlan` (sequencer untouched — it's EDD+changeover, doesn't read weights). `weightSetVersion` = resolved token (`obj:t<rev>`/`obj:p<rev>` else `aps-w2`), stamped in rationale + determinism key (weight change invalidates what-if cache). **Verified: cascade, guard rejects/accepts, config-driven scoring (353.43→366.924), token+cache.**
- **Group: Reporting Policy (window)** — `reportingWindowDays` (default 14); feeds the continuous-throughput `windowStart` (NOT hardcoded). The `today−12` was a SEED ARTIFACT, not a rule — now config-driven. **Stops at plant: COHERENT-but-UNDESIRABLE** (a per-line window would break cross-lane KPI comparability — different reason from weights, which are INCOHERENT per-line. Record the distinction.)
- **Autonomy (Stage 3, DEFERRED):** stays on its own tenant-only screen, registered as a placeholder ("cascade pending migration"). Migrate into `config_override` opportunistically later — pure refactor, no new capability, not worth doing now.

### Warm-start rolling window (BUILT, committed — earlier)
demo:reset produces a today-anchored window: committed baseline −12…+9 days (10 past WORKING days → today → future), ~80 backdated actuals (execution history + learning fuel). Deterministic. Press A wear = a live queued advisory prediction (predicting, not crossed). **demo:reset requires API up** (else empty board). Saltillo count varies by date (month-fill is month-end-relative): 42/42 on Jun 25 is correct, climbs toward 54+ early-month.

---

## OPEN THREADS (what's next)

### Immediate next step — OPERATOR-PERFORMANCE condition (the LAST condition to walk)
Conditions walked: material + goal-seek + tool-wear + **line-down (now COMPLETE)**. **Operator-performance is the last one.** The cycle-time effect: an operator's `performanceFactor` (C5, percent-of-standard) scales RUN time (`effectiveCycle = baseCycle / factor`; setup untouched; higher = faster). The simulator already has the operator scenario (set performance %, pin/swap operator on a line). Walk it: set an operator slow on a line (or swap a slower operator in) → re-solve the board → run times stretch on that line → at-risk where it tips → causal chain / what-if as appropriate → Copilot explains. Confirm the factor flows through the sequencer, the board reflects the longer runs, and the attribution is honest. (No new mechanism expected — the factor + assignment wiring already exists; this is a walk + verify, with seed/staging tuning to make the beat land.)

### LINE-DOWN condition — BUILT & PROVEN (this session, committed across 6 staged steps)
A line-down is a per-resource **`resource_downtime`** window — an unplanned CLOSURE for `[from,to)`, the SAME mechanism as maintenance (unified). Built end-to-end, propose-then-confirm per stage, verified against the running API:
- **Schema (migration 0017):** new `master_data.resource_downtime` (`kind` line_down|maintenance, `planned`, `from/to`, `reason`, `isActive` soft-delete, `createdBy`); `binding_downtime_id` on `scheduled_operation`; **`calendar.maintenance_windows` DROPPED** (was plant-shared → couldn't target one line; always-empty, no UI). Maintenance now flows through the same per-resource table.
- **Master-data:** repo/service/admin endpoints — open / "bring back up" (truncate-now) / retract (soft-delete); `listActiveDowntime` on `MasterDataReadContract` (the seam the engine binds to).
- **Engine (the core):** `buildBaseContext`/`utilization` build the downtime map → `resolveResourceCalendars` → `closedIntervals` → **ops displace around the window (NOT excluded)**. The binder TAGS the delayed start `resource_downtime` + records the window id (recorded at the binder, never re-derived — Option B). Merge-dedupe in `buildWorkingCalendar` → a window in base + a duplicate change is subtracted ONCE (**no double-apply**, locked by a unit test).
- **Causal chain:** new `resource_downtime` lateness root; narrates the stored window (kind + reason); Copilot `compactLateness` surfaces `downtimeKind`. Degrades gracefully (generic line-down label) if the window was brought-back-up/expired.
- **Simulator:** duration-from-now presets — "rest of today" (→ reroute-tomorrow), "rest of this shift", "next Nh" (→ OT-extend) — create a `line_down` record; "bring back up" closes it. Replaced the old binary inactive/active toggle.
- **Board/what-if:** DOWN + the lane **closure block** (new `ScheduleGantt` `closures` prop — hatched danger region showing the outage timing) + utilization DOWN all read the ONE window set. `runLineDownWhatIf` is **remediation-only**: sends a `line_down` marker (no window — it's in base), engine offers **reroute / OT** families (NOT wear/material), **cost differentiates** (reroute 1.67 vs OT 1.71). The window is the SITUATION (base, single source); the changeset is the RESPONSE — closes commit-gap & double-apply by construction.
- **Verified (running API):** op count preserved 42→42 (displaced, not dropped); `MF-104 op10` bound to `resource_downtime` + the window id; reroute+OT families + cost; stored changeset carries NO `resource_window`; applied reroute draft honors the window via persisted base (0 ops in the window). `bun run check` green; 132/132 tests.

### Remaining conditions to walk
- **Operator-performance** (next, the LAST — cycle-time effect; walk + verify, mechanism already wired).

### Seed-requirement notes (deferred — collect for the seed pass)
- **Seed a line as already-ADOPTED** (`ml_adjusted`/measured/purple) so the demo shows all THREE provenance states at once (standard, predicted, measured). Press A is deliberately *predicting* (not adopted), so today there's no purple line.
- **Forward-demand density:** month-fill is month-end-relative → board gets leaner near month-end (42 on Jun 25 vs 54+ early-month). Consider a **fixed rolling forward-window** so board density is stable regardless of demo date.
- Ramos thin board (10% of Saltillo) — bump demand vs keep focused-on-collision (staging decision).
- **Line-down at-risk beat — REACHABLE with a single-press outage; NO seed change needed (RESOLVED).** The earlier "single-press never tips / due-date slack / needs a seed" diagnosis was an **ARTIFACT of the determinism-cache bug below** (the what-if kept replaying one stale `absorbed` result). With the cache FIXED, a single Press A outage tips orders at a *plausible* length — re-probed against the running API (R1 pre-outage = 1): **rest-of-today → R2=1 ABSORBED; +1d → 1 ABSORBED; +2d → R2=4 AT-RISK (reroute 4 @1.65 vs OT clears to 1 @1.67 — cost differentiates); +4d → 7; +5d → 8.** So **both demo beats come from plausible single-press injections**: "Press A down rest-of-today" → absorbed (resilience), "Press A down ~2 days" (a realistic repair) → at-risk decide-support (reroute-vs-OT + C6). The seed prototype is **moot** — left the seed untouched (spine intact). (Due-date slack is real, but it absorbs only short outages, not "any length" as the cache had implied.)

- **✅ What-if determinism-cache bug — FIXED (was the "what-if ignores the window" blocker).** ROOT CAUSE: `determinismKey` (whatif.service) hashed baseVersionId + changeSet + items(demand) + overlay + weights + engine, but NOT the persisted downtime. The `line_down` marker carries no window times and a windowed-down resource stays `status='active'`, so `items` were identical → **every Press A window hashed identically → the first cached result (5h absorbed) was replayed for ALL windows** (the entire earlier sweep read one stale row). The placement engine was always correct (confirmed: clearing the cache flipped both-presses-30d from base=1 to base=17 = solve). FIX (commit `91f6ff7`): hash the active downtime windows in the key → cache busts per-window → the what-if base now REFLECTS the outage (agrees with solve + Step 6). **`b42d591` banner ALSO FIXED**: replaced `lineDownAbsorbed = best ≤ base` (always-absorbed, since the base IS the outage) with the three-reference-point model — R1 pre-outage (committed at-risk orders) / R2 with-outage (what-if base) / R3 remediation (options); **absorbed ⟺ R2 ≤ R1**. D2 confirmed empirically (committed at-risk count == scorePlan.lateOrders; committed baseline stable vs fresh re-solve). Re-verified: per-window busting, base = solve, both outcomes honest.

### Locale (deferred — before any Spanish/Magna-facing demo)
- **Only `en` is populated.** New line-down strings (simulator presets, lateness `rootLineDown`/`rootMaintenance`/`rootDowntimeReason` + `lever.resource_downtime`, error codes) and everything else live in `en` only. **Populate `es` before any Spanish/Magna-facing run** (the i18n scaffolding is ready; it's a translation pass). Ties to the Copilot-rename open item (check Spanish reading).

### Other open items
- **Applied-draft binding attribution (pre-existing, NEW note):** the what-if **apply** path (`WhatIfService.applyOption`) persists a draft WITHOUT binding attribution (`binding_kind`/`binding_downtime_id` null) — only `solve()` attributes. So the causal chain shows on the committed **solve** view (which has the condition + attribution), not on a what-if-applied/rerouted draft. Surfaced while building line-down; not introduced by it. Future cleanup: thread binding through the apply write path so a rerouted plan keeps its attribution.
- **Weights build was greenlit and BUILT this session** (Stage 2) — the earlier "build-vs-document pending" is now resolved (built).
- **Autonomy Stage 3** migration — deferred (above).
- **Day-rollover / view-freshness** (production) — captured under deferred real-time-push in REMAINING-ITEMS.md.
- **Copilot rename** — still open (candidates discussed; check naming collisions + Spanish reading before committing).
- Surfaces not yet deeply walked: scorecard, workforce, admin; native (Layer 4); polish (Layer 5).
- **Staging (F):** seed coherence (incl. the seed notes above), run-of-show, talk track, recorded fallback, rehearsal.

## Single sources of truth
- `REMAINING-ITEMS.md` — the master backlog.
- `ENGINE-CONSTRAINTS-AND-PRODUCTION.md` — the engine truth ledger.
- `CONFIG-FRAMEWORK-DESIGN.md` — the config framework + weights + reporting (Stage 3 autonomy pending).
- `WEIGHT-CONFIG-DESIGN.md` — weights detail + learned-weights-as-advisory (future, never auto-drift).
- `PREDICTIVE-SCHEDULING-EMPHASIS.md` — the predictive talk-track (built beats vs vision; honesty caveat).
- `PRE-SEED-SANITY-CHECK.md` — the re-runnable walk checklist.

## Before switching — checklist
1. Commit Stage 2 + any uncommitted (design docs: decide repo vs outputs).
2. **Push everything** (several commits accumulated unpushed across the session).
3. `git status` clean; `bun run check` green.
4. New Claude Code session: brief it from THIS note + `CLAUDE.md` + the docs above. **Line-down is DONE** — start the **operator-performance** condition (the last; walk + verify, mechanism already wired).
