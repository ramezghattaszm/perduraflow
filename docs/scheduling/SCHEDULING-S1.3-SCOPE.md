# Scheduling S1.3 scope — hard/soft/slack as resolved config + the objective bridge

| | |
|---|---|
| **Layer** | Scheduling production-completion · S1.3 — application mode as resolved config; the objective opened to registered constraints |
| **Written against** | Actual repo state @ `9a761ef` (S1.1 + S1.2 closed: the registry owns the loop; the veto primitive + tool-state exist, inert) |
| **Governed by** | `SCHEDULING-S1-SCOPE.md` §3 (S1.3) + D-S1-6; `CONFIG-FRAMEWORK-DESIGN.md`; `WEIGHT-CONFIG-DESIGN.md` (the dominance guard) |
| **Gate** | Propose-then-confirm; **TWO byte-identical proofs** (see §3) — the plan digest alone is insufficient here |
| **Locked** | **D-S1-6 = Option B (fully keyed objective)** — one uniform, registry-driven weight/factor structure; the 6 built-ins become pre-registered entries. Chosen for build-to-completion: it is the shape that does not get rebuilt when config/customer-authored constraints eventually carry weights. |

> **The finding that shapes S1.3:** the objective is closed in **four places at once** — `RationaleFactorKey` (6-member union, `scheduling.ts:690`), `ObjectiveWeights` (6-field interface, `config.ts:218`), `scorePlan`'s **hardcoded 6-element `factors` array** (`whatif.scoring.ts:133–148`), and the `objective` config group's `fields: OBJECTIVE_WEIGHT_KEYS.map(...)` (`config.groups.ts:61`). A registered soft constraint has nowhere to put its violation degree. Meanwhile **hard is reported but never enforced** — the only `hard` `ConstraintBinding` (`feasibility`) has `binding: false` **hardcoded** (`whatif.scoring.ts:157`). S1.2 built the veto primitive, so hard-mode finally has a landing place: **the two design problems are one problem.**

---

## 1. What ground truth settled

- **The objective's closed shape is 4 coupled edits**, and it crosses the **contracts boundary** → clients. Blast radius: `packages/contracts/src/{scheduling,config}.ts`; `apps/api/.../{whatif.scoring,whatif.service,scheduling.service}.ts`; `apps/api/src/modules/config/{config.groups,config-read.service}.ts`; `packages/app/features/configuration/configuration-screen.tsx`.
- **The dominance guard is a correctness coupling, not a typing nit.** `firmLatenessDominates(w: ObjectiveWeights)` enforces `lateness ≥ FIRM_LATENESS_DOMINANCE_RATIO(2) × every other weight`, typed on `keyof ObjectiveWeights`. If registered constraints can carry weights, a soft constraint could out-weigh firm lateness and silently break firm-delivery dominance (D13/D23).
- **The `line` rung is realized but deliberately dormant.** `configLevelSchema = ['global','tenant','plant','line']`; `config.service.ts:57` — *"No config caller threads a `lineId` in S0 (line depth is S1) → the line rung is inert."* **S1.3 is its first real consumer.** `resolveObjective(tenantId, plantId?)` has **no `lineId` param** yet. `config.resolve.spec.ts` already proves *lineId-absent vs threaded-but-null → identical SHA* — the inertness guard to lean on.
- **The config group descriptor is itself closed.** `ConfigGroupDescriptor.fields: GroupFieldSpec[]` is a **static list of scalar fields**. Option B's registry-derived weights *and* a per-constraint mode map both need **registry-derived / keyed** group fields — the same closed-shape problem, in the config framework.
- **`solve()` does not use `scorePlan`.** The committed-plan digest is produced by the sequencer; `scorePlan` is the **what-if objective**. So an objective-shape change can leave the plan byte-identical while silently changing option scores/rationale. **The plan digest alone cannot gate S1.3.**

---

## 2. The design (build-to-completion)

