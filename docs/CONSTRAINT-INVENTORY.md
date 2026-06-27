# PerduraFlow — constraint inventory (hard / soft / approval)

> **Purpose:** a summary of what the scheduler constrains and how. Distinguishes **hard** (a plan violating it is invalid/infeasible — not negotiable, not weighted), **soft** (weighted in the objective — the optimizer trades it off; never invalidates a plan), and the **approval policy** (gates *commit*, not validity). **Also tracks CONFIGURABILITY** — for a platform meant to be "installable by any manufacturer with safe defaults, configurable per client" (D48), *whether and how* each constraint can be configured is as important as whether it's enforced.
>
> **Confidence markers (enforcement):**
> - ✅ **VERIFIED** — built and walked this/prior cycles; high confidence it's enforced.
> - ⚠️ **QUESTIONABLE** — spec'd, but built-status uncertain → **ask Claude to confirm against the code** (collected in the "Questions for Claude" section at the end).
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
- ✅ **Inspection-station capacity (C3)** — the inspection station is a finite resource ops compete for (queue for the booth) + weld→inspect precedence. *(Demo models it as a station-as-resource; the spec's cert-skill-pool is the production form — see Questions.)*
- ✅ **Minimum batch / run-length (C4)** — `minBatchQty`, run-to-minimum (no tiny batches between big ones).
- ✅ **Resource eligibility** — an op targets a resource *group*; only eligible active members run it (least-loaded assignment, tie-break lowest id — AS10).
- ✅ **Routing precedence (within a part)** — multi-operation routing order (op N before op N+1); linear in-plant flow.
- ✅ **No-eligible-resource reject (D4 service gate)** — an op with no eligible resource is a HARD reject (`infeasibleReason`). Deliberately kept DISTINCT from the soft window-overflow penalty (that one is resolvable by faster-operator/reroute/OT; this one nothing can fix).
- ✅ **Operator double-booking guard** — a per-operator assignment can't place the same operator on two resources at once (`OPERATOR_DOUBLE_BOOKED`); per-resource one-by-construction. *(The manual-line first step; relaxes to capacity-based multi-line tending later.)*

### Questionable — confirm built-status with Claude
- ⚠️ **Sequencing / campaign rules (D28)** — four hard *legality* types: **required ordering, contiguity, forbidden-transition (+ required cleanout), max-consecutive.** These are mandatory ordering rules (paint dark→light needs a purge; material campaigns run together; max N runs before a clean). The changeover *cost* matrix (D8, soft) is separate from these *legality* rules. **Believed NOT built (or only the cost matrix, not the legality rules) — confirm.** *Likely the most significant hard-constraint gap; getting one wrong = scrap in real automotive.*
- ⚠️ **Tool-life hard cap (D9)** — a tool can run only N strokes before forced maintenance (a hard cap, always-on, not a policy option). The tool-*wear prediction* (advisory drift signal) is built; the hard *cap that forces maintenance at the limit* — **confirm whether it's enforced as a hard constraint or only predicted.**
- ⚠️ **Single-location tool constraint** — a tool occupies only one resource at a time (`single_location`, default true). Entities exist; **confirm enforcement in placement.**
- ⚠️ **Changeover cost in the objective (D8 matrix)** — the attribute-keyed transition-cost matrix (campaigning as a soft tradeoff). **Confirm the matrix is actually wired into `scorePlan` vs. spec-only** (listed here because it straddles — the *cost* is soft, but its built-status is uncertain).

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
- ✅ **Displacement / churn (weight low)** — re-timing ops vs. the prior committed plan (plan stability).
- ⚠️ **Changeover cost (D8)** — see Questionable above; confirm it's wired into the objective.

---

## APPROVAL POLICY (neither hard nor soft — gates COMMIT, not validity; D4 stage 2 / D25 / D26)

Routes *valid* (passed-the-hard-gates) but *risky* plans to human approval. Doesn't invalidate a plan; controls whether it can auto-commit.
- ✅ / ⚠️ **Confidence × tier autonomy** — LLM-influenced/low-confidence/customer-delivery-risk proposals route to approval; auto-commit only where explicitly permitted; LLM proposals require approval by default (D26). The framework + the demo's graduated-autonomy story exist; **production calibration of the confidence model (AQ8) is deferred** — confirm how much of the tiering is live vs. demonstrative.

---

## The calendar's escape-valve structure (a useful frame)

The working calendar is **hard on regular capacity**, with escape valves of increasing weight:
1. ✅ **Overtime** — stretch an already-open day past normal end (soft, costed; the OT-aversion factor). Built.
2. ❌ **Open a normally-closed window** — staff/schedule a normally-closed period (recovery weekend shift) as *planned regular capacity*, NOT OT premium. **Not built** — distinct from OT, symmetric with holidays (a date-specific *open* exception vs. a holiday's date-specific *closed* exception). A real Tier-1 recovery lever. *(Logged in REMAINING-ITEMS Future phases.)*
3. **Change the recurring pattern** ("we now run Sundays") — a config decision (the `workingDays` admin field), not a scheduling lever.

Same hard-floor-plus-costed-escape pattern recurs: **capacity** (hard) ← reroute/OT relieve it; **material** (hard) ← expedite relieves it; **calendar** (hard) ← OT / open-window relieve it.

---

## Configurability map (parameter level + toggleability) — ESTIMATES, verify with Claude

> For each constraint: what's the PARAMETER, its configurability level (L1/L2/L3), and can it be toggled on/off? **These are best-estimate; the actual levels need code verification** (added to Questions for Claude). The likely overall finding: *parameters are mostly L2 (config-data, no admin UI — the section-G half-features), and constraints are mostly always-on (no toggle).*

| Constraint | Key parameter(s) | Est. level | Toggle on/off? | Notes |
|---|---|---|---|---|
| Delivery window | `required_date` (per order) | L2 (data) | No (always-on) | Order data, not a config knob; correctly always-on |
| Material gate | `availableAt` (seeded) | L2 | No | Seeded today; production = ERP feed. Always-on |
| Working calendar | shifts, `workingDays`, holidays | L2→L3 | No | `workingDays` admin field = G#1 (→L3 when built); shift times/holidays editable in Calendars form |
| **OT cap** | **`otCapMinutes`** (seeded ~120/day) | **L2** | No | **The example asked about — config DATA (not hardcoded), but NO admin UI yet = G#2. Editing needs the Resources-form write-path.** |
| Resource downtime | window `[from,to)` | L2 | n/a (event) | Created via the launcher/simulator, not a standing config |
| Inspection capacity | station as a resource | L2 | No | Station-as-resource model; cert-pool is the production form |
| Min batch | `minBatchQty` | L2 | No | In `resource_type_config`, config-driven (proof passed); no admin UI = G#3 |
| Resource eligibility | `resource_group_id` | L2 | n/a | Master-data eligibility, not a toggle |
| Objective weights (soft) | lateness/cost/OT/inventory/displacement | **L3** | n/a (weight=0 ≈ off) | **Fully configurable** — the Objective Policy group (slider/exact-entry, cascade, dominance guard, audit). The "done right" example |
| Reporting window | `reportingWindowDays` | **L3** | n/a | Fully configurable — Reporting Policy group |
| Sequencing/campaign rules (D28) | the 4 rule types | ⚠️ unknown | ⚠️ — | Built-status unknown; if built, these are inherently per-rule on/off (a rule exists or doesn't) |
| Tool-life cap (D9) | stroke limit | ⚠️ unknown | ⚠️ — | Confirm enforced vs. predicted |
| Approval policy | tier rules, ml_reliance | ⚠️ partial | per-rule | Rules are individually configurable by design (D25); confirm how much is live |

**Takeaway:** the *soft* constraints (weights, window) are L3 (fully configurable) — the framework done right. The *hard* constraint *parameters* are mostly L2 (config-data, no admin UI — the section-G write-paths close this for OT cap, working days, resource-type config). **Almost nothing is toggleable on/off** — constraints are parameterized-but-always-on. That's fine for always-true constraints (delivery windows) but limits OPTIONAL ones (campaign rules, and any constraint a given plant doesn't use).

---

## Constraints control panel (a "configure the model" screen) — TRACKED, LOW PRIORITY

> **Idea (RG, low-priority, track-don't-build-yet):** a single screen to **toggle constraints on/off and set their parameters** — a "constraints control panel" / "operating-model config." For the demo it would visibly show the platform is **configurable, not a black box** — directly supporting the "installable by any manufacturer, safe defaults, configurable per client" (D48) story: open the panel, show OT cap / min-batch / working days / campaign rules as editable knobs with safe defaults, toggle one, re-solve, watch the plan respond.
- **What it would surface:** per-constraint enable/disable toggle + parameter editor, grouped (capacity / calendar / material / sequencing / objective weights), reading the L2/L3 config values above. Objective weights already have their config UI (could link or fold in).
- **Why it's compelling for the demo:** "constraints are configurable per client" is currently *told* (talk track) but not *shown*; a control panel *demonstrates* it. Toggling a constraint and re-solving is a strong "this is a real configurable engine" moment.
- **Why it's more than a screen:** (a) it needs the **on/off toggles** that mostly don't exist yet (most constraints are always-on — adding an `enabled` flag per constraint is real work); (b) it needs the **L2→L3 admin write-paths** (the section-G items: OT cap, working days, resource-type config) so the parameters are editable; (c) safe-defaults + cascade + audit per the framework. So it's the *capstone* of the configurability work (G items + per-constraint enable flags + the panel UI), not a standalone screen.
- **Sequencing:** depends on the configurability audit (below) + the G admin write-paths. **Low priority now; tracked so it isn't lost.** If pursued for the demo, the cheapest compelling version is: surface the constraints that are ALREADY L2/L3 (OT cap, min-batch, working days, weights) as a read/edit panel, defer the on/off toggles to where they're easy.

---

## Questions for Claude (verify against the code)

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

Once Claude answers, update the ⚠️ enforcement items to ✅/❌ AND fill in the verified configurability levels — this becomes a verified constraint + configurability inventory, and the basis for scoping the constraints control panel.
