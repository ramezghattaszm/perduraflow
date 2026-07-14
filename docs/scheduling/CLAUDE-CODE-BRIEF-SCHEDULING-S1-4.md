# Claude Code build brief — Scheduling S1.4 (the D6 resolved-constraint-set audit snapshot) — **S1 closes here**

| | |
|---|---|
| **Companion (authority)** | `docs/scheduling/SCHEDULING-S1.4-SCOPE.md` — read first; the "second half" finding |
| **Also read** | `SCHEDULING-S1-SCOPE.md` §3 (S1.4); `SCHEDULING-S1.3-SCOPE.md` D-S1.3-7 (`ConstraintPolicyResolution` — the object this snapshots) |
| **Decisions** | D-S1.4-1…5 **LOCKED** (scope §4) |
| **Scope of THIS brief** | **S1.4 only** — capture + determinism. **No new constraint** (D28/D8 → S2; D9/D11/JIS → S2/S3), no §4.11 disposition, no CP-SAT. |
| **Discipline** | **Commit-by-commit; gates green before the next moves.** Stop-and-report each. |
| **Repo base** | `5f9feb5` (S1.1/S1.2/S1.3 closed) |

> **⚠ THE RISK IS INVERTED FROM WHAT "AUDIT SNAPSHOT" SUGGESTS.** The capture half (a new table + column + a constant empty-set digest) is nearly risk-free. **The determinism-key half is the dangerous one.** S1.3 made application mode *resolved config*, but `whatif.service.ts:884` hashes `baseVersionId, changeSet, items[], overlayDigest, downtimeDigest, weightSetVersion, baseInputsDigest` — it carries the **objective** token but **no constraint-set or mode token at all**. So a mode change would **not bust the what-if cache**: a result computed under the *old* policy replays as if current. This is the exact bug the `downtimeDigest` comment directly above it already records — *"Without this, every line-down window hashes identically → the first result is replayed for all of them (a stale cache that disagrees with solve)."* **Capture without the key = an audit record of a plan the cache can contradict.** A mistake here does not corrupt the plan; it silently serves a **stale** one.

> **The gates (every commit):** the **three proofs** — `plan:baseline` (**same-clock old-vs-new**, never a stored digest; it is date-sensitive), `objective:baseline`, `comparative:baseline` — **plus** the per-group config digests. **Plus, from Commit 1, a replay/reconstruction proof.** Any divergence → **STOP**.

---

## Commit 0 — pre-flight (report only)
- Confirm verbatim: `schedule_version` (`schema/schedule.schema.ts:41–63` — no `constraint_set_ref`); the `masterDataAsof` **write** (`scheduling.service.ts:683`) and **replay read** (`simulator.service.ts:133`) — *the pattern to mirror*; `determinismKey(...)` (`whatif.service.ts:884`) and everything it hashes; `ConstraintPolicyResolution` (`constraints/policy-bridge.ts`).
- Capture all three baselines + the config digests same-clock.
- **Report:** the confirmed sites; the baselines; wait for go.

