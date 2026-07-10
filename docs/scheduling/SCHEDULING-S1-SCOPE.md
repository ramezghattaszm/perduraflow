# Scheduling S1 scope — the constraint framework (the substrate)

| | |
|---|---|
| **Layer** | Scheduling production-completion · S1 — **the largest layer in the program**; the substrate S2/S3/S4 are all born on |
| **Written against** | Actual repo state (S1 ground-truth report) |
| **Governed by** | `SCHEDULING-PRODUCTION-COMPLETION-PLAN.md` §0; `PLATFORM-CONFIGURABLE-REFERENCE-SETS.md` (cascade, now reaching `line` via S0) |
| **Gate** | Propose-then-confirm; **byte-identical extraction** is the load-bearing discipline |
| **Locked** | (1) abstraction expresses **all five mechanisms**; (2) existing constraints **moved** into the registry (not two-homed); **EDD is a registered rank constraint**; **mechanism-by-mechanism** byte-identical extraction |

> **The finding that shaped S1:** the greedy loop has **no veto-and-reselect primitive** — every built constraint is a timing floor, a rank term, a candidacy gate, a feasibility-degrade, or a service pre-gate; *none* can say "this placement is illegal, pick another." That primitive is exactly what D28/D9/JIS need. So S1 is not "lift inline checks into a list" — it is **(a) a universal declarative constraint abstraction that describes every placement decision, (b) the missing veto primitive + cross-resource state, (c) hard/soft/slack as resolved config, (d) the resolved-set audit snapshot** — with the entire existing engine re-expressed through (a), proven byte-identical.

---

## 1. What ground truth settled (the design constraints)

- **Injection mechanisms** (§2), across **two scopes** (proven by the reverse-order inertness diagnostic): `SELECTION`-scope = the stateful per-step composite scorer (`rankBonus` changeover-avoidance + expedite + not-ready over live `currentAttr`, total-order tie-break) — the **sole ordering mechanism**; `PLACEMENT`-scope = `CANDIDACY`/`FLOOR`/`FEASIBILITY` + `PRE_GATE` (already extracted). **No ORDERING scope** — the DB input order is proven inert. Changeover is a SELECTION term (not a `solve()` placement cost).
- **No veto-and-reselect** exists — the central new control-flow (S1.2).
- **The objective already speaks degree-of-violation:** every `scorePlan` factor's `rawValue` *is* a violation degree; `ConstraintBinding` already has `type:'hard'|'soft'` — but **hard is only *reported*, never *enforced*** (`binding:false` hardcoded). So soft-mode maps onto the objective cleanly; **hard-mode has no enforcement path in `scorePlan`** and must route to the veto primitive. The two design problems (veto + hard-mode) are one problem.
- **Two loci, different data shapes:** `sequence()` evaluates pre-placement `(item, resourceState, candidateStart)`; `scorePlan()` post-placement `(placement, plan)`. The declarative constraint must be a relation over a **schedule-model both can evaluate** — which is also the CP-SAT-adapter form (solver-neutrality, S4).
- **All state is `resourceId`-keyed** (§3); single-location needs `toolId`-keyed busy-intervals, tool-life a `toolId`-keyed usage ledger — new state axes, orthogonal-additive to `ResourceState`.
- **Extraction hazards (§7):** the ML `effectiveFor` overlay, the timing floors, min-batch quantity floor, operator scaling — **must reproduce exactly, including their ordering relative to candidacy.** This is the core byte-identical risk under decision (1).
- **Determinism (§4):** the tie-break/total-order + purity (no `Date.now()`/random). Re-expression must preserve it, and the **registry's evaluation order must be deterministic + declared** (an ordered mechanism-pipeline, not an unordered bag).

---

## 2. The universal constraint abstraction (the central artifact)

