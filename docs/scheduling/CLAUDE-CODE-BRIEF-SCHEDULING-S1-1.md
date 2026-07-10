# Claude Code build brief — Scheduling S1.1 (constraint registry + byte-identical extraction)

| | |
|---|---|
| **Companion (authority)** | `docs/scheduling/SCHEDULING-S1-SCOPE.md` — read first; rationale + the full S1 arc there |
| **Also read** | `SCHEDULING-PRODUCTION-COMPLETION-PLAN.md` §0 (the reframed constraint model) |
| **Decisions** | D-S1-1…7 **LOCKED** (scope §4) |
| **Scope of THIS brief** | **S1.1 only** — the abstraction + ordered-pipeline registry + extract all five mechanisms, byte-identical. **No veto primitive, no config modes, no new constraint, no audit snapshot** (those are S1.2/1.3/1.4, separate briefs). |
| **Discipline** | **Mechanism-by-mechanism; each byte-identical before the next moves.** Commit-per-mechanism. Stop-and-report each. |

> **This is the highest-risk commit in the program** — it re-expresses the scheduling engine's entire placement decision logic through a registry, and its only acceptance is **byte-identical output**. Two mitigations are mandatory: **(1) move the *decision*, reuse the *arithmetic*** (D-S1-5 — the ML `effectiveFor` overlay, `Math.max` floor math, operator scaling, `processMs` stay as untouched functions the constraints *invoke*); **(2) one mechanism at a time**, proven against the lock before the next, so a break localizes.

> **The byte-identical lock (the gate at EVERY step):** `demo:reset` build = **1043 ops**, **per-`Placement`-field equality** (start/end/resource/setup/qty/source — every field), and the **four determinism invariants** (§the ground-truth §4 tie-break/total-order + purity). Capture a pre-S1.1 baseline once; every mechanism step must reproduce it exactly (SHA or field-level equality). **Any divergence → STOP, do not proceed to the next mechanism.**

---

## Commit 0 — pre-flight + baseline (report only, no engine change)
- Re-confirm the placement loop shape (`sequence()` `sequencer.ts:232`), the five mechanisms' exact injection sites (§2 of ground truth), the tie-break/total-order code, and the arithmetic functions to be *reused-not-moved* (`effectiveFor`, floor math, operator scaling, `processMs`).
- **Capture the byte-identical baseline:** a permanent harness dumping the full committed plan (per-`Placement` fields + determinism tokens + op count) from `demo:reset`. This is the reference every subsequent commit diffs against.
- **Report:** the five injection sites verbatim; the arithmetic-function list (what stays); the baseline capture (1043 ops + a plan digest). Wait for go.

## Commit 1 — the abstraction + ordered-pipeline registry (WRAPPING, not moving)
- Define the **constraint abstraction** (scope §2): predicate over a schedule-model → degree-of-violation and/or contribution; a `mechanism` tag (`FLOOR|CANDIDACY|FEASIBILITY|PRE_GATE|SELECTION`) **and a `scope` (`SELECTION` | `PLACEMENT`)** — **two scopes, not three; there is no `ORDERING` scope** (the DB input order is proven inert; the `pipeline.order` seam is an inert identity no-op, not a mechanism); authored against an **explicit versioned expression vocabulary** (the internal representation — this is what S4 adapters + future customer-authoring expose).
- Build the pipeline for **two scopes** (proven structure — see scope §2; the earlier "three-scope/ORDERING-static" framing was a fabrication, corrected):
  - **`SELECTION` scope — stateful, per-step:** the sole ordering mechanism (the in-loop composite scorer over live `currentAttr`). There is **no static ORDERING pre-sort** — the DB input order is proven inert.
  - **`PLACEMENT` scope — per job in `placeJob`:** `PRE_GATE → CANDIDACY → FLOOR → place → FEASIBILITY`. The scope order is part of the determinism contract. **Changeover is NOT a PLACEMENT constraint** — it is a SELECTION rank term only. Verified in code (`sequencer.ts` @ `6320a46`): `placeJob`/duration carry no sequence-dependent setup-cost; `durMs = (eff.setupTime + effCycle·effRunQty)·MS_PER_MINUTE`, where `setupTime` is the op's own standard setup, not a changeover cost. **Do not add one.**
