# PerduraFlow — API Spec

> App-specific API decisions. The reusable patterns live in `API-ARCHITECTURE.md` — this file
> only records what is unique to PerduraFlow.
>
> **This app is the manufacturing operations platform** (production scheduling = module #1). Source
> documents: `docs/CLAUDE-CODE-BRIEF.md` (phase 0), `docs/CLAUDE-CODE-BRIEF-PHASE-1.md` (phase 1),
> `docs/platform-architecture-spec.md` (A-series), `docs/production-scheduling-business-functional-spec.md`
> (D-series), `docs/master-data-module-spec.md` (MD-series), `docs/PLATFORM-COMPLETION-LOG.md` (SKIP-NN).
>
> **STATUS:**
> - **Phase 0 (§1–§9): BUILT & signed off** — kernel spine (tenant, auth) + org model, admin screens.
> - **Phase 1 (§10): BUILT & verified** — the first domain module (`master-data`) + an `org` priority
>   edit + the `org.read 1.1` bump + `masterdata.read 1.0`. Migration `0003` applied + seeded; all
>   boundary proofs pass (scoped schema, no cross-schema FK, additive contract, no resolver).

---

## 0. Template override — contract-bound modules (replaces API-ARCHITECTURE.md §3)

> **This is the single most important deviation from the template baseline.** Per
> `CLAUDE-CODE-BRIEF.md` §1 (Template override note) and §2 (invariants), we are **not** building
> the modular monolith API §3 describes (one shared Drizzle barrel / Pool, "call module B's
> service", in-process `EventEmitter2` across boundaries). We are building a **modular, contract-bound**
> platform where any module is replaceable by another platform module or a third party.
>
> **Litmus test for every boundary decision:** *could a third party replace this module by
> satisfying its contract, with zero change to any consumer?* If not, the boundary is wrong.

The following rules **supersede API-ARCHITECTURE.md §3** for this app. Everything else in the two
architecture docs still stands.

| # | Rule | Enforcement |
|---|---|---|
| O1 | **Contracts are the only shared surface between modules.** Inter-module contracts live in `packages/contracts`, each carrying an `id + version` from day one. A module imports another module's **contract** and nothing else — never its code, types, repositories, or tables. | Code review + the lint rule O3. |
| O2 | **Each module owns its own store — mechanically isolated.** One **Postgres schema/namespace per module**; each module's Drizzle instance is scoped to **only its own tables**, so a cross-module join **cannot compile**. No cross-schema FKs, no cross-schema joins, ever. **One shared `Pool`** backs all instances (one database, not per-module pools) — only the Drizzle *instance* is scoped, not the connection. | Per-module Drizzle instances over one Pool (§2.1); `pgSchema()` per module. |
| O3 | **A CI/lint rule forbids importing another module's `schema/`.** Schema files live *inside* each module (`modules/<m>/schema/`), and only that module's code may import its own `schema/` barrel. **The migration generator is exempt** — it legitimately aggregates every module's schema at build time. | ESLint `no-restricted-imports` zone rule with a drizzle-config exemption (§2.3). |
| O4 | **Cross-module references are plain `text` IDs**, validated through the other module's contract **at write time** — exactly as if that module were a separate service. | Validation in the writing module's service via the consumed read interface. |
| O5 | **Inter-module events go through the EventBus coordinator** with its **local in-memory provider** (SKIP-05). Never raw `EventEmitter2` across a module boundary. Intra-module `EventEmitter2` is fine. | `EventBus` coordinator (§5). |
| O6 | **Transport behind the contract is swappable.** In-process-behind-the-contract now; an HTTP/Kafka adapter later promotes a module to its own service with no consumer change (deployment shape B → A). | Contract interfaces never expose transport. |
| O7 | **A binding sits between every consumer and every *domain* contract**, resolving per tenant to `{ platform_module \| connector \| upload \| native }`. The demo implements only `platform_module` and `native`. **The binding *resolver* is NOT built this session** — it has no consumer until phase 1 (scheduling consuming Master Data). Phase 0 only establishes the contract `id + version` convention and the read-interface seam. | Phase 1. |
| O8 | **Cross-module writes** in one local transaction are a future saga/outbox point — flag with a `SKIP-06` site when first encountered. None expected in phase 0. | Completion log. |

**Kernel vs domain — don't over-bind (CLAUDE-CODE-BRIEF.md §2).** The **organizational model**
(Plant, Plant group, Customer, Program, Calendar) and identity/tenancy are *shared reference data
consumed by every module* (A10/D17) — **not** replaceable domain modules. Modules consume the org
model through a **kernel-provided read interface** (contract-shaped, boundary enforced — no reaching
into kernel tables), but it sits behind **no per-tenant binding**. There is one org model and it is
kernel. Per-tenant bindings (O7) are for *domain* contracts (net-requirements, capacity, master
data, …) — the things a third party can actually replace.

This override is recorded against the completion log: **SKIP-21** (contract registry — foundational
`id + version` built now; A12 machinery deferred), **SKIP-05** (EventBus — coordinator + local
provider built now; Kafka provider deferred), **SKIP-01** (tenancy — active now; isolation
hardening deferred), **SKIP-28** (deployment shape B — one deployable, contract-bound).

---

## 1. Domain modules & table ownership (phase 0)

One Postgres schema per module; the module's Drizzle instance is scoped to only these tables (O2).

| Module | Postgres schema | Kind | Owns tables |
|---|---|---|---|
| `tenant` | `tenant` | kernel | `tenant` (single seeded row; scoping machinery active) |
| `auth` | `auth` | kernel | `user`, `role`, `approval_tier` (refresh is stateless — see §3) |
| `org` | `org` | kernel | `plant`, `plant_group`, `plant_group_member`, `customer`, `program`, `calendar` |

**Cross-module reference in phase 0 (proves the discipline inside the kernel):** `auth.role` carries
a **data scope** that names plants/plant-groups (D33). Those are stored as **plain `text` ID arrays**
(`scoped_plant_ids`, `scoped_plant_group_ids`) — **no cross-schema FK** — and validated through the
**org read interface** (the `org.read` contract, §4 / packages/contracts) **at write time** (O4).
This is the only inter-module reference in phase 0 and is the proof of the boundary before any
domain module exists.

**Phase-0 module set (decided at build):** the demo/infra template modules are **removed** to keep
the boundary crisp and the only writer of `user` inside `auth`: `example`, `notifications`,
`storage`, and the generic `admin` (platform_config) modules are deleted, and `users` (profile
`/users/me`) is **folded into `auth`** (a `ProfileController` in the auth module). `email` +
`notifier` are kept (no tables → no schema-isolation concern) because `auth` uses them for OTP. The
canonical module *pattern* still lives in `API-ARCHITECTURE.md §1`. The single-barrel `DrizzleModule`
(`db/drizzle.module.ts`) and central `db/schema/` barrel are **removed**, replaced by one shared
`Pool` + per-module scoped Drizzle instances (§2.1).

### Module internal structure (each kernel module)

```
modules/<name>/
  <name>.module.ts
  <name>.controller.ts        ← public/read routes (JwtAuthGuard)
  <name>.admin.controller.ts  ← admin CRUD routes (JwtAuthGuard + RolesGuard), where applicable
  <name>.service.ts           ← domain logic; owns tenant scoping + ownership/validation
  <name>.repository.ts        ← Drizzle queries for THIS module's schema only
  <name>.read.ts              ← the read interface this module exposes to others (impl of its contract)
  schema/
    *.schema.ts               ← tables in this module's pgSchema('<name>')
    index.ts                  ← module-scoped barrel (only this module imports it — O3)
  dto/  types/
```

---

## 2. Persistence — per-module Drizzle isolation (O2)

> **The boundary is exactly three things** (and nothing more): (1) a per-module **Postgres schema
> namespace** (`pgSchema('<m>')`), (2) a Drizzle **instance scoped to only that module's tables**,
> and (3) the **lint rule rejecting imports of another module's `schema/`**. One shared `Pool`
> backs every instance; the migration generator is exempt from the lint rule.

### 2.1 One shared Pool, many scoped instances

A single `pg` Pool (one database) is shared; **each module gets its own Drizzle instance bound to
only its own schema barrel**, so the type of `db.query` only ever exposes that module's tables.

```ts
// db/pool.ts — one shared Pool for the deployable (single database)
export const POOL = Symbol('POOL')

// modules/org/org.db.ts — scoped instance + injection token (mirrored per module)
import * as orgSchema from './schema'
export const ORG_DB = Symbol('ORG_DB')
export type OrgDatabase = ReturnType<typeof drizzle<typeof orgSchema>>
// provider: useFactory: (pool) => drizzle(pool, { schema: orgSchema })
```

Tokens: `TENANT_DB`, `AUTH_DB`, `ORG_DB`. There is **no** global `DRIZZLE` barrel token anymore
(replaces `db/drizzle.module.ts`). A module physically cannot reference another module's tables —
its Drizzle instance has never heard of them.

### 2.2 Postgres schemas

Each module declares its tables under a named Postgres schema:

```ts
import { pgSchema } from 'drizzle-orm/pg-core'
export const orgSchema = pgSchema('org')
export const plant = orgSchema.table('plant', { /* ... */ })
```

Migrations: one `drizzle-kit` config sees every module's schema files (so migrations generate
centrally), but the **runtime** isolation (O2) and the **import** isolation (O3) are what enforce
the boundary. No cross-schema FK is ever declared.

### 2.3 Lint rule (O3)

ESLint `no-restricted-imports` zones: any file under `modules/A/**` is forbidden from importing
`modules/B/schema` (and `modules/B/*.repository`). Cross-module access is allowed **only** via
`@perduraflow/contracts` + the consumed module's exported read interface.

### 2.4 Schema rules (every table — no exceptions, per CLAUDE-CODE-BRIEF.md §2)

- `text` ULID PK, app-generated via `generateId()` (the table's own `id` is the business key the
  D-series calls `plant_id`, `customer_id`, …).
- Foreign keys are `text`, **intra-schema only**.
- **Every table carries `tenant_id` (text) and is indexed on it; every user-facing query is
  tenant-scoped** from the JWT (§3). `tenant_id` is a **plain text column, not a cross-schema FK**
  to `tenant.tenant` (O2) — validated via the tenant read interface at write.
- `created_at` `defaultNow()`; soft delete only (`is_active=false`, or a `status` transition for
  stateful entities — `plant.status`). No hard delete.
- Migrations never edited after creation.

### 2.5 Table sketches (phase 0)

> Logical shape for sign-off; exact column types finalized at implementation. All carry
> `id` (ULID PK), `tenant_id` (text, indexed), `created_at`; soft delete as noted.

**tenant.tenant** — `name`, `logo_url` (nullable; shell `OrgAvatar`, set via seed/config — SKIP-53),
`is_active`. Single seeded row; the scope root.

**auth.user** — `tenant_id`, `name`, `email` (unique), `password_hash`, `role_id` (text → `auth.role.id`,
intra-schema FK), `is_verified`, `avatar_url`, `preferences` (jsonb; per-user UI prefs e.g.
`sidebarCollapsed` — server-persisted, never browser storage), `updated_at`. *(Replaces the template's
`role` text enum with `role_id`.)* `/users/me` returns the profile + the tenant brand
(`tenantName`/`tenantLogoUrl`) so the shell renders without a second request; `PATCH /users/me` merges
a partial `preferences` patch.

**auth.role** (D33) — `tenant_id`, `name`, `is_default_seed` (bool), `data_scope`
(enum `plant|plant_group|multi_plant|tenant`), `scoped_plant_ids` (jsonb text[] — org IDs, O4),
`scoped_plant_group_ids` (jsonb text[] — org IDs, O4), `approval_tier_id` (text → `auth.approval_tier.id`,
nullable), `is_active`. Full per-dashboard action matrix is **SKIP-43** — seed the structure, not the matrix.

**auth.approval_tier** (D25 shape) — `tenant_id`, `name`, `rank` (int, ordering), `is_active`.
Minimal shape so `role.approval_tier_id` resolves; rule engine is **SKIP-46**.

**org.plant** (5.7) — `tenant_id`, `name`, `timezone`, `region`, `location`, `status` (enum `active|inactive`).

**org.plant_group** (D49) — `tenant_id`, `name`, `group_type` (enum `cluster|division|region|custom`),
`allows_resource_sharing` (bool, default `false`), `effective_from`, `effective_to`, `is_active`.

**org.plant_group_member** (D49) — `tenant_id`, `plant_group_id` (→ `org.plant_group.id`),
`plant_id` (→ `org.plant.id`). Junction (a plant may join many groups). Intra-schema FKs.

**org.customer** (5.7/D23) — `tenant_id`, `name`, `firm_fence_days` (int, nullable — the **default
firm-fence horizon** in days, D23; modeled, enforcement later — the per-line `firmness` flag is the
later operative source), `is_active`.

**org.program** (5.7/D23) — `tenant_id`, `customer_id` (→ `org.customer.id`), `name`,
`firm_fence_days` (int, nullable — **overrides the customer default** when set), `is_active`.

**org.calendar** (D17) — `tenant_id`, `plant_id` (text, nullable — tenant-level if null; **plain text,
validated via org read interface**), `name`, `shift_patterns` (jsonb), `holidays` (jsonb),
`maintenance_windows` (jsonb — **plant-level in phase 0; no `resource_id` reference yet**, resources
are phase 1), `is_active`.

---

## 3. Tenant / scope key & auth

- **Scope key:** `tenantId`. Resolved **server-side at login** (`TenantService.resolveTenantId`),
  embedded in the JWT payload, applied in **every** user-facing query (`where eq(table.tenantId, user.tenantId)`).
  Never inferred from a client parameter.
- **Active from day one** (SKIP-01) — single seeded tenant in the demo; only cross-tenant isolation
  *hardening* + the second topology are deferred.
- **Refresh token:** stateless (template default; no session table). Lifetime **90d** access **15m**
  (template). Web → httpOnly cookie `perduraflow_auth` presence + scoped refresh cookie; native → body.
- **OTP:** retained from template (email verify / reset). No change for phase 0.
- **Roles:** seeded default editable role set (D33, §3.1). RBAC depth = **SKIP-43**.
- **Biometric (native):** template default; not a phase-0 focus.
- **Guards:** `JwtAuthGuard` on protected routes; `RolesGuard` on admin CRUD (both — API §11).
  Phase-0 admin gating is by the seeded **Admin / configurator** role (`configure`).

### 3.1 Seeded default role set (D33, all editable; SKIP-43 = structure only)

`Operator / line lead`, `Scheduler / planner`, `Supervisor`, `Plant manager`,
`Materials / logistics`, `Multi-plant / exec`, `Maintenance / tooling`, `Admin / configurator`
(per spec §9). Each seeded with a `data_scope` and (where applicable) an `approval_tier_id`. Seeded
approval tiers (by rank): planner → supervisor → plant manager.

---

## 4. Contracts (`packages/contracts`) — `id + version` from day one (O1, SKIP-21)

Phase 0 introduces the **kernel org-model read interface** as the first inter-module contract.

- **`org.read` `1.0`** — the read interface the `org` module exposes to consumers (kernel-provided;
  **no per-tenant binding** — it is kernel reference data). Carries a contract descriptor
  `{ id: 'org.read', version: '1.0' }` plus typed read operations and DTOs:
  `getPlant(id)`, `listPlants()`, `getPlantGroup(id)`, `getCustomer(id)`, `getProgram(id)`,
  `getCalendar(id)`, and `validatePlantIds(ids): { valid: string[]; invalid: string[] }` used by
  `auth` to validate `role.scoped_plant_ids` at write time (O4).
- Contracts are typed interfaces + DTOs only — **no transport** (O6). The in-process implementation
  lives in `org`'s `org.read.ts`; `auth` depends on the **interface**, resolved via Nest DI now (the
  per-tenant binding **resolver** is phase 1, O7).

