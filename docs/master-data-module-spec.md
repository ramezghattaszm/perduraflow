# Master Data module — business & functional specification

| | |
|---|---|
| **Document** | Business & functional specification — Master Data module |
| **Product** | Manufacturing operations platform; Master Data is the foundational module (A13), next after production scheduling (#1) |
| **Status** | Draft v0.3 |
| **Date** | 2026-06-10 |
| **Companion docs** | Platform architecture specification (Draft v0.8); Production scheduling module business & functional specification (Draft v0.10) |
| **Intended use** | Source-of-truth for the Master Data module build; defines the part & BOM contracts the rest of the platform consumes |

> **Status note:** MD1–MD14 are **Agreed**. The MDQ question log (Section 9) is fully resolved (MDQ1–MDQ6).

---

## 1. Purpose & how to read this document

This document specifies the **Master Data module**: the foundational platform module that owns the **part/material domain** — part identity, the shared part attributes every module relies on, plant-local↔global part resolution, bill-of-materials structure, and unit-of-measure conversion — and exposes them as platform **contracts** (A8) that all other modules consume.

It establishes ownership per **A13**: master data is a domain in its own right (effectivity resolution, revision control, UoM conversion, BOM integrity and where-used), so it lives in a module rather than the kernel. The **kernel** owns the organizational model (Plant, Plant group, Customer, Program, Calendar) that this module references but does not own.

Where this module's responsibility ends and a consuming module's begins, the rule is the **ownership principle (MD12)**: *if an attribute or entity has potential to be used by more than one module, it belongs in Master Data; only data that no other module would plausibly read is module-specific.* The test is **potential**, not current actual use — it deliberately biases foundational data toward Master Data so later modules inherit it rather than triggering a migration. UoM, physical part attributes, and tooling/assets → Master Data (plausibly read by scheduling, quality, logistics, maintenance). The changeover *matrix* and sequencing *rules* → scheduling's extension (only the scheduler's optimizer reads them).

Decisions are logged as an **MD-series** (Section 3); open questions as an **MDQ-series** (Section 9). Cross-references: `A#` = architecture spec, `D#`/`Q#` = scheduling module business spec.

---

## 2. Scope

### 2.1 In scope

- **Part master** — global-within-tenant part identity (D12) and the shared core attributes (UoM per D40, make/buy, revision, customer/program references, lifecycle status).
- **Plant part mapping** — plant-local and customer part numbers resolved to the global `part_no` (D12).
- **BOM** — bill-of-materials structure (topology, `qty_per`, scrap factor), multi-level (D37).
- **Unit-of-measure conversion** — per-part factors to normalize alternate units to the canonical base UoM (D40).
- **Physical & descriptive part attributes** — material, gauge, colour, and an extensible shared attribute map (MD11); the changeover *matrix* and sequencing *rules* that consume them remain scheduling's.
- **Asset master (production assets)** — definition of **tooling** (tools, dies, molds, fixtures: family, eligibility, tool-life, single-location, asset↔part mapping, MD10) and **resources** (machines, lines, work-centres: type, rate, plant, calendar; plus resource-group definitions, MD14). Live operational state (tool usage, resource up/down) is transactional and owned elsewhere.
- **Domain services** — effectivity resolution (D10), cross-reference resolution, BOM where-used and structural explosion, UoM-factor publication, master-data completeness/integrity validation (the Master-Data portion of D45).
- **Revision & change control** — versioned, effectivity-dated master data driven by ECN/ECR; never edited in place.
- **Provided contracts** — the part contract and BOM contract (A8), with per-tenant system-of-record binding (D35/Q15).

### 2.2 Out of scope

- **Organizational model** (Plant, Plant group, Customer, Program, Calendar) — kernel-owned (A10/A13); referenced here, not owned.
- **Scheduling part extensions** — routings & operations (scheduling 5.2), the changeover matrix and sequencing rules (5.4), lot-sizing policy (5.6) — owned by the scheduling module, keyed on this module's `part_no` and referencing its attributes/assets.
- **Tooling and resources (machines/lines/work-centres) and resource groups** are *now Master Data* (asset domain, MD10/MD14), no longer scheduling-owned; scheduling consumes them.
- **Live asset & inventory state** — tool usage, resource up/down/utilization, and component inventory/receipts (scheduling 4.8) are transactional, not master data; sourced via integration, consumed by the scheduler.
- **Inventory & receipts** (scheduling 4.8) — transactional, not master data; sourced via integration, consumed by the scheduler's material gate.
- **Demand, capacity, schedules** — other modules' domains.

