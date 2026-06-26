# The Constraint & Scoring Engine — current state, simplifications, and production roadmap

> The engineering-truth ledger of the scheduling engine: every constraint considered (and whether it's hard, soft, simplified, deferred, or deliberately out-of-scope), how the heuristic scoring engine actually works (documented against the as-built code), the objective weights and how they should be configured in production, the authority model that relates the engine to the ML/LLM layers, and the production-build roadmap. This is **Chapter 1 of the production build plan.**
>
> *As-built against `sequencer.ts`, `whatif.scoring.ts`, `whatif.weights.ts` (ENGINE_VERSION `wi-11`, WEIGHT_SET_VERSION `aps-w2`).*
>
> <!-- TODO(RG): version NUMBERS synced to code (wi-11 / aps-w2, here + Part 2 + Part 3). Remaining: the per-version lineage TEXT for wi-9/wi-10/wi-11 (RG to supply). -->

> *Labor-model note (this session): the labor boundary in 1E was sharpened (roster-generation external; crew-to-line allocation is scheduling's — see 1E). Production-vs-model staffing framing added to 1C; crew-per-line + labor-as-capacity/multi-tending added to 1D and Part 5.*

---

## Part 1 — Constraints

Five categories: **hard** (must hold — infeasible if violated), **soft** (penalized in the score, can be traded), **simplified** (built but approximate), **deferred** (spec'd, not built), and **boundary** (deliberately out of the engine).

### 1A. Hard constraints (built — violation = infeasible / at-risk)
| Constraint | How it works (as-built) | Production gap |
|---|---|---|
| **Feasibility / eligibility** | Every op must have ≥1 eligible resource (group membership). The **service** runs the feasibility hard gate *before* `sequence()`; the sequencer assumes feasibility. A `feasibility` constraint binding is emitted (always non-binding when it reaches scoring). | Eligibility today = `resourceGroup` membership only. Production: richer eligibility (tooling, qualification-as-hard-gate if cert moves into the sequencer — see boundary). |
| **Working calendar** (C1) | `placeJob` walks the cursor through **working time only** — skips nights, Sundays, holidays, maintenance, line-down closures. An op can't be placed in closed time. Per-resource calendar; `ALWAYS_ON` (24/7) fallback when none. | Calendar is the resource **operating** calendar (machine hours), not labor. Labor-availability intersection (the line only runs when staffed) is deferred. Holidays/maintenance windows are modeled but empty in the seed. |
| **Material gate** (C2/D36) | `earliestStartMs` = latest availability of consumed buy-components — a **floor** on the op's start (`max(freeMs, origin, earliestStartMs, predEnd)`). Op can't start before its material lands; composes with the calendar (material-in-closed-time → next working open). At-risk reason `'material'` when binding. | Availability is **seeded** (`material_availability.availableAt`); production reads on-hand + inbound receipts via the §4.8/D35 ERP input. Single "fully-covered date" per component — quantity-phased netting deferred. Lightweight `material_requirement` link is interim (retires when real BOM/SKIP-45 lands). |
| **Intra-routing precedence** (C3) | Single-level linear: within a demand line, an op follows the prior `opSeq`; a successor is a candidate only once its predecessor is placed, and floored by `predecessorEnd`. Reuses the cursor-floor. | **Single-level only.** Multi-level make-component precedence / dependent demand (D37) is deferred. `opSeq` now genuinely orders (was carried-but-unused before C3). |
| **Inspection-station capacity** (C3) | The inspection station is a finite **resource** ops compete for (least-loaded assignment + calendar). Ops queue → later ones at-risk. | Modeled as a **station resource** for demo visibility; the spec (D29/D54) prescribes a **cert-skill pool per shift**. Production reconciliation: cert-skill-pool model, or formally fold cert-staffing into the sequencer. |
| **Minimum batch** (C4) | `effRunQty = max(demandQty, minBatchQty)` per resource type — won't run below the economical batch; **runs to minimum** when it binds. Drives duration + run qty. | Surplus disposition (`effRunQty − demandQty` → inventory/netting) is a documented future refinement; the seed keeps demand ≥ minBatch so it never binds, so no disposition is needed for the demo. |

### 1B. Soft constraints (built — penalized in the score, tradeable)
| Soft constraint | Factor / weight | Notes |
|---|---|---|
| **Firm delivery** (D13/D23) | `lateness` factor, weight **10** (dominant), **firm orders only** | Firm-lateness *dominates* by weight ratio — a firm order's lateness is never traded for a changeover. Structurally protected (firm jobs also never receive the changeover pull-ahead bonus). The binding `firm_delivery` constraint flags when firmLateHours > 0. |
| **Changeover grouping** | `changeover` factor, weight **1** | Counts attribute switches per resource in sequence order. A **forecast-only** pull-ahead bonus (`CHANGEOVER_BONUS_HOURS = 24`) lets a forecast job jump earlier to group a changeover; firm jobs never get it. |
| **Overtime cost** | `overtime` factor, weight **4** (labor premium) | OT only spent when explicitly funded (what-if "add overtime"/protect-delivery); default solve never uses OT. OT extends past shift end, capped per resource-type/day. |
| **Holding / early finish** | `inventory` factor, weight **0.2** | Per early-hour finished ahead of need — light pressure against finishing too early (inventory cost). |
| **Schedule stability / nervousness** (D44) | `displacement` factor, weight **2** | Counts ops moved (resource or sequence position) vs. the base plan — discourages churning the schedule for marginal gain. |

### 1C. Simplified (built, but approximate vs. the real model)
- **Operator performance** (C5) — a **consumed** factor (`performanceFactor`, divides run time) from a **seeded** pinned assignment. Production: factor is **seeded from an external system initially, then derived from actuals** (observed output vs. standard, same learning-overlay shape as cycle times). Assignment from a real roster/MES. Factor is on the operator (not task-specific); per-operator-per-resource override is a future refinement.
- **One operator per line / "no assignment = standard, not unmanned"** — the assignment table (`resource_operator_assignment`) holds at most one operator per resource per window (replace-open). A resource with NO assignment row is NOT unstaffed — standard cycle/setup times are rated to a standard qualified operator (IE 100%-rating convention; `performanceFactor` 1.0 = standard), so "no row = runs at standard via an implicit standard operator," never "no labor." The assignment table is a **performance-and-attribution overlay** (names the person + their deviation from standard + labor rate), not a presence flag. Two simplifications vs. real production: (1) **no crew** — a line carries one named operator, not a multi-person crew (so labor cost = that operator's rate, understating a 2–3 person crew — see 1D); (2) **one operator per line** — doesn't model multi-machine tending where one operator covers several automated lines (see labor-as-capacity, 1D / Part 5).
- **Inspection as a station** (vs. cert-skill pool) — see 1A.
- **Material availability as a seeded date** (vs. ERP on-hand + receipts) — see 1A.
- **The optimizer itself** — the whole engine is a **deterministic EDD heuristic stand-in** (SKIP-03) for the real optimizer (D18/AQ6). See Part 2.

### 1D. Deferred (spec'd / intended, not built)
- **Full BOM explosion** (§5.1, SKIP-45) — multi-level part structure + recursive explosion. Interim `material_requirement` link stands in.
- **D37 make-component precedence / dependent demand** — multi-level (sub-assemblies whose production precedes the parent). Only single-level buy-component gating is built.
- **Net-requirements module** (D20) — finished-good / independent-demand netting (CUM-based, PAB). Spec-only, not built; **distinct** from the scheduler material gate (NR = finished-good netting; scheduler = component availability).
- **Quantity-phased material netting** — current model is one availability date per component, not a quantity-over-time curve.
- **Labor-availability intersection** — the resource operating calendar narrowed by actual staffing.
- **Crew per line** — multiple operators on one line → a combined performance factor + **summed** labor cost. Today one operator per line; labor cost = single rate.
- **Labor-as-capacity / multi-line tending** — whether one operator can run multiple lines depends on each line's **attention demand**: a manual line (hand-load every cycle) consumes ~100% of an operator (one operator, one line); an automated/auto-fed/robot-tended line consumes a fraction, so one operator can tend several (multi-machine tending — normal for automated CNC/stamping/weld cells). Realistic model: an operator has a tending CAPACITY; each line consumes some by attention-demand; an operator covers multiple lines if combined demand fits. The per-operator double-booking guard (built this session — one operator can't be two places) is the **manual-case first step**; it relaxes to "combined attention-demand ≤ tending-capacity" once multi-tending is modeled (3 automated lines valid; 2 manual not). Relates to "labor-availability intersection" above.

### 1E. Boundary — deliberately OUT of the engine (and why)
- **Cost as an optimization objective** — cost is **computed and reported** (`costPerUnit` KPI) but is **NOT a scoring factor** — the engine does not optimize for it. *(Demo TODO C6 changes this — see Part 3 & the note below.)*
- **Labor rostering (who works) — external; but crew-to-line allocation (which line) is scheduling's.** The boundary is sharper than "labor is external." **The test: changing *who works* = external (workforce mgmt); changing *which line a present, qualified worker runs* = scheduling.** What's fed in: the **roster** — who is employed, certified, and scheduled to work each shift (from workforce-mgmt/MES/HR). Scheduling does NOT generate or optimize the roster. What scheduling owns: (a) **knowing** the roster + reasoning over its schedule impact (assignment → durations/sequencing — built, the C5 consumed factor), and (b) **crew-to-line allocation** — deciding which present, qualified operator runs which line to best meet the objective IS scheduling (it allocates a fed resource), not workforce mgmt. **Today** that allocation is a MANUAL planner lever (the assign/switch control — built this session: resource-grain, time-windowed, cross-plant allowed since operators float day-to-day, per-operator double-booking rejected). The engine consumes assignments but does not itself reallocate crew — that (crew-allocation as an optimization variable, bounded by roster+certs+tending-capacity) is the labor-as-capacity roadmap (Part 5). (Supersedes the earlier "rostering permanently external, SKIP-14" framing, which was too broad.)
- **Certification as a hard scheduling gate** — LEAK/CMM/TORQUE certs are soft/advisory (Workforce Coverage view, gap detection) and never read by the sequencer. The station gates capacity (hard); the cert gates *who staffs it* (soft).
- **Cross-line dynamic re-optimization** — the heuristic places greedily; it doesn't globally re-optimize across lines. That's the real optimizer's job (Part 2).

---

## Part 2 — How the heuristic scoring engine works (as-built)

**It is a deterministic EDD, changeover-aware, least-loaded greedy sequencer — a documented stand-in for the real optimizer (AQ6).** Pure + reproducible (D2): same inputs → identical output, no `Date.now()`, no randomness.

### Placement algorithm (`sequence()`)
1. **Origin** — the timeline anchors to a deterministic origin: start-of-day UTC of the earliest demand date.
2. **Per-resource cursor** — each resource has a `freeMs` cursor (the calendar-walking next-available instant), advanced only through working time.
3. **Readiness (precedence)** — an op is a candidate only once its predecessor (prior `opSeq`, same line) is placed. Single-op routings are always ready.
4. **Selection (greedy EDD with penalty rank)** — for each ready item, compute a `rank`:
   `rank = (requiredDate − origin)/h − changeoverBonus − expedite + notReadyDefer`
   - **EDD core** — earlier due date ranks first.
   - **Changeover bonus** (`−24h`, forecast-only) — a forecast job matching the resource's current campaign attribute pulls ahead to avoid a changeover. **Firm jobs never get it** (firm dominance).
   - **Expedite** (`−100,000h`, what-if protect-delivery only) — front-loads expedited lines.
   - **readyFirst defer** (`+50,000h`, what-if re-sequence-around) — defers a not-yet-material-ready op so ungated work fills the gap.
   - **Tie-break** (total order, deterministic): firm-first → earlier due → higher priority → partNo → demandLineId.
5. **Resource assignment** — least-loaded eligible resource (min `freeMs`; tie-break by pre-sorted id).
6. **Effective times (overlays, applied in order):**
   - `std` baseline → `resolveEffective` applies the **ML learning overlay** (`ml_adjusted` learned cycle, or `ml_predicted` for pre-adopted predictions) → then
   - `÷ performanceFactor` (C5 operator) on **run time only** (setup untouched).
   - `effRunQty = max(qty, minBatchQty)` (C4) → drives duration.
7. **Floor + placement** — `floor = max(freeMs, origin, earliestStartMs, predecessorEnd)`; `placeJob` walks the floor into working time (skipping closures, applying OT if funded). At-risk if it ends past the required date (or can't fit → `exceeds_working_window`). At-risk reason: `material` / `late` / `exceeds_working_window`.

### Scoring (`scorePlan`) — plan-based, deterministic
For an evaluated plan: **score = Σ (rawValue × weight)** over five factors; **lower is better** (matches the sequencer). All factors are penalties (positive = worsens).

| Factor | Raw value | Weight | Direction |
|---|---|---|---|
| lateness | firm-late hours (firm only) | 10 | dominant penalty |
| changeover | attribute switches | 1 | penalty |
| overtime | OT hours | 4 | penalty |
| inventory | early-finish hours | 0.2 | penalty |
| displacement | ops moved vs. base | 2 | penalty |

**KPIs** (reported alongside, not all scored): `otif`, `costPerUnit` (**reported, not scored**), `oee` (**null in plan-scoring** — execution-only), `lateOrders`, `throughput`, `churn` (displacement ratio).

**Comparatives** — precomputed deltas between options (the "why not B" substrate): each option carries its factor contributions + constraint bindings, so the relative reasoning is addressable without re-solving (phase-5 §5.1 / phase-6 Type-1).

### Versioning
- **`WEIGHT_SET_VERSION = 'aps-w2'`** (`= OBJECTIVE_DEFAULT_VERSION`) — stamped into every stored rationale so contributions stay interpretable if weights re-tune.
- **`RATIONALE_SCHEMA_VERSION = '1.0'`** — the rationale shape (independent of weights).
- **`ENGINE_VERSION = 'wi-11'`** — in the determinism key; a bump invalidates cached what-if results. Lineage: `wi-2` distinct-plan de-dup · `wi-3` line-down option set · `wi-4` calendar-aware placement · `wi-5` material gate · `wi-6` inspection + precedence · `wi-7` operator performance · `wi-8` minimum batch · `wi-9`/`wi-10`/`wi-11` (descriptions TBD — RG to supply).

---

## Part 3 — Weights & configuration

### The current weights (hardcoded → must become config)
The five weights are **hardcoded constants** (`WEIGHTS` in `whatif.weights.ts`), versioned by `aps-w2`. They are the engine's **objective function** — the business value system (how much firm-lateness matters vs. changeover vs. holding vs. stability).

### Production: weights → DB, hierarchical resolution — **global → tenant → plant** (stop at plant)
Cascading override: each level inherits from above and may override. Resolution order: **plant → tenant → global default** (most specific wins; global is the shipped-default floor, D48).

**Why it stops at plant — the policy-vs-physics principle:**
- The weights are an **objective function**, and the engine scores **whole plans** against **one** objective. A schedule is per-plant, so the objective is per-plant.
- Different plants legitimately differ (a JIS plant near the OEM weights lateness brutally; a bulk-stamping plant weights changeover/setup more). **Plant is where weight variation genuinely lives.**
- **Below plant (line/resource) is incoherent for weights** — if line A valued lateness 10 and line B valued it 5, you'd be scoring one schedule against two objective functions; "the best plan" stops being well-defined. What varies per-line is not the *weight* (the policy) but the *raw values* (this line has more changeovers, this resource is slower) — and those already vary per-resource through the **operating parameters**.
- **The distinction to hold:** **weights = policy (plant-level); operating parameters = physics (resource-level).** Don't make weights configurable below plant. Do make operating parameters configurable per resource/resource-type.
- **The one future exception:** if independent **scheduling scopes** below plant are ever modeled (e.g. a stamping area and an assembly area scheduled separately, never traded against each other), weights attach to the **scope**, not the line. Structure the resolution to allow an optional scope level *only if* that concept lands — not per-line.

### Operating parameters (the "physics" — already partly config, resolve per-resource)
| Parameter | Home | Admin-editable today |
|---|---|---|
| `calendar.shiftPatterns` | org/calendar | ✅ yes |
| `calendar.workingDays` | org/calendar | ✅ yes (added) |
| `resource.otCapMinutes` (override) | master-data/resource | ✅ yes (added) |
| Tier-B cost rates | master-data/resource | ✅ yes (added) |
| `operator.performanceFactor` (seeded baseline) | master-data/operator | ✅ yes |
| `resource_type_config`: `splittable`, type `otCapMinutes`, `work_center`, **`minBatchQty`** | scheduling | ❌ **no — the deferred #3 admin screen** (grew into the resource-type operating profile) |
| `material_availability`, `resource_operator_assignment` | scheduling | Operational data — launcher (demo) / ERP+roster (prod), **deliberately not config screens** |

---

## Part 4 — The authority model (how the engine relates to ML/LLM)

The non-negotiable hierarchy — the safety architecture:
- **The deterministic engine decides.** It is authoritative for every scheduling result. Reproducible, auditable.
- **ML proposes within bounds.** Learning corrects cycle times (`ml_adjusted`) and predicts (`ml_predicted`) — but only *feeds* the engine (effective times, parameter predictions); it never overrides a decision or computes a schedule.
- **The LLM explains and routes, never computes.** Narration translates the structured rationale; the conversation retrieves stored facts (Type 1) or calls the engine (Type 2) — it never produces a scheduling answer from its own reasoning, never commits.
- **Confidence × tier gate** — autonomy dials *within* a consequence tier, **never across**. A high-confidence prediction can auto-commit a Tier-1 (low-consequence) parameter; a Tier-3 (high-consequence) decision stays human even at 0.99 confidence. Autonomy is **earned** from measured outcomes.
- **Determinism (D2) is a contract** — the engine is pure/reproducible; the production optimizer (Part 5) must honor this too, or the auditability story (IATF, every decision a persisted inspectable record) breaks.

---

## Part 5 — Production roadmap (the build-out)

### Engine
- **The real optimizer (AQ6 / D18)** — the heuristic is a documented stand-in. The real optimizer (CP-SAT / OR-Tools flexible job-shop) drops in behind the `external_solver` binding (architecture already a drop-in). It does what the heuristic approximates: **all constraints simultaneously** (not greedy-EDD), **cost as an objective**, **cross-line dynamic re-optimization**, global optimization rather than per-op placement. Must stay deterministic (D2).
- **Weights → DB, hierarchical** (global → tenant → plant) — Part 3. Plus the **policy-vs-physics** boundary enforced (no sub-plant weights except optional scheduling-scope).
- **Cost as an optimization objective** — *(also a DEMO TODO, C6)*. Move cost from reported-KPI to a **weighted factor**. Real work, not a trivial add:
  - **Calibration** — cost ($/unit) must translate into the scoring currency; weight tuned so cost matters but sits **well below lateness** (firm-lateness dominance D13/D23 must survive — cost never pulls a firm order late).
  - **Non-null guard** — `costPerUnit` is null without resource rates; a scored factor can't be null. Every option needs computed cost.
  - **Re-verify + version bump** (`aps-w1`→`aps-w2`, ENGINE_VERSION). Talk track shifts "cost-aware" → "cost-optimized."

### Constraints to complete
- **Full BOM** (SKIP-45) — retires the interim `material_requirement` link; the gate reads from real multi-level BOM.
- **D37 make-component precedence / dependent demand** — multi-level precedence beyond single-level buy-gating.
- **Net-requirements module** (D20) — finished-good netting (CUM-based, PAB) — separate module, spec-only today.
- **Real material availability** (§4.8/D35) — on-hand + inbound receipts from ERP, replacing the seeded date; quantity-phased netting.
- **Inspection: reconcile to cert-skill-pool** (D29/D54) or formally fold cert-staffing into the sequencer.
- **Labor-availability intersection** — narrow the operating calendar by real staffing.
- **Labor-as-capacity (crew allocation as a scheduling optimization)** — let the scheduler treat crew-to-line allocation as an optimization variable: on re-solve, reallocate present qualified operators across lines to best meet the objective, BOUNDED by the fed roster (can't invent crew) + qualifications (cert-gating) + tending-capacity (attention-demand). Scheduling optimizing within the fed pool — NOT importing workforce mgmt. The double-booking guard is its first constraint.
- **Crew per line** — multi-operator assignment → combined factor + summed labor cost.
- **Minimum-batch surplus disposition** — where `effRunQty − demandQty` goes (inventory/netting) when min-batch binds.

### ML engine (cross-ref the "ML engine — production build TODO" in REMAINING-ITEMS.md)
Operator-performance derivation (seeded-then-learned), real predictive model (replacing the OLS stand-in), real cycle-time learning pipeline (MES actuals via D35), confidence-model calibration (AQ8), accuracy measurement / model monitoring, ML provider abstraction, graduated-autonomy-by-measured-outcome.

### Configuration & monitor surfaces (cross-ref REMAINING-ITEMS.md)
`resource_type_config` admin screen (#3); read-only monitor surfaces for derived/external values (learned-parameters, predictions, performance seeded-vs-observed, external inputs) — the **configure-vs-monitor** distinction.

---

## What this document establishes
The engine is a **deterministic, auditable constraint heuristic** with an honest, explicit boundary: it places work against working-time, material, precedence, inspection-capacity, and minimum-batch constraints; it scores plans against a five-factor objective (firm-lateness dominant); it reports cost but (today) doesn't optimize it; and it deliberately keeps labor optimization, cost-as-objective, multi-level BOM, and global re-optimization out — each documented with its production path. The ML and LLM layers *feed* and *explain* the engine; they never decide. The production build replaces the heuristic with a real optimizer behind an existing seam, makes the weights hierarchical config, completes the deferred constraints, and builds the real ML engine — all without changing the authority model or the determinism contract that make the system auditable.