## Commit 1 — the snapshot (content-addressed; inert)
- **Migration:** a `constraint_set` table keyed by a **digest of the canonical resolved set** (immutable, dedup'd — most versions share one set), and `schedule_version.constraint_set_ref` → that id/digest. Nullable for versions built before S1.4 (mirror `masterDataAsof`'s null-tolerance).
- **Canonical serialization (D-S1.4-3):** the resolved **policies per scope** (`ConstraintPolicyResolution` — per constraint: mode + threshold/params, resolved per `line`) **PLUS the registry identity** (which constraints exist + their `vocabularyVersion`). **A set that records modes but not which constraints existed cannot be replayed.** Key-sorted/canonical JSON → stable digest (reuse the harnesses' canonicalization approach).
- **Write at commit**, alongside `masterDataAsof` (`scheduling.service.ts:683`).
- **Reconstruction (D-S1.4-4):** replay **reads the recorded `constraint_set_ref`** and resolves against **that** set — **never re-resolves from current config.** This is the `masterDataAsof` contract (`simulator.service.ts:133`) applied to policy. A replay that would resolve a *different* set must be **detectable, not silent**.
- **Inert:** `CONSTRAINT_POLICIES` is empty → the resolved set is empty → **every version gets the same constant digest**. The plan is untouched.
- **Gate:** three proofs + config digests (plan byte-identical) **+ the replay proof** (a committed version replays against its recorded set).
- **Report:** the migration + serialization + capture/replay diff; the constant empty-set digest; all gates.

## Commit 2 — the determinism key (THE DANGEROUS ONE)
- Thread the **resolved-set token** into `whatif.service.determinismKey(...)` alongside `weightSetVersion` — **unconditionally (D-S1.4-2)**. While inert it is a **constant**, so keys shift **once** and are then stable.
- **Accepted, expected cost:** a **one-time what-if cache invalidation** (existing `what_if_result` rows become unreachable by key — a miss just recomputes; no correctness break) and a **re-pin of any key-pinned test**. Name both explicitly in the report; do **not** let a re-pin quietly absorb anything else.
- **Do NOT** implement "omit the token when the set is empty" — the key must distinguish *empty set* from *no set*, and the special case would mislead a future reader.
- **Gate:** three proofs + config digests + replay proof. The determinism key changes **exactly once** and is then stable across reruns (assert this).
- **Report:** the key diff; the one-time invalidation + every test re-pinned (and **why** each moved); proof the key is stable across reruns.

## Commit 3 — close-out (**S1 CLOSES**)
- **Permanent tests (the ones that make this layer real):**
  - a replay resolves the **same** set as the one recorded;
  - a **synthetic mode change** (off the demo — the registries stay empty) produces **BOTH** a different `constraint_set_ref` **AND** a different determinism key. *This is the proof that capture and cache agree.* A mode change that moves one but not the other is the failure this layer exists to prevent.
- **Honesty guards:** extend the existing ones — nothing carries a mode; the resolved set is empty; the empty-set digest is constant. A future D28/D9/JIS consumer trips them **by design**.
- **Docs:** REMAINING-ITEMS — S1.4 built + **S1 COMPLETE** (SHAs for all four sub-phases). Sync scope + brief. Honesty framing: **S1.4 changed what is captured and what invalidates the cache, not behavior** — no constraint carries a mode; D28/D8 (S2) and D9/D11/JIS (S2/S3) are the first consumers. **Do not let any doc imply hard/soft/slack, single-location, tool-life, or campaign rules are "in use."**
- **Report:** the full sweep (three proofs + config digests + replay); the capture⇄cache agreement test; guards green; suite + 5-workspace typecheck green; SHAs; **S1 closure statement**.

---

## Acceptance gate
The resolved constraint set (policies per scope + registry identity) is content-addressed and snapshotted onto every committed `schedule_version` via `constraint_set_ref`; reconstruction **replays the recorded set and never re-resolves**; the resolved-set token is **in the determinism key**, so a mode change busts the what-if cache (proven with a synthetic mode); the plan is byte-identical (empty set → constant digest); all gates green; **no new behavior**. `demo:reset` green. **S1 closes.**

## Stop conditions (report, don't improvise)
- Any of the three proofs, the config digests, or the replay proof diverges → **STOP**.
- The determinism key changes **more than once**, or is unstable across reruns → **STOP** (the token is not canonical).
- A test re-pin would absorb **anything beyond** the one-time key shift → **STOP** (that is how a real regression hides in a re-pin — see the S1.3 Commit-2 aggregate-digest lesson).
- The snapshot records modes **without** the registry identity → **STOP** (unreplayable).
- Reconstruction **re-resolves** policy from current config instead of reading the recorded ref → **STOP** (that is the `masterDataAsof` contract broken; the audit record becomes a lie).
- A constraint gets registered with a mode, or a line override is seeded into the demo → **STOP** (that is S2/S3).
- Any work reaches a new constraint, §4.11 disposition, or CP-SAT → **STOP**.