### 2.3 Operating context

- **Tenant-scoped** throughout (D24): every Master Data entity (parts, BOM, assets, attributes, mappings) carries `tenant_id` as part of its identity, and every contract and cross-reference resolution (MD9) is tenant-scoped. The "global" `part_no` (D12) is global **within a tenant**, never across tenants. This holds regardless of entitlement granularity (entitlement is per-tenant per AQ3, but the *data model* is tenant-scoped because shared-SaaS deployments (D24a) co-locate tenants in one database). Isolation mechanics → Architecture doc.
- **Multi-plant** (D12/D32): part identity is global within a tenant; some attributes and all mappings are plant-specific.
- **Effectivity-dated** (D10): master data carries effectivity; consumers resolve the version effective at a *reference date* (e.g. the scheduled date), not "current."
- **Foundational dependency**: net-requirements and scheduling cannot operate without this module; it is the platform's dependency root and the build that follows module #1.

---

## 3. Decision log (MD-series)

| ID | Decision | Rationale (summary) | Status |
|---|---|---|---|
| **MD1** | **The Master Data module is the authoritative owner of the part/material domain**: Part master (core), Plant part mapping, BOM, and UoM conversion (Section 5). These entities' property definitions in this document supersede the equivalent tables in scheduling business-spec 5.1, which become a consuming view. | A13: a consumed domain is a module, not kernel, and has one owner. | Agreed |
| **MD2** | **Provided contracts (A8): a `part` contract, a `bom` contract, and an `asset` contract.** UoM base unit and conversion factors are **nested in the `part` contract** (MDQ3 — kept lean, not a separate contract). Physical part attributes (MD11) are nested in `part`; the asset/tooling domain (MD10) is the `asset` contract. Each registers at `1.0` with enums annotated open/closed (A12). All other modules consume part/BOM/asset data exclusively through these contracts; no module reads Master Data tables directly. | Contract-first boundaries (A8) keep consumers decoupled; folding conversion and attributes into `part` keeps the contract count low and the round-trips minimal (MDQ3). | Agreed |
| **MD3** | **Effectivity resolution is a provided service, not reimplemented per consumer** (D10). A consumer asks "resolve part/BOM X as-of date D" and receives the version effective then. Master Data owns the resolution logic so every module resolves identically and reconstructably. | Effectivity reimplemented N times drifts; identical resolution is a correctness and IATF-reconstructability requirement (D6/D10). | Agreed |
| **MD4** | **Master Data is the source of truth for UoM base units and conversion factors (D40); the act of converting inbound quantities happens at each consumer's ingestion boundary.** The part/uom-conversion contract publishes the base UoM and factors; consumers apply them when normalizing their own inbound data (e.g. the scheduler converting an inbound demand quantity). Master Data does not convert other modules' transactional data. | The base UoM and factors are master data; the conversion *event* belongs at the boundary where foreign-unit data actually arrives (D40), which differs per consumer. One source of factors, many ingestion points. | Agreed |
| **MD5** | **BOM services: structural where-used and structural explosion (topology only), plus BOM integrity validation.** Master Data resolves "what does part X consume / where is X used," explodes multi-level structure (D37), and validates BOM integrity (components exist, no cycles, effectivity consistency, make/buy coherence). **Quantities and lot-sizing are applied by the consumer** (the scheduler explodes against planned quantities per D37; net-requirements nets); Master Data supplies the structure, not the arithmetic of a specific plan. | BOM topology is master data; applying it to a quantity is the consuming module's domain. Splitting here keeps Master Data plan-agnostic and reusable. | Agreed |
| **MD6** | **Revision & change control: versioned, effectivity-dated, never edited in place** (mirrors D6/D10). An ECN/ECR produces a new effectivity-dated revision; prior revisions are retained. **Master-data history is retained at least as long as any schedule version or audit trace that references it** — i.e. the D46 retention floor (life of program + 15 years default) applies transitively, because reconstructing a past schedule requires resolving the master data effective at that schedule's date. | Reconstructability (D6) is impossible if the master data effective at a past build date has been discarded; retention must track the longest consumer requirement (D46). | Agreed |
| **MD7** | **Per-tenant system-of-record binding (D35/Q15) attaches to the part, BOM, and asset contracts; the Master Data module understands only a canonical view.** Three modes: **connector** (an external SoR such as SAP/PLM is the source — read-mostly in-app), **upload** (structured templates, bootstrap/low-volume), **native** (Master Data is the SoR, full in-app maintenance). **Crucially, all external-system mapping — field mapping, code translation, and effectivity/revision reconciliation — lives in a separate integration/mapping component, not in Master Data** (MDQ5/MD13). Master Data receives already-canonical data regardless of mode; consumers always see the canonical contract. The mode may differ per contract within a tenant. | D35 generalized; keeping Master Data canonical-only (MD13) means its domain logic never carries vendor-specific quirks, and the mapping component absorbs each external system's idiosyncrasies. | Agreed |
| **MD8** | **Master Data validates its own completeness & integrity and raises data-quality exceptions on its data; consuming modules validate their extensions** (D45 split). Master Data checks: part identity present, UoM set, mappings resolvable, BOM integrity (MD5). It does **not** validate routings/attributes/labor — those are scheduling's completeness checks. The D45 data-quality exception flow spans both; each layer raises against the data it owns, and a part is schedulable only when both layers pass. | D45 ("never schedule on guessed/missing data") spans owned domains; each owner validates what it owns; the platform composes the verdict. | Agreed |
| **MD9** | **Cross-reference resolution is a provided service.** Inbound signals carrying plant-local part numbers or customer/OEM part numbers are resolved to the global `part_no` by Master Data (D12). The service resolves `(plant_id, plant_part_no) → part_no` and `(customer_id, customer_part_no) → part_no`, returning a data-quality exception (MD8) on an unresolvable reference rather than guessing. | The resolution rules and mapping tables are master data; centralizing resolution prevents each consumer from carrying its own cross-reference logic and guarantees consistent identity across modules. | Agreed |
| **MD10** | **Tooling and equipment are a Master-Data-owned asset domain** (MDQ1). Tools, dies, molds, fixtures, and other equipment are assets read by multiple modules — scheduling (eligibility, life cap, single-location, D9) and a future maintenance module (life, maintenance history). Master Data owns the **asset definition**: identity, family, plant, eligible resources, tool-life specification, single-location flag, and the asset↔part mapping (Section 5.5). **Live asset state** — usage-since-maintenance and availability status — is *transactional* (like inventory, scheduling 4.8): sourced via integration / a future maintenance module and consumed by the scheduler, not part of the definition. Exposed as the `asset` contract (MD2). | The ownership principle (MD12): tooling has clear potential cross-module use (maintenance, OEE), so the asset definition is foundational master data; only its live operational state is transactional and owned elsewhere. | Agreed |
| **MD11** | **Physical and descriptive part attributes are Master-Data-owned** (MDQ2). Attributes that describe the *part itself* — material, gauge, colour, and (later) weight/dimensions — are read by scheduling (changeover drivers, D8), and plausibly by quality, compliance, and logistics, so they live in Master Data (Section 5.6) and are nested in the `part` contract. The part↔`tool_family` association (linking a part to its eligible asset family, MD10) is likewise master data. **Scheduling retains only the logic that consumes these**: the changeover matrix (transition *cost*) and sequencing rules (transition *legality*), which reference Master Data attributes but are not themselves part data. A genuinely scheduling-private custom attribute may still live in a scheduling-side extension; a custom attribute with any cross-module potential goes in the Master Data shared attribute map (MD12). | The ownership principle (MD12): physical attributes have obvious cross-module potential; the matrix and rules that *act on* them do not. | Agreed |
| **MD12** | **Ownership principle: potential cross-module use, not actual use, determines placement.** If an attribute or entity could plausibly be read by more than one module, it belongs in Master Data; only data no other module would plausibly read is a module-specific extension. The test is deliberately biased toward Master Data so that later modules inherit foundational data rather than forcing a migration. This principle governs all future line-drawing (supersedes the narrower A13 "second actual consumer" phrasing). | Foundational data placed too narrowly forces painful migrations when the second consumer arrives; erring toward Master Data is cheaper than the alternative and keeps the platform's shared spine coherent. | Agreed |
| **MD13** | **Master Data is canonical-only; external-system mapping is a separate integration component** (MDQ5). The Master Data module defines and stores a single canonical view of parts, BOMs, assets, and attributes. Mapping any external system's schema, codes, and effectivity semantics to/from that canonical view is the job of a distinct **integration/mapping component** (part of the connector binding, A8/D35), not Master Data. Effectivity reconciliation with an external SoR (former MDQ5) is therefore resolved in that component, which presents reconciled, canonical, effectivity-dated data to Master Data. | A domain module that absorbs every external system's quirks stops being canonical; isolating mapping keeps Master Data's model clean and makes adding an external source a mapping task, not a Master Data change. | Agreed |
| **MD14** | **Production resources (machines, lines, work-centres) and resource groups join the Master-Data asset domain** (resolving MDQ6). Per MD12, machines have clear cross-module potential — maintenance (downtime, service history), OEE/performance, and capacity all read resource data — so the **resource asset definition** (identity, type, throughput rate, plant, calendar reference) and **resource-group definitions** (interchangeability groupings, which are also the capacity envelope grain, scheduling 4.2) are Master-Data-owned and exposed on the `asset` contract. Scheduling and capacity **consume** them; operations reference a Master Data `resource_group_id` for eligibility. **Live resource state** — up/down, current utilization — is *transactional* (like tool usage MD10, inventory 4.8), sourced via MES / a future maintenance module and consumed by the scheduler, not part of the definition. A purely scheduling-private transient grouping, if ever needed, may stay scheduling-side (MD12). | The ownership principle (MD12): machines are the clearest cross-module asset of all; a maintenance or OEE module is unviable without them. Resource groups travel with resources because capacity already consumes them as its grain. Only live operational state stays transactional. | Agreed |

