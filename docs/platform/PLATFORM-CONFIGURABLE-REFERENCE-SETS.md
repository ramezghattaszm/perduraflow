# Platform architecture — Configurable reference sets & scope-resolution hierarchy

| | |
|---|---|
| **Type** | Standing platform-architecture decision (cross-cutting; governs all modules) |
| **Status** | **Accepted — substrate BUILT** (config reference-set enhancement, Commits 1–5, migrations 0032/0033; §8 DoD all green). Two test-only sets exist; the first real consumer `asset_type` registers in Layer 2b (descriptor + in-use probe together). Reconcile-later precursors logged in `docs/REMAINING-ITEMS.md`. |
| **Ownership** | **The mechanism lives in the `config` module** (it already owns scope-resolved tenant configuration). Domain modules own set *descriptors* and are *consumers*. |
| **Companion decisions** | Exact-decimal computation (net-requirements trigger); this is the 2nd standing platform decision |
| **Home** | `docs/platform/` |

> **Ground-truth reframe.** The `config` module already implements the hard part: a real `global → tenant → plant` cascade with sparse per-field overrides, per-field provenance, revisioning, reset-to-parent, and append-only field-level audit, consumed via the O7 binding path (four groups already ride it). So this is **not greenfield and not Master Data's** — it is a **config-module enhancement**. Config resolves the *scalar value of a known field within a group*; a reference set is a *keyed collection whose membership a tenant extends/suppresses*. The genuinely new part is narrow: a **collection resolution unit + a membership fold**, on config's existing level/scope/audit/guard/provenance/binding substrate.

> **Problem.** Every enum in the build is a hardcoded TS union (`part_type`, `asset_type`, `resource_type`, `make_buy`, UoM sets, status enums). A client whose taxonomy differs from ours (a 5th tooling type, a custom material class) would require a code change + redeploy to onboard — the opposite of a configurable product. But not every enum *should* be open: some drive hard code branches and a value the platform doesn't know would break. This doc establishes (A) which enums are configurable, and (B) the mechanism by which configurable ones resolve across an **open, ordered scope hierarchy** — not a fixed tenant/plant pair.

---

## 1. The classification rule — taxonomic vs behavioral

The gate for entry into the configurable system:

- **Taxonomic (→ configurable):** the value *classifies or labels* a domain object; the platform does **not** branch on which value it is in logic that would break on an unknown value. Adding a value is a data operation. → tenant-configurable reference set.
- **Behavioral (→ stays closed/hardcoded):** the value *drives a code branch or state machine*; there is no code path for a value the platform doesn't know, so an unknown value is a defect, not a config. → closed TS union, unchanged.

The test: *"if a tenant added a new value tomorrow, would existing code do the right thing with zero changes?"* Yes → taxonomic. No → behavioral.

### Classification of current enums

| Enum | Class | Disposition |
|---|---|---|
| `asset_type` (`tool/die/mold/fixture`) | **Taxonomic** | Configurable set — **first instance** (§4). Classifies tooling; no logic branches on mold-vs-die. |
| `part_type` (`finished/component/raw`) | **Taxonomic** | Configurable set. Descriptive; already inert (Layer-1 ground truth — never read to branch). Migrate when convenient (not urgent). |
| `resource_type` (`press/molding/assembly/…`) | **Taxonomic** | Configurable set. Classifies resources; `resource_type_config` already carries per-type behavior *as data* (splittable, ot-cap) — that's the pattern, generalize it. |
| UoM set (`EA/KG/M/COIL/…`) | **Taxonomic** | Already open (Layer 1: `text` + advisory `KNOWN_UOM`). Reconcile onto the formal set mechanism when convenient. |
| `changeover_attribute_key` (`colour/material/gauge`) | **Borderline → taxonomic** | Names *which* attribute drives changeover; configurable, but its referents (the attribute columns) are named — so extending it pairs with the `shared_attributes` map. Configurable set, flagged as attribute-coupled. |
| `make_buy` (`make/buy`) | **Behavioral** | **Stays closed.** Drives dependent-demand routing (make → explode/produce; buy → material-gate) — a 3rd value has no code path. |
| status enums (`draft/published/superseded`, schedule `draft/committed/…`, `MasterDataStatus`) | **Behavioral** | **Stay closed.** State machines, not taxonomies. |
| `tool_life_uom`, `rate_uom` | **Taxonomic** | Configurable (UoM-set family). |

