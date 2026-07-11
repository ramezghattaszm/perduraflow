# Claude Code build brief — Scheduling S1.2 (veto-and-reselect primitive + toolId-keyed state)

| | |
|---|---|
| **Companion (authority)** | `docs/scheduling/SCHEDULING-S1.2-SCOPE.md` — read first; rationale + the full consumer analysis there |
| **Also read** | `SCHEDULING-S1-SCOPE.md` §3 (S1.2); `SCHEDULING-PRODUCTION-COMPLETION-PLAN.md` §0 |
| **Decisions** | D-S1.2-1…5 **LOCKED** (scope §4): Option A reselect; three inert commits; two-point veto; tool-state structures-only; declared termination backstop |
| **Scope of THIS brief** | **S1.2 only** — the veto-and-reselect control-flow + the `toolId`-keyed state substrate, **inert**. **No constraint consumes them** (D28/D9/JIS are S2/S3; hard-soft-slack config is S1.3; D6 snapshot is S1.4). |
| **Discipline** | **Commit-by-commit; each byte-identical (inert) before the next moves.** Commit-per-piece. Stop-and-report each. |
| **Repo base** | `76cb070` (S1.1 closed — the two-scope registry owns the loop) |

> **The load-bearing difference from S1.1:** S1.1 *moved* existing computation (extraction). S1.2 *adds new control-flow (a reselect loop) and a new state axis (tool)* — but they must be **inert**: dead branches + empty maps, so the plan is unchanged. Nothing existing is moved or re-timed. Two mitigations are mandatory: **(1) inertness** — no veto constraint registered, no `toolId` on any seed item, so the new branches never execute and the new maps stay empty; **(2) prove the new path OFF the demo** — a synthetic-veto unit test exercises reselect/backstop determinism, so the primitive is verified without a consumer that doesn't exist yet.

> **The byte-identical lock (the gate at EVERY commit):** `demo:reset` = **1043 ops**, per-`Placement`-field equality, the four determinism invariants (`sequencer.determinism.spec.ts`). **Re-capture the pre-digest same-day** (`plan:baseline --check`; `0645457f…006ef` shifts by weekday — the gate is pre==post today, NOT equality to the stored value). Every commit must reproduce it exactly. **Any divergence → STOP** — an inert step diverging means a branch is not actually dead or a map is being consulted.

---

## Commit 0 — pre-flight + baseline (report only, no engine change)
- Re-confirm the loop shape against `sequencer.ts` @ `76cb070`: the scan (`:356–379`), CANDIDACY pre-assignment (`:366`, `resourceId=''`), `assignResource` (`:367`), `selectionScore` (`:372`), argmin+`tieBreakLess` (`:373`), `placeJob` (`:428`), `pipeline.feasibility` degrade (`:429`), state mutation (`st.freeMs`/`st.currentAttr`/`splice`, `:494–539`), `ResourceState` (`:215–224`), `pipeline.feasibility` (`pipeline.ts:104–113`), `placementFeasibilityConstraint` (`feasibility.ts`).
- **Re-capture the byte-identical baseline same-day** (per the lock). Report the digest + op count.
- **Report:** the confirmed injection sites (the new pre-place veto point after `:367`; the reselect wrapper around `:428–429`; the tool-state homes); the same-day baseline; wait for go.

## Commit A — veto-and-reselect control-flow (WRAPPING new dead branches; inert)
Build the **two-point veto** + the **Option-A reselect loop**. No veto constraint is registered, so every new branch is dead → byte-identical.