A **constraint** is a declarative object:
- **predicate/evaluation** — a relation over the **schedule-model** (op, resource, tool, window, sequence, candidate-start) producing a **degree of violation** (0 = satisfied, >0 = magnitude) and/or a **contribution** (a floor time, a rank delta) per its mechanism.
- **mechanism** — one of `FLOOR | CANDIDACY | FEASIBILITY | PRE_GATE | SELECTION` (extraction targets) — declares *how* the framework applies the evaluation. (`SELECTION`=stateful per-step pick, the sole ordering mechanism; the rest per-job PLACEMENT.)
- **expression vocabulary** — authored against an **explicit, versioned internal representation** (not ad-hoc TS predicates), so multi-solver adapters (S4) and eventual customer-authoring are exposures of this vocabulary, not rewrites.
- **application mode** (S1.3) — `hard | soft | hard-with-slack`, **resolved config**, deciding whether a violation vetoes, penalizes, or slacks-then-vetoes.
- **solver-neutral** — the constraint knows nothing of *when* (loop vs objective) or *by which engine* (greedy vs CP-SAT) it is evaluated; adapters compile it.

**The two-scope evaluation model (proven by diagnostic — supersedes three earlier wrong models):** the mechanisms split across **two real scopes**:
- **`SELECTION` scope** — the **sole ordering mechanism: a stateful per-step scorer, evaluated each iteration.** Re-scans remaining ready candidates and picks the best by a composite score: `rank = dueHours − changeoverBonus(st.currentAttr) − expedite + notReady`, with the total-order tie-break `(firm → requiredDate → priorityRank → partNo → demandLineId)`. **It reads and mutates live per-resource state (`currentAttr`) each step** — so "who's next" depends on "what was just placed." **The order is produced from scratch here, statefully — there is no static pre-sort feeding it.**
- **`PLACEMENT` scope** — **per-job, post-selection** (`placeJob`): `PRE_GATE → CANDIDACY → FLOOR → place → FEASIBILITY`. (Already extracted — Commits 2/3/5.)

**There is NO `ORDERING` scope.** The DB `ORDER BY (requiredDate, demandLineId)` in `activeDemand` is a **cosmetic input order, proven inert** — reversing the entire starting order of `remaining` before the loop produced a byte-identical plan (`0645457f…006ef` unchanged). The in-loop selection is a strict-total-order min-scan over ready candidates (precedence guarantees ≤1 ready op per demand line → distinct `demandLineId` → unique min regardless of scan order), so the input order cannot affect the plan. The `pipeline.order` identity seam may stay as an inert no-op or be dropped, but **must not be documented as a load-bearing ordering layer.**

**Changeover** is a `SELECTION` term (stateful `rankBonus` from `currentAttr`, affecting *which job is next*). In `solve()` it is **not** a placement setup-cost (no changeover term in `placeJob`/duration). A separate post-hoc changeover *count* exists in `scorePlan` (the what-if objective, weight 1) — never in `solve()`'s selection.

**EDD** is the `dueHours` base term *inside* the SELECTION composite score — not a separable pre-sort. Data-described within the SELECTION constraint.

So the extraction is **one commit, not two**: extract the stateful SELECTION scorer, byte-identical, threading live per-resource state. There is no clean "ORDERING 4a" — the whole ordering is the hard stateful part.

> **Provenance note (the authority — do not re-infer):** this structure was **mis-modeled three times**: (1) as a flat per-candidate pipeline; (2) as a two-tier "static-ORDERING + changeover-as-placement-cost"; (3) as a three-scope "static `items.sort` on `(dueMs,seqIndex)` ORDERING + stateful SELECTION" — this last one was a **fabrication written into this doc as false 'verbatim-code authority'** (there is no `items.sort` and no `seqIndex` in `sequence()`), caught by Claude Code before sync. The **two-scope model above is proven by the reverse-order inertness diagnostic** (digest unchanged) + verbatim code, not inferred. This is the corrected authority.

