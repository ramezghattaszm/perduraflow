# Claude Code build brief — Master Data Layer 1 (part-to-fullest)

| | |
|---|---|
| **Companion (authority)** | `docs/master-data/MASTER-DATA-LAYER-1-SCOPE.md` — read first; rationale there, not duplicated |
| **Decisions** | D-L1-1…6 **all LOCKED** (scope §3); all additive — Layer 0 identity untouched |
| **Discipline** | Commit-per-part; git lifecycle explicit; **stop-and-report at each checkpoint**; change nothing outside this brief |
| **Boundary rules** | O1–O8, §2.4. **No cross-schema FK. No cross-module schema import.** Consume `org.read` via contract only. |

> **Risk posture:** Layer 1 is **additive** — new nullable columns, three new tables, two new services, `resolvePart` extended with optional `plantId`, contract `1.4 → 1.5`. The single migration needing care is **`make_buy`** (mandatory → backfill-then-drop-default). Every consumer that calls `resolvePart` today passes **no** `plantId`, so it keeps resolving pure-global — the demo build must stay identical.

> **Out of scope — do NOT build:** MD8 completeness/integrity + data-quality flow (Layer 3 — MD9 returns a typed `UNRESOLVABLE_PART_REF` only), BOM (Layer 2), asset/tooling (Layer 2), the SoR connectors, per-plant UoM factors, deep/nested `shared_attributes` merge. If you find yourself building these, stop.

---

## Commit 0 — pre-flight (report only, no code)
Confirm before any migration:
1. **`org.read` validators.** Does `org.read` expose `validateCustomerIds` / `validateProgramIds` (it has `validateCalendarIds`)? If **missing**, that's a required `org.read` minor bump *before* `part` can validate the new refs — **stop and report** the gap with a proposed bump; don't proceed on assumption.
2. **`make_buy` backfill source.** Enumerate the current de-facto buy-components: every `part_no` appearing as `component_part_no` in `scheduling.material_requirement`. List them. This is the exact set that must backfill to `'buy'`; everything else `'make'`. Confirm the list looks right before the migration drops the default.
- **Report:** the validator answer + the buy-component list. Wait for go.

## Commit 1 — `make_buy` + part-core refs (the one careful migration)
- Add to `master_data.part`: `make_buy text $type<'make'|'buy'> NOT NULL DEFAULT 'make'`, `customer_part_no text NULL`, `customer_id text NULL`, `program text NULL`. (**No `plant_id`** — override layer, Commit 4.)
- **Backfill** `make_buy`: the Commit-0 buy-component set → `'buy'`; all else `'make'`.
- **Drop the default** on `make_buy` after backfill (every insert must state it, like `part_no`).
- Validate `customer_id`/`program` at the write path via `org.read` (O4), as `resource.calendar_id` already is.
- These are engineering fields → **copied forward on `revisePart`** (extend the revise op).
- Migration `0026`. Tree green: `make_buy` populated, new refs nullable, `getPart`/`resolvePart` unchanged.
- **Report:** migration diff; backfill counts (buy vs make) matching the Commit-0 list; confirm default dropped.

## Commit 2 — physical attributes completion
- Add to `master_data.part`: `tool_family text NULL`, `shared_attributes jsonb NULL`. Engineering fields → copied forward on `revisePart`.
- Migration `0027`. Additive; nothing reads them yet.
- **Report:** diff; confirm revise copies them forward.

