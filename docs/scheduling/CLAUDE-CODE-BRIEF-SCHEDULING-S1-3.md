# Claude Code build brief — Scheduling S1.3 (hard/soft/slack as resolved config + the objective bridge)

| | |
|---|---|
| **Companion (authority)** | `docs/scheduling/SCHEDULING-S1.3-SCOPE.md` — read first; the four-closed-shapes finding + the two-proof gate |
| **Also read** | `SCHEDULING-S1-SCOPE.md` §3 + D-S1-6; `CONFIG-FRAMEWORK-DESIGN.md`; `WEIGHT-CONFIG-DESIGN.md` (the dominance guard) |
| **Decisions** | **D-S1-6 = Option B (fully keyed objective)**; D-S1.3-2…6 **LOCKED** (scope §5) |
| **Scope of THIS brief** | **S1.3 only** — open the objective, the per-constraint mode config group, the mode→behavior bridge. **No new constraint** (D28/D9/D8 → S2; D11/JIS → S3), **no D6 audit snapshot** (S1.4), **no customer-authoring surface**. |
| **Discipline** | **Commit-by-commit; both proofs green before the next moves.** Stop-and-report each. |
| **Repo base** | `9a761ef` (S1.1 + S1.2 closed) |

> **⚠ THE GATE IS TWO PROOFS — the plan digest ALONE CANNOT gate this layer.** `solve()` does **not** use `scorePlan`. `scorePlan` is the **what-if objective** — it produces every option score, rationale, recommendation, and `ConstraintBinding` the demo narrates. **An Option-B regression can change all of them while the 1043-op plan digest stays perfectly green.** So every commit must prove BOTH:
> 1. **PLAN** — `solve()` untouched: **1043 ops**, identical digest, **same-clock old-vs-new** (base commit vs new commit, back-to-back, same seeded data). **Never gate against a stored digest** — it is date-sensitive (`0645457f…`/`01c50afd…` are stale artifacts, not targets).
> 2. **OBJECTIVE** — `scorePlan` reshaped but **numerically identical**: for the demo scenarios, the same **factors (all six, same order), rawValues, weights, contributions, score, `CostedKpis`, and `ConstraintBinding`s**. **This is the load-bearing proof.** Proof (1) will happily stay green through an objective regression.
> 3. **COMPARATIVE / NARRATION** *(the gap found at Commit 0 — proof (2) alone does NOT cover this)*. `ScoredPlan` is `{score, kpis, factors, constraints}` — **`scorePlan` does not return comparatives.** They are built one level up, in `whatif.service.ts:849` (`private comparatives(...)` → `decidingFactors`, `:871`), and `OptionComparative.decidingFactors[].key` is typed on **`RationaleFactorKey`** — the exact type Option B reshapes. That layer **derives** deciding factors by comparing factor contributions **across options**, so a shift in the factor set or fold order changes the deciding factors → changes `whatif.narration.ts:104` (`FACTOR_NAME[d.key]`) → **changes the demo's "why the winner won" narration and recommendation**. A regression here is invisible to BOTH (1) and (2). Pin it: a **multi-option fixture** (≥2 scored plans) run through the comparative builder + narration, digested (`vsOptionId`, `deltaScore`, `verdict`, `decidingFactors[].key/delta`, and the narrated text).
>
> **Any divergence in ANY of the three → STOP.**
>
> *(Note for S2, not S1.3: `FACTOR_NAME` (`whatif.narration.ts:33`) is already `Record<string, string>` with a `?? key` fallback, so Option B won't break it structurally — but a newly registered factor would narrate its **raw key**. Registered constraints must supply a label key when they start carrying weights.)*

---

## Commit 0 — pre-flight + the OBJECTIVE baseline harness (report only, no behavior change)
There is a plan baseline harness (`plan:baseline`); **there is no objective baseline harness — build one.** Proof (2) is impossible without it.

- **Confirm the four closed shapes** verbatim: `RationaleFactorKey` (`packages/contracts/src/scheduling.ts:690`), `ObjectiveWeights` (`packages/contracts/src/config.ts:218`), `scorePlan`'s hardcoded `factors` array (`apps/api/src/modules/scheduling/whatif.scoring.ts:133–148`) + `score = factors.reduce(...)`, and the `objective` group (`config.groups.ts:59–62` — `fields: OBJECTIVE_WEIGHT_KEYS.map(...)`, `validate: firmLatenessDominates`). Also confirm the hardcoded `binding: false` (`whatif.scoring.ts:157`, `:175`) and `DominanceVerdict.offending: (keyof ObjectiveWeights)[]` (`config.ts:270`).
- **Build the objective baseline harness:** dump, for a fixed set of demo what-if scenarios, the **full scoring surface** — every `RationaleFactor` (key, rawValue, unit, weight, contribution, direction, detailKey/detailParams), the `score`, the `ConstraintBinding[]`, and the weight-set version token — as a digest + a field-level reference. This is the reference every subsequent commit diffs against.
- **Capture both baselines same-clock** (plan + objective).
- **Report:** the confirmed shapes; the new harness + both baselines; wait for go.

## Commit 1 — open the objective (Option B, fully keyed) — THE HARD ONE
- Replace the closed shapes with **one registry-driven, keyed structure**: `ObjectiveWeights` → `Record<string, number>`; `RationaleFactorKey` → registry-derived/string-keyed; **Zod-validate at the config boundary** (recovering the safety the closed union gave).
- **The six built-ins become pre-registered entries** — `lateness`, `changeover`, `overtime`, `inventory`, `displacement`, `cost` — with the **same keys, same `OBJECTIVE_DEFAULTS`, same `aps-w2` version token**. No built-in/registered split.
- `scorePlan` **derives** its factor list from the registry instead of the hardcoded array. **Registration order is load-bearing** (the factor array order + `reduce` sum order must reproduce the current float result exactly — same order, same arithmetic).
- The `objective` **config group's `fields` derive from the registry**; the **UI weights panel** (`packages/app/features/configuration/configuration-screen.tsx`) derives from it too (no hardcoded field list).
- **Generalize the dominance guard (D-S1.3-2):** `firmLatenessDominates` must apply to **every registered weight**, not just the original six (`offending` can no longer be `(keyof ObjectiveWeights)[]`). A soft constraint out-weighing firm lateness is a **correctness failure** (D13/D23) — the guard is the check that prevents it.
- **Reuse the arithmetic, move the shape:** `factor()`, the contribution math, `r2`/`r4` rounding, and the detailParams stay **invoked unchanged**.
- **Gate: BOTH proofs** — especially (2): identical factors/rawValues/weights/contributions/score/rationale/`ConstraintBinding`s. Any float drift = the fold order changed → **STOP**.
- **Report:** the diff; explicit confirmation the six are pre-registered with identical keys/defaults/order; the dominance-guard generalization; both proofs.

## Commit 2 — the constraint-policy config group (inert)
- Add a config group carrying, **per constraint id**, its application `mode` (`hard | soft | hard-with-slack`) + a slack **threshold** where applicable.
- **D-S1.3-3:** `ConfigGroupDescriptor.fields` is a **static scalar list** (`config.groups.ts:17–18`) — extend it to **registry-derived/keyed fields** so both the open weight set (Commit 1) and this per-constraint mode map can be expressed.
- **Resolve the full ladder `global → tenant → plant → line`.** **D-S1.3-6:** thread `lineId` into config resolution — `config.service.scopePath` already accepts it (`config.service.ts:55`), and `config.service.ts:57` says outright *"No config caller threads a `lineId` in S0 (line depth is S1) → the line rung is inert."* **S1.3 is the rung's first real consumer.** `resolveObjective(tenantId, plantId?)` (`config-read.service.ts:44`) has no `lineId` param — add it.
- **Inert by data:** no constraint carries a mode; **no line-level override is seeded** → resolution is identical. Lean on the existing guard: `config.resolve.spec.ts:162` proves *lineId-absent vs threaded-but-null → identical SHA*. Extend it to the new group.
- **Gate: BOTH proofs** + config resolution identical (the SHA spec).
- **Report:** the group + ladder diff; confirmation nothing carries a mode and no line override is seeded; both proofs + the config SHA.

## Commit 3 — the mode → behavior bridge (inert with default config)
- **soft** → the constraint's violation **degree** becomes an objective factor (through Commit 1's keyed structure) + an **honest `ConstraintBinding`**.
- **hard** → the violation routes to **S1.2's veto primitive** (`preplaceVeto` / `feasibilityReject`, `sequencer.ts:266` seam). Hard is finally **enforced**, not just reported: the hardcoded `binding: false` (`whatif.scoring.ts:157`) becomes an **honest verdict**.
- **hard-with-slack** → veto only past the **resolved threshold**.
- **Inert:** no constraint carries a mode (D28/D9/JIS are S2/S3) → the bridge has nothing to apply, no veto is registered, no new factor appears.
- **⚠ The S1.2 honesty guard (`inert-honesty.guard.spec.ts`) must survive in spirit.** It asserts no `preplaceVeto:`/`feasibilityReject:` **array-literal registration** exists. The bridge must **not** register a literal array — it derives registrations from resolved modes, and with no constraint carrying a mode the set is **empty**. If the guard's regex needs adjusting for the derived path, **the assertion it protects must be preserved**: *no constraint is actually enforced yet.* **Do not weaken or route around it** — strengthen it if anything (assert the derived registration set is empty at runtime).
- **Gate: BOTH proofs.**
- **Report:** the bridge diff; confirmation the derived registration set is **empty** and no factor was added; the honesty guard's status; both proofs.