- **Wrap, don't move yet:** the registry initially delegates each scope/phase to the *existing inline logic* (thin pass-through) — the in-loop re-score through SELECTION, `placeJob` through PLACEMENT — computing identically. The `pipeline.order` seam stays an **inert identity** no-op; it is NOT a load-bearing ORDERING layer.
- **Gate:** byte-identical to baseline (the routing indirection changed nothing).
- **Report (Commit 1, already landed):** the abstraction + pipeline diff; `placeJob` routes through PLACEMENT; byte-identical vs baseline. *(NB: Commit 1 is done; this describes it. The SELECTION scope's stateful wiring is completed in Commit 4.)*

## Commit 2 — move FLOOR (the hardest; timing arithmetic)
- Move the floor decisions (material `earliestStartMs`, precedence `predecessorEnd`, release, min-batch quantity floor) into registered `FLOOR` constraints — **each invokes the same untouched arithmetic function** (D-S1-5). The `Math.max` composition becomes the pipeline folding the FLOOR constraints' contributions.
- **Preserve exactly:** the order floors compute *relative to candidacy* and *relative to the ML `effectiveFor` overlay* (the §7 hazard — do not reorder).
- **Gate:** byte-identical. This is the step most likely to break; if it does, the diff is localized to floor timing.
- **Report:** the FLOOR-constraint diff; explicit confirmation the arithmetic functions are invoked-unchanged; byte-identical proof (per-field, esp. every `start`).

## Commit 3 — move CANDIDACY
- Move `isReady` + eligibility (`routing_operation.resourceGroupId → members`) into registered `CANDIDACY` constraints (skip-until-ready / not-eligible). Eligibility still flows through the group (untouched data path; only the *gate decision* moves).
- **Gate:** byte-identical.
- **Report:** diff; byte-identical proof.

## Commit 4 — move SELECTION (the stateful per-step scorer) — THE HARD ONE, and the last mechanism
> **Corrected structure (proven, not inferred):** there is **no static ORDERING pre-sort** — the DB `ORDER BY (requiredDate, demandLineId)` is proven **inert** (reversing `remaining`'s start order left the digest unchanged). The **sole ordering mechanism is the stateful in-loop SELECTION scorer.** So this is ONE commit, not an ORDERING-then-SELECTION pair. Do not introduce or "extract" a static sort — there is nothing to extract; fabricating one would mislabel an introduction as an extraction.

- Move the in-loop composite re-selection into a registered **stateful `SELECTION` constraint**: the min-scan over remaining ready candidates scored by `rank = dueHours − changeoverBonus(st.currentAttr) − expedite + notReady`, with the total-order tie-break `(firm → requiredDate → priorityRank → partNo → demandLineId)`.
- **The pipeline gains stateful evaluation for this scope:** a SELECTION constraint's `evaluate` takes `(item, resourceState, remaining)` — not the stateless `(item, model)` of PLACEMENT — and the registry threads the **live, mutating** `currentAttr` per iteration. Reproduce exactly, in order:
  1. **the composite score formula** (`dueHours` base − `changeoverBonus(currentAttr)` − expedite + notReady) per (job, resource-state);
  2. **the selection + total-order tie-break** — `bestRank`/`bestIdx` over remaining, tie-break `tieBreakLess` firing at the same point;
  3. **the state-mutation timing** — `st.currentAttr = item.changeoverValue` at the *same* loop point as today (after placement), so iteration N+1 sees exactly what it sees now.
- **Changeover** stays a SELECTION term (it is not a `solve()` placement setup-cost — do not add one). The `pipeline.order` identity seam is inert; leave it a no-op or drop it, but do **not** document/build it as an ordering layer.
- **The `assignResource` least-loaded pick** is part of selection state (reads `st.freeMs`) — confirm it's threaded/reproduced, not reordered.
- **Gate:** byte-identical vs `0645457f…006ef` (re-capture pre same-day). This is the determinism-most-exposed step — the whole per-op selection order rides on it.
- **Report:** the SELECTION diff; the stateful-threading confirmation (`(item, resourceState, remaining)`, `currentAttr` read/mutate points); byte-identical proof with **determinism tokens + the full per-op selection order** called out; explicit confirmation no static ordering sort was introduced and the state-mutation happens at the same loop point as today.

## Commit 5 — move FEASIBILITY (+ PRE_GATE)
- Move the `placeJob → null` degrade into a registered `FEASIBILITY` constraint (**degrade form only — the veto-and-reselect form is S1.2, not here**). Move any service-level `PRE_GATE`.
- **Gate:** byte-identical. Registry now owns the whole loop; no inline mechanism remains.
- **Report:** diff; grep proving no inline constraint logic remains outside the registry (arithmetic functions excepted — they're invoked); byte-identical proof.

## Commit 6 — close-out (only after Commit 4/SELECTION lands)
> **State check:** FLOOR, CANDIDACY, FEASIBILITY, and the zero-eligible PRE_GATE are already registered (Commits 2/3/5). **SELECTION (Commit 4) is the one outstanding extraction** — the sole ordering mechanism (stateful). The close-out cannot claim "the registry owns the whole loop" until it lands byte-identical. (The originally-numbered "Commit 4" was falsely reported and never landed; the ordering was mis-modeled three times — see the scope doc provenance note. There is no ORDERING extraction: the static input order is proven inert.)
- **Full byte-identical sweep** vs the Commit-0 baseline (all fields + tokens + 1043).
- **Determinism invariants** re-asserted as permanent tests (tie-break/total-order/purity, now over the registry — including the SELECTION-scope stateful path).
- **Docs:** sync S1 scope + this brief to repo; REMAINING-ITEMS — S1.1 built (SHAs); note S1.2/1.3/1.4 pending.
- **Report:** the full sweep; a **grep proving no inline constraint decision remains** outside the registry (arithmetic + `bindMs` diagnostic attribution excepted — they're invoked/separate); determinism tests green; `demo:reset` identical; suite green.

---

## Acceptance gate
The whole placement loop runs through the ordered-pipeline registry; all mechanisms are registered constraints across the **two scopes (SELECTION/PLACEMENT)**; EDD is data-described as the `dueHours` base term **inside the SELECTION composite scorer** (no separable ORDERING sort — the input order is proven inert); **byte-identical at every mechanism step and at close-out** (1043 ops, per-`Placement`-field equality, determinism tokens); ML/floor/operator/quantity **arithmetic untouched** (invoked, not moved); **no new behavior** (no veto, no config mode, no new constraint). `demo:reset` green.

## Stop conditions (report, don't improvise)
- Any mechanism step diverges from the baseline (any field, op count, or determinism token) → **STOP** — do not proceed; the break is localized to the mechanism just moved.
- An arithmetic function (`effectiveFor`, floor math, operator scaling, `processMs`) would be *modified* rather than *invoked* → **STOP** (D-S1-5 violated — move the decision, not the math).
- The pipeline would evaluate scopes out of declared order (SELECTION stateful per-step; PLACEMENT per-job as `PRE_GATE→CANDIDACY→FLOOR→place→FEASIBILITY`) — e.g. a floor after candidacy, or the stateful re-score reordered → **STOP** (determinism/byte-identical break).
- Changeover would be modeled as a PLACEMENT setup-cost, or added to `placeJob`/duration in any form → **STOP** (fabrication: verified in code, changeover exists ONLY as the SELECTION `rankBonus`; there is no placement setup-cost to reproduce, and inventing one breaks byte-identical).
- Any work reaches a veto-and-reselect, a config mode, a new constraint, or an audit snapshot → **STOP** (out of S1.1 scope — later sub-phases).
