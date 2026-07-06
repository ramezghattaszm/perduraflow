# Master Data — Layer 1 scope: part-to-fullest

| | |
|---|---|
| **Layer** | Production Phase 1a · Layer 1 (part completed to spec, on the Layer-0 substrate) |
| **Written against** | Actual repo state (Claude Code Layer-1 ground-truth report) |
| **Builds on** | Layer 0 (effectivity + revision + audit substrate) — **shipped** |
| **Gate** | Propose-then-confirm — **no build until sign-off** |
| **Consumes** | MD2/MD4/MD9/MD11 (spec §5.1/5.2/5.4/5.6, §6.2/6.3), D12/D36/D37/D40 |

> **Risk posture:** unlike Layer 0, Layer 1 is **largely additive** — new nullable columns, two new tables, two new services, one contract minor-bump. The only migration needing care is `make_buy` (mandatory → default + behavior-preserving backfill). No retrofit on verified tables **unless** D-L1-5 (plant variants) is taken to full.

---

## 1. What ground truth settled

- **`part_type` is inert** — enum `['finished','component','raw']`, never read to branch behavior. The de-facto make/buy signal is `material_requirement` membership, not `part_type`. → `make_buy` is net-new and authoritative; `part_type` stays descriptive (not redundant).
- **UoM is free text**, no enum, no factors; values undefined (`'EA'` hardcoded in seed). Conversion is SKIP-02, entirely absent.
- **Physical attrs flat** (`material`/`gauge`/`colour` columns); no `shared_attributes` map, no `tool_family`.
- **Cross-reference absent** — inbound resolves by global `part_no` only (`resolvePart(part_no, asOf)`); no `plant_part_mapping`, no `customer_part_no`.
- **No MD8 mechanism** — confirms MD8 completeness/integrity is **Layer 3**, not here.
- **Contract `masterdata.read` 1.4**, `PartDto` fields flat (not nested).

---

## 2. Scope boundary

**In:** part core completion (§4A); UoM conversion entity + publication service (§4B, MD4); physical-attribute completion (§4C, MD11); plant/customer cross-reference entity + resolution service (§4D, MD9); contract `1.4 → 1.5` additive (§5).

**Out:** MD8 completeness/integrity + data-quality flow → **Layer 3** (MD9 service returns only a typed unresolvable result). BOM (§5.3) → Layer 2. Asset/tooling (§5.5) → Layer 2. External-system UoM/part *mapping* connectors → integration component.

---

## 3. Decisions to confirm