**Objective — Option B, fully keyed.** One registry-driven structure:
- `ObjectiveWeights` → a **keyed map** (`Record<string, number>`); `RationaleFactorKey` → registry-derived (string-keyed), **Zod-validated at the config boundary** to recover the safety the closed union gave.
- The **six built-ins become pre-registered entries** (`lateness`, `changeover`, `overtime`, `inventory`, `displacement`, `cost`) — same keys, same defaults (`OBJECTIVE_DEFAULTS`, `aps-w2`), same contributions. One mechanism, no built-in/registered split.
- `scorePlan` **derives** its factor list from the registry instead of a hardcoded array. With only the six registered, it must produce **identical factors, rawValues, weights, contributions, and score**.
- The `objective` config group's `fields` **derive from the registry**; the UI weights panel derives from it too (no hardcoded field list).
- **The dominance guard generalizes to every registered weight** (D-S1.3-2) — a soft constraint out-weighing firm lateness is a correctness failure, not a config preference.

**Application mode as resolved config.** A new config group carries, **per constraint id**, its mode `hard | soft | hard-with-slack` (+ a slack threshold where applicable), resolving the full ladder **`global → tenant → plant → line`** (the S0 rung's first real consumer; `lineId` threaded into config resolution).

**The mode → behavior bridge (the point of the layer):**
- **soft** → the constraint's violation **degree** becomes an objective factor (via the keyed structure) + an honest `ConstraintBinding`.
- **hard** → the violation routes to **S1.2's veto primitive** (`preplaceVeto` / `feasibilityReject`) — hard is finally *enforced*, not just reported. The hardcoded `binding: false` becomes an honest verdict.
- **hard-with-slack** → veto only past the **resolved threshold**.

**Inert by default.** No constraint is registered with a mode (D28/D9/JIS are S2/S3), and no line-level override is seeded → the bridge has nothing to apply, the veto stays unregistered, config resolves exactly as today.

---

## 3. The gate — TWO byte-identical proofs (the plan digest is NOT sufficient)

1. **Committed plan** — `solve()` untouched: 1043 ops, identical digest **same-clock old-vs-new** (never against a stored digest — it is date-sensitive).
2. **What-if objective outputs** — `scorePlan` reshaped but **numerically identical**: for the demo scenarios, the same **factors (all six, same order), rawValues, weights, contributions, score, rationale, and `ConstraintBinding`s**. This is where an Option-B regression would actually surface, and proof (1) would happily stay green through it.

Plus: config resolution identical (`lineId` threaded-but-no-line-data → identical SHA, the existing spec); determinism preserved; `demo:reset` green.

---

## 4. Sub-phases — four commits (each proven before the next)

1. **Commit 1 — open the objective (Option B).** Registry-driven weights/factors; the six built-ins pre-registered; `scorePlan` derives its factor list; dominance guard generalized; config group fields + UI panel derive from the registry; Zod at the boundary. **Gate: both proofs — especially (2), identical scores/factors/rationale.**
2. **Commit 2 — the constraint-policy config group.** Per-constraint `mode` (+ threshold) resolving `global→tenant→plant→line`; thread `lineId`. **Inert** (nothing registered, no line override seeded) → both proofs.
3. **Commit 3 — the mode → behavior bridge.** soft → objective factor + honest `ConstraintBinding`; hard → the S1.2 veto; hard-with-slack → threshold veto. Still **inert with default config**. → both proofs.
4. **Commit 4 — close-out.** Inertness/honesty guards as permanent tests (no constraint carries a mode yet; hard-enforcement path exists but is unexercised); determinism; REMAINING-ITEMS S1.3 built (SHAs); docs synced.

---

## 5. Decisions

| ID | Decision | Status |
|---|---|---|
| **D-S1-6 / D-S1.3-1** | Objective closed-shape | **LOCKED — Option B (fully keyed / registry-driven)**; the six built-ins become pre-registered entries; Zod at the config boundary recovers type safety. |
| **D-S1.3-2** | Dominance guard scope | **LOCKED + BUILT (`ac57689`) — applies to EVERY registered weight** (the guard iterates the registry with the registry's dominant key). A soft constraint out-weighing firm lateness is rejected. |
| **D-S1.3-3** | Config group descriptor | **LOCKED + BUILT (`0523e78`) — registry-derived/keyed fields**; the `constraint_policy` group derives `<id>.mode`/`<id>.threshold` per registered constraint (empty → field-less/inert). |
| **D-S1.3-4** | The gate | **LOCKED + BUILT — THREE proofs** (committed plan + objective scoring surface + comparative/narration surface). Proof (3) added at Commit 0b after the comparative blind spot was found. |
| **D-S1.3-5** | Commit split | **LOCKED + BUILT — 0/0b/1/2/3/4** (harnesses / objective / policy group / bridge / close-out), each proven before the next. |
| **D-S1.3-6** | Line rung | **LOCKED — `lineId` threaded** into config resolution (S1.3 is the rung's first consumer); inert **by data** (no line override seeded), guarded by the existing identical-SHA spec. |
| **D-S1.3-7** | Mode resolution strategy | **LOCKED — pre-resolved `lineId → ResolvedConstraintPolicy` map**, built once per solve and threaded into `sequence()`; the sequencer looks up a mode by the placed resource's line (resources carry a line, S0a). **Not** per-op resolution — async I/O in the placement loop would break purity/determinism. The map is also the object **S1.4's D6 snapshot captures** (the resolved set is part of the determinism key). Inert: empty registry → empty map → the lookup never fires. |
| **D-S1.3-8** | Config regression lock | **LOCKED — pin PER-GROUP digests, not one aggregate.** The single aggregate SHA forces a re-pin whenever a group is added, and a re-pin is where a change to an *existing* group can hide behind "it's just the new one." Per-group pins make re-pins surgical. (Fold into Commit 4.) |

---

## 6. Definition of done

- The objective is registry-driven and keyed; the six built-ins are pre-registered and produce **numerically identical** factors/score/rationale; the dominance guard covers every registered weight.
- Constraint application mode (`hard`/`soft`/`hard-with-slack` + threshold) resolves `global→tenant→plant→line`; soft→objective factor, hard→veto (S1.2), slack→threshold-veto.
- **Both byte-identical proofs green** at each commit with default config; `demo:reset` green; determinism preserved.
- Honesty marker: S1.3 changed *how policy is expressed and enforced*, **not behavior** — no constraint carries a mode yet (D28/D9/JIS are S2/S3).

## 7. Scope boundary

**Out:** any *new* constraint (D28/D9/D8 → S2; D11/JIS → S3); the D6 resolved-set audit snapshot (**S1.4** — it consumes this layer's resolved modes); the CP-SAT engine (S4); customer-*authored* constraint types (the keyed shape enables it; the authoring surface is not built).

> **Risk honesty:** S1.3's danger is **not** the plan — it is the **objective**. Option B reshapes the scoring path that produces every what-if option, rationale, and recommendation the demo narrates. A regression here is invisible to the 1043-op digest. Proof (2) is therefore the load-bearing gate, and the `firmLatenessDominates` generalization is the load-bearing correctness check.

---

*BUILT — Commit 0 `d703f7f` / 0b `070effc` (harnesses), 1 `ac57689` (open the objective), 2 `0523e78` (mode group + line rung), 3 `1f00cdd` (bridge), 4 `54eab21` close-out ( seam assertion, per-group digests, runtime registered-key + one-dominant invariants, permanent line/dominance tests). All INERT — no constraint carries a mode; hard/soft/slack is a capability, not in use. Three proofs byte-identical. First consumers: D28/D8 (S2), D9/D11/JIS (S2/S3). Pending: S1.4 (D6 audit snapshot — consumes `ConstraintPolicyResolution`).*
