# Claude Code build brief — Master Data Layer 2 (BOM + asset), continuous

> **✅ DELIVERED — Layer 2 closed at Commit 2c (2026-07-09).** Decisions D-L2-1…7 all built as recommended; scope §7 DoD closed; suite 313 green; demo schedule 1043 (identical to pre-Layer-2). Commit map:
> `31a2213` 2a.1 (BOM version/draft-publish, mig 0034) · `c3f05d3` 2a.2 (explosion/where-used) · `86f1dd3` 2a.3 (integrity + blocking publish) · `4215a1c` 2a.4 (`bom.read 1.0`) · `d932844` 2a.5 (retire `material_requirement`, mig 0035) · `1272f7f` 2b.1 (tooling asset, mig 0036) · `9a231fb` 2b.2 (`asset.read 1.0` + resource move) · `91ea463` 2b.3 (`asset_type` reference set + write validation) · **2c** (re-seed + close-out, this commit).

| | |
|---|---|
| **Companion (authority)** | `docs/master-data/MASTER-DATA-LAYER-2-SCOPE.md` — read first; rationale there |
| **Also read** | `docs/platform/PLATFORM-CONFIGURABLE-REFERENCE-SETS.md` (asset_type = reference set) |
| **Decisions** | D-L2-1…7 **LOCKED** (scope §3) |
| **Structure** | **One continuous sequence: 2a phase (BOM) → 2b phase (asset) → single close-out.** No demo between; 2a need not be independently shippable (2b closes its dangling `tool_family` + resource-contract interim). |
| **Discipline** | Commit-per-part; stop-and-report at each checkpoint; change nothing outside this brief. |
| **Base** | Migrations at **0033**; BOM starts **0034**. Contracts: `masterdata.read 1.5`, `org.read 1.2`, `config.read 1.0`, `reference.read 1.0`. |

> **Out of scope:** quantity/lot-size arithmetic (net-requirements — exact-decimal trigger fires there); live asset/tool state (`current_usage`, up/down); SoR connectors; folding `resource_type_config`/`part_plant` onto the reference-set mechanism (reconcile-later); generalizing draft/publish to part/routing (documented future).

> **`status`/lifecycle enums stay closed** (behavioral — platform doc §1). BOM `status` does NOT go through the reference-set mechanism.

---

## Commit 0 — pre-flight (report only, no code)
Re-confirm against the advanced base:
1. BOM + tooling still greenfield (no new scaffolding since the Layer-2 ground truth); `material_requirement`/gate logic unchanged (still topology + max-date floor, no quantity math).
2. The `reviseRouting`/`*Tx` revise+child-copy pattern is intact (BOM authoring mirrors it); `master_data_audit` enum + `MasterDataResolver` shape unchanged.
3. `reference.read 1.0` is registered + binding-resolvable (2b will consume it for asset_type validation and serve config the in-use probe).
- **Report:** confirmations + any drift. Wait for go.

---
# PHASE 2a — BOM
---

## Commit 2a.1 — BOM version model + draft/publish (D-L2-1/2)
- `master_data.bom` (version header): `parent_part_no`, `revision`, `status ∈ {draft,published,superseded}`, `effective_from` (null while draft), `effective_to`, `supersedes_id`, audit cols. Partial unique `(tenant, parent_part_no) WHERE status='draft'` (one draft) + `WHERE status='published' AND effective_to IS NULL` (one open published).
- `master_data.bom_component` (edge child): `bom_id` FK → `bom.id`, `component_part_no`, `qty_per numeric`, `scrap_pct numeric NULL`. **No per-edge effectivity** (rides the version window). `numeric` (exact — Layer-1 factor precedent).
- Custom-SQL GiST non-overlap on `(tenant, parent_part_no, tstzrange(effective_from, effective_to))` for **non-draft** rows; wire into reset flow.
- Services (`MasterDataResolver`, `*Tx`-shaped): `reviseBom` (author/update draft + edges), `publishBom(parentPartNo, effectiveFrom)` (integrity-gate → publish → supersede prior → audit, atomic).
- Migration `0034`. Audit enum += `bom`.
- **Report:** schema + service diff; tests — author a draft (invisible to resolve), publish (opens window, supersedes prior, audits), one-draft + one-open-published invariants, GiST rejects overlapping non-draft windows.

## Commit 2a.2 — resolution + explosion + where-used (D-L2-1)
- `resolveBom(parentPartNo, asOf?)` — published + window-containing only; drafts never resolve; superseded resolvable via closed past window.
- `explodeBom(parentPartNo, asOf?)` — recursive (each `make` component resolves its own BOM; `buy`/leaf terminates), derives `level`, **cycle-safe** (visited-set; a cycle is an integrity failure, not an infinite loop).
- `whereUsed(componentPartNo, asOf?)` — parents, structural traversal up.
- **Report:** tests — multi-level explode with derived levels; as-of returns the historically-correct version; where-used; a planted cycle is caught (not hung); drafts excluded.