> Rule of thumb going forward: **new enums are classified at definition.** Taxonomic → born as a configurable set. Behavioral → closed union with a comment stating why it's closed.

---

## 2. The mechanism — configurable reference sets

A **reference set** is a tenant-scoped, platform-seeded, admin-extensible list of allowed values that domain columns reference and validate against.

- **Definition:** each set has a `set_key` (`asset_type`, `part_type`, …), a **platform default seed**, and per-value metadata (code, display label / i18n key, optional behavior flags, `is_active`).
- **Storage:** values live in a reference-set table scoped by the resolution hierarchy (§3), seeded with platform defaults at the `platform` level; tenant/lower overrides are added rows.
- **Reference + validation:** a domain column (e.g. `tooling_asset.asset_type`) stores the value as `text` and is **validated at the write path** against the resolved set for that context (like `org.read` ref validation, O4) — unknown value rejected with a typed error, never silently accepted.
- **Contract exposure:** resolved sets are published on a contract (a `config`/reference-data read contract) so consumers (and admin UIs for typeahead/pickers) read the *resolved* set for their context. Consumers must-ignore values they don't recognize (A12 open-enum discipline) — which is safe precisely because these are taxonomic (no branch).

This is the **same open-enum shape** already used for UoM in Layer 1, promoted from an advisory const to a managed, referenced, hierarchy-resolved table.

---

## 3. Scope resolution — an open, ordered level ladder (not tenant/plant)

**Scope is a first-class ordered hierarchy, not two fixed columns.** A configured value is stored against `(set_key, scope_level, scope_id, value…)`, and resolution walks **most-specific → least-specific** along the context's scope path, returning the first hit (replace mode) or merging up the path (merge mode).

### 3.1 The level ladder
An **ordered, extensible enumeration** of scope levels, broadest → narrowest:

```
platform/global  →  tenant  →  plant  →  line  →  work_center  →  …
```

