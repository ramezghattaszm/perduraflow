# Scheduling S1.2 scope — the veto-and-reselect primitive + toolId-keyed cross-resource state

| | |
|---|---|
| **Layer** | Scheduling production-completion · S1.2 — the missing control-flow S2 (D28/D9/JIS) is born on |
| **Written against** | Actual repo state @ `76cb070` (S1.1 closed; the two-scope registry owns the loop) |
| **Governed by** | `SCHEDULING-S1-SCOPE.md` §3 (S1.2); `SCHEDULING-PRODUCTION-COMPLETION-PLAN.md` §0 |
| **Gate** | Propose-then-confirm; **byte-identical, inert on the demo** is the load-bearing discipline — proven **same-clock old-vs-new** (base commit vs new commit, back-to-back, same seeded data), **not** against a stored digest (the plan is date-sensitive: the seed anchors demand to the current date, so the digest shifts across a weekday rollover with no code change). Also hold 1043 ops + per-field equality. |
| **Locked (this session)** | (1) Reselection = **Option A** (resources-first-then-defer); (2) **three inert commits**; (3) build-to-completion — the full primitive now, no reshape when S2 consumers land |

> **Why S1.2 exists (S1.1's finding):** the greedy loop has **no veto-and-reselect primitive** — every extracted mechanism is a timing floor, a rank term, a candidacy gate, a feasibility-degrade, or a pre-gate; *none* can say "this placement is illegal, pick another." That primitive is exactly what D28 (four hard sequencing-legality rules), D9 (single-location + tool-life cap), and JIS need. S1.2 builds the primitive **and** the `toolId`-keyed cross-resource state axis it will read — **inert** (no constraint consumes them yet), so the demo schedule is unchanged. This isolates the scariest machinery from its first users (S2).

---

## 1. What ground truth settled (repo @ `76cb070`)

- **The loop** (`sequencer.ts:356–429`): per iteration — scan `remaining`, per candidate run **CANDIDACY (pre-assignment, `resourceId=''`)** → `assignResource` (one least-loaded eligible resource) → `pipeline.selectionScore` rank; pick argmin + `tieBreakLess`; `placeJob`; `pipeline.feasibility` (**degrade form** — records the verdict, returns the placement unchanged); mutate state; `remaining.splice`. **No reselect branch exists.**
- **State** (`ResourceState = {freeMs, currentAttr, seq, ot, lastOpKey}`) is **`resourceId`-keyed**. There is **no tool state anywhere in the module** (`grep` for `toolId`/tool-life/busy-interval = 0). Tooling exists only in master-data (asset domain, D52); no `toolId` reaches the sequencer.
- **The veto seam is already reserved:** `feasibility.ts:9–10` ("S1.2 can give it teeth… `degree>0` = infeasible"), `pipeline.feasibility` records the verdict "for S1.2's veto-and-reselect", `types.ts:88` defines FEASIBILITY veto as `degree>0`, `gate.spec.ts:25` asserts the current no-veto behavior.
- **Consumer shapes (why Option A):** **D28** forbidden-transition/max-consecutive is knowable *pre-place* (needs the assigned resource's live `currentAttr`) and its remedy is **a different op**; **D9 single-location** is knowable *post-place* (needs the placed `[start,end]` vs the tool's busy intervals) and its remedy is **a different resource, else wait/defer**. The two pull in different directions → the primitive must serve both.

---

## 2. The primitive (build-to-completion)

**Two-point veto.** A veto is a property of a *placement attempt*, evaluable at two points, both raising `degree>0` = reject (reusing existing mechanisms — extend, don't invent):

- **Pre-place veto — resource-aware CANDIDACY.** A new evaluation point **after `assignResource`** (the current candidacy runs pre-assignment with `resourceId=''`, so it cannot see `currentAttr`). Reads the resource-aware schedule-model (live `currentAttr`, `freeMs`). D28-shaped. A reject here means "not this op on this resource this step."
- **Post-place veto — FEASIBILITY with teeth.** After `placeJob`, a FEASIBILITY constraint may **reject** (not just degrade). Reads `placedFeasible` + the placed `[start,end]` + (future) tool state. D9-shaped.

**Reselect control-flow — Option A (resources-first-then-defer).** On a veto of `(op, resource)`:
1. Try the op on its **next-best eligible resource** (deterministic order: least-loaded `freeMs`, then pre-sorted `id`).
2. If **all** the op's eligible resources veto → **defer** the op (leave it in `remaining`) and let the scan pick the **next-best different candidate** by the total-order this iteration.
3. **Termination backstop (declared):** if **every** remaining candidate is vetoed on **every** eligible resource in an iteration → **degrade the total-order-best** (today's at-risk placement) rather than spin, and record a typed `all_vetoed` disposition. Guarantees termination; never triggers while inert.

**Determinism (D-S1-7 preserved).** Op reselection order = the same `tieBreakLess` total-order `(firm → requiredDate → priorityRank → partNo → demandLineId)`; resource reselection order = least-loaded then `id`. Both fixed → reselection is deterministic.

**`toolId`-keyed cross-resource state (orthogonal-additive).** Two new top-level structures in `sequence()`, **not** fields on `ResourceState` (a tool spans resources):

- **Busy-interval map** `Map<toolId, {startMs, endMs, resourceId}[]>` — single-location: a tool occupied on R2 during `[a,b]` is unavailable to an overlapping op on R1.
- **Tool-life usage ledger** `Map<toolId, number>` — cumulative usage (strokes/units), incremented per tool-using placement.
- **Linkage:** an optional `toolId` (+ optional per-op usage) on `SequencerItem`. **Unset in the demo seed → both maps stay empty → never consulted → inert.**
- S1.2 builds the **structures + guarded update-on-placement + threading** so a future veto (D9, S2) can read them. **No veto consumes them in S1.2** — the single-location and tool-life-cap *constraints* are D9/S2.

**Inertness = byte-identical.** With no veto constraint registered and no `toolId` on any item: the reselect branch is never entered, the backstop never fires, the tool maps stay empty. The plan is identical — **1043 ops + an identical digest old-vs-new, same clock, same seeded data**. (The absolute digest is date-sensitive and is NOT a target; see the gate above.)

---

## 3. Sub-phases — three inert commits (each byte-identical before the next)

1. **Commit A — veto-and-reselect control-flow (inert).** Add the resource-aware pre-place CANDIDACY evaluation point + the FEASIBILITY reject verdict; wrap the place step in the Option-A reselect loop (resource-retry → defer → termination backstop), deterministic order. **No veto constraint registered** → branch never taken → byte-identical. Keep `gate.spec` inertness assertion; add a **synthetic-veto unit test** proving deterministic reselect (resource-retry then defer) off the demo path.
2. **Commit B — `toolId`-keyed state (inert).** Optional `toolId` (+ usage) on `SequencerItem`; busy-interval map + tool-life ledger + guarded update-on-placement + threading. **No item carries a `toolId`** → maps empty → byte-identical.
3. **Commit C — close-out.** Inertness + determinism invariants as permanent tests (reselect determinism, termination backstop, no-veto/no-tool → byte-identical); an **honesty grep-guard** that no veto constraint is registered and no tool is consumed yet; REMAINING-ITEMS S1.2 built (SHAs); scope + brief synced.

---

## 4. Decisions

| ID | Decision | Status |
|---|---|---|
| **D-S1.2-1** | Reselection semantics | **LOCKED — Option A** (resources-first-then-defer): resource-retry in least-loaded/id order, then defer to next-best op by the total-order. |
| **D-S1.2-2** | Commit granularity | **LOCKED — three inert commits** (A veto-flow / B tool-state / C close-out), each byte-identical before the next. |
| **D-S1.2-3** | Veto evaluation point | **Proposed — two-point** (resource-aware pre-place CANDIDACY + post-place FEASIBILITY-with-teeth), reusing existing mechanisms. Forced by build-to-completion so D28 (pre-place) and D9 (post-place) both fit without a reshape. |
| **D-S1.2-4** | Tool-state shape | **Proposed** — busy-interval map + tool-life ledger as top-level `toolId`-keyed structures, orthogonal to `ResourceState`; optional `SequencerItem.toolId`, unset in seed. Structures + threading only; the consuming vetoes are D9/S2. |
| **D-S1.2-5** | Termination backstop | **Proposed** — all-vetoed → degrade the total-order-best + typed `all_vetoed` disposition. Declared for the primitive's contract; inert in the demo. |

---

## 5. Definition of done

- Veto-and-reselect primitive exists across the two evaluation points; Option-A reselect (resource-retry → defer → backstop) is deterministic and declared.
- `toolId`-keyed busy-interval + tool-life structures exist and thread through placement, guarded on `SequencerItem.toolId`.
- **Inert:** no veto constraint registered, no tool consumed; **demo byte-identical** — 1043 ops + an identical digest **old-vs-new, same clock** (not against a stored value) at each commit.
- Determinism preserved and asserted (reselection order, backstop); `demo:reset` green; suite + 5-workspace typecheck green.
- Honesty marker: S1.2 changed *control-flow capability + state axis*, **not behavior** — new behavior is S2 (the constraints that consume this).

## 6. Scope boundary

**Out:** any constraint that *uses* the veto or tool-state — D28's four legality rules, D9's single-location + tool-life cap, JIS ordering (all S2/S3); the objective bridge / hard-soft-slack config (S1.3); the D6 audit snapshot (S1.4). S1.2 is **primitive + state substrate only, inert.**

> **Risk honesty:** S1.2 is lower byte-identical risk than S1.1 (nothing is *moved* — the loop's existing computation is untouched; new branches are dead while inert), but it is the **most control-flow-novel** step: the reselect loop and the termination backstop are genuinely new paths. The mitigation is inertness (dead branches) + a synthetic-veto determinism test that exercises the new path off the demo, so the primitive is proven *without* relying on a consumer that doesn't exist yet.

---

*Confirm D-S1.2-3/4/5 (1–2 locked). Then the S1.2 build brief (Commit A/B/C, byte-identical each) — Commit A first.*