---

## 4. Relationship to the platform & consumers

### 4.1 Position in the dependency graph

```
                 ┌─────────── Kernel (org model, A10) ───────────┐
                 │  Plant · Plant group · Customer · Program · Calendar
                 └───────────────────▲───────────────────────────┘
                                     │ references
                          ┌──────────┴──────────┐
                          │   Master Data (A13) │  ← this module
                          │  part · BOM · UoM   │
                          └──────────┬──────────┘
                                     │ part / bom contracts (A8)
        ┌──────────────┬─────────────┼─────────────┬──────────────┐
   Net-requirements  Scheduling   Demand plan.  Logistics      (future)
                     (extends part:
                      routings, attrs,
                      lot-sizing)
```

Master Data **references** kernel org entities (a Part master row carries `plant_id`; a part may carry `customer_id`/`program`). It is **referenced by** every part-consuming module through its contracts.

### 4.2 Provided contracts (A8)

| Contract | Carries | Primary consumers | SoR binding (MD7) |
|---|---|---|---|
| `part` (`1.0`) | Part identity + shared core attributes (5.1); **nested** UoM base + conversion factors (5.4) and physical attributes (5.6); resolution & effectivity services (Section 6) | All part-consuming modules | per-tenant: connector / upload / native |
| `bom` (`1.0`) | BOM structure (5.3); where-used / explosion / integrity services | Net-requirements, scheduling, costing | per-tenant: connector / upload / native |
| `asset` (`1.0`) | Tooling/equipment definition + asset↔part mapping (5.5); eligibility, life spec, single-location (MD10) | Scheduling, future maintenance | per-tenant: connector / upload / native |