**The stateful `SELECTION` scope changes the pipeline shape:** a SELECTION constraint's `evaluate` takes `(item, resourceState, remaining)` — not the stateless `(item, model)` of the PLACEMENT scopes — and the registry threads the **live, mutating** per-resource state (`currentAttr`) through each iteration. This is the same stateful machinery S1.2 (veto + tool state) needs, so building it correctly here de-risks S1.2. It also maps onto CP-SAT as a **sequence-dependent setup-cost objective** (S4).

**What stays inline (not extracted):** nothing legality/ordering-related — but the *arithmetic primitives* the constraints call (the ML `effectiveFor` duration overlay, operator scaling, the raw `Math.max`/`processMs` computation) remain functions the `FLOOR`/duration constraints *invoke*. The constraint declares "material floor applies here"; the millisecond math it calls is the same untouched function. This is the seam that makes byte-identical achievable: **move the *decision*, reuse the *arithmetic*.**

---

## 3. Sub-phases (ordering forced by the findings)

### S1.1 — universal abstraction + registry; extract all five mechanisms; **byte-identical, mechanism-by-mechanism**
The riskiest phase — it re-expresses the whole placement loop through the registry. De-risked by extracting **one mechanism at a time**, each proven byte-identical against the 1043-op lock + per-`Placement`-field equality + the four determinism invariants **before the next moves**:
1. Define the abstraction + ordered pipeline + schedule-model; the registry wraps the *existing* inline logic (no move yet) — prove identical. **[DONE — Commit 1]**
2. Move **FLOOR** (material, precedence, release, min-batch) — timing arithmetic + ML-overlay interaction; reuse the arithmetic functions. **[DONE — Commit 2]**
3. Move **CANDIDACY** (isReady, eligibility). **[DONE — Commit 3]**
4. Move **FEASIBILITY** (placeJob-degrade) + **PRE_GATE** (zero-eligible reject). **[DONE — Commit 5]**
5. Move **SELECTION** — extract the stateful per-step composite scorer (`rankBonus(currentAttr)` + expedite + not-ready + EDD-`dueHours` base, total-order tie-break, `currentAttr` mutation) — the hard stateful one; threads live per-resource state. The **sole ordering mechanism**; there is no separable ORDERING step. **[pending — the true Commit 4]**
6. Registry owns the whole loop; inline mechanisms gone; **no new behavior, no veto yet.**
Determinism invariants preserved and asserted; ML overlay/quantity/operator arithmetic untouched (invoked, not moved).

> **Extraction-status note (corrected against repo):** Commits 1/2/3/5 landed byte-identical (FLOOR/CANDIDACY/FEASIBILITY/PRE_GATE). The originally-numbered "Commit 4" was **falsely reported and never landed** — SELECTION remains inline. There is **one** remaining extraction: **SELECTION** (the stateful scorer, the sole ordering mechanism). Close-out cannot claim "the registry owns the loop" until it lands byte-identical.