## Commit 4 — close-out
- **Full sweep** — both proofs vs the Commit-0 baselines.
- **Permanent tests:** the dominance guard over registered weights (incl. a soft-weight-exceeds-lateness case → rejected); mode resolution across `global→tenant→plant→line` (incl. a line override resolving correctly **in a test**, off the demo); the objective registry producing the six built-ins identically.
- **Honesty guard (extend):** no constraint carries a mode; the derived veto-registration set is empty; the hard-enforcement path exists but is **unexercised**. A future D28/D9/JIS consumer trips it **by design** — that is the signal to update it, not route around it.
- **Docs:** REMAINING-ITEMS — S1.3 built (SHAs); scope + brief synced; note S1.4 pending (it **consumes** this layer's resolved modes).
- **Report:** the full sweep (both proofs); guards + determinism green; `demo:reset` identical; suite + 5-workspace typecheck green; SHAs.

---

## Acceptance gate
The objective is registry-driven and keyed, with the six built-ins pre-registered producing **numerically identical** factors/score/rationale; the dominance guard covers **every** registered weight; application mode (`hard`/`soft`/`hard-with-slack` + threshold) resolves `global→tenant→plant→line`; soft→objective factor, hard→**the S1.2 veto** (enforced, not just reported), slack→threshold-veto; **BOTH proofs green at every commit** with default config; **no new behavior** (no constraint carries a mode). `demo:reset` green.

## Stop conditions (report, don't improvise)
- **Either proof diverges** → **STOP**. In particular, proof (1) green + proof (2) red = exactly the failure this layer is designed to catch; do not proceed on the plan digest alone.
- Any float drift in the six built-in contributions/score → **STOP** (the registry's fold order changed — the arithmetic must be invoked, not re-derived).
- The dominance guard would apply to only *some* weights, or a registered weight could exceed `lateness / FIRM_LATENESS_DOMINANCE_RATIO` → **STOP** (firm-delivery dominance broken).
- The S1.2 honesty guard would be **weakened, deleted, or routed around** to make the bridge pass → **STOP** (that guard is the thing standing between "inert" and a false byte-identical pass).
- A constraint gets registered with a mode, or a line-level override is seeded into the demo → **STOP** (that is S2/S3, and it makes S1.3 non-inert).
- Any work reaches a new constraint, the D6 audit snapshot (S1.4), or a customer-authoring surface → **STOP** (out of scope).