Deferred to later phases / SKIP-21: runtime registry, MAJOR.MINOR wire negotiation, open/closed
enum annotations, dual-publish windows, Avro/Protobuf schema registry.

---

## 5. EventBus coordinator + local provider (O5, A4, SKIP-05)

- A concrete **`EventBus`** coordinator owns envelope shape, event-name constants, and publish audit;
  it delegates `publish` / `subscribe` / `ack` to a **provider**. The only provider this session is
  **`InMemoryEventBusProvider`** (local). All cross-module events flow through it; **no raw
  `EventEmitter2` across a boundary**. Intra-module `EventEmitter2` is allowed.
- Event names are constants in `events/`. Phase-0 events are minimal (e.g. `org.plant.created`,
  `auth.user.created`) — wired so the coordinator exists and the seam is real; consumers are sparse.
- Deferred (SKIP-05): the Kafka-protocol provider, idempotency keys, ordered partitions,
  replay-for-retraining — all added behind the **same** coordinator.

---

## 6. Error codes (app-specific)

Add to `packages/contracts` `ERROR_CODES` (mirror in frontend `errors.json`):

```
PLANT_NOT_FOUND, PLANT_GROUP_NOT_FOUND, CUSTOMER_NOT_FOUND, PROGRAM_NOT_FOUND,
CALENDAR_NOT_FOUND, ROLE_NOT_FOUND, APPROVAL_TIER_NOT_FOUND,
INVALID_PLANT_REFERENCE,        // a role's scoped plant/group id did not resolve via org.read (O4)
DUPLICATE_NAME                  // unique-name conflict within tenant scope
```

