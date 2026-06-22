# PerduraFlow — remaining items before demo (single source of truth)

> Demo ~10 days out (as of phase-6 completion). Engine (phases 0–6) is feature-complete and verified. What's left = fixes + realism + improvements + staging. Grouped by priority.

---

## A. Must-fix before demo (small, known — clears the deck)
- [ ] **Per-option narration scoping** (`NARRATION-PER-OPTION-FIX.md`) — each option card gets its OWN narration; "why the winner won" appears once, not on every card. **Fix at the shared component level** (surfaced twice — demand path + wear path). Re-verify translate-only (#5) + non-blocking (#6).
- [ ] **"See options" UI bug** — on the line-down condition card, the action did nothing (the new `reroute` path). (Step-3 verification was validated separately; the UI control needs the fix.)
- [ ] **Cost-credibility glance** — confirm the seeded historical $9.05 cost/unit is *plausible* for the operation. It's now a headline baseline number; a too-good-to-be-true delta invites skepticism.
- [ ] **Markdown rendering in Copilot** — confirm message bubbles render markdown (bold/lists) on web AND native. (Possibly port EQALL's formatter if standalone + cross-platform; else a standard RN+web markdown renderer.)
- [ ] **Delete a draft plan** — the user should be able to delete a draft (uncommitted) schedule version. Drafts accumulate (every re-solve / what-if exploration creates one); there's no way to discard them. Scope: delete only DRAFT versions (committed versions stay immutable for audit/IATF — never deletable). Standard pattern (delete action on the version list/selector, draft-only guard).

## B. Conversation-capability improvements (deferred — after the engine is committed)
- [ ] **Better scenario-creation understanding** — sharpen intent recognition → change-set construction when the user asks to create a scenario (more reliable language→ChangeSet mapping).
- [ ] **Screen context-awareness** — the Copilot should know the current screen AND its on-screen selections (active plant, version, selected option/resource), so "explain this" / "what if we change this" grounds against actual on-screen context, not just conversation history.

## C. Realism batch (post-phase-6 — `POST-DEMO-REALISM-PLAN.md`, shifts first)
Ranked by recognition-value × feasibility on the heuristic.
- [x] **1. Shift/calendar model + Week view + Date navigation (THE KEYSTONE)** — DONE (web; native deferred to D). Calendar-aware placement, OT meaningful (seed loaded), day-axis = working window, week view + date nav with calendar-derived gaps. Engine committed; week view built + web-verified.
- [x] **2. Material-arrival timing (PV-22 → FG-3001)** — ACTIVE. Upgrades collision 3 from seeded anchor to computed (weld op can't start before PV-22 available). **Owner = scheduler material gate (D36/§4.8), NOT net-requirements** (component availability is the scheduler's gate; NR does finished-good netting only). Buy-component scope only — lightweight requirement link + seeded `availableAt` + `SequencerItem.earliestStartMs` floor in `placeJob` (composes with the calendar cursor) + at-risk on shortfall. Same `availableAt` threaded into both baseline arms (phantom-early-material trap). Seed flips PV-22 from anchor→linked-component-with-late-availability; slip computes. **Simplifications deferred to production — see the "Material gate" subsection under Future phases.**
- [x] **3. Inspection-station capacity** — DONE. — model CMM/leak-test as finite resources ops compete for (reinforces the leak-test story; entities exist).
- [x] **4. Min run-length** — DONE (minBatchQty in resource_type_config, run-to-minimum, config-driven proof passed).  — no tiny batches between big ones (constraint or seed-discipline).
- [x] **5. Operator performance modifier** — DONE (consumed operator.performanceFactor + resource_operator_assignment, divide convention, launcher lever).  — operator's performance modifies effective cycle time (links Workforce to schedule timing).

## D. UI polish (late — against settled content)
- [ ] **Fix UI components** — general look/refinement of the screens. Do AFTER realism (which changes screen content) so polish isn't redone.
- [ ] Apply the typography scale / board type-map / density pass consistently if any screens still lag the standard.
- [ ] **Native (Expo) verification pass — all screens** — verify rendering (not just `tsc`/compile) on a phone viewport across every surface, as part of the screen-refinement pass. Includes the **week view** (dense — compression likely needs narrow-viewport behavior) and the Copilot. Web is verified per-feature during the build; native is batched here to do once against settled screens.

## E. Deferred follow-ups (nice-to-have / if time allows)
- [ ] **SSE token-streaming for Copilot** (SKIP-65) — currently JSON-return + "Thinking…" pending state (EventSource is GET-only, tool-loop non-streaming). Watch the "Thinking…" feel in rehearsal; if it drags, this becomes polish (POST-based/chunked streaming later).
- [ ] **Real-time push (invalidation)** capability — SSE invalidation bridge (architecture approved in `POST-DEMO-REALISM-PLAN.md`). Enhancement to a moment that already works via `refetchOnMount`. Build only if time remains after realism.
- [ ] **Name the "Copilot"** — branding decision, defer to staging.

## F. Staging / run-of-show (the final pre-demo work)
- [ ] **Seed fully wired + coherent** — the Magna-Mexico scenario reconciling across all six views (`SEED-SCENARIO-SPEC.md` + historical-outcomes addendum).
- [ ] **Run-of-show** — the demo script: which collision, which screen, in what order; drive-the-drift-then-show-the-lift sequencing (frozen baseline reads zero until learning runs).
- [ ] **Talk track / honest framings** — "seeded data, real working system, your reality in the pilot"; baseline = "the lift our intelligence adds" not "vs your manual process"; the heuristic-stands-in-for-the-optimizer framing; the 5 demo-doc truthfulness edits.
- [ ] **`recorded` fallback ready** — narration AND the scripted conversation can run on `recorded` if live Groq misbehaves in the room.
- [ ] **Rehearsal** — full walk on the demo machine; confirm `demo:reset` restores clean baseline; watch latency/feel.

---

## G. Admin-config write paths (shift-model fields — DOING NOW: #1 + #2)
The shift model extended schema/engine but didn't carry new fields to the admin write paths, so they fell outside the otherwise-clean config pattern (DataTable + Popup form). Closing the cheap, visible gaps on EXISTING screens now:
- [ ] **#1 — `calendar.workingDays` in the Calendars form** — add to create/update calendar schema (currently `.strict()`, excludes it) + a weekday multi-toggle in the existing Calendars form. Closes a visible half-feature (the form already edits shift times + holidays but not which weekdays are open — pinned to seeded [1–6]). Smallest.
- [ ] **#2 — `resource.otCapMinutes` + Tier-B cost rates in the Resources form** — add both to create/update resource schema + numeric fields in the existing Resources form. **Bundle the cost rates** (same seed-only gap, same form, and cost is demo-visible via cost/unit + baseline cost deltas — the more important half). One schema + form pass for both.

---

## Future phases / productionization (post-demo — not in the 10 days)
> **Convention:** capture ALL deferred items here, even production-only ones, so nothing lives only in conversation memory.

- **#3 — `resource_type_config` admin screen** (DEFERRED) — net-new admin surface (Admin → Config → "Resource types": DataTable + Popup + controller/endpoints) for `splittable` + type-level `otCapMinutes`. Correctly seeded for the demo (line non-splittable, cell splittable, 120 min/day OT); never edited live in the demo. Per-client config matters at pilot. Defer — it's a whole new screen, not extending an existing one.
- **Shift-model config completeness** — once #1/#2/#3 land, a client can fully configure their operating model (shifts, working days, OT caps, splittability) from admin, per D48 (safe defaults, complete on install, configurable per client).
- **Phase 7** (`PHASE-7-NOTE.md`) — conversational apply (act on an explored scenario via the conversation, with explicit confirm preserving D26).
- **Full optimizer** — CP-SAT / OR-Tools flexible-job-shop with all constraints (shifts, tooling, materials, cost-as-objective, cross-line dynamic re-optimization). Drops in behind the `external_solver` binding / contract — architecture is already a drop-in. Its own planning artifact.
- **Per-tenant LLM provider config** to DB (provider/model/params/custom-URL as data, secrets as secrets-manager references, no-deploy) — productionizes the phase-5 env-based selection.
- **Prompts → DB / per-tenant config** — narration + conversation prompts currently code constants (hash-derived `promptVersion`); move to versioned config / per-tenant overrides at productionization (same trajectory as the LLM provider config).
- **Rolling / multi-week planning horizon** — the week view DISPLAYS any version's horizon already (production-ready as-is); generating longer/rolling horizons (extend forward, re-plan as actuals arrive) is engine/planning-cadence work, separate from the view.

### Material gate (D36/§4.8) — what the demo build SIMPLIFIES, deferred to production
> C2 builds the **buy-component material gate only** (D36): a lightweight requirement link + a seeded `availableAt` + an `earliestStartMs` floor in `placeJob` + at-risk on shortfall. The following are deliberately NOT built for the demo and are captured here:
- **Real material-availability input (§4.8 / D35)** — the demo **seeds** `availableAt` (PV-22 lands at T). Production computes it from **on-hand inventory + inbound scheduled receipts** via the D35 ERP/inventory/MES input. Seed-now, real-input-later: structure the gate so the real source drops in without reshaping it.
- **Full BOM explosion (§5.1, SKIP-45)** — the demo uses a lightweight component→consuming-op requirement record (single FG-3001→PV-22 link), NOT a real multi-level BOM. Full BOM (`part` BOM structure, recursive explosion) stays deferred. **Note:** the C2 `material_requirement` table is the **interim** requirement source — scheduler-side to keep the master-data boundary clean (no premature half-BOM). When the real master-data BOM is built, the gate reads requirements from it and `material_requirement` retires.
- **D37 make-component precedence / dependent-demand** — NOT built. PV-22 is a *buy* component (material gate only). Make-components (sub-assemblies whose own production must precede the parent, multi-level dependent demand, op-precedence ordering) are the heavier D37 feature — deferred. (`opSeq` is carried on items today but never used to order; real precedence is part of this.)
- **Component shortfall remediation as what-if options** — the demo surfaces material-driven lateness as at-risk; expediting/alternate-sourcing/partial-build options are future.

### Inspection capacity (C3) — demo models it as a STATION, spec wants a cert-skill pool
> C3 builds inspection capacity as a **station-as-resource** (model a): an inspection station resource + an inspection routing op + weld→inspect precedence via the C2 earliest-start floor. The station is the **hard** finite constraint (ops queue for the booth, visible as a Gantt lane). This deviates from the spec:
- **D29/D54 prescribe a cert-skill pool per shift** (finite capacity-by-skill counter — N qualified inspections per shift), NOT a physical station resource. Chosen station-as-resource for the demo because it's **concrete and visible** (you can see ops queue for the booth on a lane); the cert-pool counter is invisible (a number, no lane).
- **Certifications stay soft/advisory** — LEAK/CMM/TORQUE certs remain Workforce-Coverage-view-only (View 3, gap detection, D54), decoupled from the sequencer, as today. In model (a) the station gates *finite capacity* (hard); the cert gates *who can staff it* (soft overlay).
- **Production version** — reconcile to the spec's cert-skill-pool model (hard cert-skill capacity per shift) OR keep station-as-resource and formally fold cert-staffing into the sequencer (hard cert gate). Either is a productionization decision; the demo's station model is the deferred simplification.

### Operator performance (C5) — future refinements
> C5 builds operator performance as a **consumed** input: `operator.performanceFactor` (efficiency rating, 1.0=standard, >1.0 faster, `effectiveCycle = baseCycle / factor`, run-time only — setup not divided) + a scheduler-owned `resource_operator_assignment` (consumed, never optimized — labor boundary intact). Settable via launcher. Deferred refinements:
- **Task-specific performance** — the factor is on the **operator** (she's a 90% operator everywhere). Real skill is task-specific (faster on familiar stations). Future: move/override the factor onto the **assignment row** (operator-resource pair) so the same operator can be faster on one line than another. The assignment row already exists; it'd gain an optional factor override.
- **Recurring / shift-coded assignment windows** — the assignment window is a `[effectiveFrom, effectiveTo]` timestamp range now. Future: recurring patterns ("operator O works Shift A every weekday") or shift-of-day codes, rather than explicit per-window rows.
- **`perfFactor` on the placement + board tooltip** — deferred to keep C5 tight; would let the board explain "this cycle is longer because the operator is at 85%."
- **Real roster source** — the assignment is seeded for the demo; production fills `resource_operator_assignment` from a real roster/MES (the §4.8 consumed-input seam, same as material availability).

### Monitor / display surfaces (read-only — derived & external values)
> **Principle: configure vs. monitor.** Admin/config screens are for values a HUMAN SETS (editable). A separate class of values is DERIVED by ML or FED by external systems — a human should SEE them (trust, audit, understand) but NOT edit them (editing a learned/measured value is meaningless or breaks the loop). These want **read-only monitor surfaces**, distinct from editable config. Today these values display only **in-context** (on the board, in panels); production wants consolidated views. None are demo-critical (in-flow board display already shows them where they land, which demos better than a static table).
- **Learned-parameters view** — all current ML-learned cycle times (op, resource, std→ml value, # actuals, confidence, settled/drifting). Today per-op on the board; consolidated read-only "what the system has learned." Strongest candidate.
- **Predictions view** — active wear/forecast predictions (crossing time, confidence) consolidated, not just per-board.
- **Performance display** — operator/resource effective performance: the **seeded-from-external baseline** AND the **derived-from-actuals observed** value side by side (e.g. "seeded 85%, observed 80% over 30 cycles"). Read-only for the derived part; the seeded baseline stays editable on the Operators form.
- **External-inputs view** — operational data feeding the scheduler from upstream systems: material availability (ERP/inventory), operator assignments (roster/MES), actuals (MES). Displayed, fed-not-edited.
- **`resource_type_config` admin screen (#3, GREW)** — now holds `splittable` + type-level `otCapMinutes` + `work_center` config + **`minBatchQty`** (C4 added it). It's become the **resource-type operating-profile** config (how a press/cell/work-center behaves). Net-new admin screen + endpoints; all values correctly seeded for the demo, so still deferred — but more substantial than first scoped.
- **Operational-vs-config is intentional** — `material_availability` and `resource_operator_assignment` are operational data (launcher for demo, ERP/roster for production), deliberately NOT admin-config screens. Correct (you don't hand-edit "when did the part arrive"); stated so it's a conscious choice.

### ML engine — production build TODO
> The demo uses deterministic stand-ins (OLS linear-trend predictor; seeded performance/availability). Production replaces these with the real ML/learning engine. Captured as a running TODO so the demo→production ML gap is explicit.
- **Operator performance derivation** — performance is **seeded from an external system initially, then derived from past performance** (observed output vs. standard over time). The demo seeds `performanceFactor` static; production: ingest the external baseline, then continuously re-derive the observed factor from actuals (same learning-overlay shape as cycle times — measured, confidence-weighted, settled/drifting). Surfaces in the Performance display (seeded vs. observed).
- **Real predictive model** — replace the OLS linear-trend wear predictor (P4 stand-in) with the production ML model (proper forecasting, feature inputs, validated accuracy). Drops in behind the existing predictor seam; confidence×tier gate (P4) stays the authority boundary.
- **Real cycle-time learning** — the std→ml overlay is the learning mechanism; confirm the production learning pipeline (actuals ingestion from MES via D35, the derivation cadence, the convergence/settle logic, confidence model AQ8).
- **Confidence model calibration (AQ8)** — the agent confidence model needs real calibration against measured outcomes (the demo uses a heuristic confidence = samples·R²·horizon-decay). Production: calibrate so confidence×tier auto-commit thresholds are trustworthy.
- **Accuracy measurement / model monitoring** — retain predictions vs. actuals (the prediction-accuracy substrate) and build the model-monitoring view (drift, accuracy over time) — production needs to know if the model is degrading.
- **ML provider/infra abstraction** — like the LLM provider pattern, the ML engine should be a pluggable provider (train/serve infra abstracted) for cloud portability. Define the ML provider seam.
- **Graduated autonomy by measured outcome** — the confidence×tier autonomy must be EARNED from measured accuracy (a tier-1 param auto-commits only after the model proves itself on that param class). Production: the mechanism that ratchets autonomy up as outcomes validate it.
- **Optimizer selection (AQ6)** — the full CP-SAT/OR-Tools optimizer (separate from ML, but the other "real engine" swap) drops in behind the `external_solver` binding; engine selection is an open architecture question.

### Net-requirements module (spec-only, NOT built)
- The whole **net-requirements module** (finished-good / independent-demand netting, D20 — CUM-based netting, PAB) is **spec-only, not built**. It is a separate module from the scheduler material gate (NR1 / D36 are explicitly distinct: NR = finished-good netting, scheduler = component availability). Build is a future phase.
- **Real-time push (invalidation)** — SSE invalidation bridge (`POST-DEMO-REALISM-PLAN.md`); enhancement to a moment that already works via `refetchOnMount`. (Also listed under E if attempted pre-demo.)

---

## Status anchor (where things stand)
- **REALISM BATCH (C) COMPLETE** — all five items built + verified, each with a config-driven proof (responds to its input, not staged): C1 shifts+week-view, C2 material gate, C3 inspection capacity, C4 min-batch, C5 operator performance. The schedule now behaves like a real constraint problem (working hours, material availability, finite inspection capacity, within-routing precedence, minimum batches, operator performance) — not a 24/7 toy. Each rode the foundation the prior built (cycle seam, cursor-floor, resource model, consumed-input pattern, resolver-callback).
- **Remaining = NO new engine/realism.** Finishing stretch: fix batch (A) → admin-config #1/#2 (G) → UI polish + native (D) → staging (F). Plus deferred conversation improvements (B) and the documented productionization items.
- **Phases 0–6 built + verified** (engine + learning + prediction + what-if/baseline/narration + conversational layer). Demo feature-complete.
- **Shift-model keystone (C1 engine) committed + verified** — calendar-aware placement, OT meaningful (seed loaded so lines run realistically full; line-down → reroute-tomorrow vs OT-extend-today confirmed), day-axis = working window. **Week view + date nav (C1 UI half) in build.**
- **Convention:** every deferred item — including production-only — is captured in this doc, not left in conversation memory.
- **Next:** finish week view + date nav (C1) → admin-config #1/#2 (G) → remaining realism (C2–5) → fix batch (A) → polish (D) → staging (F).