### S1.2 — the veto-and-reselect primitive + cross-resource state
- Introduce the missing control-flow: a constraint (mechanism `FEASIBILITY` in *veto* form) can **reject a candidate placement → the loop reselects** (vs today's degrade). Deterministic reselection order.
- Introduce **`toolId`-keyed** state: a busy-interval structure (single-location) + a usage ledger (tool-life) — orthogonal-additive to `ResourceState`.
- **Inert on the demo:** no constraint *uses* veto or tool-state yet, so the schedule stays byte-identical. This isolates the scariest machinery from its first users (S2's D9/D28).

### S1.3 — hard/soft/slack as resolved config + the objective bridge
- Application mode resolves through the cascade **down to `line`** (the S0 rung): a constraint is hard/soft/slack per `global→tenant→plant→line`.
- **soft** → violation degree becomes a new `scorePlan` factor + `ConstraintBinding` (the objective already speaks this).
- **hard** → violation routes to the **veto primitive** (S1.2).
- **hard-with-slack** → veto only past the resolved threshold.
- Requires extending the closed `RationaleFactorKey`/`ObjectiveWeights` union through the cascade (or a keyed structure) — a real change to the objective's closed shape, scoped here.

### S1.4 — the D6 audit snapshot (determinism⇄audit convergence)
- The **resolved constraint set** (which constraints, which modes, which params/thresholds, resolved per scope) is snapshotted onto the committed `schedule_version` — this *is* D6's `constraint_set_ref`.
- Because mode+enablement are resolved config, the resolved set is **part of the determinism key** — a replay must resolve the same set. Capture makes a configured schedule reproducible; without it, reconstruction breaks.
- Folds the D6 half of the capture work (plan §Capture); §4.11 disposition-record stays independent/early.

---

## 4. Decisions to confirm

| ID | Decision | Recommendation |
|---|---|---|
| **D-S1-1** | Abstraction scope | **All five mechanisms** (locked) — the universal placement vocabulary; every decision data-described. |
| **D-S1-2** | Extract vs preserve | **Move** existing constraints into the registry (locked) — byte-identical extraction is the proof; no two-homed constraints. |
| **D-S1-3** | EDD | **The `dueHours` base term inside the stateful `SELECTION` scorer** (corrected: not a separable ORDERING pre-sort — proven inert). Data-described within the SELECTION constraint; S4 expresses it as part of the sequence-dependent selection objective. |
| **D-S1-4** | Extraction granularity | **Mechanism-by-mechanism**, each byte-identical before the next — a break localizes to the mechanism just moved (vs an unrebuggable whole-loop diff). |
| **D-S1-5** | Arithmetic seam | **Move the decision, reuse the arithmetic** — floors/ML-overlay/operator math stay as invoked functions; only *which constraint applies* moves. The seam that makes byte-identical feasible. |
| **D-S1-6** | Objective closed-shape | Extend `RationaleFactorKey`/`ObjectiveWeights` to a **keyed/registry-driven** structure so soft constraints add factors through config — confirm over keeping the closed 6-key union (which can't grow with registered constraints). |
| **D-S1-7** | Veto reselection order | Deterministic + declared (next-best candidate by the same total-order) — preserves the determinism contract through reselection. |

---

## 5. Definition of done

**S1.1:** whole placement loop runs through the registry; all five mechanisms extracted; EDD a registered rank constraint; **byte-identical** (1043 ops, per-`Placement`-field equality, 4 determinism invariants) proven **at each mechanism step**; ML/quantity/operator arithmetic untouched; no new behavior.
**S1.2:** veto-and-reselect primitive + `toolId`-keyed state exist; **inert** (demo byte-identical — nothing uses them).
**S1.3:** hard/soft/slack resolves through the cascade to `line`; soft→objective factor, hard→veto, slack→threshold-veto; objective closed-shape opened to registered constraints; **still byte-identical with default config** (no constraint enabled changes the demo).
**S1.4:** resolved constraint set snapshotted onto the committed version; part of the determinism key; a replay resolves the same set.
**All:** determinism contract preserved; `demo:reset` green; **demo schedule identical** through the entire layer (S1 changes *architecture*, not *behavior* — new behavior is S2+).

---

## 6. Scope boundary

**Out:** any *new* constraint (D28/D9/D8 → S2; D11/JIS → S3); the CP-SAT engine (S4 — but the abstraction is built solver-neutral for it); §4.11 disposition (independent/early); customer-authored constraint *types* (behavioral — the vocabulary enables it later, not built).

> **Risk honesty:** S1.1 is the highest-risk commit in the program — it re-expresses the scheduling engine's entire decision logic and must be byte-identical. The mechanism-by-mechanism sequence + the move-decision-reuse-arithmetic seam are the two mitigations; the 1043-op lock + per-field equality + determinism-token proof is the gate at every step.

---

*Sign off D-S1-1…7 (1–5 locked; **6 and 7 are live** — the objective-shape change and the reselection-order are the two open design calls) and the four-sub-phase order, then I write the S1.1 build brief (the mechanism-by-mechanism extraction) first — S1.2/1.3/1.4 get their own briefs as we reach them.*