---

## 7. Environment variables (app-specific)

No new vars for phase 0 beyond the template set (`DATABASE_URL`, `JWT_*`, `CORS_ORIGIN`, `PORT`,
`NODE_ENV`, `EMAIL_*`, `STORAGE_*`). EventBus local provider needs none. Future: `EVENTBUS_PROVIDER`
(default `memory`) when the Kafka provider lands (SKIP-05).

---

## 8. Real-time / WebSocket

Not used in phase 0.

---

## 9. Open API decisions

| ID | Question | Status |
|---|---|---|
| AS1 | `firm_fence` modeled as `firm_fence_days` (int days) — the default fence horizon, on `customer` with `program` override. | **Confirmed** |
| AS2 | `approval_tier` placed in the `auth` schema (RBAC/identity area). | **Confirmed** |
| AS3 | Replacing the template's single-barrel `DrizzleModule`/`DRIZZLE` token with per-module scoped instances over one shared Pool (O2). | **Confirmed** |
| AS4 | Moving schema files from central `db/schema/` into `modules/<m>/schema/` to make O3 enforceable; migration generator exempt. | **Confirmed** |

---

# Phase 1 — Master Data (BUILT)

> **STATUS: BUILT & verified.** Source:
> `docs/CLAUDE-CODE-BRIEF-PHASE-1.md`, `docs/master-data-module-spec.md` (MD1–MD15),
> scheduling spec §5.2–5.4 (routing/operation, resource, changeover), D7/D54/D57. All §0 override
> rules (O1–O8) and §2 schema rules carry forward unchanged.

