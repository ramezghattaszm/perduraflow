# Scheduling S1.4 scope — the D6 resolved-constraint-set audit snapshot (S1 closes here)

| | |
|---|---|
| **Layer** | Scheduling production-completion · S1.4 — the last S1 sub-phase; determinism ⇄ audit convergence |
| **Written against** | Actual repo state @ `5f9feb5` (S1.1/S1.2/S1.3 closed; `ConstraintPolicyResolution` is first-class, built for exactly this) |
| **Governed by** | `SCHEDULING-S1-SCOPE.md` §3 (S1.4); `SCHEDULING-S1.3-SCOPE.md` D-S1.3-7 |
| **Gate** | The three proofs + config SHA (all still apply) **+ a new replay/reconstruction proof** |
| **Locked** | **D-S1.4-1 = content-addressed `constraint_set` table + `schedule_version.constraint_set_ref`**; **D-S1.4-2 = the determinism key ALWAYS includes the resolved-set token** (accepting a one-time what-if cache invalidation) |

> **The finding that shapes S1.4 — there is a second half the plan does not name.** S1.4 is not only "snapshot the resolved set for audit." **S1.3 made application mode *resolved config*, and the what-if determinism key does not know about it.** `whatif.service.ts:884` hashes `baseVersionId, changeSet, items[], overlayDigest, downtimeDigest, weightSetVersion, baseInputsDigest` — it already carries the **objective** token (`weightSetVersion`) but **no constraint-set or mode token whatsoever**. So a mode change would **not bust the cache**: a result computed under the *old* policy replays as if current. The codebase already documents this exact bug class, in the `downtimeDigest` comment directly above:
>
> > *"Without this, every line-down window hashes identically → the first result is replayed for all of them (a stale cache that disagrees with solve)."*
>
> Same failure, new axis. **Capture without the determinism key is an audit record of a plan the cache may contradict.** The two halves are one layer.

---

## 1. What ground truth settled (repo @ `5f9feb5`)

- **`schedule_version`** (`schema/schedule.schema.ts:41–63`): `id, tenantId, plantId, status, horizonStart/End, optimizerRunId, supersedesVersionId, masterDataAsof, createdAt`. **No `constraint_set_ref`** → a migration is required.
- **The pattern to mirror already exists.** `masterDataAsof` is *"a deliberate, recorded anchor — reconstruction replays THIS value, never re-defaults to now"*: **written at solve** (`scheduling.service.ts:683`, `masterDataAsof: startedAt`) and **read back at replay** (`simulator.service.ts:133`, `version.masterDataAsof ?? new Date()`). `constraint_set_ref` is its sibling — record it, replay it, never re-resolve it.
- **`optimizer_run`** carries run provenance (trigger, objectiveSummary, status, timings, `inputDemandCount`) but **no config/constraint provenance**.
- **The determinism key is the what-if cache key** (`what_if_result.determinism_key`) — see the finding above. It carries `weightSetVersion`, not the constraint set.
- **`ConstraintPolicyResolution`** (S1.3 / D-S1.3-7) is the per-line pre-resolved policy map + `resourceId→lineId` lookup, already a first-class object **precisely so D6 can snapshot it**.
- **Inert today:** `CONSTRAINT_POLICIES` is empty → the resolved set is empty → every version gets the **same constant empty-set digest**. S1.4 therefore lands inert on the plan.

---

## 2. The design