- **Pre-place veto — resource-aware CANDIDACY.** Add a **second** candidacy evaluation point **after** `assignResource` (`:367`), evaluated with the resource-aware `ScheduleModel` (live `currentAttr`, `resourceFreeMs = st.freeMs`). This is distinct from the existing pre-assignment candidacy (`:366`, `resourceId=''`), which stays. A registered constraint here with `degree>0` = "not this op on this resource this step." **Empty → returns candidate (no-op).**
- **Post-place veto — FEASIBILITY with teeth.** Extend `pipeline.feasibility` so a FEASIBILITY constraint can **reject** (a distinct verdict) vs today's degrade-only. Preserve the degrade path exactly: `placementFeasibilityConstraint` stays `degree>0` on `placedFeasible===false` but its verdict continues to route to the **degrade** (contiguous-fallback) arithmetic unless a *reject-form* constraint is registered. **No reject-form constraint registered → identical to today.**
- **Reselect loop (Option A).** Wrap the place step (`:428–429`) in a deterministic reselect:
  1. On a veto of `(op, resource)`, try the op on its **next-best eligible resource** — declared order: least-loaded `freeMs`, then pre-sorted `id` (reuse `assignResource`'s rule; generalize it to yield an ordered list / next candidate, do **not** change its tie-break).
  2. If **all** the op's eligible resources veto → **defer** the op (leave in `remaining`) and let the scan take the **next-best different candidate** by `tieBreakLess`.
  3. **Termination backstop:** all remaining candidates vetoed on all eligible resources → **degrade the total-order-best** (today's at-risk placement) + record a typed `all_vetoed` disposition. Never fires while inert.
- **Reproduce exactly (the inert path):** with no veto registered, the pre-place veto returns candidate, the post-place veto never rejects, the reselect loop runs its body **once** and places exactly as today; the backstop is unreachable. `assignResource`'s selection and the state mutation points (`:494–539`) are **unchanged** (reproduced, not reordered).
- **Determinism:** op reselection = `tieBreakLess` total-order; resource reselection = least-loaded then `id`. Both fixed.
- **Gate:** byte-identical (same-day pre==post, 1043). The reselect indirection changed nothing because it iterates once.
- **Report:** the pipeline/loop diff; explicit confirmation the new branches are dead while inert (no veto registered) and `assignResource`/state-mutation are unchanged; the **synthetic-veto unit test** proving Option-A order (resource-retry → defer) + backstop determinism, OFF the demo; byte-identical proof.

## Commit B — toolId-keyed cross-resource state (inert)
- Add an optional **`toolId`** (+ optional per-op usage) to `SequencerItem`. **Unset in the demo seed.**
- Add two **top-level** structures in `sequence()` (NOT fields on `ResourceState` — a tool spans resources): a **busy-interval map** `Map<toolId, {startMs, endMs, resourceId}[]>` and a **tool-life usage ledger** `Map<toolId, number>`.
- Add **guarded update-on-placement**: after a placement, `if (item.toolId != null)` append the placed `[start,end]`/resourceId to the busy-interval map and increment the ledger. Thread both so a future veto (D9) can read them. **No veto reads them in S1.2.**
- **Reproduce exactly:** no seed item has a `toolId` → the guards never run → both maps stay empty → nothing consults them → byte-identical.
- **Gate:** byte-identical (same-day pre==post, 1043).
- **Report:** the `SequencerItem`/state diff; confirmation the guards are dead in the demo (no seed `toolId`) and the maps are populated/read by **nothing** yet; byte-identical proof.

## Commit C — close-out (only after A + B land byte-identical)
- **Full byte-identical sweep** vs the Commit-0 baseline (all fields + tokens + 1043).
- **Permanent tests:** reselect determinism (resource-retry → defer order), termination backstop (`all_vetoed` → total-order-best degrade), and **inertness** — no-veto/no-tool ⇒ byte-identical (extend the existing `gate.spec` inertness assertion + the determinism spec).
- **Honesty grep-guard:** assert **no veto constraint is registered** and **no tool is consumed** (the pre-place veto set + reject-form feasibility set are empty; the busy-interval/ledger maps are read by nothing) — S1.2 is substrate-only. This guard is the honesty marker that S1.2 changed *capability, not behavior*.
- **Docs:** sync the S1.2 scope + this brief; REMAINING-ITEMS — S1.2 built (SHAs); note S1.3/1.4 pending and that D28/D9/JIS (S2/S3) are the first consumers.
- **Report:** the full sweep; the grep-guard output; determinism + inertness tests green; `demo:reset` identical; suite + 5-workspace typecheck green; SHAs recorded.

---

## Acceptance gate
The two-point veto (resource-aware pre-place CANDIDACY + reject-form FEASIBILITY) and the Option-A reselect loop (resource-retry → defer → declared backstop) exist and are deterministic; the `toolId`-keyed busy-interval + tool-life structures exist and thread through placement, guarded on `SequencerItem.toolId`; **byte-identical at every commit** (1043, per-field, determinism tokens; same-day pre==post) because nothing is registered/populated; the new path is proven by a synthetic-veto test OFF the demo; **no new behavior** (no constraint consumes veto or tool-state). `demo:reset` green.

## Stop conditions (report, don't improvise)
- Any commit diverges from the same-day baseline (any field, op count, or determinism token) → **STOP** — a branch is not actually dead or a map is being consulted; the break is localized to the piece just added.
- Existing computation (`assignResource` selection, `selectionScore`, the floor/quantity/feasibility-degrade arithmetic, the state-mutation points) would be *modified or re-timed* rather than left intact → **STOP** (S1.2 adds branches; it moves nothing).
- A veto constraint, a reject-form feasibility constraint, or a `toolId` on any seed item would be **registered/populated** → **STOP** (that makes S1.2 non-inert — the consumers are S2/S3).
- The reselect loop lacks a declared termination backstop, or reselection is non-deterministic (resource order not least-loaded-then-id, op order not `tieBreakLess`) → **STOP** (determinism/termination contract break).
- Any work reaches a hard-soft-slack config mode (S1.3), a D6 audit snapshot (S1.4), or an actual D28/D9/JIS rule (S2/S3) → **STOP** (out of S1.2 scope).