- `platform/global` holds seeded defaults (in-code descriptor floor — never stored, per config's existing model); `tenant`/`plant` are stored overrides; deeper levels as sets require them.
- **Realizable today (ground truth):** exactly `global → tenant → plant` — config already resolves these and they map to real containment (`org.plant.tenant_id`). **No new rung is realizable now:** `plant_group` exists but is a **many-to-many pool** (a plant joins many groups) — not single-parent containment, so not a drop-in rung; **below plant nothing exists** (no `line`/`work_center` entity; `resource_group` is an eligibility pool, not a location). So the ladder is built as a **seam** — the walk is ladder-driven so rungs are *additive later* — but we realize only the depth config already has.
- Adding a rung later = adding an entry to this ordering + teaching the resolver to derive that level from context. It is **not** a schema reshape of every set.
- The ladder is a **small, closed, deliberately-extended list** — **not** arbitrary user-defined hierarchies. Tenant-defined scope levels would make this a general-purpose config platform (a far larger thing) — an explicit non-goal; that line is held hard.

### 3.2 Per-set declared depth
Each set **declares which levels it resolves at** — it opts into the rungs that make sense for it:

- `asset_type` → `{platform, tenant}` (a die is a die in every plant; taxonomy doesn't vary by plant). Resolver stops at tenant.
- a plant-varying set → `{platform, tenant, plant}`.
- a future set → `{platform, tenant, plant, line}`.

The machinery supports the full ladder; a set pays only for the depth it declares. The common case (`asset_type`, two rungs) is trivial.

### 3.3 Resolution mode (per set)
- **Replace (most-specific-wins):** scalar/list sets (`asset_type`). First hit down the path wins.
- **Merge (per-key, up the whole path):** map-like sets — generalizes Layer-1's `shared_attributes` shallow key-merge from two levels to N (merge platform → tenant → plant → … ; more-specific keys override, `null` = inherit, top-level shallow, nested-deep a documented future).

### 3.5 One walker, pluggable fold (the (b) decision)
Config's existing scalar `resolve()` is hardcoded to two fetches (tenant row, plant row). This work **extracts a single shared scope-path walker** that produces the ordered level rows for a context, with a **pluggable fold**:
- **scalar-field fold** — the existing config behavior (per-field first-non-null cascade + per-field provenance). **Must be a pure extraction: the four live groups (objective, reporting, autonomy, KPI) resolve byte-identical, same provenance, same determinism version tokens.** This is the load-bearing safety gate — (b) reopens verified code.
- **membership fold** — new, for reference sets: union members across the path, most-specific-wins on key collision, with **suppression** (§3.6).

### 3.6 Membership + suppression (tombstone)
A reference set's members are contributed per level and folded up the path:
- A tenant (or lower) level **adds** members and may **override** an inherited member's metadata (most-specific-wins).
- A tenant may **suppress** an inherited platform default via a **tombstone** — an active override at the tenant level marking the inherited member hidden (cannot delete it; it lives at the level above). The resolver omits suppressed members. Restoring = removing the tombstone. This is the membership analogue of config's reset-to-parent.
- **Referential-safety gate (decided):** suppression is **rejected if the value is currently in use** (existing rows reference it) — typed error at the write path, same shape as `org.read` ref validation. This is what makes "suppress" safe: no silent-invalid data. Add-only never hits this; suppression does, hence the gate.

### 3.4 The honest precondition for extending the ladder
To resolve along `line → plant → tenant`, the resolver must know a given object's **line, plant, and tenant** — i.e. the **containment** between levels must exist as real, resolvable entities with known parents. Tenant→plant exists (org model). Extending downward (plant→line, line→work_center) has a prerequisite: **that level must be modeled as an entity with known containment** before it can be a resolution rung. So "add a rung" = "define that level as a contained entity," not merely "add a string." The extensibility promise is real but not free — it's cheap to *reach* deeper once the entity exists, and the ladder/declared-depth seam is built now so reaching deeper never reshapes existing sets.

---

## 4. First instance — `asset_type` (Layer 2b)

- `asset_type` is a configurable reference set, declared depth `{platform, tenant}`, resolution mode **replace**.
- Platform seed: `tool`, `die`, `mold`, `fixture`. Tenant admins add values (e.g. `check_fixture`, `eoat`, `gauge`) as `tenant`-level rows.
- `tooling_asset.asset_type` stores `text`, **validated at write** against the resolved set for the tenant; unknown → typed rejection.
- No plant rung (doesn't vary by plant) — demonstrates per-set declared depth (the machinery *could* go deeper; this set doesn't).
- This proves the mechanism on a **greenfield** set before any shipped set is migrated onto it.

---

## 5. Reconcile-later precursors (decided: reconcile-later-logged)

Two shipped, working structures are precursors of this general mechanism. **Neither is retrofitted now** — prove the general mechanism first on greenfield `asset_type`, then migrate deliberately (proving-then-migrating beats migrating-while-proving on verified paths).

**`part_plant` (Layer 1)** — the two-level hardcoded override (global + plant, prefer-plant-else-global / shallow key-merge). The two-level special case of the N-level membership/merge mechanism. Documented as a **sanctioned special case**.

**`resource_type_config` (master-data)** — a flat keyed-metadata reference set (one row per `resource_type`, typed behavior columns `splittable`/`ot_cap_minutes`/`min_batch_qty`), but **flat** (no cascade/audit). It is a reference-set-with-metadata missing the hierarchy — the exact thing this mechanism generalizes. Documented as a precursor to fold in.

This is the honest form of "no rework": the platform briefly has more than one configuration shape; we acknowledge and schedule the reconciliation rather than force it into verified/demo-critical paths prematurely.

**Logged in REMAINING-ITEMS:** reconcile `part_plant`, `resource_type_config`, the Layer-1 UoM advisory const, and the inert `part_type`/`resource_type` enums onto the configurable-reference-set mechanism — deferred, not urgent, no behavior change when done.

---

## 6. Scope of the build

**Establish now (as the substrate for `asset_type` in 2b):**
- The reference-set storage + `(set_key, scope_level, scope_id, value)` model with the `platform/tenant` rungs realized and the ladder + declared-depth + resolution-mode seams in place (deeper rungs unrealized until a set needs them).
- Write-path validation + the reference-data read contract + admin CRUD for set values (guarded).
- `asset_type` as instance one.

**Explicitly NOT now (documented futures):**
- Deeper rungs (`line`, `work_center`) — realized when a set declares them (needs the containment entity, §3.4).
- Deep/nested merge mode.
- Migrating `part_plant`, UoM const, `part_type`/`resource_type` onto the mechanism (§5).

---

*Sign-off gates the 2b scope, where `asset_type` builds on this. Behavioral enums (`make_buy`, status) are explicitly out — they stay closed.*
