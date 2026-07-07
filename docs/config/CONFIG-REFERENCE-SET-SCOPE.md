# Config — reference-set enhancement scope

| | |
|---|---|
| **Layer** | Config-module enhancement — sequenced **before** Master Data 2a/2b (foundational; MD 2b consumes `asset_type`) |
| **Written against** | Actual repo state (Claude Code config ground-truth report) |
| **Governed by** | `docs/platform/PLATFORM-CONFIGURABLE-REFERENCE-SETS.md` — read first (ownership, ladder reality, folds, suppression) |
| **Gate** | Propose-then-confirm — **no build until sign-off** |
| **Decisions locked** | Ownership = `config`; walker = **(b) one shared walker, pluggable fold**; suppression = **add + suppress-if-unused**; ladder realized = `global→tenant→plant` only |

> **What this is.** The `config` module already does the scope cascade (per-field scalar overrides, provenance, revision, reset-to-parent, field-level audit, O7 binding). This adds a **second content kind — reference sets** (keyed collections a tenant extends/suppresses) — riding the same substrate, via a shared scope-path walker with a pluggable fold. `asset_type` is registered/seeded here; its *consumption* is Master Data 2b.

---

## 1. What ground truth settled

- Config = **override-table + audit**, no value-table (global is the in-code descriptor default, never stored). `config_override` (sparse `payload` jsonb per `(tenant, group, level, scopeId)`) + append-only `config_audit` (one row per changed field).
- `resolve()` is a **two-fetch hardcoded cascade** (tenant row, plant row) → per-field first-non-null + per-field provenance. **Not** a generic N-level walk.
- `config.read 1.0` is a provided service (O7 binding), exposing **group-typed** `resolve*` ops (not a generic get).
- Write path: known-field validation → sparse merge → **group guard** on the effective set → insert/rev-bump → **field-level audit**. Guards: `JwtAuthGuard` (GET) + `ConfigureGuard` (mutations), tenant-scoped from JWT.
- `resource_type_config` = flat keyed-metadata reference set (no cascade) — a precursor (platform doc §5), **not touched here**.

---

## 2. Scope boundary

**In:** the shared scope-path walker (pure extraction of the scalar cascade + a new membership fold); the reference-set descriptor + storage + resolution; suppression (tombstone) + the in-use referential gate; `reference.read` contract ops + guarded admin CRUD + audit; `asset_type` registered + seeded as the first descriptor.

**Out:** `asset_type` *consumption* (`tooling_asset` validation) → MD 2b. Deeper ladder rungs (`line`/`work_center`) — no containment entity exists (platform doc §3.4). Deep/nested merge mode. Reconciling `part_plant`/`resource_type_config`/UoM-const onto the mechanism (documented futures). Behavioral enums (`make_buy`, status) — stay closed.

---

## 3. Decisions to confirm

| ID | Decision | Recommendation |
|---|---|---|
| **D-CFG-1** | Shared walker extraction | **Extract one scope-path walker** producing ordered level rows; the scalar-field fold is the **existing config behavior, pure-extracted**; the membership fold is new. **Non-negotiable safety gate: the four live groups resolve byte-identical (values + provenance + determinism version tokens).** |
| **D-CFG-2** | Reference-set storage | **Reuse the `config_override` shape** where possible — a reference set is `(tenant, set_key, level, scopeId, payload)` where `payload` holds the level's member contributions + tombstones. Keeps one storage + audit substrate. (Alternative: a dedicated `reference_set_value` table — rejected unless the payload model proves too awkward for member metadata; flag if so.) |
| **D-CFG-3** | Membership fold + suppression | Union members platform→tenant→plant; most-specific-wins on key collision; **tombstone suppresses** an inherited member; **suppression rejected if the value is in use** (typed error, write-path check). |
| **D-CFG-4** | Descriptor ownership | Set **descriptors** (`set_key`, platform defaults, declared depth, resolution mode, optional cross-field guard) are **registered into config** by the owning domain module — like config's existing group descriptors. `asset_type`'s descriptor is registered here for the substrate build; MD owns it conceptually. |
| **D-CFG-5** | Contract shape | **New `reference.read` capability** (or extend `config.read`) exposing `resolveReferenceSet(tenantId, setKey, { plantId? }) → { members[] }` (resolved, suppression-applied). Recommend a **new `reference.read 1.0`** rather than bloating `config.read`'s group-typed surface — reference sets are a distinct content kind. Confirm. |

---

## 4. The shared walker (D-CFG-1) — pure extraction