## 10. Phase-1 modules & table ownership

| Module | Postgres schema | Kind | Owns / changes |
|---|---|---|---|
| `master-data` *(new — first domain module)* | `master_data` | **domain** | `part`, `resource`, `resource_group`, `resource_group_member`, `routing`, `routing_operation`, `certification`, `operator`, `operator_qualification` |
| `org` *(edit existing kernel module)* | `org` | kernel | **add `priority`** to `customer` and `program` |

**Two architectural firsts (brief §0), both load-bearing:**
1. **First domain module.** `master-data` gets its own `pgSchema('master_data')` + a Drizzle
   instance scoped to only its tables (`MASTERDATA_DB` token), following the proven O2 pattern. It is
   a **domain** module (unlike the kernel modules), so its contract sits behind a per-tenant binding
   *in principle* (O7) — but the **binding resolver is NOT built** (first consumer is scheduling,
   phase 2). `master-data` only *publishes* its contract now.
2. **First contract *consumption* across a domain→kernel boundary.** `resource.plant_id` /
   `resource.calendar_id` reference `org` **through `org.read`** (text IDs, validated at write, no
   cross-schema FK — O4), exercising the consumer side of the contract model for the first time.

### 10.1 `master_data` table sketches (O2/§2.4 rules apply: ULID PK, `tenant_id` + index, `created_at`, soft-delete)

