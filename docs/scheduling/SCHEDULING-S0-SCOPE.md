# Scheduling S0 scope — the `line` entity + cascade rung

| | |
|---|---|
| **Layer** | Scheduling production-completion · S0 (foundational — line-level config prerequisite for S1) |
| **Written against** | Actual repo state (S0 ground-truth report) |
| **Governed by** | `docs/platform/SCHEDULING-PRODUCTION-COMPLETION-PLAN.md`; `docs/platform/PLATFORM-CONFIGURABLE-REFERENCE-SETS.md` (the cascade ladder) |
| **Gate** | Propose-then-confirm — no build until sign-off |
| **Locked** | One S0, **two commits** (entity → rung); `resource.line_id` **nullable-permanent, plant = fallback grain**; rung change **proven byte-identical** |

> **Why S0 exists:** `line` is net-new. Resources locate only to `plant` today (`plant_id`; `resourceType='line'` is a *kind*, not a place). S1's per-line constraint config (hard-at-line-A / soft-at-line-B) needs `line` as a **real single-parent containment entity** *and* as a **resolvable cascade rung**. S0 delivers both. This is **platform infrastructure** — the first realized rung below plant on the ladder — not a scheduling-local change.

---

## 1. What ground truth settled

- Resources locate **only to plant** (`resource.plant_id`, O4-validated); no line/cell/area/station field or convention. `resourceType='line'` is a classification (drives `resource_type_config`), **not** a location — disarmed.
- **`resource_group` is a M:N eligibility pool**, orthogonal to location; eligibility flows `routing_operation.resourceGroupId` → group members → `eligibleResourceIds` (`scheduling.service.ts:864`). **`line` must stay distinct — a location (1:N single-parent), never a group.** Eligibility path is untouched by S0.
- **`plant_group` is a M:N lateral pool** (D49 resource-sharing), **not** a containment rung. The chain is strictly `tenant → plant → (line)`.
- **Cascade folds are depth-agnostic** (Commit-1 extraction); reference sets already declare partial depth (`declaredLevels`). **But the walker + level-type carry a two-stored-level assumption** — realizing the rung is a bounded code change (§4).
- **`plant` under `tenant`** is the exact precedent to replicate one level down (single-parent plain-text `tenant_id`, O4 `validatePlantIds`, soft-delete via `status`).

---

## 2. Scope boundary

**In (S0a):** `org.line` entity (single-parent under plant); `org.read` `getLine`/`validateLineIds`; `resource.line_id` (nullable, O4-validated); the consumer location-filter dimension.
**In (S0b):** the `plant → line` cascade rung — widen `ConfigLevel`, thread `lineId` through `walkScopePath` + callers, extend fixed-shape revision/view types, **proven byte-identical** on existing global/tenant/plant resolution.

**Out:** any constraint using line (S1); making `line` required (per-tenant maturity, not a schema constraint); line-level config *content* (S1 defines what resolves at line); reconciling `resource_group`/`plant_group` onto anything (they stay as-is, orthogonal).

---

## 3. Decisions (locked)