Refactor config's `resolve()` into:
- **`scopePath(context) → orderedLevelRows`** — walks the realizable ladder (`global→tenant→plant`) driven by a level list, returning each level's stored row (or descriptor default for global). Ladder-driven so a future rung is additive (platform doc §3.1).
- **fold plug** — `scalarFold(rows, descriptor)` (existing per-field first-non-null + provenance) and `membershipFold(rows, descriptor)` (new, §5).
- Existing `resolveObjective/Reporting/Autonomy/KpiPolicy` call `scalarFold` over `scopePath` — **behavior identical.**

**Proof required (the gate):** a fixture asserting the four live groups + their determinism version tokens (`obj:p<rev>/obj:t<rev>/…`) are byte-identical pre- and post-extraction, across global-only / tenant-override / plant-override / mixed-provenance cases. This is the inertness proof; (b) is only safe if this holds.

---

## 5. Reference sets — descriptor, storage, fold, suppression

**Descriptor** (registered into config): `set_key`, `platform_defaults[]` (seeded members + metadata), `declared_levels` (e.g. `{global, tenant}` for `asset_type`), `resolution_mode` (`replace`|`merge`), optional `member_guard`.

**Storage** (D-CFG-2): per `(tenant, set_key, level, scopeId)`, a `payload` holding: added/overridden members (key → metadata) + tombstones (key → suppressed). Sparse, like config groups. Revisioned + field(member)-level audit reusing `config_audit`'s shape (member key as the audited unit).

**Membership fold:** start from platform defaults → apply each level up the path (add/override members, apply tombstones) → most-specific-wins on collision → **omit suppressed** → return resolved members. `asset_type` uses `replace`/union; map-like sets use `merge` (N-level generalization of Layer-1 shallow key-merge; nested-deep deferred).

**Suppression + in-use gate (D-CFG-3):** a tenant tombstone hides an inherited default. **Write-path check:** before accepting a suppression, verify no in-use reference — but config **can't know** who references a set (that's the consumer's data). So the descriptor carries an **`in_use(tenantId, memberKey) → boolean` probe** the owning module implements (for `asset_type`: "any `tooling_asset` with this type?"). Suppression rejected with a typed `REFERENCE_VALUE_IN_USE` if the probe returns true. **This probe is the one cross-module seam** — flagged: it means the owning module registers both a descriptor *and* an in-use probe.

---

## 6. Contract + admin CRUD + audit

- **`reference.read 1.0`** (D-CFG-5): `resolveReferenceSet(tenantId, setKey, {plantId?})`, `listReferenceSets()`. O7-bound like `config.read`.
- **Admin CRUD** mirrors config's controller pattern: `GET` auth-only; add-member / override / suppress / restore behind `ConfigureGuard`, tenant-scoped from JWT (`assertScope`). Suppress runs the in-use probe.
- **Audit:** reuse `config_audit` shape — one row per member change (add/override/suppress/restore), `oldValue/newValue` = member metadata or suppression flag, `changedBy` = JWT sub.

---

## 7. `asset_type` — first descriptor (registered here, consumed in 2b)

- Descriptor registered: `set_key='asset_type'`, defaults `[tool, die, mold, fixture]`, `declared_levels={global, tenant}`, mode `replace`, in-use probe = (implemented in MD 2b — stub/absent here means suppression of a default is allowed until 2b wires the probe; **flag:** either land the probe with 2b before any tenant suppresses, or register `asset_type` in 2b, not here).
- **Sequencing note:** because the in-use probe belongs to the `tooling_asset` consumer (2b), registering `asset_type`'s *descriptor* here but its *probe* in 2b creates a window where suppression can't be safely gated. **Recommend:** build the substrate + a **test-only reference set** here to prove the mechanism; register `asset_type` (descriptor + probe together) in 2b. Confirm this over registering `asset_type` now.

---

## 8. Definition of done

- [ ] Shared scope-path walker extracted; **four live config groups byte-identical (values + provenance + determinism tokens)** — the inertness proof passes.
- [ ] Reference-set descriptor + storage + membership fold built; `replace` and `merge` modes; sparse per-level payload.
- [ ] Suppression via tombstone; **in-use probe gate** rejects suppressing a referenced value (`REFERENCE_VALUE_IN_USE`).
- [ ] `reference.read 1.0` + guarded admin CRUD + member-level audit (reusing `config_audit`).
- [ ] Ladder realized `global→tenant→plant`; walk is ladder-driven (future rung additive); no speculative rung built.
- [ ] `resource_type_config`/`part_plant` untouched (reconcile-later); behavioral enums untouched.
- [ ] `demo:reset` green; existing config-driven behavior (objective weights, reporting, autonomy, KPI) unchanged end-to-end.

---

*Sign off (or redirect) D-CFG-1…5 + the `asset_type`-in-2b sequencing (§7) — especially D-CFG-1 (the pure-extraction gate) and D-CFG-5 (new `reference.read` vs extend `config.read`) — and I'll write the build brief.*
