# PerduraFlow — constraint inventory (hard / soft / approval)

> **Purpose:** a summary of what the scheduler constrains and how. Distinguishes **hard** (a plan violating it is invalid/infeasible — not negotiable, not weighted), **soft** (weighted in the objective — the optimizer trades it off; never invalidates a plan), and the **approval policy** (gates *commit*, not validity). **Also tracks CONFIGURABILITY** — for a platform meant to be "installable by any manufacturer with safe defaults, configurable per client" (D48), *whether and how* each constraint can be configured is as important as whether it's enforced.
>
> **Confidence markers (enforcement):**
> - ✅ **VERIFIED** — built and walked this/prior cycles; high confidence it's enforced.
> - ⚠️ **QUESTIONABLE** — *(resolved this cycle — every ⚠️ enforcement item has been audited against the code and flipped to ✅/❌ with inline evidence; see the answered "Questions" section).*
> - ❌ **NOT BUILT** — spec'd, known to be unbuilt / deferred.
>
> **Configurability levels** (the "no-hardcoding" framework rule: policy/preference is configured, hierarchical, audited — global→tenant→plant cascade):
> - **L1 — hardcoded literal** in engine code. *Violates the framework rule; we want NONE of the constraint parameters here.*
> - **L2 — config data, seeded, engine reads it** (changing the data changes behavior) but **no admin UI to edit it**. Architecturally correct, not user-facing. *Most constraints likely sit here.*
> - **L3 — config data + admin UI + cascade + audit** — fully configurable per the framework. *The "done right" tier (objective weights, reporting window).*
> - **TOGGLE?** — separately from setting the *parameter*, can the constraint be turned **on/off** entirely? *(Probably mostly NO today — constraints are parameterized-but-always-on, not toggleable. An on/off flag matters for OPTIONAL constraints some plants have and others don't — e.g. campaign rules — and is the basis for the "constraints control panel" demo idea below.)*
>
> The mental model (D4): every proposal passes **hard gates** (deterministic validity) → then the **approval policy** routes valid-but-risky plans to humans → and the **objective** (soft weights) ranks the valid options. A useful recurring pattern: many constraints are a **hard floor + costed escape valve** (e.g. calendar is hard, but OT extends it at a cost; capacity is hard, but reroute/OT relieve it; material is hard, but expedite relieves it).

---

## HARD constraints

### Verified (built + walked)
- ✅ **Delivery-window gate (D4)** — `planned_end > required_date` flags the order; drives at-risk. The core lateness check.
- ✅ **Material / component availability (D36 / §4.8)** — a job can't start before its component `availableAt`; enforced as the `earliestStartMs` floor in `placeJob`. Unmet → infeasible-at-time → at-risk. *(Buy-component scope, seeded `availableAt`; C2.)*
- ✅ **Working-window / calendar (D17 / C1)** — ops place only within working shifts (calendar-aware; closed nights/weekends/holidays). An op that can't fit any window → **infeasible-as-planned** (`placedFeasible=false`, scored this cycle). *Hard on regular capacity; OT is the soft costed extension (see Soft).*
- ✅ **Resource downtime / line-down** — a `resource_downtime` window is a hard closure; ops displace around it (not dropped). Maintenance flows through the same mechanism. *(This cycle.)*
- ✅ **Inspection-station capacity (C3)** — the inspection station is a finite resource ops compete for (queue for the booth) + weld→inspect precedence, via the same eligibility/least-loaded placement as any resource. **Confirmed station-as-resource (Q6):** the cert-skill-pool (D29/D54) is **NOT** a hard capacity gate — certs/qualifications exist as master-data but labor is only a *performance modifier* (`performanceFactor` scales cycle time), never a finite by-skill capacity (see the ❌ labor item below). Certs are advisory-only today.
- ✅ **Minimum batch / run-length (C4)** — `minBatchQty`, run-to-minimum (no tiny batches between big ones).
- ✅ **Resource eligibility** — an op targets a resource *group*; only eligible active members run it (least-loaded assignment, tie-break lowest id — AS10).
- ✅ **Routing precedence (within a part)** — multi-operation routing order (op N before op N+1); linear in-plant flow.
- ✅ **No-eligible-resource reject (D4 service gate)** — an op with no eligible resource is a HARD reject (`infeasibleReason`). Deliberately kept DISTINCT from the soft window-overflow penalty (that one is resolvable by faster-operator/reroute/OT; this one nothing can fix).
- ✅ **Operator double-booking guard** — a per-operator assignment can't place the same operator on two resources at once (`OPERATOR_DOUBLE_BOOKED`); per-resource one-by-construction. *(The manual-line first step; relaxes to capacity-based multi-line tending later.)*

### Verified NOT built (audited this cycle — flipped from ⚠️)
- ❌ **Sequencing / campaign rules (D28)** — **NONE of the four hard legality types are built.** No required-ordering, no hard contiguity, no forbidden-transition/cleanout, no max-consecutive enforcement anywhere in the sequencer or scheduling service (no match for `campaign`/`forbidden`/`cleanout`/`purge`/`consecutive`/`contiguity` as gates). The only attribute-aware logic is a **soft, forecast-only changeover-grouping BONUS** ([sequencer.ts:324-327](apps/api/src/modules/scheduling/sequencer.ts#L324-L327), `CHANGEOVER_BONUS_HOURS = 24` at [sequencer.ts:20](apps/api/src/modules/scheduling/sequencer.ts#L20)) that pulls a *forecast* op up to 24h earlier when its attribute matches the resource's current campaign — **firm jobs never get it** (stay strict EDD). The routing schema is explicit: changeover attributes are *"modeled, not sequenced (the matrix/rules are scheduling-owned, SKIP-48)"* ([routing.schema.ts:37](apps/api/src/modules/master-data/schema/routing.schema.ts#L37)). **This is the biggest hard-constraint gap, as suspected.**
- ❌ **Tool-life hard cap (D9)** — **not enforced as a hard cap.** No stroke/usage limit gates placement (no `toolLife`/`strokeLimit`/`maxStrokes`/forced-maintenance match in the sequencer). Only the *advisory wear prediction* exists ([learning.predictor.ts](apps/api/src/modules/learning/learning.predictor.ts) → an OLS trend that proposes `preadjust_parameter`, never a placement constraint). Wear is **predicted, never capped.**
- ❌ **Single-location tool constraint** — **not enforced; not applicable as built.** The sequencer has **no tool entity at all** — it places operations onto *resources*, never tools (no `tool`/`single_location`/`singleLocation` reference in the engine). Tool master-data may exist but is invisible to placement.

### Verified built (audited — was ⚠️, now resolved)
- ✅ **Changeover cost in the objective** — wired into `scorePlan`, **but as a switch-COUNT, not a cost matrix.** `countChangeovers` ([whatif.scoring.ts:47-64](apps/api/src/modules/scheduling/whatif.scoring.ts#L47-L64)) counts attribute switches per resource in sequence order; the `changeover` factor ([whatif.scoring.ts:139](apps/api/src/modules/scheduling/whatif.scoring.ts#L139)) multiplies that count by `w.changeover` (default **1** — [config.ts:168](packages/contracts/src/config.ts#L168)). **The D8 attribute-keyed transition-cost MATRIX is ❌ not built** — every switch costs the same flat weight regardless of which transition; there is no per-pair cost lookup or sequence-dependent setup time.

### Not built (spec'd, deferred — known)
- ❌ **Labor as a hard capacity constraint (D29 / D30)** — labor is currently a *performance modifier* (C5: `performanceFactor` scales cycle time), NOT a *finite capacity-by-skill gate*. The spec wants: labor-short-and-unresolved → the shortfall stands as a hard constraint → demand at-risk. The hard labor-pool gate is unbuilt.
- ❌ **Full lot-sizing policy (D27)** — per-part policy (lot-for-lot / fixed-period + stackable modifiers: min-lot, lot-multiple, pack-rounding, max-lot). Only min-batch (C4) is built; the full policy engine is spec-only. *(Tool-life max applies on top as hard — see D9 above.)*
- ❌ **Full BOM explosion (§5.1, SKIP-45)** — a lightweight component→consuming-op link today, not recursive multi-level BOM.
- ❌ **Make-component precedence / dependent demand (D37)** — sub-assemblies whose own production must precede the parent (multi-level dependent demand, cross-level precedence). `opSeq` is carried but not used to order.

---

## SOFT constraints (the objective function — `scorePlan`, weight-set `aps-w2`)

These are weighted factors the optimizer trades off; they rank valid plans, never invalidate one. **Invariant: the `firmLatenessDominates` guard keeps lateness ≥ 2× every other weight — so cost/OT/inventory can NEVER pull a firm order late.**

- ✅ **Firm lateness (weight 10 — DOMINANT)** — firm-late hours. *This cycle: window-overflow infeasibility folded in via a fixed sentinel (`infeasibleFirmOps × 100_000`) so a can't-run plan scores worse than a runs-late plan, while `firmLateHours` stays honest.*
- ✅ **Cost (weight 4)** — per-placement: setup + run-cost·hours + **operator labor·hours** (added wi-12 this cycle) + overhead·qty, + OT cost. The Tier-B cost model.
- ✅ **Overtime aversion (weight 4)** — the *non-$* aversion to OT (fatigue/disruption), SEPARATE from OT's dollar cost in the cost factor. *(The deliberate OT double-axis: OT is penalized on $ AND on operational aversion, so an equal-$ operator swap beats OT.)*
- ✅ **Inventory / earliness (weight ~0.2)** — finishing-early carrying cost.
- ✅ **Displacement / churn (weight 2)** — re-timing ops vs. the prior committed plan (plan stability). [whatif.scoring.ts:142](apps/api/src/modules/scheduling/whatif.scoring.ts#L142).
- ✅ **Changeover (weight 1)** — a per-switch **count** penalty ([whatif.scoring.ts:139](apps/api/src/modules/scheduling/whatif.scoring.ts#L139)), NOT the D8 per-pair cost matrix (that's not built — see Hard section). All switches cost the same flat weight.

---

## APPROVAL POLICY (neither hard nor soft — gates COMMIT, not validity; D4 stage 2 / D25 / D26)

Routes *valid* (passed-the-hard-gates) but *risky* plans to human approval. Doesn't invalidate a plan; controls whether it can auto-commit.

- ✅ **Confidence × tier autonomy — LIVE for LEARNING predictions** (the wear/drift forecasts). `gateDisposition(tier, confidence, threshold)` ([learning.service.ts:27-30](apps/api/src/modules/learning/learning.service.ts#L27-L30)) runs on **every** settled prediction ([learning.service.ts:249](apps/api/src/modules/learning/learning.service.ts#L249)): **Tier-1 + confidence ≥ threshold → auto-commits** (`preAdopt`, fires `LEARNING_PREDICTION_AUTOCOMMITTED`); **Tier-1 below threshold, or Tier-2/3 → queued** for human approval ([learning.service.ts:355-371](apps/api/src/modules/learning/learning.service.ts#L355-L371)). Tier is a hard floor (confidence can't bypass Tier-2/3). The approve path is admin-guarded ([learning.controller.ts:54-60](apps/api/src/modules/learning/learning.controller.ts#L54-L60)).
- ✅ **Confidence is COMPUTED, not canned** — derived from sample count × dispersion: `clamp(n / N_TRUST) × (1 − clamp(cv / CV_MAX))` ([learning.rule.ts:112-118](apps/api/src/modules/learning/learning.rule.ts#L112-L118)). Only the *adoption threshold* (`tier1AutoThreshold` = 0.75) is seeded config. (Production calibration AQ8 — i.e. tuning the model itself — is still the deferred piece; the live formula is a reasonable proxy, not a calibrated model.)
- ❌ **Schedule-COMMIT approval gate — NOT built.** `commit()` has no approval check — it just supersedes the prior version and marks committed ([scheduling.service.ts:663-679](apps/api/src/modules/scheduling/scheduling.service.ts#L663-L679)); the comment flags it as the *"seam the Phase-3 approval policy will gate (SKIP-46)."* LLM/Copilot conversation plans never auto-commit anyway (construct + explain only, D26 — they apply to a *draft*, which a human then commits unapproved). Approval **tiers are seeded** (Planner/Supervisor/Plant manager) but no rule engine routes a commit to a tier yet.
- ❌ **Customer/delivery-risk routing** — not found. No risk-based approval trigger exists; routing is purely tier × confidence on learning predictions.
- ⚙️ **Configurability** — the autonomy policy is a real config group (`tier1AutoThreshold`, `wearBand`, `boundedAuto`, …) the engine reads, **but it cascades global→tenant only — NO plant override** (the autonomy boundary is a tenant-wide trust policy by design — [config.ts](packages/contracts/src/config.ts) autonomy group). A `PUT /config/autonomy/tenant/:id` write-path exists.

---

## The calendar's escape-valve structure (a useful frame)

The working calendar is **hard on regular capacity**, with escape valves of increasing weight:
1. ✅ **Overtime** — stretch an already-open day past normal end (soft, costed; the OT-aversion factor). Built.
2. ❌ **Open a normally-closed window** — staff/schedule a normally-closed period (recovery weekend shift) as *planned regular capacity*, NOT OT premium. **Not built** — but **confirmed a small symmetric extension (Q7):** holidays are modeled as a **date-specific closed-set** — `calendar.holidays` is a `jsonb` array of `YYYY-MM-DD` strings ([calendar.schema.ts:21](apps/api/src/modules/org/schema/calendar.schema.ts#L21)) checked by `dayIsWorking()` (*open iff `workingDays` includes the weekday AND date ∉ holidays* — [working-calendar.ts:129-133](apps/api/src/modules/scheduling/working-calendar.ts#L129-L133)). An "open a closed window" lever is the inverse: a date-specific *open-exception* set evaluated symmetrically. The calendar already has an admin write-path ([org.admin.controller.ts:117-134](apps/api/src/modules/org/org.admin.controller.ts#L117-L134)), so this is a schema-field + one-line-rule change, not a structural one. A real Tier-1 recovery lever. *(Logged in REMAINING-ITEMS Future phases.)*
3. **Change the recurring pattern** ("we now run Sundays") — a config decision (the `workingDays` admin field), not a scheduling lever.

Same hard-floor-plus-costed-escape pattern recurs: **capacity** (hard) ← reroute/OT relieve it; **material** (hard) ← expedite relieves it; **calendar** (hard) ← OT / open-window relieve it.

---

## Configurability map (parameter level + toggleability) — VERIFIED against the code

> For each constraint: the PARAMETER, its configurability level (L1/L2/L3), and toggleability. **Levels below are code-verified** (audit this cycle). Overall finding confirmed: *only the **config-framework** groups (objective weights, reporting window, autonomy) get full L3 cascade+audit; everything else is either L2 seed-only or a flat admin-editable entity with no cascade; and **nothing is toggleable on/off**.*
>
> **Cascade reality (Q11):** only **three** groups flow through `ConfigService.resolve()`'s global→tenant→plant cascade — `objective`, `reporting`, `autonomy` ([config.service.ts:48-78](apps/api/src/modules/config/config.service.ts#L48-L78)), and `autonomy` is **tenant-only** (no plant). OT cap, min-batch, and the calendar live in **master-data / org tables**, NOT the config framework — so they do **not** cascade.

| Constraint | Key parameter(s) | Verified level | Toggle on/off? | Cascade | Evidence |
|---|---|---|---|---|---|
| Delivery window | `required_date` (per order) | data (not a knob) | No (always-on) | n/a | [demand-input.schema.ts:28](apps/api/src/modules/scheduling/schema/demand-input.schema.ts#L28) — order data |
| Material gate | `availableAt` (seeded) | data (not a knob) | No | n/a | [material.schema.ts:22](apps/api/src/modules/scheduling/schema/material.schema.ts#L22) — supply data; simulator can override |
| Working calendar | shifts, `workingDays`, holidays | **L3-flat** (admin CRUD, **no cascade**) | No | ❌ flat (plant entity) | `org.calendar`; admin POST/PATCH [org.admin.controller.ts:117-134](apps/api/src/modules/org/org.admin.controller.ts#L117-L134); no config-audit |
| **OT cap** | **`otCapMinutes`** | **split: per-resource L3-ish / type-default L2** | No | ❌ no config cascade | Per-resource override **IS editable** via `PATCH /resources/:id` (`updateResourceSchema` includes it — [masterdata.ts:275](packages/contracts/src/masterdata.ts#L275)); the **type default** (`resource_type_config`, seed 240) has **no CRUD = G gap**. Engine reads override ?? type-default ([scheduling.service.ts:918](apps/api/src/modules/scheduling/scheduling.service.ts#L918)) |
| Resource downtime | window `[from,to)` | L2 (event) | n/a (event) | n/a | Created via simulator/launcher, not standing config |
| Inspection capacity | station as a resource | data (master-data) | No | n/a | Station-as-resource; cert-pool not a gate (see Q6) |
| Min batch | `minBatchQty` | **L2 (seed-only)** | No | ❌ | `resource_type_config.minBatchQty` (seed 100); engine reads [scheduling.service.ts:843](apps/api/src/modules/scheduling/scheduling.service.ts#L843) + enforces [sequencer.ts:370](apps/api/src/modules/scheduling/sequencer.ts#L370); **no CRUD = G gap** |
| Resource eligibility | `resource_group_id` | data (master-data) | n/a | n/a | Master-data eligibility, not a toggle |
| Objective weights (soft) | lateness/cost/OT/inventory/displacement/changeover | **L3 (full)** | n/a (weight=0 ≈ off) | ✅ plant→tenant→global | Config group + `PUT` [config.controller.ts:61-73](apps/api/src/modules/config/config.controller.ts#L61-L73) + `config_audit` + `firmLatenessDominates` guard. The "done right" example |
| Reporting window | `reportingWindowDays` | **L3 (full)** | n/a | ✅ plant→tenant→global | Reporting Policy group; same write-path + audit |
| Autonomy policy | `tier1AutoThreshold`, `wearBand`, `boundedAuto`, … | **L3 (tenant-only)** | `boundedAuto` is a real bool toggle | ⚠️ global→tenant (**no plant**) | Config group + `PUT /config/autonomy/tenant/:id`; the ONE genuine engine-honored on/off flag in the system |
| Sequencing/campaign rules (D28) | — | ❌ **not built** | — | — | No rules to configure (see Hard section) |
| Tool-life cap (D9) | stroke limit | ❌ **not built** | — | — | Predicted (advisory), not capped |
| Changeover | per-switch count weight | covered by **objective weights** (L3) | n/a | ✅ | Flat count × `w.changeover`; no per-pair matrix to configure |

**Takeaway (verified):** the **config-framework** groups — objective weights, reporting window, autonomy — are the only true L3 constraints (cascade + write-path + audit), and autonomy is tenant-only. The **calendar** is admin-editable but **flat** (no cascade, no audit). **OT cap** is half-editable (per-resource override yes; type-default seed-only). **Min-batch** is L2 seed-only (the clearest section-G gap). **Nothing is toggleable on/off at the constraint level** — the lone genuine on/off flag the engine honors is `boundedAuto` inside the autonomy policy; entity `isActive` flags (resources, calendars) remove the *entity*, they don't disable a *constraint*. Q8: **no hard-constraint parameter is an L1 literal** — the only sequencer literals are soft-policy bonuses (`CHANGEOVER_BONUS_HOURS=24`, expedite/ready deferrals), unit conversions, and a `[1..6]` working-days fallback; OT cap and min-batch are read from config tables.

---

## Constraints control panel (a "configure the model" screen) — TRACKED, LOW PRIORITY

> **Idea (RG, low-priority, track-don't-build-yet):** a single screen to **toggle constraints on/off and set their parameters** — a "constraints control panel" / "operating-model config." For the demo it would visibly show the platform is **configurable, not a black box** — directly supporting the "installable by any manufacturer, safe defaults, configurable per client" (D48) story: open the panel, show OT cap / min-batch / working days / campaign rules as editable knobs with safe defaults, toggle one, re-solve, watch the plan respond.
- **What it would surface:** per-constraint enable/disable toggle + parameter editor, grouped (capacity / calendar / material / sequencing / objective weights), reading the L2/L3 config values above. Objective weights already have their config UI (could link or fold in).
- **Why it's compelling for the demo:** "constraints are configurable per client" is currently *told* (talk track) but not *shown*; a control panel *demonstrates* it. Toggling a constraint and re-solving is a strong "this is a real configurable engine" moment.
- **Why it's more than a screen (now quantified by the audit):** (a) **on/off toggles essentially don't exist** — `boundedAuto` (autonomy) is the *only* engine-honored on/off flag; every other constraint is parameterized-but-always-on, so a constraints panel with real toggles means adding an `enabled` flag per constraint **and** teaching the engine to honor it (net-new work, not a UI veneer); (b) the **admin write-path gaps** are now specific: **min-batch** (`resource_type_config`) has **no CRUD at all** (pure seed-only — the clearest G gap); the **OT-cap type-default** is seed-only (the per-resource override is already editable via the Resources PATCH); **working days/shifts/holidays** are already editable (Calendars admin) but **flat, no cascade/audit**; (c) safe-defaults + cascade + audit per the framework — only objective/reporting/autonomy have that today. So it's the *capstone* of the configurability work, not a standalone screen.
- **What's cheap vs. expensive to surface:** *cheap* (already L3, just link the UI) — **objective weights** + **reporting window** (full config framework). *Medium* (editable, needs a panel) — **OT cap per-resource**, **calendar** (working days/holidays). *Expensive* (build a write-path first) — **min-batch** (needs `resource_type_config` CRUD). *Not applicable* — **campaign rules** and **tool-life cap** have nothing to configure because **they aren't built**; a panel toggle for them is downstream of building the constraint itself.
- **Sequencing:** depends on the G admin write-paths (chiefly the `resource_type_config` CRUD for min-batch) + per-constraint enable flags. **Low priority now; tracked so it isn't lost.** Cheapest compelling demo version: surface the already-L3 knobs (weights, reporting window) plus the editable OT-cap/calendar as a read/edit panel, and defer on/off toggles entirely (only `boundedAuto` exists).

---

## Questions for Claude — ANSWERED (code-verified this cycle)

> **VERDICT:** **~10 hard gates enforced** (delivery, material, calendar/working-window, downtime, min-batch, eligibility, routing precedence, no-eligible-reject, operator double-book, inspection-as-resource). **The real hard-constraint gaps: all four D28 campaign/sequencing legality rules, the D9 tool-life cap, and the single-location tool constraint are NOT built** (the sequencer has no tool entity at all; campaigning exists only as a soft 24h forecast bonus). **Changeover IS in the objective — but only as a flat switch-COUNT (weight 1), not the D8 cost matrix.** Approval autonomy is **LIVE for learning predictions** (tier × computed-confidence gate) but the **schedule-commit gate is unbuilt (SKIP-46)**. Configurability: **only objective weights + reporting window are full-L3 cascade+audit; autonomy is L3 tenant-only; calendar + per-resource OT are admin-editable but flat (no cascade); min-batch + OT-type-default are L2 seed-only**. **No hard-constraint parameter is an L1 literal.** **Nothing is toggleable on/off except `boundedAuto`.** Answers in detail below.

1. **Sequencing / campaign rules (D28)** — ❌ **NONE of the four built.** Only a soft, firm-excluded forecast changeover-grouping bonus ([sequencer.ts:324-327](apps/api/src/modules/scheduling/sequencer.ts#L324-L327)); routing schema says attributes are "modeled, not sequenced (SKIP-48)". *The biggest gap, as suspected.*
2. **Tool-life hard cap (D9)** — ❌ **not a cap.** Advisory wear prediction only ([learning.predictor.ts](apps/api/src/modules/learning/learning.predictor.ts)); no stroke-limit gate in placement.
3. **Single-location tool** — ❌ **not enforced / not applicable.** The sequencer places ops onto resources; **no tool entity** is referenced at all.
4. **Changeover cost (D8 matrix)** — ✅ wired into `scorePlan` as a **count** (`countChangeovers` × `w.changeover`=1, [whatif.scoring.ts:139](apps/api/src/modules/scheduling/whatif.scoring.ts#L139)); ❌ the **attribute-keyed per-pair cost matrix is not built**.
5. **Approval autonomy** — ✅ **LIVE for learning predictions** (`gateDisposition` tier×confidence, [learning.service.ts:27-30](apps/api/src/modules/learning/learning.service.ts#L27-L30); confidence computed at [learning.rule.ts:112-118](apps/api/src/modules/learning/learning.rule.ts#L112-L118)); ❌ **schedule-commit has no gate** ([scheduling.service.ts:663-679](apps/api/src/modules/scheduling/scheduling.service.ts#L663-L679), SKIP-46). No customer-risk trigger.
6. **Inspection capacity** — ✅ **station-as-resource confirmed**; cert-skill-pool is **NOT** a hard gate (labor = `performanceFactor` modifier, not capacity; certs advisory).
7. **Holidays** — ✅ **date-specific closed-set** (`calendar.holidays` `YYYY-MM-DD[]`, [working-calendar.ts:129-133](apps/api/src/modules/scheduling/working-calendar.ts#L129-L133)); the "open-a-closed-window" lever is a symmetric open-exception (small extension).
8. **L1 literals?** — ❌ **none for hard-constraint parameters.** OT cap + min-batch read from config tables; the only sequencer literals are soft-policy bonuses, unit conversions, and a `[1..6]` working-days fallback.
9. **L2 estimates / G gaps** — confirmed: **min-batch** = L2 **seed-only, no CRUD** (the clearest G gap); **OT-cap type-default** = seed-only (per-resource override editable). Objective/reporting/autonomy are real config the engine reads with write-paths.
10. **Toggle on/off?** — ❌ **only `boundedAuto`** (autonomy) is an engine-honored on/off flag. All other constraints are parameterized-but-always-on; entity `isActive` removes the entity, not the constraint.
11. **Cascade?** — only `objective`, `reporting`, `autonomy` cascade ([config.service.ts:48-78](apps/api/src/modules/config/config.service.ts#L48-L78)); `autonomy` is **tenant-only**. Calendar/OT/min-batch are master-data/org tables → **no cascade**.

<details><summary>Original questions (for reference)</summary>

1. **Sequencing / campaign rules (D28)** — are ANY of the four hard legality types (required-ordering, contiguity, forbidden-transition, max-consecutive) enforced in the sequencer? Or is only the changeover *cost* matrix present (and is even that wired into `scorePlan`)? This is the biggest suspected hard-constraint gap.
2. **Tool-life hard cap (D9)** — is the tool-life stroke cap enforced as a hard constraint (forcing maintenance at the limit), or only surfaced as the wear *prediction* (advisory drift)?
3. **Single-location tool constraint** — is `single_location` enforced in placement (a tool can't be on two resources at once)?
4. **Changeover cost (D8 matrix)** — is the attribute-keyed transition-cost matrix actually contributing to the objective (`scorePlan`), or is it spec-only / partial?
5. **Approval-policy autonomy** — how much of the confidence×tier approval routing is LIVE (actually gating commit on real triggers) vs. demonstrative for the demo? Which triggers fire today?
6. **Inspection capacity model** — confirm it's the station-as-resource model (the demo simplification), and that the cert-skill-pool (D29/D54) is NOT enforced as a hard capacity gate (certs are advisory-only today).
7. **(For the calendar-exception roadmap item)** — how are HOLIDAYS modeled today? If they're date-specific exception rows on the calendar, the "open a closed window" lever is a small symmetric extension; if handled some other way, it's a bigger change.

### Configurability audit (the parameter-level + toggle question — see the Configurability map)
8. **Are any constraint PARAMETERS hardcoded literals (L1) in the engine**, vs. read from config data/tables (L2+)? Specifically check: OT cap, min-batch, any window/threshold/limit — confirm none are literal constants in the sequencer/scorer. (The framework rule says none should be.)
9. **For each L2 estimate in the map — confirm it's actually config-data the engine reads** (so changing the seed/row changes behavior), and confirm which have NO admin write-path (the section-G gaps) vs. which are editable.
10. **Can any constraint be toggled ON/OFF entirely** today (an `enabled`/`active` flag the engine honors), or are all constraints parameterized-but-always-on? This determines how much work the "constraints control panel" toggles are.
11. **Does the configurability CASCADE** (global→tenant→plant per the ConfigService framework) for each configurable constraint, or are some flat/global-only? (Weights + reporting window cascade; do the others?)

</details>

*Audit complete — enforcement items flipped to ✅/❌ with inline code evidence, configurability levels verified against the code. This is now a verified constraint + configurability inventory and the basis for scoping the constraints control panel.*
