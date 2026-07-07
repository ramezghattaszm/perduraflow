# Claude Code build brief — Config reference-set enhancement

| | |
|---|---|
| **Companion (authority)** | `docs/config/CONFIG-REFERENCE-SET-SCOPE.md` + `docs/platform/PLATFORM-CONFIGURABLE-REFERENCE-SETS.md` — read both first |
| **Decisions** | D-CFG-1…5 **LOCKED**; walker=(b) shared; suppression=add+suppress-if-unused; `asset_type`→2b; contract=new `reference.read 1.0` |
| **Discipline** | Commit-per-part; git lifecycle explicit; **stop-and-report at each checkpoint**; change nothing outside this brief |
| **Boundary** | O1–O8. This lives in the **`config` module** (O2). No cross-schema FK. Reference sets ride config's substrate. |

> **Risk posture:** the one dangerous commit is **Commit 1** — it reopens config's verified `resolve()`. That commit is a **pure refactor** whose only acceptance is *byte-identical* behavior of the four live groups (values + provenance + **determinism version tokens**). Everything after is additive. `asset_type` is **NOT** built here (2b) — only a **test-only reference set** proves the mechanism.

> **Out of scope — do NOT build:** `asset_type` registration/consumption (2b), deeper ladder rungs (no containment entity exists), deep/nested merge, touching `resource_type_config`/`part_plant`/UoM-const, any behavioral enum.

---

## Commit 1 — extract the shared scope-path walker (PURE REFACTOR; byte-identical gate)
- Refactor config's `resolve()` into: `scopePath(context) → orderedLevelRows` (ladder-driven over a level list `[global, tenant, plant]`) + a `scalarFold(rows, descriptor)` carrying the **exact existing** per-field first-non-null cascade **and per-field provenance**.
- `resolveObjective/Reporting/Autonomy/KpiPolicy` now call `scalarFold` over `scopePath` — no behavior change.
- **NO new content kind yet.** This commit only proves the extraction is inert.
- **Acceptance (the gate):** a fixture asserts the four groups resolve **byte-identical pre/post** across global-only / tenant-override / plant-override / mixed-provenance cases — **including the determinism version tokens** (`obj:p<rev>/obj:t<rev>/…`), since those feed the scheduler determinism key. Diff must be empty.
- **Report:** the refactor diff; the byte-identical proof (values + provenance + tokens) across all four cases; full suite green; `demo:reset` + a schedule build unchanged (determinism key stable).
- **STOP.** This is the one that can silently break scheduling reproducibility — do not proceed until the token-equality proof is shown.

## Commit 2 — reference-set descriptor + storage + membership fold
- **Descriptor** (registered into config, mirroring group descriptors): `set_key`, `platform_defaults[]`, `declared_levels`, `resolution_mode` (`replace`|`merge`), optional `member_guard`, and an **`in_use(tenantId, memberKey)` probe hook** (interface only — no set registers one yet).
- **Storage (D-CFG-2):** reuse the `config_override` shape — `(tenant, set_key, level, scopeId, payload)` where `payload` holds member contributions + tombstones (sparse, revisioned). If member-metadata makes the shared payload awkward, **stop and report** before diverging to a dedicated table.
- **`membershipFold(rows, descriptor)`:** platform defaults → apply each level up the path (add/override members, apply tombstones) → most-specific-wins → omit suppressed. `replace` union for scalar/list sets; `merge` = N-level generalization of Layer-1 shallow key-merge (nested-deep deferred).
- Register a **test-only reference set** (e.g. `set_key='__test_refset'`, defaults `[a,b,c]`, `{global,tenant}`, `replace`) to exercise the mechanism — no domain consumer.
- **Report:** schema/descriptor diff; tests — add member, override metadata, resolve union across levels, `merge`-mode key-merge; the test-set resolves correctly.

## Commit 3 — suppression (tombstone) + in-use probe gate
- Tenant tombstone suppresses an inherited default; resolver omits it; restore = remove tombstone.
- **Write-path gate:** before accepting a suppression, call the descriptor's `in_use(tenant, memberKey)` probe; if true → typed `REFERENCE_VALUE_IN_USE`. (The test-set's probe returns a controllable value for the test.)
- **Report:** tests — suppress hides an inherited default; restore brings it back; **suppression rejected when the probe reports in-use**; add-only path never invokes the probe.

## Commit 4 — `reference.read 1.0` contract + guarded admin CRUD + audit
- **New `reference.read 1.0`** (D-CFG-5): `resolveReferenceSet(tenantId, setKey, {plantId?}) → { members[] }` (resolved, suppression-applied), `listReferenceSets()`. Register at the composition root; O7-bound.
- **Admin CRUD** mirroring config's controller: `GET` auth-only; add-member / override / suppress / restore behind `ConfigureGuard`, tenant-scoped (`assertScope`). Suppress runs the probe.
- **Audit:** reuse `config_audit` shape — one row per member change (add/override/suppress/restore), `changedBy` = JWT sub, append-only.
- Confirm no consumer pins `=` any contract version (float-minor, as prior layers).
- **Report:** contract diff + pin-check; the guard-coverage (all mutations behind `ConfigureGuard`); an audit row per member change; `reference.read` resolves via the binding.

## Commit 5 — re-seed + verification + close-out
- Reset-flow: any new constraint present after `demo:reset`.
- Re-seed: the test-set defaults (and any tenant override/tombstone to exercise resolution) — idempotent. **No `asset_type`.**
- **Full-DoD sweep** (scope §8) line-by-line with evidence — the Commit-1 byte-identical proof is the headline line.
- **Docs close-out:** sync repo scope + platform doc to decisions; REMAINING-ITEMS — close the enhancement with shas; log the reconcile-later precursors (`part_plant`, `resource_type_config`, UoM-const, inert enums) and the **`asset_type`-registers-in-2b** carry-forward (descriptor + probe together).
- **Report:** post-reset check; the §8 DoD sweep; existing config-driven behavior (objective/reporting/autonomy/KPI) unchanged end-to-end; docs/REMAINING-ITEMS done.

---

## Acceptance gate (scope §8)
Headline: **Commit-1 byte-identical proof (values + provenance + determinism tokens).** Plus: membership fold (replace + merge); suppression + in-use gate; `reference.read 1.0` + guarded CRUD + member audit; ladder realized `global→tenant→plant` only; precursors untouched; existing config behavior unchanged.

## Stop conditions (report, don't improvise)
- Commit-1 extraction changes any group's value, provenance, or determinism token → **stop** (extraction is not inert).
- `config_override` payload can't cleanly hold member metadata + tombstones → **stop and report** before diverging to a dedicated table.
- Any work reaches `asset_type`, a deeper ladder rung, `resource_type_config`, `part_plant`, or a behavioral enum → **stop** (out of scope).
- A reference set would register without an in-use probe while allowing suppression → **stop** (the safety invariant: no suppressable set without a probe).