**(A) The snapshot — content-addressed (D-S1.4-1).**
- New `constraint_set` table keyed by a **digest of the canonical resolved set** (immutable, dedup'd — most versions share one set).
- `schedule_version.constraint_set_ref` → that digest/id. Written **at commit**, alongside `masterDataAsof`.
- **Contents (D-S1.4-3, proposed):** the **resolved policies per scope** (the `ConstraintPolicyResolution` — per constraint: mode + threshold/params, resolved per `line`), **plus the registry identity** (which constraints exist + their `vocabularyVersion`). A set that records *modes* but not *which constraints existed* cannot be replayed.
- **Weights stay orthogonal:** `weightSetVersion` already pins the objective. Do **not** fold it into `constraint_set_ref` — but **both** must feed the determinism key (below).
- **"Did policy drift between versions?" becomes an id compare** — the point of content-addressing.

**(B) The determinism key (D-S1.4-2).**
- The resolved-set token joins `weightSetVersion` in `whatif.service.determinismKey(...)`, **unconditionally**.
- While inert the token is a **constant**, so keys shift **once** and then stay stable. **Accepted cost:** a one-time what-if cache invalidation (a miss just recomputes) and a re-pin of any key-pinned test. Chosen over "omit when empty" because the key must distinguish *empty set* from *no set*, and a clever special case would mislead a future reader.

**(C) Reconstruction (D-S1.4-4, proposed).** Replay **reads the recorded `constraint_set_ref`** and resolves against *that* set — **never re-resolves from current config** (exactly the `masterDataAsof` contract). Because mode + enablement are resolved config, **the resolved set is part of the determinism key**: a replay that resolves a different set is a different plan, and must be detectable, not silent.

---

## 3. Sub-phases — three commits (D-S1.4-5, proposed)

1. **Commit 1 — the snapshot.** Migration (`constraint_set` table + `schedule_version.constraint_set_ref`); canonical serialization of `ConstraintPolicyResolution` + registry identity; capture at commit; replay reads the recorded ref (mirror `masterDataAsof`). **Inert:** empty set → a constant digest on every version. Gate: three proofs + config SHA (plan unchanged).
2. **Commit 2 — the determinism key.** Thread the resolved-set token into `determinismKey(...)` alongside `weightSetVersion`. **One-time cache invalidation**; re-pin key-pinned tests. Gate: three proofs + config SHA; the key changes **once** and is then stable.
3. **Commit 3 — close-out (S1 CLOSES).** Permanent tests: a replay resolves the **same** set; a **synthetic mode change** (off the demo) produces both a **different `constraint_set_ref`** *and* a **different determinism key** — the proof that capture and cache agree. REMAINING-ITEMS: S1.4 built + **S1 complete**; docs synced; honesty framing held.

---

## 4. Decisions

| ID | Decision | Status |
|---|---|---|
| **D-S1.4-1** | Snapshot storage | **LOCKED — content-addressed `constraint_set` table + `schedule_version.constraint_set_ref`.** Dedup; drift-detection is an id compare; immutable/auditable. |
| **D-S1.4-2** | Determinism key | **LOCKED — always include the resolved-set token** (constant while inert). Accepts a one-time what-if cache invalidation over a fragile omit-when-empty special case. |
| **D-S1.4-3** | Set contents | **Proposed — resolved policies per scope + registry identity** (constraint ids + `vocabularyVersion`). Weights stay orthogonal (`weightSetVersion`), but **both** feed the determinism key. |
| **D-S1.4-4** | Reconstruction | **Proposed — replay reads the recorded ref, never re-resolves** (the `masterDataAsof` contract). |
| **D-S1.4-5** | Commit split | **Proposed — three commits** (snapshot / determinism key / close-out). |

---

## 5. Definition of done

- The resolved constraint set is snapshotted, content-addressed, onto every committed `schedule_version` (`constraint_set_ref`).
- The resolved-set token is **in the determinism key** — a mode change busts the what-if cache (proven with a synthetic mode, off the demo).
- Reconstruction replays the **recorded** set, never a re-resolved one.
- Three proofs + config SHA green; plan byte-identical (empty set → constant digest); `demo:reset` green.
- **S1 CLOSES.** Honesty marker: S1.4 changed *what is captured and what invalidates the cache*, **not behavior** — no constraint carries a mode yet (D28/D8 → S2; D9/D11/JIS → S2/S3).

## 6. Scope boundary

**Out:** any *new* constraint (S2/S3); the §4.11 disposition record (independent/early); the CP-SAT engine (S4). S1.4 is **capture + determinism only.**

> **Risk honesty:** the audit half is low-risk (a new column + an inert constant digest). **The determinism-key half is where the danger is** — it changes a cache key every what-if result is addressed by. A mistake there does not corrupt the plan; it silently serves a *stale* one. That is precisely the failure the `downtimeDigest` comment already records, and the reason S1.4 is one layer, not two.

---

*Confirm D-S1.4-3/4/5 (1–2 locked). Then the S1.4 build brief — Commit 1 (the snapshot) first.*