| ID | Decision | Recommendation |
|---|---|---|
| **D-L1-1** | `make_buy`: authoritative flag + backfill source | **Add `make_buy enum(make,buy) NOT NULL`; backfill to preserve *current de-facto behavior*** — a part that is a buy-component today (appears as `component_part_no` in `material_requirement`) → `buy`; all others → `make`. Keep `part_type` as descriptive. Layer 2 switches the scheduler to read `make_buy` (retiring the membership inference). |
| **D-L1-2** | `plant_part_mapping` effectivity flavor | **Effectivity-windowed** — `effective_from`/`effective_to` + resolve-as-of + GiST non-overlap on `(tenant, plant_id, plant_part_no)`, audited, **no ECN revision** (a mapping isn't "revised"). Reuses Layer-0 windowing infra minus the revision label. |
| **D-L1-3** | UoM value-set | **Platform base enum, annotated *open* (A12)** — curated automotive units (EA, KG, M, COIL, …) extensible per tenant; consumers must-ignore unknowns. Per-part factors reference it. (Alternative: keep free-text — rejected; factors need a stable referent.) |
| **D-L1-4** | MD8 completeness/integrity | **Defer to Layer 3.** Layer 1's MD9 resolve returns a typed `UNRESOLVABLE_PART_REF` result; the completeness validator + data-quality queue are Layer 3. |
| **D-L1-5** | **Plant-specific part variants** (CONFIRMED — build now, override-layer model) | **Build as a global-identity + plant-override layer (SAP-style), the industry-standard shape.** Global `part_no` identity stays **exactly as Layer 0 built it** — never fragmented, uniqueness `(tenant, part_no)` unchanged. Plant-specific attributes live in a **new `part_plant` override table** (§4E), resolved **prefer-plant-else-global**. `resolvePart` gains an **optional `plantId`** (additive: omitted = global = current behavior). **This deviates from the spec's literal conditional-`plant_id`-on-`part` (§5.1)** — the override layer realizes "attributes may vary by plant" *without* touching global identity, whereas conditional-`plant_id` would fragment it. Retrofitting later would be strictly larger (constraints hardened, `resolvePart` callers multiplied, production rows to split), so building now at the still-small Layer-0 surface is the cheap moment. |
| **D-L1-6** | Customer cross-ref shape | **Inline `customer_part_no`/`customer_id` on the part version** (spec §5.1 model), resolved as-of. A multi-customer-per-part mapping table is a documented future additive, not now. |

> With D-L1-5 settled as an override layer, **all six decisions are additive** — Layer 0's identity and constraints are untouched. Two effectivity flavors apply (see §4 note): *engineering properties* ride the part revision; *operational mappings* carry independent windows.

---

## 4. Entity / schema deltas

> **Two effectivity flavors** (both reuse Layer-0 window infra):
> - **Engineering properties ride the part revision** — nested under the part version (`part_id` FK → version), copied forward on `revisePart`. Applies to: physical attributes (§4C), UoM factors (§4B).
> - **Operational mappings carry independent windows** — keyed to the business key `part_no`, own `effective_from`/`effective_to` + GiST non-overlap, resolve-as-of, changeable *without* forcing a part revision. Applies to: `plant_part_mapping` (§4D), `part_plant` overrides (§4E). Rationale: a plant flipping a part make→buy is an operational change that shouldn't pollute the global engineering-revision history.

### 4A. Part core completion (`master_data.part`)
All **nest under the part version** (ride the revision — Pattern A, already versioned). Add:
- `make_buy text $type<'make'|'buy'> NOT NULL` — the **global (all-plants) default**; overridable per plant in `part_plant` (§4E). **Migration + backfill** per D-L1-1.
- `customer_part_no text NULL`, `customer_id text NULL` (kernel org ref, `org.read`-validated), `program text NULL` (kernel org ref) — D-L1-6.
- **No `plant_id` on `part`.** Plant-specificity is an override layer (§4E), not a column on the global identity — this is the D-L1-5 deviation from the spec's literal §5.1 `plant_id`, chosen to keep global identity intact.
- Keep `description`/`part_type`/`status` (present, MDQ4-early). No change.

### 4B. UoM conversion (new `master_data.uom_conversion`)
Per-part factors (§5.4). **Nested under the part version** conceptually; table keyed to the part.
| col | type | notes |
|---|---|---|
| `id` | text PK | ULID |
| `tenant_id` | text | indexed |
| `part_id` | text FK → `part.id` | the specific part **version** these factors belong to (rides revision) |
| `alternate_uom` | text (open enum) | D-L1-3 |
| `base_uom` | text (open enum) | = the part version's `uom` |
| `factor` | numeric | `alt_qty × factor = base_qty` (D40) |
- Unique `(tenant, part_id, alternate_uom)`.
- Copied forward on `revisePart` (like routing ops).

### 4C. Physical attributes completion (`master_data.part`)
Keep `material`/`gauge`/`colour` flat. Add (nest under version):
- `tool_family text NULL` (links to Asset, §5.5 — Layer 2).
- `shared_attributes jsonb NULL` — extensible custom-attribute map **with cross-module potential** (MD12); scheduling-private customs stay scheduling-side.

### 4D. Plant/customer cross-reference (new `master_data.plant_part_mapping`)
| col | type | notes |
|---|---|---|
| `id` | text PK | ULID |
| `tenant_id` | text | indexed |
| `plant_id` | text | kernel org ref (`org.read`-validated) |
| `plant_part_no` | text | plant-local number |
| `part_no` | text | resolved global identity (business key, not version id) |
| `effective_from` / `effective_to` | timestamptz | window (D-L1-2) |
| `supersedes_id` | text NULL | lineage (optional) |
- Partial unique `(tenant, plant_id, plant_part_no) WHERE effective_to IS NULL`.
- Custom-SQL GiST exclusion: no overlapping windows per `(tenant, plant_id, plant_part_no)` (reuses Layer-0 pattern).
- Audited via `master_data_audit` (entity_type `plant_part_mapping` — add to enum).
- Customer cross-ref uses the **inline** part fields (§4A), no separate table (D-L1-6).

### 4E. Plant-specific attribute overrides (new `master_data.part_plant`) — D-L1-5
SAP-style override layer. Global identity untouched; a plant row overrides only the attributes that vary. Operational-mapping flavor (independent window, keyed to `part_no`).
| col | type | notes |
|---|---|---|
| `id` | text PK | ULID |
| `tenant_id` | text | indexed |
| `part_no` | text | global identity (business key, **not** a version id) |
| `plant_id` | text | kernel org ref (`org.read`-validated) |
| `make_buy` | text NULL | override; null = inherit global |
| `material` / `gauge` / `colour` | text NULL | overrides; null = inherit global |
| `tool_family` | text NULL | override; null = inherit global |
| `shared_attributes` | jsonb NULL | override map; **shallow key-merge** over the global map (see resolution) |
| `effective_from` / `effective_to` | timestamptz | window |
| `supersedes_id` | text NULL | lineage |
- Partial unique `(tenant, part_no, plant_id) WHERE effective_to IS NULL`; GiST non-overlap per `(tenant, part_no, plant_id)`.
- Audited (`entity_type` `part_plant`).
- **Resolution:** `resolvePart(part_no, plantId, asOf)` = global part version as-of, with:
  - **named fields** (`make_buy`/`material`/`gauge`/`colour`/`tool_family`) — each non-null `part_plant` value layered over the global (**prefer-plant-else-global**);
  - **`shared_attributes`** — **shallow key-merge**: resolved = `{ ...global, ...plant }` at top level. A plant key overrides that key; a plant key the global lacks is **added**; a plant value of `null` means **inherit (no override)**, *not* delete (deletion unsupported in Layer 1); nested objects **replace wholesale** (deep/recursive merge is the sole documented future — deferred only because no nested case exists to design against).
  - No plant row → pure global (current behavior).
- `uom` **base is not overridable** (canonical base stays global, SAP-style); per-plant UoM *factors* are a documented future, not now.

---

## 5. Services + contract (`masterdata.read 1.4 → 1.5`, additive/A12)

**New service — cross-reference resolution (MD9, §6.2):**
- `resolvePlantPart(tenantId, plantId, plantPartNo, asOf?) → { partNo } | UNRESOLVABLE_PART_REF`.
- `resolveCustomerPart(tenantId, customerId, customerPartNo, asOf?) → { partNo } | UNRESOLVABLE_PART_REF` (queries inline part fields as-of).
- Unresolvable → typed result, **never a guess** (MD9); full exception flow is Layer 3.

**Extended — `resolvePart` gains optional `plantId` (additive, D-L1-5):**
- `resolvePart(tenantId, partNo, { plantId?, asOf? })` → part version as-of, with `part_plant` overrides layered when `plantId` given (**prefer-plant-else-global**). **`plantId` omitted = pure global = current behavior** → every Layer-0 consumer is unchanged. Core single-identity assumption holds (global `part_no` still resolves to one version).

**New service — UoM-factor publication (MD4, §6.3):**
- `getUomFactors(tenantId, partNo, asOf?) → { baseUom, factors: [{ alternateUom, factor }] }`.
- Publishes factors; **consumers convert at their own ingestion boundary** (MD4 — Master Data does not convert others' transactional data).

**Contract 1.5 additions:**
- `PartDto`: add `makeBuy`, `customerPartNo`, `customerId`, `program`, `toolFamily`, `sharedAttributes` (all optional/nullable except `makeBuy`); add nested `uomFactors?`. **No `plantId` on `PartDto`** — plant-resolution is a `resolvePart` argument, and the returned DTO reflects the *resolved* (plant-layered) values.
- New ops: `resolvePlantPart`, `resolveCustomerPart`, `getUomFactors`; `resolvePart` signature extended with optional `plantId`; admin CRUD schemas for `plant_part_mapping`, `uom_conversion`, `part_plant`.
- `org.read` unchanged (validates `customer_id`/`program`/`plant_id` — **confirm `validateCustomerIds`/`validateProgramIds` exist early**; if not, that's an `org.read` minor bump, flagged before the migration).

---

## 6. Migration + backfill plan

- **`make_buy` (the one careful migration):** add `NOT NULL DEFAULT 'make'` → **backfill** to de-facto behavior (buy-components → `'buy'`, rest `'make'`) → **drop the default** (every insert must state it, like `part_no`). Pre-check: enumerate current buy-components from `material_requirement` and confirm the backfill matches before dropping the default.
- **Additive columns on `part`** (`customer_part_no`, `customer_id`, `program`, `tool_family`, `shared_attributes`): nullable, no backfill. (No `plant_id` — override layer instead.)
- **New tables** (`uom_conversion`, `plant_part_mapping`, `part_plant`): create + GiST exclusion where windowed (custom SQL, wired into the reset flow per Layer-0 Commit-7 rider).
- **Audit enum:** add `plant_part_mapping`, `part_plant`, `uom_conversion` to `MASTER_DATA_ENTITY_TYPES`.
- **Re-seed:** seed one `uom_conversion` (e.g. COIL→EA factor), one `plant_part_mapping` per plant, and one `part_plant` override (to exercise prefer-plant-else-global resolve); set `make_buy` explicitly on all seeded parts. Idempotent; `demo:reset` green; **demo schedule identical** (new fields/overrides don't alter the build — consumers still call `resolvePart` without `plantId` until Layer 2).

---

## 7. Definition of done — ALL GREEN (Layer 1 built + verified; close-out Commit 7)

- [x] Part core complete: `make_buy` present + backfilled to preserve current behavior (buy-components → `buy`, i.e. `COIL-HSLA-18`); `customer_part_no`/`customer_id`/`program` added (customer/program validated via `org.read` 1.2, O4); engineering fields ride the part revision (copied forward on `revisePart`). **No `plant_id` on `part`.** *(C1 `828ec3c`, migration 0026.)* — Commit-6 rider: `make_buy` is now a **required** `createPart` input (the app-level `'make'` default dropped; admin must choose).
- [x] `uom_conversion` built; `getUomFactors(partNo, asOf)` publishes base + factors; factors copied forward on revise (**guarded on the base UoM** — a `uom` change drops them + flags the audit, never a silent copy); UoM value-set is an **open enum** (text + advisory `KNOWN_UOM`, unknown values accepted). *(C3 `835ff5a`, migration 0028.)* `factor` is `numeric` (exact) transported as its native decimal STRING — **factor-as-string boundary** (C7): no global OID-1700 parser; narrowed to a JS `number` only at the `getUomFactors` DTO edge (digit-for-digit survival proven; the one documented precision cliff → REMAINING-ITEMS future). *(C6 migration 0031; C7 boundary.)*
- [x] Physical attrs complete: `tool_family` + `shared_attributes` on the part version (ride the revision). *(C2 `61a7cbb`, migration 0027.)*
- [x] `plant_part_mapping` built (windowed, GiST non-overlap, audited); `resolvePlantPart`/`resolveCustomerPart(asOf)` return `{ partNo }` or typed `UNRESOLVABLE_PART_REF` — never a guess. *(C5 `f09074d`, migration 0030.)*
- [x] **Plant-override layer built:** `part_plant` (windowed, GiST non-overlap, audited) with named overrides **and** `shared_attributes`; `resolvePart(partNo, { plantId, asOf })` layers named fields **prefer-plant-else-global** and `shared_attributes` by **shallow key-merge** (`{...global, ...plant}`, plant `null` = inherit, top-level only); `resolvePart` **without `plantId` returns pure global (byte-identical to Layer 0)** — proven (unit inertness test + live), so no existing consumer changes behavior. Global `part_no` identity + Layer-0 uniqueness/constraints **untouched**. *(C4 `a1cea20`, migration 0029.)*
- [x] `masterdata.read` at `1.5` (additive; `PartDto` part-core fields + optional `uomFactors`; new ops `resolvePlantPart`/`resolveCustomerPart`/`getUomFactors`; `resolvePart` opts bag). Existing consumers compile unchanged (no `=1.4` pin; bindings key on `contract.id` + major `1`). `org.read` minor-bumped to `1.2` (customer/program validators — C0.5 `5fb6f10`). **uomFactors shaping = decision B** (published only via `getUomFactors`, never inlined in list/resolve reads → no payload bloat). *(C6 `494dfcc`.)*
- [x] No new cross-schema FK; O2/O3 intact; new-table GiST constraints (`part_plant_effectivity_no_overlap`, `plant_part_mapping_effectivity_no_overlap`) present after `demo:reset` — confirmed via the wired `applyCustomMigrations` step (custom SQL 0002/0003).
- [x] `demo:reset` + `db:seed` green; **demo schedule identical to pre-Layer-1** — 1043 scheduled ops (ml_adjusted 0, learned 32), unchanged across the Layer-1 commits. Identical **by construction**: the sequencer resolves via `resolvePart` **without** `plantId` (byte-identical) and never reads the new tables; the seed's Layer-1 rows (1 `uom_conversion`, 2 `plant_part_mapping`, 1 `part_plant`) don't feed the build.

---

*D-L1-1…6 signed off — all additive, Layer 0's identity untouched. Built across Commits 0.5–7; §7 DoD all green. Documented futures (per-plant UoM factors, deep/nested `shared_attributes` merge, multi-customer mapping table, first-class exact-decimal factor computation) logged in `docs/REMAINING-ITEMS.md` (Master-Data Layer 1 close-out).*