> Phase-1 **minimal** slice of the full Master Data module (SKIP-02). Deferred & logged:
> revision/effectivity — **current-version only** (SKIP-44); BOM (SKIP-45); UoM conversion / multi-UoM
> — **single base UoM per part, no factors** (SKIP-02); tooling/asset domain (tools/dies/molds),
> physical-attribute domain, asset↔part mapping (SKIP-02); changeover matrix + sequencing rules
> (SKIP-48, scheduling-owned); operator rostering / station assignment (SKIP-14); margin/penalty order
> economics (SKIP-13 — only customer/program **priority** is in). New scope-downs surfaced during
> build get their own SKIP row.

**master_data.part** (MD1/5.1; brief §3) — `tenant_id`, `part_no` (text, **unique within tenant** —
the global-within-tenant business identity, D12), `description` (text, nullable), `part_type`
(enum `finished|component|raw`), `uom` (text — the part's canonical **base** UoM; single UoM, no
conversion SKIP-02), **`material`** (text, nullable), **`gauge`** (text, nullable), **`colour`**
(text, nullable) — physical/descriptive attributes (MD11/5.6), the **canonical changeover drivers**
the operation's `changeover_attribute_key` names (AS6), `status` (enum `active|inactive`).
*(`part_type`/`description`/`status` are MDQ4-deferred fields, and material/gauge/colour are the MD11
attributes — pulled in now because the Parts screen + changeover modeling are their consuming need,
each an additive use; revision/effectivity stay deferred, SKIP-44. `tool_family` attribute stays out
until the tooling/asset domain lands, SKIP-02.)*

