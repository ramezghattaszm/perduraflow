# Master Data — Layer 2 scope: BOM + asset/tooling

| | |
|---|---|
| **Layer** | Production Phase 1a · Layer 2 — two siblings: **2a BOM** (MD5), **2b asset/tooling** (MD10/MD14) |
| **Written against** | Actual repo state (Claude Code Layer-2 ground-truth report) |
| **Builds on** | Layer 0 (effectivity + revision + audit substrate) + Layer 1 (part-to-fullest, incl. `make_buy`) — shipped |
| **Gate** | Propose-then-confirm — **no build until sign-off** |
| **Consumes** | MD2/MD5/MD8/MD10/MD14 (spec §5.3/5.5, §6.4), D9/D37/D40 |

---

## 1. What ground truth settled

- **`material_requirement` retirement is clean:** gate = pure topology + max-date floor, **no quantity math**; `qty_per_unit`/`availability.qty` vestigial. Retirement = gate reads BOM explosion (topology) + keeps `material_availability`. **`make_buy` (Layer 1) is the filter** — explode → `buy` leaves → availability floor.
- **BOM + tooling/asset are greenfield** (only Layer 1's naked `tool_family` text pointer exists).
- **Contracts:** everything on `masterdata.read` (1.5); no `bom`/`asset` stub. Binding keyed on `contract.id`; a new contract = new descriptor + one `register()` line at the composition root.
- **Resource move is small:** ~18 read-sites, ~4 files, one repeated `listResources`; the two O4 resource validators are **dead**.
- **Draft/publish precedent = `schedule_version`** (`draft→committed→superseded`, supersedes pointer, `commit()` gate, consumers filter to committed) — but *status-superseding*, not windowed. BOM combines the two.
- **`reviseRouting` is the BOM-authoring precedent** (copies child rows onto a new version). **Graph traversal/cycle-detection is from-scratch.**

---

## 2. Scope boundary + the 2a/2b split

**2a — BOM:** `bom` version model (draft/publish + effectivity), single-level edges, explosion/where-used/integrity services, `bom.read` contract, **gate migration retiring `material_requirement`**.

**2b — Asset:** tooling asset (tool/die/mold/fixture) + asset↔part mapping, fold `resource`/`resource_group` into an `asset.read` contract (the ~4-file move), `single_location`/eligibility/tool-life *definition* (Pattern B).

**Order:** **2a first** (retires the interim, unblocks net-requirements — the primary BOM consumer). 2b is independent and can follow (unblocks tool-life-as-hard-constraint, a scheduling concern).

**Out:** quantity/lot-size arithmetic (consumer's job, MD5 — net-requirements, where the **exact-decimal decision fires**); live asset/tool state (`current_usage`, up/down — transactional, MD10/MD14); SoR connectors (integration component); routing changes (Layer-0 done). The **generalization of draft/publish to part/routing** is a documented future — Layer 2 applies it to BOM only.

---

## 3. Decisions taken (D-L2-1…7 — all implemented as recommended; see §7 for close-out SHAs)

| ID | Decision | Recommendation |
|---|---|---|
| **D-L2-1** | **BOM version model** | **Version-level (header + edges), Pattern A windows + draft/publish gate.** A `bom` version keyed to `parent_part_no` (own `revision`/window/`supersedes_id`, independent of the parent part's revision — like routing); `bom_component` **edges are children of the version**. Edges are **single-level** (parent→direct components); **explosion derives multi-level + `level`** at query time. **Deviates from spec §5.3's edge-level effectivity** → version-level, because atomic publish-the-whole-BOM needs one window per version, not per edge. |
| **D-L2-2** | **Draft/publish mechanics** | Mirror `schedule_version` **combined with** effectivity: `status ∈ {draft, published, superseded}`. Draft = no window, invisible to resolve-as-of, freely edited (**one open draft per `parent_part_no`**). `publish()` = run integrity (must pass) → `published` + open window → close+supersede prior published → audit, **atomically** (`reviseRouting`-shaped). Superseded stays queryable via its closed past window (reconstruction). GiST non-overlap on **non-draft** windows per `parent_part_no`. |
| **D-L2-3** | **Contract structure (MD2)** | Register **`bom.read` + `asset.read` at 1.0** (greenfield). **Move `resource`/`resource_group` to `asset.read`** (~4 files; deprecate-not-remove the resource ops on `masterdata.read`; drop the two dead validators). **`masterdata.read` stays as the part contract** at its current 1.5 — no rename/reset (the binding id is load-bearing; a rename is churn for a cosmetic spec-literal match). |
| **D-L2-4** | **Retire `material_requirement` (in 2a)** | Gate explodes each FG's published BOM as-of build date → filters to **`buy` leaves** (`make_buy`) → floors on `material_availability`. Same output shape, sourced from BOM. `material_availability` stays; `material_requirement` + its vestigial `qty_per_unit` retire. (Alternative: defer to net-requirements — rejected; leaves a dead interim with no write path.) |
| **D-L2-5** | **Asset domain pattern** | **Pattern B (mutable-with-audit, stable id)** for tooling asset + asset↔part mapping, consistent with `resource` (Layer 0). Tooling is an operational asset, not ECN-revisioned; spec marks its effectivity optional. Audited via `master_data_audit`. |
| **D-L2-7** | **`asset_type` = configurable reference set** (from the config-substrate detour) | `asset_type` is **NOT** a column enum. 2b registers its **descriptor + `in_use` probe together** onto the config reference-set substrate (invariant: no suppressable set without its probe). `tooling_asset.asset_type` is **`text`, validated at write against the resolved set via `reference.read`** — unknown → typed rejection. Declared depth `{global, tenant}`, mode `replace`, suppression gated by the probe. `resource_type_config` stays **flat** (reconcile-later — do NOT fold it onto the mechanism now). |
| **D-L2-6** | **Integrity validation timing** | Run BOM integrity (components-exist, **acyclic**, effectivity-consistency, make/buy coherence) **on `publish()` (blocking — can't publish an invalid BOM)** *and* expose as an on-demand service (MD5/MD8). Cycle detection is a cross-BOM graph walk (from-scratch). |

---

## 4. 2a — BOM

### 4a.1 Entities
**`master_data.bom` (version header):** `id` PK, `tenant_id`, `parent_part_no` (business key), `revision`, `status ∈ {draft,published,superseded}`, `effective_from` (null while draft), `effective_to` (null=open), `supersedes_id`, audit cols.
- Partial unique `(tenant, parent_part_no) WHERE status='draft'` (one open draft); partial unique `(tenant, parent_part_no) WHERE status='published' AND effective_to IS NULL` (one open published).
- Custom-SQL GiST non-overlap on `(tenant, parent_part_no, tstzrange(effective_from, effective_to))` **for non-draft rows**.

**`master_data.bom_component` (edge, child of version):** `id` PK, `tenant_id`, `bom_id` FK → `bom.id` (the version), `component_part_no`, `qty_per numeric`, `scrap_pct numeric NULL`. **No per-edge effectivity** (rides the version window). `qty_per`/`scrap_pct` **`numeric`** (exact — the Layer-1 factor precedent; they feed quantity math downstream).

### 4a.2 Services (`MasterDataResolver`, on `bom.read`)
- `reviseBom` / draft authoring — create/update the draft version + its edges (`reviseRouting`-shaped, transactional, audited).
- `publishBom(parentPartNo, effectiveFrom)` — integrity-gate → publish → supersede prior → audit, atomically.
- `resolveBom(parentPartNo, asOf?) → published version + edges` (window + status filter; drafts never resolve).
- `explodeBom(parentPartNo, asOf?) → multi-level topology` (recursive: each `make` component resolves its own BOM; `buy`/leaf terminates). Derives `level`. **Cycle-safe** (visited-set; a cycle is an integrity failure, not an infinite loop).
- `whereUsed(componentPartNo, asOf?) → parents` (structural traversal up).
- `validateBomIntegrity(parentPartNo)` — components exist as parts; acyclic; child effectivity ⊆ parent window; make/buy coherence. Topology only (MD5) — **no plan quantities**.

### 4a.3 Gate migration (retire `material_requirement`)
- Scheduling's gate (`scheduling.service.ts:769–780`) switches: for each FG, `explodeBom(fgPartNo, buildAsOf)` → filter to `make_buy='buy'` leaves → `material_availability` max-date floor (unchanged). Sourced via the `bom.read` binding.
- Retire `material_requirement` + repo/DTO/seed refs; keep `material_availability` and its ops. Update the seed to a real BOM (`SAL-1004 → COIL-HSLA-18`) that explodes to the same buy-leaf.
- **DoD: demo schedule identical** — the gate produces the same per-FG floor from BOM as it did from `material_requirement`.

---

## 5. 2b — Asset

### 5.1 Entities (Pattern B — mutable-with-audit, stable id)
**`master_data.tooling_asset`:** `id` PK, `tenant_id`, `asset_id` (business key), `asset_type text` (**a `reference.read` set value, validated at write against the resolved `asset_type` set — NOT a column enum**, D-L2-7), `tool_family`, `plant_id` (org ref), `tool_life_units numeric NULL`, `tool_life_uom NULL`, `single_location boolean NOT NULL default true`, `status`/`is_active`, audit cols. `effective_from/to` optional — **not** windowed-versioned (Pattern B).
**`master_data.tooling_eligible_resource`:** `tooling_asset_id` FK, `resource_id` (the `eligible_resource_ids` list).
**`master_data.asset_part_map`:** `tooling_asset_id` FK, `part_no` (which parts the tool produces).
- `tool_family` links to Layer-1 `part.tool_family` (the naked pointer now resolves to a domain).
- **Live state excluded** (`current_usage`, availability — transactional, MD10).

### 5.2 Resource move → `asset.read`
- `resource`/`resource_group` schemas **stay put** (Pattern B, unchanged); only their **contract exposure** moves: `getResource`/`listResources`/`getResourceGroup`/`listResourceTypeConfigs`/downtime ops → `asset.read`. Drop the two dead validators.
- Migrate the ~4 consumer files (scheduling.service, actuals-rollup, learning.service, learning-read) to resolve `asset.read`; add the `register()` line. Deprecate-not-remove the resource ops on `masterdata.read`.
- **`resource_type_config` stays flat** on its current shape — do **not** fold it onto the reference-set mechanism (reconcile-later, platform doc §5). It moves contract-exposure-wise to `asset.read` with the rest of the resource surface, but its storage is untouched.

### 5.2b `asset_type` reference set (D-L2-7)
- Register the `asset_type` **descriptor** into the config reference-set substrate: defaults `[tool, die, mold, fixture]`, `declared_levels={global, tenant}`, mode `replace`, **plus the `in_use(tenantId, memberKey)` probe** implemented in Master Data — "any `tooling_asset` (active) with this `asset_type`?" **Descriptor + probe register together** (the substrate's no-suppressable-set-without-a-probe invariant).
- `tooling_asset.asset_type` write path **validates against `reference.read`'s resolved `asset_type` set** for the tenant (O4-style, via the binding); unknown value → typed rejection. Master Data consumes `reference.read` through the O7 binding, same as it consumes `org.read`.
- The probe is the **one cross-module callback**: config → Master Data on suppression. Master Data now both *consumes* `reference.read` (validation) and *serves* config (the probe).

### 5.3 `asset.read` contract (1.0)
Tooling ops (`getToolingAsset`/`listToolingAssets`/`getAssetsForPart`/eligibility) + the moved resource/resource-group ops + tooling admin CRUD (Pattern-B, `JwtAuthGuard + ConfigureGuard`, audited). Master Data additionally **consumes `reference.read`** (asset_type validation) — a new binding dependency.

---

## 6. Contract structure summary

| Contract | Version | Owns | Consumers |
|---|---|---|---|
| `masterdata.read` (part) | 1.5 (stays) | part core + attrs + UoM factors + routing + cross-ref; **resource ops deprecated** | scheduling, net-req |
| `bom.read` | **1.0 (new)** | BOM version + explosion/where-used/integrity | net-req, scheduling gate, costing |
| `asset.read` | **1.0 (new)** | tooling + asset↔part + **resource/resource_group** | scheduling, future maintenance |
| `org.read` | 1.2 (unchanged) | kernel org | all |

---

## 7. Definition of done — ✅ CLOSED (Commit 2c, 2026-07-09)

All items met and verified at the 2c close-out (`demo:reset` → `db:seed` → build). Evidence in the commit body; DB-catalog + schedule proofs below.

**2a:**
- [x] `bom` version model built: draft/publish lifecycle (`reviseBom`/`publishBom`), Pattern-A windows, one-draft + one-open-published invariants, GiST non-overlap on non-draft windows. — `31a2213` (2a.1), verified: `bom_parent_draft_unique WHERE status='draft'`, `bom_parent_published_open_unique WHERE status='published' AND effective_to IS NULL`, `bom_effectivity_no_overlap` GiST `WHERE status <> 'draft'`.
- [x] `resolveBom`/`explodeBom`/`whereUsed` correct + as-of; explosion is cycle-safe and derives `level`; `qty_per`/`scrap_pct` `numeric`. — `c3f05d3` (2a.2).
- [x] `validateBomIntegrity` (components-exist, acyclic, effectivity-consistency, make/buy coherence) runs **blocking on publish** + on-demand. — `86f1dd3` (2a.3); publish throws `INVALID_BOM` on a failing gate.
- [x] `bom.read` at 1.0; drafts invisible to consumers; superseded queryable as-of. — `4215a1c` (2a.4).
- [x] **Gate reads BOM** (explode → `buy` leaves → availability floor); `material_requirement` retired; `material_availability` intact. — `d932844` (2a.5, migration 0035); `material_requirement` table absent (0 in catalog), only retirement-note comments remain; gate = `bomBuyComponentsByFg` → `material_availability` floor.
- [x] **Demo schedule identical to pre-2a** (BOM produces the same gate floor). — 1043 ops.

**2b:**
- [x] Tooling asset + asset↔part + eligibility built (Pattern B, audited); `single_location` default true; live state excluded. — `1272f7f` (2b.1, migration 0036).
- [x] `resource`/`resource_group` exposed on `asset.read` 1.0; ~4 consumers migrated; dead validators dropped; resource ops deprecated on `masterdata.read`. — `9a231fb` (2b.2).
- [x] `asset_type` = configurable reference set: descriptor + in-use probe register together; write-validated via `reference.read` (unknown → `INVALID_ASSET_TYPE`); suppression gated by the real config→Master-Data binding callback. — `91ea463` (2b.3).
- [x] Layer-1 `part.tool_family` now resolves to a real asset family. — verified: `SAL-1001.tool_family='STAMP-BODY-A'` → `DIE-STAMP-BODY-A` (type `die`, 250000 strokes, eligible Press A/B, produces SAL-1001).
- [x] No new cross-schema FK; O2/O3 intact; new GiST/constraints present after `demo:reset`. — tooling FKs are intra-`master_data`; `asset_part_map.part_no` is `text` (no FK, O4); constraints confirmed in catalog.
- [x] `demo:reset` + `db:seed` green; **demo schedule identical** (now via `asset.read`). — 1043 ops; suite 313 green.

**Identical-schedule proof:** pre-Layer-2, post-2a, and post-2c all build **1043 scheduled operations** — the gate is now BOM-sourced and resource reads are `asset.read`-sourced, both proven behavior-preserving.

---

*Layer 2 closed at Commit 2c (`demo:reset` idempotent combined 2a+2b baseline, no demo between). Decisions D-L2-1…7 all implemented as recommended. Documented futures (draft/publish generalization to part/routing; deep/nested merge; reconcile-later precursors incl. `resource_type_config` and the resource HTTP-transport-vs-contract inconsistency flagged in 2b.2) logged in `docs/REMAINING-ITEMS.md`.*
