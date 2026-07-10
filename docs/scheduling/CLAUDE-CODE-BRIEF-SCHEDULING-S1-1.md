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
- Define the **constraint abstraction** (scope §2): predicate over a schedule-model → degree-of-violation and/or contribution; a `mechanism` tag (`FLOOR|RANK|CANDIDACY|FEASIBILITY|PRE_GATE`) **and a `scope` (`ORDERING` | `PLACEMENT`)**; authored against an **explicit versioned expression vocabulary** (the internal representation — this is what S4 adapters + future customer-authoring expose).
- Build the **two-tier pipeline** (corrected per Commit-0 ground truth — the mechanisms are NOT one flat per-candidate sequence):
  - **`ORDERING` scope — once, before placement:** produces the global job order. EDD (the `(dueMs, seqIndex)` pre-sort) is the base ORDERING constraint.
  - **`PLACEMENT` scope — per job in `placeJob`:** `PRE_GATE → CANDIDACY → FLOOR → place → FEASIBILITY`. Changeover is a PLACEMENT constraint (setup-cost lookup), not an ordering term.
  - The two-tier order is part of the determinism contract. **Extracting EDD as a per-candidate rank would change *when* it evaluates and reorder placement — do not.**
- **Wrap, don't move yet:** the registry initially delegates each scope/phase to the *existing inline logic* (thin pass-through) — the global pre-sort routes through the ORDERING tier, `placeJob` through the PLACEMENT tier — computing identically.
- **Gate:** byte-identical to baseline (the routing indirection changed nothing).
- **Report:** the abstraction + two-tier pipeline diff; confirmation the pre-sort routes through ORDERING and `placeJob` through PLACEMENT; byte-identical proof vs baseline.

## Commit 2 — move FLOOR (the hardest; timing arithmetic)
- Move the floor decisions (material `earliestStartMs`, precedence `predecessorEnd`, release, min-batch quantity floor) into registered `FLOOR` constraints — **each invokes the same untouched arithmetic function** (D-S1-5). The `Math.max` composition becomes the pipeline folding the FLOOR constraints' contributions.
- **Preserve exactly:** the order floors compute *relative to candidacy* and *relative to the ML `effectiveFor` overlay* (the §7 hazard — do not reorder).
- **Gate:** byte-identical. This is the step most likely to break; if it does, the diff is localized to floor timing.
- **Report:** the FLOOR-constraint diff; explicit confirmation the arithmetic functions are invoked-unchanged; byte-identical proof (per-field, esp. every `start`).

## Commit 3 — move CANDIDACY
- Move `isReady` + eligibility (`routing_operation.resourceGroupId → members`) into registered `CANDIDACY` constraints (skip-until-ready / not-eligible). Eligibility still flows through the group (untouched data path; only the *gate decision* moves).
- **Gate:** byte-identical.
- **Report:** diff; byte-identical proof.

## Commit 4 — move ORDERING (EDD as a registered constraint)
- Move the global `(dueMs, seqIndex)` pre-sort into a registered **base `ORDERING` constraint** (evaluated **once**, before placement — NOT per-candidate). Future ordering constraints compose into the same global sort key.
- **Changeover is NOT here** — it's a `PLACEMENT`-scope setup-cost lookup inside `placeJob` (moved with the PLACEMENT mechanisms, Commits 2–3/5), not a reordering term. Do not turn changeover into a rank bias — that would change behavior.
- **Critical:** the ORDERING constraint must produce the **identical global job order** (and identical `(dueMs, seqIndex)` tie-break). This is where determinism-token equality is most exposed.
- **Gate:** byte-identical (esp. determinism tokens + the global op order).
- **Report:** diff; byte-identical proof with the determinism tokens + job order called out explicitly.

## Commit 5 — move FEASIBILITY (+ PRE_GATE)
- Move the `placeJob → null` degrade into a registered `FEASIBILITY` constraint (**degrade form only — the veto-and-reselect form is S1.2, not here**). Move any service-level `PRE_GATE`.
- **Gate:** byte-identical. Registry now owns the whole loop; no inline mechanism remains.
- **Report:** diff; grep proving no inline constraint logic remains outside the registry (arithmetic functions excepted — they're invoked); byte-identical proof.

## Commit 6 — close-out
- **Full byte-identical sweep** vs the Commit-0 baseline (all fields + tokens + 1043).
- **Determinism invariants** re-asserted as permanent tests (the tie-break/total-order/purity, now over the registry).
- **Docs:** sync S1 scope + this brief to repo; REMAINING-ITEMS — S1.1 built (SHAs); note S1.2/1.3/1.4 pending.
- **Report:** the full sweep; determinism tests green; `demo:reset` schedule identical; suite green.

---

## Acceptance gate
The whole placement loop runs through the ordered-pipeline registry; all five mechanisms are registered constraints; EDD is a registered RANK constraint; **byte-identical at every mechanism step and at close-out** (1043 ops, per-`Placement`-field equality, determinism tokens); ML/floor/operator/quantity **arithmetic untouched** (invoked, not moved); **no new behavior** (no veto, no config mode, no new constraint). `demo:reset` green.

## Stop conditions (report, don't improvise)
- Any mechanism step diverges from the baseline (any field, op count, or determinism token) → **STOP** — do not proceed; the break is localized to the mechanism just moved.
- An arithmetic function (`effectiveFor`, floor math, operator scaling, `processMs`) would be *modified* rather than *invoked* → **STOP** (D-S1-5 violated — move the decision, not the math).
- The pipeline would evaluate mechanisms out of the declared two-tier order (ORDERING once-before-placement; PLACEMENT per-job as `PRE_GATE→CANDIDACY→FLOOR→place→FEASIBILITY`) — e.g. EDD extracted as a per-candidate rank, or a floor after candidacy → **STOP** (determinism/byte-identical break).
- Changeover would be turned into an ORDERING/rank term (it's a PLACEMENT setup-cost lookup) → **STOP** (behavior change).
- Any work reaches a veto-and-reselect, a config mode, a new constraint, or an audit snapshot → **STOP** (out of S1.1 scope — later sub-phases).