## Commit 3 — UoM conversion + publication service
- UoM value-set: **open enum** (A12) — curated base units (`EA`, `KG`, `M`, `COIL`, …), extensible, consumers must-ignore unknowns. Define once; `part.uom` and `uom_conversion.*_uom` reference it.
- New table `master_data.uom_conversion` (scope §4B): `part_id` FK → part **version**; `(alternate_uom, base_uom, factor)`; unique `(tenant, part_id, alternate_uom)`. Engineering flavor → **copied forward on `revisePart`**.
- Service `getUomFactors(tenantId, partNo, asOf?) → { baseUom, factors[] }` on `MasterDataResolver`; consumers convert at their own boundary (MD4 — Master Data does not convert others' data).
- Migration `0028`.
- **Report:** diff; a test that `getUomFactors` returns seeded factors as-of, and factors copy forward on revise.

## Commit 4 — plant-override layer (`part_plant`) + `resolvePart` plantId
- New table `master_data.part_plant` (scope §4E): **windowed** (own `effective_from`/`effective_to` + `supersedes_id`, keyed to `part_no` — operational-mapping flavor, independent of part revision). Overridable cols: `make_buy`/`material`/`gauge`/`colour`/`tool_family` (each nullable) + `shared_attributes jsonb NULL`. `plant_id` `org.read`-validated.
- Partial unique `(tenant, part_no, plant_id) WHERE effective_to IS NULL`; custom-SQL GiST non-overlap per `(tenant, part_no, plant_id)` (wire into reset flow, Layer-0 Commit-7 pattern).
- Audited (`entity_type` `part_plant`).
- **Extend `resolvePart`** → `resolvePart(tenantId, partNo, { plantId?, asOf? })`:
  - `plantId` **omitted** → pure global, **unchanged behavior** (existing callers untouched).
  - `plantId` given → layer the window-containing `part_plant` row: named fields **prefer-plant-else-global**; `shared_attributes` **shallow key-merge** `{...global, ...plant}` (plant `null` = inherit, top-level only; nested = replace wholesale; no delete).
- Migration `0029`.
- **Report:** diff; tests — `resolvePart` without `plantId` is byte-identical to pre-Commit-4; with `plantId` a `part_plant` override wins on a named field and key-merges `shared_attributes`; a plant `null` inherits global; overlapping-window insert rejected by GiST.

## Commit 5 — cross-reference resolution (MD9)
- New table `master_data.plant_part_mapping` (scope §4D): **windowed**, `(plant_id, plant_part_no) → part_no`; partial unique + GiST non-overlap per `(tenant, plant_id, plant_part_no)`; audited (`entity_type` `plant_part_mapping`).
- Services on `MasterDataResolver`:
  - `resolvePlantPart(tenantId, plantId, plantPartNo, asOf?) → { partNo } | UNRESOLVABLE_PART_REF`.
  - `resolveCustomerPart(tenantId, customerId, customerPartNo, asOf?) → { partNo } | UNRESOLVABLE_PART_REF` (queries the inline part fields as-of).
  - Unresolvable → **typed result, never a guess** (MD9). No exception *queue* (Layer 3).
- Migration `0030`.
- **Report:** diff; tests — resolvable plant-local + customer refs return the global `partNo`; unresolvable returns the typed result; overlapping-window insert rejected.

## Commit 6 — contract 1.5 + admin CRUD
- `masterdata.read` `1.4 → 1.5` (additive, A12): `PartDto` adds `makeBuy`, `customerPartNo`, `customerId`, `program`, `toolFamily`, `sharedAttributes`, nested `uomFactors?` (**no `plantId` on `PartDto`** — plant-resolution is a `resolvePart` arg; the DTO carries *resolved* values). New ops `resolvePlantPart`/`resolveCustomerPart`/`getUomFactors`; `resolvePart` signature extended (optional `plantId`). Admin CRUD schemas for `uom_conversion`, `part_plant`, `plant_part_mapping`.
- Deprecated Layer-0 ops stay as-is; `org.read` unchanged (unless Commit-0 forced a minor bump).
- **Report:** contract diff; existing consumers still compile; changelog line.

## Commit 7 — re-seed + verification + close-out
- **Reset-flow:** the new GiST constraints (`part_plant`, `plant_part_mapping`) apply via the custom-migration step already wired into `demo:reset`/`db:setup` (Layer-0 rider) — confirm post-reset presence.
- **Re-seed** (`db/seed.ts`): set `make_buy` explicitly on all parts; one `uom_conversion` (COIL→EA), one `plant_part_mapping` per plant, one `part_plant` override (exercise prefer-plant-else-global + a `shared_attributes` key-merge). Idempotent.
- **Schedule check:** `demo:reset` → `db:seed` → build; **demo schedule identical to pre-Layer-1** (consumers still call `resolvePart` without `plantId`; new data doesn't alter the build). Talk-track runs.
- **Full-DoD sweep:** walk scope §7 line-by-line, pass/fail with evidence.
- **Docs close-out:** sync repo scope + this brief to decisions taken; close Layer-1 REMAINING-ITEMS with commit shas; log the documented futures (per-plant UoM factors, deep/nested `shared_attributes` merge, multi-customer mapping table).
- **Report:** post-reset constraint proof; identical-schedule + talk-track; the §7 DoD sweep; docs/REMAINING-ITEMS close-out done.

---

## Acceptance gate (scope §7 — all must pass)
Mirror scope §7. Non-negotiables: `make_buy` backfilled to preserve current behavior; `resolvePart` without `plantId` **byte-identical to Layer 0**; global `part_no` identity + Layer-0 constraints **untouched**; new-table GiST constraints present **after `demo:reset`**; contract at `1.5`; no new cross-schema FK; demo schedule identical.

## Stop conditions (report, don't improvise)
- `org.read` lacks customer/program validators → **stop** (Commit 0), propose the bump.
- `make_buy` backfill set doesn't match the Commit-0 list, or a part is ambiguous (both a demand target *and* a component) → **stop and report**; don't guess the flag.
- `resolvePart` without `plantId` diverges from Layer 0 output → **stop** (the override layer must be inert when unused).
- Any work touches BOM / asset / MD8-queue / connector / per-plant-UoM / nested-map-merge → **stop** (out of scope).