> Conversion factors and physical attributes are folded into `part` (MDQ3/MD11), not separate contracts. Contract evolution per A12 (MAJOR.MINOR, open/closed enum annotations, consumer must-ignore, dual-publish, pin-major/float-minor). The `part`/`bom`/`asset` contracts register as founding registry entries alongside scheduling's 4.1–4.10 (A12 / architecture 6.5). External-system mapping for any contract lives in the integration/mapping component, not here (MD13).

---

## 5. Domain model (property level)

Authoritative definitions for the part/material domain (MD1). Conventions match the scheduling spec: **Req** = Y mandatory / N optional / C conditional; `reference` = FK; all entities **tenant-scoped** (D24, `tenant_id` omitted for brevity); effectivity-dated where marked (D10).

### 5.1 Part master — core

Global-within-tenant part identity (D12) and the shared attributes every module reads.

| Property | Type | Req | Notes |
|---|---|---|---|
| `part_no` | string | Y | Global identity within the tenant (D12). |
| `revision` | string | Y | Engineering revision; new revision on ECN/ECR (MD6). |
| `customer_part_no` | string | N | OEM part number mapping. |
| `customer_id` | reference → Customer (kernel) | N | Owning customer, where part is customer-specific. |
| `program` | reference → Program (kernel) | N | Customer / vehicle program. |
| `uom` | enum | Y | The part's **canonical base UoM**; all internal quantities for the part are in this unit (D40). |
| `make_buy` | enum(`make`,`buy`) | Y | `make` → scheduled as dependent demand (D37); `buy` → material-availability check only (D36). |
| `plant_id` | reference → Plant (kernel) | C | Set where the record is plant-specific; identity is global, attributes may vary by plant. |
| `effective_from` / `effective_to` | datetime | Y | Effectivity window (D10). |