**master_data.resource** (MD14/5.5; brief §3) — `tenant_id`, `name`, `resource_type`
(enum `line|machine|cell|work_center`), `plant_id` (**text → `org` via `org.read`**, validated at
write, no FK — O4), `calendar_id` (**text → `org` via `org.read 1.1`**, validated, no FK), **`rate`** (decimal, nullable
— nominal throughput rate, MD5.5), **`rate_uom`** (text, nullable), `status`
(enum `active|inactive`). The per-operation `std_cycle_time`/`std_setup_time` remain the scheduling
baseline (D7); the resource `rate` is a nominal descriptor (AS5). *(MD5.5's single `resource_group_id`
is superseded by the many-to-many membership below — a resource may belong to multiple groups, §5.3.)*

**master_data.resource_group** (MD14/5.3) — `tenant_id`, `name`, `plant_id` (text → `org` via
`org.read`, validated), `is_active`.

**master_data.resource_group_member** (MD14) — `tenant_id`, `resource_group_id` (→
`master_data.resource_group.id`, **intra-schema FK**), `resource_id` (→ `master_data.resource.id`,
intra FK). Junction (a resource joins many groups).

**master_data.routing** (5.2; brief §3) — `tenant_id`, `part_id` (→ `master_data.part.id`, intra
FK), `name` (text), `is_primary` (bool, default `true`), `status` (enum `active|inactive`).
Current-version only (SKIP-44); alternates/`preference_rank`/`plant_id` deferred.

