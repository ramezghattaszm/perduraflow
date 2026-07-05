# Claude Code brief — Phase 2: deterministic scheduling core + first per-tenant binding

| | |
|---|---|
| **Builds on** | Phase 0 (kernel + shell) and Phase 1 (Master Data) — both closed. All prior invariants and boundary rules carry forward unchanged. |
| **This session** | The first vertical slice that actually schedules: consume Master Data through the **first per-tenant binding**, produce a **deterministic** schedule, and put it on a **read-first board**. |
| **Working mode** | Propose-then-confirm. Draft the spec deltas, present, **wait for sign-off**, then implement. Same gate. |

---

## 0. Mission

Stand up `scheduling` as the second domain module: bind to Master Data through the first per-tenant binding resolver, run a deterministic sequencer over seeded demand, persist a versioned committed schedule, and render it on a read-first Gantt. This is the deterministic spine; **everything that makes the demo sing — actuals, the closed loop, ML, IoT, performance metrics, what-if, baseline, narration — is Phase 3+ and explicitly out of this session.**

**The architectural first that matters most — the per-tenant binding resolver.** Phase 1 *published* `masterdata.read 1.0`; Phase 2 is its first consumer, so this is where the resolver gets built. Scheduling binds to the `masterdata.read` contract, **resolved per tenant** to `platform_module` (the Phase 1 module). Only `platform_module` is implemented; the resolver indirection exists so `connector | upload | native` are later config, not code. When this works, "any domain module is replaceable behind its contract" stops being a claim and is demonstrated end to end. (Kernel contracts like `org.read` are still consumed directly — bindings are for *domain* contracts only.)

---

## 1. Read first

1. `docs/CLAUDE-CODE-BRIEF.md` §2 and `docs/CLAUDE-CODE-BRIEF-PHASE-1.md` §2 — invariants and contract-bound-module rules, still binding.
2. `docs/scheduling/production-scheduling-business-functional-spec.md` (Draft v0.11) — §4.1 demand input, §4.4 committed schedule, §4.9 schedule versions/optimizer runs, §5.3/5.4 resource & changeover model, D2 (deterministic decision), D4 (hard gates), D7 (standard baseline), D18/AQ6 (optimizer deferred), D44 (stability — context, deferred here).
3. `docs/platform/platform-architecture-spec.md` (Draft v0.10) — A8 (contracts/registry/binding), the binding counterparts model.
4. `docs/frontend-spec-shell.md` — the shell the board renders into.
5. `docs/PLATFORM-COMPLETION-LOG.md` (v0.3) — SKIP-03 (sequencer stand-in), SKIP-40 (board scope), SKIP-10 (demand seeded / net-req deferred), SKIP-04 (source/confidence carry-through).

---

## 2. Invariants — prior rules carry, plus these Phase 2 specifics

All Phase 0/1 boundary rules apply unchanged: per-module schema + scoped Drizzle instance; lint rule fails the build on cross-module `schema/` import; one shared Pool; contracts the only cross-module surface; EventBus coordinator for cross-module events; ULID PKs; tenant scope column + index; soft-delete only. Additions:

- **Scheduling consumes Master Data only through the binding-resolved `masterdata.read` contract** — never master-data's code, types, schema, or tables. References to parts/resources/routings are text IDs validated/read through the contract; **no cross-schema FK to `master_data`**. (Same discipline as Phase 1's `org.read`, now through the binding resolver.)
- **The binding resolver is real this session.** A consumer resolves a domain contract to its per-tenant counterpart; Phase 2 implements `platform_module` only, but the indirection must be genuine — scheduling calls *the resolved contract*, not the module. Demonstrate that swapping the binding would need no scheduling code change.
- **Deterministic-decision invariant (D2).** The sequencer owns the schedule; it is reproducible — same seeded inputs → identical schedule. No ML, no GenAI, no randomness without a seed.
- **Source/confidence carry-through (SKIP-04) — wire it now, empty.** Committed-schedule records carry `setup_source` / `cycle_source` (enum `standard | ml_adjusted`, **default `standard`**) and `setup_confidence` / `cycle_confidence` (nullable, **default null**) from the first table. No ML produces them yet; the fields exist so Phase 3's closed loop flips them with zero schema/board change. The board renders source/confidence even though every value is `standard`/null now.
- **Standard times are the baseline (D7).** Setup/cycle times come from the routing operations (Phase 1 `routing_operation.std_setup_time` / `std_cycle_time`); `resource.rate` is nominal/reference only — op-grain std times are the binding planning input (the rate-authority note from Phase 1).
- **Demand is seeded, not built or integrated (SKIP-10).** A seeded canonical `demand_input` fixture; no net-requirements netting (deferred), no integration. Honest "seeded, not connected" posture.
- **Contract evolution stays additive.** If `masterdata.read 1.0` or `org.read 1.1` lacks something scheduling needs, bump MINOR additively (no consumer breakage); don't reshape.

---

## 3. This session — scope

**Module → schema/table ownership** (new `scheduling` module, own Postgres schema, scoped Drizzle instance):

| Module | Schema | Owns tables |
|---|---|---|
| `scheduling` *(new)* | `scheduling` | `schedule_version`, `optimizer_run`, `scheduled_operation` (committed schedule), `demand_input` (seeded canonical demand) |

Sketch (refine field-level in your draft; ground every field in a spec ref):