## Commit 2a.3 — integrity validation (D-L2-6)
- `validateBomIntegrity(parentPartNo)` — components exist as parts; **acyclic** (graph walk, from-scratch); child effectivity ⊆ parent window; make/buy coherence. Topology only — no plan quantities.
- **Blocking on `publishBom`** (can't publish an invalid BOM) + exposed on-demand.
- **Report:** tests — each failure mode rejects publish with a typed error; a valid BOM publishes; on-demand returns structured findings.

## Commit 2a.4 — `bom.read 1.0` contract (D-L2-3 slice)
- New `bom.read 1.0`: `resolveBom`/`explodeBom`/`whereUsed`/`validateBomIntegrity` + draft-authoring admin ops (`reviseBom`/`publishBom` behind `JwtAuthGuard + ConfigureGuard`, audited). Register at composition root, O7-bound.
- `=`-pin check (float-minor).
- **Report:** contract diff + pin-check; guard coverage on authoring ops; resolve via binding.

## Commit 2a.5 — retire `material_requirement` (D-L2-4) [ATOMIC-BREAKING]
- Gate switches: for each FG, `explodeBom(fgPartNo, buildAsOf)` → filter to **`buy` leaves** (`make_buy`) → `material_availability` max-date floor (unchanged). Sourced via the `bom.read` binding.
- Retire `material_requirement` + repo/DTO/seed refs + its vestigial `qty_per_unit`; **keep `material_availability`** and its ops.
- Re-seed the demo BOM (`SAL-1004 → COIL-HSLA-18`) so it explodes to the same buy-leaf.
- Migration `0035`.
- **DoD: demo schedule identical** — BOM produces the same per-FG floor `material_requirement` did (1043 ops).
- **Report:** the gate diff; grep proving no residual `material_requirement` read; **identical-schedule proof**.

---
# PHASE 2b — ASSET
---

## Commit 2b.1 — tooling asset domain (D-L2-5)
- `master_data.tooling_asset` (Pattern B, stable id, audited): `asset_id`, `asset_type text` (**validated in 2b.3**, not an enum), `tool_family`, `plant_id` (org-validated), `tool_life_units numeric NULL`, `tool_life_uom NULL`, `single_location boolean NOT NULL default true`, `is_active`. `master_data.tooling_eligible_resource` (`resource_id` list). `master_data.asset_part_map` (`part_no`). **No live state.**
- Audit enum += `tooling_asset` (+ child kinds as needed).
- Migration `0036`.
- **Report:** schema diff; Pattern-B create/update/deactivate audited; `tool_family` now resolves to a real family.

## Commit 2b.2 — `asset.read 1.0` + resource move (D-L2-3)
- New `asset.read 1.0`: tooling ops (`getToolingAsset`/`listToolingAssets`/`getAssetsForPart`/eligibility) + tooling admin CRUD (`JwtAuthGuard + ConfigureGuard`, audited) **+ the moved** `getResource`/`listResources`/`getResourceGroup`/`listResourceTypeConfigs`/downtime ops.
- Move ~4 consumers (scheduling.service, actuals-rollup, learning.service, learning-read) to resolve `asset.read`; add `register()`. **Deprecate-not-remove** the resource ops on `masterdata.read`; **drop the two dead validators**. `resource_type_config` storage **untouched** (reconcile-later) — only its contract exposure moves.
- `=`-pin check.
- **Report:** contract diff; the 4-file consumer move; grep proving no live consumer reads resource via `masterdata.read`; pin-check; schedule unchanged.

## Commit 2b.3 — `asset_type` reference set + write validation (D-L2-7)
- Register the `asset_type` **descriptor + `in_use` probe together** into the config substrate: defaults `[tool,die,mold,fixture]`, `{global,tenant}`, `replace`; probe = "any active `tooling_asset` with this `asset_type`?" (Master Data implements it; config calls it on suppression).
- `tooling_asset.asset_type` write path **validates against `reference.read`'s resolved set** (via the O7 binding) — unknown → typed rejection.
- **Report:** tests — a valid `asset_type` writes; an unknown one is rejected; the probe returns true when a tooling row uses a type and **blocks its suppression** (`REFERENCE_VALUE_IN_USE`) end-to-end (config→MD callback); descriptor + probe registered together (no descriptor-without-probe).

---

## Commit 2c — re-seed + verification + Layer-2 close-out
- **Reset-flow:** new GiST/constraints (`bom`, tooling) present after `demo:reset`.
- **Re-seed:** a published demo BOM; a tooling asset (with `asset_type` from the set, eligibility, asset↔part); `asset_type` set seeded. `tool_family` resolves. Idempotent. **No demo between 2a/2b — this is the combined baseline.**
- **Schedule check:** `demo:reset` → `db:seed` → build; **demo schedule identical to pre-Layer-2** (1043 ops) — the gate now BOM-sourced, resource now `asset.read`-sourced, both behavior-preserving.
- **Full-DoD sweep:** scope §7 (both 2a + 2b lists) line-by-line with evidence.
- **Docs close-out:** sync scope; REMAINING-ITEMS — close Layer 2 with shas; note documented futures (draft/publish generalization, deep-merge, reconcile-later precursors incl. `resource_type_config`); confirm the exact-decimal item still points at net-requirements.
- **Report:** post-reset check; identical-schedule; the full §7 sweep; docs/REMAINING-ITEMS done.

---

## Acceptance gate (scope §7)
Non-negotiables: BOM draft/publish + as-of resolution + cycle-safe explosion + integrity-blocking-on-publish; gate BOM-sourced with **schedule identical**; `bom.read`/`asset.read` at 1.0; resource moved + deprecated-not-removed on `masterdata.read`; `asset_type` validated via `reference.read` with descriptor+probe together; Pattern-B asset domain audited; no new cross-schema FK; constraints present post-reset; **demo schedule identical to pre-Layer-2**.

## Stop conditions (report, don't improvise)
- Explosion/where-used could infinite-loop on a cycle → **stop** (must be visited-set bounded; cycle = integrity failure).
- BOM-sourced gate diverges from `material_requirement` output → **stop** (2a.5 must be schedule-identical).
- `asset_type` would register a descriptor **without** its in-use probe → **stop** (safety invariant).
- Any work touches quantity arithmetic, live asset state, `resource_type_config` storage, `part_plant`, or a behavioral enum via the reference-set path → **stop** (out of scope).