> **Deferred fields (MDQ4):** `name`, `part_type`, and `status` (lifecycle), plus future universal attributes like weight/dimensions (logistics) and unit cost (costing), are **added later** as their consuming need arrives — each an additive minor change to the `part` contract (A12). Not in the initial core.

### 5.2 Plant part mapping

Resolves a plant's local numbering to the global `part_no` (D12). Do not assume plants share numbering.

| Property | Type | Req | Notes |
|---|---|---|---|
| `plant_id` | reference → Plant (kernel) | Y | |
| `plant_part_no` | string | Y | Part number as used in that plant's own systems. |
| `part_no` | reference → Part master | Y | Resolved global identity. |
| `effective_from` / `effective_to` | datetime | N | Supports re-mapping over time (D10). |

> **Uniqueness & resolution (MD9):** `(plant_id, plant_part_no)` resolves to exactly one global `part_no`; one `part_no` may carry many plant-local mappings. A customer cross-reference resolves `(customer_id, customer_part_no) → part_no` analogously. Unresolvable inbound references raise a data-quality exception (MD8), never a guess.

### 5.3 BOM component

Bill-of-materials structure; multi-level (D37).

| Property | Type | Req | Notes |
|---|---|---|---|
| `parent_part_no` | reference → Part master | Y | |
| `component_part_no` | reference → Part master | Y | |
| `level` | integer | Y | Multi-level support. |
| `qty_per` | decimal | Y | Component base-UoM units per one parent base-UoM unit (D40). |
| `scrap_pct` | decimal | N | Component scrap factor (master-data property of the structure, not a plan-specific value). |
| `effective_from` / `effective_to` | datetime | Y | (D10) |

> **Integrity (MD5):** components must exist as parts; no cycles; child effectivity must be consistent with parent; `make`/`buy` of components is coherent (a `make` component has its own routing in the scheduling extension — validated there, MD8). Where-used and structural explosion are provided services (Section 6); quantities are applied by the consumer.

### 5.4 Unit-of-measure conversion

Per-part factors to normalize alternate units to the part's base UoM (D40). Source of truth for factors; conversion is applied at consumer ingestion boundaries (MD4).

| Property | Type | Req | Notes |
|---|---|---|---|
| `part_no` | reference → Part master | Y | |
| `alternate_uom` | enum | Y | A unit the part may transact in externally. |
| `base_uom` | enum | Y | The part's canonical base UoM (Part master `uom`). |
| `factor` | decimal | Y | Multiply an alternate-UoM quantity by `factor` to get the base-UoM quantity. |

### 5.5 Asset domain (production assets)

Master-Data-owned asset definitions: **tooling** (MD10) and **resources/machines** (MD14). Live operational state (tool usage, resource up/down/utilization) is transactional and sourced elsewhere — see the notes below.

**Resource (machine / line / work-centre) — definition** (MD14)

| Property | Type | Req | Notes |
|---|---|---|---|
| `resource_id` | string | Y | Resource identity. |
| `resource_group_id` | reference → Resource group | Y | Pooling/interchangeability (also the capacity envelope grain, scheduling 4.2). |
| `plant_id` | reference → Plant (kernel) | Y | |
| `type` | enum | Y | e.g. press, molding, assembly. |
| `rate` | decimal | N | Throughput rate. |
| `rate_uom` | enum | N | |
| `calendar_id` | reference → Calendar (kernel) | Y | Shared kernel calendar (D17/A10). |
| `effective_from` / `effective_to` | datetime | N | (D10) |