**master_data.routing_operation** (5.2; brief §3; D7 baseline) — `tenant_id`, `routing_id` (→
`master_data.routing.id`, intra FK), `op_seq` (int), `resource_group_id` (→
`master_data.resource_group.id`, intra FK — the eligible group, 5.2), `std_setup_time` (decimal —
the standalone setup **`standard` baseline**, D7), `std_cycle_time` (decimal — per-piece **`standard`
baseline**, D7), `changeover_attribute_key` (enum `colour|material|gauge`, nullable — names which
**part** physical attribute (5.6) drives this op's changeover; **modeled, not sequenced**; AS6).
*(Phase-2 schedule records will carry `setup_source`/`cycle_source` defaulting to `standard` = these
values, SKIP-04.)*

**master_data.certification** (MD15) — `tenant_id`, `code` (text, **unique within tenant**), `name`
(text), `description` (text, nullable), `is_active`. The cert taxonomy behind the scheduler's
certification-grain constraint (D54) — **externally sourced, canonical view only**; mappings live in
the integration layer, not here.

**master_data.operator** (MD15 minimal stub) — `tenant_id`, `name`, `home_plant_id` (text → `org`
via `org.read`, validated), `labor_rate` (decimal, nullable — the optional MD15 labor-rate behind the
D57 labor-cost KPI), `is_active`. **Externally-sourced stub; Master Data does not roster operators**
(SKIP-14).

**master_data.operator_qualification** (MD15 join) — `tenant_id`, `operator_id` (→
`master_data.operator.id`, intra FK), `certification_id` (→ `master_data.certification.id`, intra
FK). Operator×certification many-to-many.

### 10.2 `org` edit — customer/program priority

Add `priority` to **`org.customer`** and **`org.program`**, mirroring the existing firm-fence
default/override pattern (D23 shape; brief §3):

- **`org.customer.priority`** — enum `standard|high|critical`, **default `standard`** (the tenant's
  default allocation tier for the customer's orders).
- **`org.program.priority`** — enum `standard|high|critical`, **nullable** — **overrides** the
  customer default when set (parallels `program.firm_fence_days`).

> A simple **ordinal tier**, not a commercial engine: it's the canonical reference behind
> allocation-by-priority (NMA, SKIP-13); margin/penalty economics stay deferred (SKIP-13/MD15).
> Externally sourced in principle (MD15); seeded for the demo.

### 10.3 Contracts — `org.read 1.1` (additive) + publish `masterdata.read 1.0`

**`org.read` `1.0` → `1.1` — additive MINOR only** (A12: every `1.0` consumer keeps compiling; the
phase-0 `auth` consumer of `validatePlantIds`/`validatePlantGroupIds` is **unchanged** — proof in DoD):
- **Add** `validateCalendarIds(tenantId, ids): PlantRefValidation` — so `master-data` can validate
  `resource.calendar_id` at write (O4), the calendar analogue of `validatePlantIds`.
- **Add** `priority` to `CustomerDto` and `ProgramDto` (additive field; must-ignore for `1.0`
  consumers).
- Bump `ORG_READ_CONTRACT.version` → `'1.1'`.

**Publish `masterdata.read` `1.0`** in `packages/contracts` with `{ id: 'masterdata.read', version:
'1.0' }` (O1, SKIP-21) — the read interface phase-2 scheduling will bind to. **No binding resolver
built** (O7 — first consumer is phase 2). Carries:
- DTOs: `PartDto` (incl. `material`/`gauge`/`colour`), `ResourceDto` (incl. `rate`/`rateUom`),
  `ResourceGroupDto`, `RoutingDto` (header + nested `operations: RoutingOperationDto[]` with
  `changeoverAttributeKey`), `CertificationDto`, `OperatorDto` (+ `certificationIds: string[]`).
- Read ops: `getPart`/`listParts`, `getResource`, `getResourceGroup`, `getRouting` (with operations),
  `listCertifications`, `getOperator`.
- Reference-validation (the O4 seam phase-2 consumers will use): `validateResourceIds`,
  `validateResourceGroupIds`, `validatePartIds`.
- Typed interfaces + DTOs only, **no transport** (O6); in-process impl in `master-data`'s
  `master-data.read.ts`, resolved via Nest DI (no resolver yet).

`master-data` **consumes** `org.read 1.1` for plant/calendar validation; it **does not** import any
`org` table (O1/O3).

### 10.4 Error codes (add to §6 `ERROR_CODES` + mirror in `errors.json`)

```
PART_NOT_FOUND, RESOURCE_NOT_FOUND, RESOURCE_GROUP_NOT_FOUND, ROUTING_NOT_FOUND,
ROUTING_OPERATION_NOT_FOUND, CERTIFICATION_NOT_FOUND, OPERATOR_NOT_FOUND,
INVALID_CALENDAR_REFERENCE,        // resource.calendar_id did not resolve via org.read 1.1 (O4)
INVALID_RESOURCE_REFERENCE,        // a resource_group_member / op target id did not resolve (O4)
INVALID_RESOURCE_GROUP_REFERENCE,  // an operation's resource_group_id did not resolve (O4)
DUPLICATE_PART_NO, DUPLICATE_CERTIFICATION_CODE   // unique business-key conflict within tenant
```
*(`INVALID_PLANT_REFERENCE` is reused for `resource.plant_id` / `operator.home_plant_id`.)*

### 10.5 EventBus (O5) — minimal phase-1 events

`master-data` emits `master_data.part.created`, `master_data.resource.created`, etc. through the same
`EventBus` coordinator (no new provider). Consumers sparse this phase; the seam stays real. No
cross-module **write** transaction expected (O8); flag SKIP-06 if one appears.

### 10.6 Open phase-1 API decisions (the brief §5 "items to propose" — see also frontend-spec FS5–FS8)

| ID | Question | Proposed | Status |
|---|---|---|---|
| AS5 | **Resource capacity granularity.** Where does ideal cycle/setup live; does `resource` carry a nominal rate? | Cycle/setup at **`routing_operation`** grain (`std_cycle_time`/`std_setup_time`, D7); **`resource` ALSO carries a nominal `rate` + `rate_uom`** (MD5.5, nullable). | **Confirmed** (resource has a nominal rate) |
| AS6 | **Changeover attributes on the operation.** What does `routing_operation` carry now (modeled, not sequenced) vs deferred? | **Add part physical attributes** `material`/`gauge`/`colour` to `part` now (MD11/5.6); `routing_operation.changeover_attribute_key` (enum `colour|material|gauge`, nullable) names which part attribute drives changeover — **modeled, not sequenced**. The **changeover matrix + sequencing rules stay scheduling-owned & deferred** (SKIP-48). | **Confirmed** (part attrs added) |
| AS7 | **Operation target grain.** Does an operation target a resource **group** or a specific resource? | Target a **`resource_group_id`** (the eligible group, 5.2) — matches scheduling's eligibility grain. No direct single-resource targeting in phase 1. | **Confirmed** |
| AS8 | **Priority representation.** Ordinal int vs named tier? | Named **tier enum `standard|high|critical`** (customer default, program override) — demo-friendly, mirrors firm-fence. | **Confirmed** |
