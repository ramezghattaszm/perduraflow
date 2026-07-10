# Scheduling — production-completion plan

| | |
|---|---|
| **Goal** | Finish the scheduling module to a full production build — correctness-first, no rework |
| **Origin** | The outstanding-items inventory + the scheduling ground-truth pass (constraint architecture, D11/JIS/D9/D28 hooks) |
| **Governed by** | `docs/platform/PLATFORM-CONFIGURABLE-REFERENCE-SETS.md` (cascade + declared-depth + taxonomic/behavioral rule); exact-decimal decision (net-requirements) |
| **Gate** | Propose-then-confirm per layer; each layer ground-truth-first; behavior-preserving extractions proven byte-identical |
| **Scope honesty** | This is a **multi-layer program comparable to the entire Master Data arc** — five layers + capture — not a cleanup pass. |

> **The structural finding that shaped this plan:** the sequencer is a single greedy loop with every constraint inlined (floor terms + folded EDD bonuses) — **no constraint framework**. Four priority gaps (D28, D9, D11, JIS) all need *new decision dimensions* in that loop, and `single_location` (D9) needs *cross-resource* state the resource-keyed loop can't express. So a constraint framework is the **substrate the whole arc is born on** — the effectivity-substrate moment for scheduling.

> **Three confirmed design decisions** (they compound): **(a)** the constraint abstraction is **engine-agnostic now** (declarative, CP-SAT-ready — not imperative greedy-loop checks); **(b)** **line-level config is in the first cut** → the `line` entity is a hard prerequisite (S0); **(c)** **framework first**, CP-SAT plugs into it later (S4).

> **Ultimate endpoint (confirmed): a multi-solver optimization engine.** S4 is not "the CP-SAT layer" — it is a **solver registry behind the `external_solver` binding**, shipping CP-SAT + heuristic as its first two registered solvers, extensible to more (MIP, metaheuristic, solver-portfolio/racing) by registering an adapter. This makes decisions (a)+(c) not just CP-SAT-readiness but **solver-neutrality**: the constraint/objective model is expressed in domain terms, and per-solver compilation lives in **adapters** the constraints never know about. The *capability* for multiple solvers is in S4's definition-of-done; *maximizing/tuning* it is beyond-S4 (§3).

> **Documented future — customer-authored constraint *types*.** Not in this program (behavioral logic + a CP-SAT-compilable-subset + determinism/safety enforcement make it genuinely hard). But S1's **explicit constraint-expression vocabulary** (below) makes it a bounded *extension* — expose+restrict the vocabulary — not a rewrite. The vocabulary does double duty: it's what makes **both** multi-solver adapters **and** eventual customer-authoring clean. Building it now is near-zero-cost insurance.

---

## 0. The reframed constraint model (why this is bigger than "a check registry")

Three requirements forced the abstraction past a simple registry:

1. **Hard-vs-soft is *resolved configuration, per scope* — not a code property.** The same constraint (shifts, working-days) is hard at one line, soft at another. So a constraint declares a **degree-of-violation** (0 = satisfied, >0 = by how much), and resolved config decides application mode: **hard** (violation → placement veto), **soft** (violation → weighted objective penalty), or **hard-with-slack** (tolerate up to N, then veto — the common shift/working-day case). Enforcement is no longer "which locus" (loop vs `scorePlan`); it's **two application modes of one constraint set.**
2. **Engine-agnostic (CP-SAT-ready).** A constraint is a **declarative relation over the schedule model**, with **two backends**: a heuristic evaluator (today's engine + heuristic half of the hybrid) and a CP-SAT formulation. Authored once; not re-expressed when the optimizer swaps. Hard/soft maps directly onto CP-SAT's native hard-post vs objective-penalty split.
3. **Scope-resolved down to line.** Enablement + mode + parameters + rule-data resolve through `global → tenant → plant → line` — the cascade we built, extended one realized rung (needs S0).

**Configurability boundary (the taxonomic/behavioral line, applied to constraints):** constraint *types* are **behavioral** — platform-authored logic + a determinism contract; customers cannot author new types as data. Customers configure **instances**: enablement, mode (hard/soft/slack), parameters, and rule-data (forbidden pairs, required orders, caps). New *type* = engineering (register a check); everything else = configuration. **Not** a general-purpose rules engine.

**Determinism ⇄ audit convergence:** if mode+enablement are resolved config, the **resolved constraint set is part of the determinism key** and MUST be snapshotted onto the committed version (this *is* D6's `constraint_set_ref`). Configurability and auditability meet here — capture isn't optional, it's what makes a configured schedule reproducible.

---

## 1. Layers

### S0 — the `line` entity (foundational; line-level config prerequisite)
`line` as a **first-class entity contained under plant** (single-parent — a resource locates to exactly one line), distinct from the `resource_group` **pool** (many-to-many eligibility, unchanged). Adds the `plant → line` **rung to the cascade ladder** (the first realized rung below plant — a platform capability, not just scheduling). Reconcile line (location) vs resource_group (pool) explicitly; do not conflate.
- **Ground-truth first:** how resources locate today (`plant_id` direct), what `resource_group` really is, any latent line-ish grouping.
- **Dependency for:** all line-scoped config (S1 constraints, and future line-level anything).

### S1 — the constraint framework (the substrate)
The reframed model (§0): declarative degree-of-violation constraints; **solver-neutral** (domain-term relations, per-solver compilation in adapters — not CP-SAT-shaped); hard/soft/slack as resolved config; scope-resolved to line; resolved-set snapshot into the audit trace (D6).
- **Constraints authored against an explicit, versioned expression vocabulary** — not ad-hoc TypeScript predicates. This is the single cheap discipline that makes both multi-solver adapters *and* future customer-authoring clean extensions rather than rewrites. Even though only engineers use the vocabulary at first, it must be a defined internal representation from day one.
- **Built as a behavior-preserving extraction FIRST** — extract today's inline constraints into the framework with the current heuristic as the first backend, proven **byte-identical** to today's schedule (the inertness discipline). *Then* wire config-driven enablement/mode/params on top.
- Introduces **cross-resource state** (for `single_location` and any cross-resource constraint) — the resource-keyed loop can't express it today.
- Preserves the **determinism contract** (pure, total-order tie-break).
- **Folds in D6 capture** — the resolved constraint set + model versions snapshot onto the committed version (shared artifact with the framework).

### S2 — hard-constraint correctness (on the framework)
Each a registered declarative constraint, not a loop edit. Rule-data homes decided per type (config scalar/flag vs a master-data reference structure for matrices).
- **D28 campaign/sequencing rules** — the four legality types (required-order, contiguity, forbidden-transition/cleanout, max-consecutive). Biggest correctness/scrap gap. Rule-data = a forbidden/required **matrix** (master-data-shaped) keyed on changeover attributes.
- **D9 tool-life hard cap + single-location** — consumes Layer-2 `tooling_asset` (`getAssetsForPart`/eligibility already exist); tool-usage ledger + cross-resource single-location interval. Live tool state is an asset/maintenance consumed-input seam (excluded from MD Layer 2).
- **D8 per-pair changeover cost matrix** — objective-side; replaces flat switch-count. Extends the closed `RationaleFactorKey`/`ObjectiveWeights` union through the config cascade (or a dedicated matrix).

### S3 — capability modes (on the framework)
Both need Master-Data data + a new sequencing dimension:
- **D11 alternate-routing** — MD: alternate routings + `preference_rank` (routing has only `is_primary`); `resolveRouting` returns the set; routing choice becomes a placement decision; routing-choice field on the scheduled op. Closes the **contract-misrepresentation** (`routing_id` claims alternate; engine only emits primary).
- **JIS broadcast ordering** — MD/demand: `jis_sequence_number`/`line_side_time`/`broadcast_id` (absent today; `demand_type='JIS'` is inert); a broadcast-order sequencing constraint (rides S1's ordering machinery). Closes a headline automotive delivery mode.

### S4 — multi-solver optimization engine
Replaces the SKIP-03 greedy stand-in with a **solver registry behind the `external_solver` binding** — not a single CP-SAT swap. Ships **CP-SAT + heuristic as the first two registered solvers**; a third (MIP, metaheuristic, portfolio) is "register an adapter," not a rebuild.
- Each solver has an **adapter** compiling S1's solver-neutral constraint/objective model into that solver's formulation; constraints are **not** re-authored (framework-first, c).
- **Normalized solution contract** — all solvers return solutions in one common shape (regardless of native form: CP-SAT variable assignments, a metaheuristic sequence, …), with enough fidelity that audit/determinism holds regardless of which solver produced it.
- **Solver identity + version join the determinism+audit snapshot** — if two solvers can produce different valid-optimal solutions to the same problem, *which solver ran* is part of the determinism key, exactly as *which constraints resolved* already is (D6/§0).
- Solver policy (which solver, time budget, quality target) is **config** (Group 4), scope-resolved.
- **Validated against known-good heuristic behavior** (framework-first): S1 proves inert on the current heuristic *before* the search engine also changes.

### Capture (split — confirmed)
- **§4.11 proposal-disposition record** — **early / standalone** (independent of the framework; unrecoverable-if-delayed AI-performance data). Capture at `applyOption`/`commit`: selected-rank, selected-vs-top, edited-before-commit, reason, approver, version link, outcome-ref. Feeds §14.2/§1003 AI KPIs.
- **D6 decision-audit trace** — **folded into S1** (its content — resolved constraint set, model versions, constraint-set-ref — doesn't exist until S1 produces it) + `llm_interaction_refs` linkage.

---

## 2. Sequence + dependencies

```
§4.11 capture ──(independent, start early)
S0 line ──▶ S1 framework(+D6 capture) ──▶ S2 correctness (D28,D9,D8)
                                     └────▶ S3 capabilities (D11,JIS)
                                     └────▶ S4 CP-SAT (second backend)
```

- **S0 before S1** — line-level resolution needs the entity.
- **S1 before S2/S3/S4** — all sit on the framework; S4 is a backend of it.
- **S2 and S3 parallelizable** after S1 (independent constraint sets).
- **S4 after S1** (needs the declarative model); can follow S2/S3 or interleave.
- **§4.11 anytime** (independent) — do early for the data.

---

## 3. What's explicitly NOT in this program

- Net-requirements / dependent demand (D37) — separate module; the exact-decimal trigger fires there.
- Yield/quality module — the #1 gap, but its own module (entangles exact-decimal); not scheduling-completion.
- The remaining low-consequence silent gaps (firm-fence D23/D38, move/queue-time §5.2) — logged, low priority.
- **Beyond-S4 optimizer investment** — the *multi-solver capability* (registry + ≥2 solvers + adapters) is IN S4. What's excluded is the **perpetual tuning**: solver performance engineering (search tuning, decomposition, symmetry-breaking), adding *more* solvers, multi-objective/Pareto exploration, continuous re-optimization with stability, optimizer-depth explainability. These are an ongoing investment with no done-state — a capability you keep improving, not a layer you complete.
- Configurable *constraint types by customers* — behavioral, out (see §0 boundary); enabled-as-a-bounded-extension by S1's expression vocabulary, but not built here.

> **S4 scope risk (flag now, not at S4):** S4's definition-of-done ("fast enough for the target problem size") depends on a problem size we haven't characterized. Whether CP-SAT/the hybrid closes Magna's real problem within the time budget is **empirical** — answerable only against realistic data volumes. S4 may reveal that the target needs decomposition or a different solver mix, pushing work that *feels* like S4 into beyond-S4. S4 is the one layer whose scope can't be fully bounded until profiled against real data.

---

## 4. Layer-by-layer decisions to confirm (previews — each layer gets a full scope doc)

- **S0:** line-vs-resource_group reconciliation model; does a resource move to line-as-required or line-as-optional-initially; the cascade rung wiring.
- **S1:** the declarative constraint interface shape (predicate → degree-of-violation); the two-backend contract; where resolved-config snapshots into the audit trace; the byte-identical extraction proof.
- **S2:** rule-data homes (config cascade vs master-data matrix) per constraint; the cross-resource state model for single-location.
- **S3:** alternate-routing selection semantics; JIS obligation model.
- **S4:** the `external_solver` binding shape; solver-policy config; heuristic/CP-SAT division of labor.

---

*This plan is the frame. Each layer (S0 first) gets its own ground-truth pass → scope doc → build brief, same discipline as the Master Data arc. Sign off the plan shape + the S0-first sequence, and we start S0's ground-truth pass.*