**Resource group — definition** (MD14)

| Property | Type | Req | Notes |
|---|---|---|---|
| `resource_group_id` | string | Y | |
| `plant_id` | reference → Plant (kernel) | Y | |
| `member_resource_ids` | list of reference → Resource | Y | Interchangeable members. |

> **Live resource state (transactional, owned elsewhere — MD14):** up/down status and current utilization are operational, sourced via MES / a future maintenance module and consumed by the scheduler; not part of this definition.

**Tooling asset (tool / die / mold / fixture) — definition** (MD10)

| Property | Type | Req | Notes |
|---|---|---|---|
| `asset_id` | string | Y | Tooling asset identity. |
| `asset_type` | enum(`tool`,`die`,`mold`,`fixture`) | Y | Kind of tooling. |
| `tool_family` | string | Y | Family grouping; links to the part↔`tool_family` association (5.6) and the changeover model (D8). |
| `plant_id` | reference → Plant (kernel) | Y | |
| `eligible_resource_ids` | list of reference → Resource | Y | Resources the tooling can mount on. |
| `tool_life_units` | decimal | N | Life before maintenance (e.g. strokes/shots). |
| `tool_life_uom` | enum | N | |
| `single_location` | boolean | Y | Hard constraint: occupies one resource at a time (default true). |
| `effective_from` / `effective_to` | datetime | N | (D10) |

**Asset↔part mapping** — which parts a tooling asset produces.

| Property | Type | Req | Notes |
|---|---|---|---|
| `asset_id` | reference → Tooling asset | Y | |
| `part_no` | reference → Part master | Y | |

> **Live tooling state (transactional, owned elsewhere — MD10):** usage-since-maintenance (`current_usage`) and availability (`status`: available / in_maintenance / retired) are operational state, analogous to inventory (scheduling 4.8). Sourced via integration today (MES) and owned by a future maintenance module; the scheduler consumes both for the tool-life cap (D9) and contention. Not part of the master-data asset definition.

### 5.6 Part attributes — physical & descriptive

Master-Data-owned physical attributes (MD11), nested in the `part` contract. The changeover matrix and sequencing rules (scheduling 5.4) reference these but are not part data.

| Property | Type | Req | Notes |
|---|---|---|---|
| `part_no` | reference → Part master | Y | |
| `material` | string | N | Physical material. |
| `gauge` | string | N | Thickness/gauge. |
| `colour` | string | N | |
| `tool_family` | string | N | Eligible asset family (links to Asset, 5.5). |
| `shared_attributes` | map | N | Extensible map for custom attributes **with cross-module potential** (MD12); scheduling-private custom attributes may instead live in a scheduling-side extension. |

---

## 6. Domain services

Services the module exposes through its contracts (logical; mechanics → Architecture doc). These are *what* the module computes on top of the data in Section 5 — the reason master data is a module, not a table.