- **`demand_input`** (§4.1, seeded) — part ref, order ref, qty, due_date, firmness, customer/program ref (priority read from `org`). Seeded fixture; not netted.
- **`optimizer_run`** (§4.9) — trigger, started/ended, status, **stop_reason**, params, input snapshot ref. The run header even for the heuristic (so the board, re-solve, and later what-if point at a run).
- **`schedule_version`** (§4.9) — plant, horizon, status (`draft | committed | superseded`), `optimizer_run_id`, created_at. Re-solve produces a new version.
- **`scheduled_operation`** (§4.4, committed schedule) — `schedule_version_id`, part/order ref, **resource ref (via `masterdata.read`)**, routing-operation ref, sequence, planned_start, planned_end, planned_qty, setup_time, cycle_time, **`setup_source`/`cycle_source` (default `standard`)**, **`setup_confidence`/`cycle_confidence` (null)**, `at_risk` flag.

**Sequencer (SKIP-03) — the deterministic stand-in.** A transparent **earliest-due-date, changeover-aware** heuristic: order by due date, using the Phase 1 `changeover_attribute_key` (colour/material/gauge) to group like attributes and reduce changeover within EDD bands. Satisfies D2 (deterministic, reproducible) and D4 (hard gates — at minimum feasibility/delivery-window; material assumed-available from seed for now). **Explicitly a placeholder** for the real optimizer (D18/AQ6) — label it so. Produces a `schedule_version` + `optimizer_run`.

**Binding resolver.** Scheduling resolves `masterdata.read` per-tenant → `platform_module`; reads parts/resources/routings through it. Build the resolver indirection (consumer → binding → contract), with `platform_module` the only counterpart.

**Board (read-first Gantt, SKIP-40).** Into the shell: resources (lines) as rows, time horizontal, scheduled operations as bars; version selector; **re-solve button → new version** (deterministic re-run, *not* the costed multi-option what-if — that's Phase 4); at-risk flagging; source/confidence rendered (empty now). **Not** the virtualized authoring canvas and **no drag-to-author** (deferred). A simpler Gantt is the target.

**Out of scope (Phase 3+):** execution actuals, the closed loop, ML/predictions, IoT/any floor data, the tool-wear flag, performance metrics/OEE/churn, what-if multi-option + structured rationale (D55), plan-comparison/baseline (D57), narration (A19), stability/nervousness rescheduling (D44), the virtualized authoring canvas, the real optimizer, net-requirements netting, the per-tenant binding *counterparts* beyond `platform_module`.

---

## 4. Working protocol

1. **Draft the deltas** to `docs/platform/api-spec.md` and `docs/frontend-spec.md` (the `scheduling` module + tables, the binding resolver, the EDD heuristic, the seeded demand fixture, the board), plus `PROJECT-SUMMARY.md`. **Present and stop for sign-off. Do not implement tables, the sequencer, or the board yet.**
2. On sign-off: implement — binding resolver → schema + migration + seeded demand → scheduling module + sequencer → board.
3. Verify against Section 6, including the boundary proofs.
4. Propose before any large or irreversible move.

---

## 5. Items to propose in your draft (genuine design choices — don't just pick)

- **EDD changeover-aware heuristic** — the exact rule: how changeover-awareness composes with EDD (banding within a due-date window? a changeover penalty term?). Must stay deterministic and explainable. Propose it.
- **Gantt rendering approach** — for the read-first board (a lightweight chart lib vs. simple custom SVG/CSS), explicitly *not* the virtualized canvas. Propose, with a note on how it'll later coexist with the deferred canvas.
- **schedule_version lifecycle** — how re-solve relates to versions (new version each run? draft→committed transition? what supersedes what). Propose.
- **Seeded demand fixture shape** — the structure of `demand_input` and a realistic seed that exercises changeover (mixed colours/materials) and due-date spread.

---

## 6. Definition of done — Phase 2

- `bun run check` (typecheck + doc lint + boundary lint) green; API builds and boots; `next build` succeeds; `expo` tsc clean.
- Migration applies; seed creates demand and the heuristic produces a committed `schedule_version` with an `optimizer_run`; the board renders it in the browser.
- **Boundary proofs (show in the hand-back):**
  1. `scheduling` is its own Postgres schema, Drizzle instance scoped to only its tables; the lint rule **fails the build** on a deliberate cross-module `schema/` import (negative-tested, then reverted).
  2. **The headline proof:** scheduling reads parts/resources/routings **only through the binding-resolved `masterdata.read` contract** — no import of master-data code/schema, **no cross-schema FK** to `master_data` (FK audit shows only intra-`scheduling` FKs); references are text IDs validated through the contract.
  3. **The binding resolver is genuine:** scheduling calls the resolved contract, not the module; show that re-binding `masterdata.read` to a different counterpart would need no scheduling code change (the indirection exists even with one counterpart).
  4. `scheduled_operation` carries `setup_source`/`cycle_source` (default `standard`) and `*_confidence` (null) **from the first migration** — schema proof for the Phase 3 carry-through; the board renders them.
  5. **Deterministic (D2):** running the sequencer twice on the same seed yields an identical schedule — show it.
- **Browser-verified:** the board renders a schedule, the version selector works, re-solve produces a new version. At least the feasibility hard gate (D4) demonstrably holds (an infeasible seeded case is rejected/flagged, not silently scheduled).
- Docs reflect what was built; completion log updated (SKIP-03 in progress, SKIP-40 read-first board built; SKIP-04 fields wired). Stop at this checkpoint. Do not start Phase 3.

---

*Phase 3 (execution actuals + the closed loop + deterministic performance metrics — where IoT/actuals and the demo's foreground beats land) gets its own brief once Phase 2 is signed off.*