| ID | Decision | Resolution |
|---|---|---|
| **D-S0-1** | S0 structure | **One S0, two commits** — S0a entity, S0b rung. Entity is useful before it's a rung (resources locate to lines standalone); the rung is the config-module change S1 needs. |
| **D-S0-2** | `resource.line_id` nullability | **Nullable-permanent; plant = fallback grain.** `line_id=null` → resource locates to plant only; resolution stops at plant. Line-adoption is a per-tenant maturity choice, not a hard requirement (a single-line plant needn't model lines). |
| **D-S0-3** | Rung inertness | S0b reopens `walkScopePath` (4 live config groups + reference sets depend on it). **Global/tenant/plant resolution must be byte-identical** (values + provenance + determinism tokens) — the Commit-1 discipline, re-applied. |
| **D-S0-4** | `line`-vs-`resource_group` | **Strictly distinct.** `line` = location (1:N). `resource_group` = eligibility (M:N), untouched. A line is never modeled as a group; eligibility never flows through line. |

---

## 4. S0a — the `line` entity

### `org.line` (mirrors `org.plant` one level down)
| col | type | notes |
|---|---|---|
| `id` | text PK | ULID |
| `tenant_id` | text NOT NULL | tenant-scoped index |
| `plant_id` | text NOT NULL | **single-parent containment** (plain text, no cross-schema FK, O2; O4-validated at write) |
| `name` | text | |
| `status` | enum(active/inactive) | soft-delete, like plant |
| `created_at`/`updated_at` | timestamptz | |

- `org.read` gains `getLine(tenantId, id)` (tenant-scoped) + `validateLineIds(tenantId, ids)` (O4 write guard) — mirrors the plant pair. **`org.read` minor bump** (additive, like the Layer-1 `validateCustomerIds` rider).
- Line write path validates `plant_id` via `validatePlantIds` (a line's plant must exist).

### `resource.line_id`
- Add `line_id text NULL` to `resource`; **O4-validated at write** via `validateLineIds` when present (exactly as `plant_id` via `validatePlantIds`). Null = plant-only (D-S0-2).
- **Consistency guard:** if `line_id` set, the line's `plant_id` must equal the resource's `plant_id` (a resource can't sit on a line in another plant) — validated at write, typed rejection.

### Consumer location dimension
- The ~5 `r.plantId === plantId` filter sites (`scheduling.service.ts:396/492/576`, `actuals-rollup.service.ts:151`) gain an **optional parallel `lineId` filter** — additive, not a rewrite. When no `lineId` in context, behavior is unchanged (plant-grain).
- **Eligibility untouched** (`scheduling.service.ts:864` flows through the group).
- Exposed on the appropriate read contract (`asset.read` — resource surface lives there post-2b) as an additive `line`/`lineId` field on the resource DTO + line read/admin ops.

---

## 5. S0b — the cascade rung (byte-identical)

Realize `plant → line` on the ladder. The **folds need no change** (depth-agnostic); the **walker + level-type do**:
- `configLevelSchema` / `ConfigLevel`: `['global','tenant','plant']` → **`+ 'line'`** (closed enum widen).
- `walkScopePath`: signature gains `lineId?`; add the `line` branch to `scopeId` derivation (`level==='line' → lineId`); thread `lineId` through every caller (`config.service.ts` scopePath, `reference-set.service.ts`).
- `ScopeRowFetch` union: `'tenant'|'plant'` → **`+ 'line'`**.
- `ResolvedConfig.revisions` / `ConfigFieldView`: fixed `{global,tenant,plant}` keys → **add `line`** (the fixed-shape types + the contract's cascade-column view).
- Reference sets / config groups opt in via `declaredLevels` — **nothing forced to line depth**; a set/group unchanged unless it declares `line` (asset_type stays `{global,tenant}`, config groups stay as-is).

**Inertness proof (D-S0-3, the gate):** with **no line-level data present**, all four config groups + reference sets resolve **byte-identical** (values + provenance + determinism version tokens) to pre-S0b — the ladder gained a rung nothing uses yet, so existing resolution is unchanged. Same A/B + SHA discipline as the Commit-1 extraction, re-run. A `lineId` threaded but null must produce exactly the pre-S0b path.

> S0b is a contained config-module change that reopens verified code — its only acceptance is that it's inert until something declares `line` depth (which is S1's job, not S0's).

---

## 6. Definition of done

**S0a:**
- [ ] `org.line` built (single-parent under plant, O4-validated, soft-delete); `getLine`/`validateLineIds` on `org.read` (minor bump).
- [ ] `resource.line_id` (nullable) O4-validated; the plant-consistency guard rejects a cross-plant line.
- [ ] Consumer location-filter dimension added (additive; plant-grain unchanged when no `lineId`); resource DTO carries `line`.
- [ ] Eligibility path (`resource_group`) untouched; `plant_group` untouched.

**S0b:**
- [ ] `ConfigLevel` includes `line`; `walkScopePath` threads `lineId` + has the `line` branch; fixed-shape types extended.
- [ ] **Byte-identical proof:** four config groups + reference sets resolve identically (values + provenance + determinism tokens) with no line data — the ladder rung is inert until declared.
- [ ] No set/group forced to line depth; `asset_type` stays `{global,tenant}`.

**Both:**
- [ ] `demo:reset` green; **demo schedule identical** (S0 adds location grain + a dormant rung; nothing consumes line yet).
- [ ] No new cross-schema FK; O2/O3 intact; new constraints present post-reset.

---

*Sign off (or redirect) D-S0-1…4, then I write the S0 build brief — two commits, S0b carrying the byte-identical obligation. Ground-truth already done; this goes straight to build brief on confirm.*