1. **Effectivity resolution (MD3, D10).** `resolve(part_no | bom, as_of_date) → effective version`. Every consumer resolves master data through this, including when reconstructing a past schedule (the `master_data_asof` in scheduling's audit trace 4.6 is a call into this service).
2. **Cross-reference resolution (MD9, D12).** `resolve(plant_id, plant_part_no) → part_no` and `resolve(customer_id, customer_part_no) → part_no`. Unresolvable → data-quality exception (MD8).
3. **UoM factor publication (MD4, D40).** Publishes base UoM and conversion factors per part; consumers apply at their own ingestion boundary.
4. **BOM where-used & explosion (MD5, D37).** Structural traversal up (where-used) and down (multi-level explosion) the BOM, effectivity-resolved; topology only, no plan quantities.
5. **Completeness & integrity validation (MD8, D45).** Validates that Master-Data-owned data required to schedule a part is present and valid; raises data-quality exceptions on its own data; composes with consuming-module validation for the overall D45 verdict.

---

## 7. System-of-record modes (MD7, D35/Q15)

Per tenant, per contract:

| Mode | Behavior | When |
|---|---|---|
| **connector** | Mirrors an external SoR (SAP, PLM); in-app read-mostly; changes flow from the source. Effectivity/revision reflect the source's. | Tenant runs an ERP/PLM holding parts/BOM. |
| **upload** | Ingested from structured templates (versioned artifacts of the contract, A12); validated on import (MD8). | Bootstrap, low-volume, or no live integration. |
| **native** | Master Data **is** the SoR: full in-app maintenance — create/revise parts and BOMs, set effectivity, manage status — gated by the `configure`/master-data-admin permission (kernel RBAC, A9). | No external SoR (no-ERP tenants). |

> The mode may differ per contract within a tenant (e.g. parts mirrored from SAP via connector, BOM maintained natively). All three modes feed the same validated domain model; consumers are unaffected by which mode a tenant uses — they see the contract.

---

## 8. Traceability & retention (MD6, D6/D10/D46)

- Master data is **versioned and effectivity-dated, never edited in place** (MD6); a change creates a new revision with its own effectivity.
- **Retention floor (MD6/D46):** master-data revisions are retained at least as long as the longest-lived schedule version or audit trace that references them — default life of program + 15 years, configurable to the longest applicable customer/regulatory requirement. Master data is never purged while any retained schedule could need to resolve it as-of a past date.
- All master-data changes are **audited** through the kernel audit framework (D6): who changed what, when, effective when, and (in connector mode) the source reference.
- Retention/tiering mechanics (hot vs object-storage tiering) → Architecture doc (A3/Section 7); the requirement here is reconstructability, not hot-query performance.

---

## 9. Open questions (MDQ-series)

| ID | Question | Why it matters / what resolves it | Related | Status |
|---|---|---|---|---|
| **MDQ1** | Tools/dies/molds/fixtures & equipment ownership. **Resolved → MD10**: Master-Data-owned **asset domain** (`asset` contract); definition here, live usage/status transactional/elsewhere. | MD10, D9 | Closed |
| **MDQ2** | Physical part attributes (material/gauge/colour). **Resolved → MD11**: Master-Data-owned (Section 5.6, nested in `part`); scheduling keeps only the changeover matrix and sequencing rules that reference them. | MD11, D8 | Closed |
| **MDQ3** | Separate `uom-conversion` contract? **Resolved → MD2**: no — folded into `part` to keep it lean. | MD2 | Closed |
| **MDQ4** | Part-master additions (`name`/`part_type`/`status`, etc.). **Resolved → MDQ4 note (5.1)**: deferred — added later as their consuming need arrives, each an additive minor change (A12). | MD1, A12 | Closed |
| **MDQ5** | External-SoR effectivity reconciliation. **Resolved → MD13**: out of Master Data — the integration/mapping component reconciles and presents canonical, effectivity-dated data; Master Data is canonical-only. | MD7, MD13 | Closed |
| **MDQ6** | Machines / work-centres / resource groups → asset domain? **Resolved → MD14**: yes — production resources and resource-group definitions are Master-Data-owned (Section 5.5); scheduling and capacity consume them; live resource state stays transactional. | MD14, MD12 | Closed |

---

## Appendix A — Cross-reference to the scheduling business spec

| Scheduling spec element | Status under this module |
|---|---|
| 5.1 Part master | **Owned here** (Section 5.1, MD1); scheduling consumes via `part` contract |
| 5.1 Plant part mapping | **Owned here** (Section 5.2) |
| 5.1 BOM component | **Owned here** (Section 5.3) |
| 5.1 UoM conversion | **Owned here** (Section 5.4) |
| 5.2 Routing & Operation | Scheduling extension (keyed on this module's `part_no`) |
| 5.3 Resource / Resource group (machines/work-centres) | **Owned here** as the asset domain (Section 5.5, MD14) |
| 5.3 Tool / die / mold | **Owned here** as the asset domain (Section 5.5, MD10) |
| 5.4 Part attributes (physical: material/gauge/colour) | **Owned here** (Section 5.6, MD11) |
| 5.4 Changeover matrix & sequencing rules | Scheduling extension (consume Master Data attributes) |
| 5.6 Lot-sizing policy | Scheduling-owned (planning policy) |
| D37 BOM explosion (with quantities) | Scheduling applies quantities; this module provides structure (MD5) |
| D45 master-data validation | Split: this module validates its data (MD8); scheduling validates its extension |
| D40 UoM normalization | Factors here (MD4); conversion applied at scheduler ingestion |

---

*End of document — Draft v0.3.*
