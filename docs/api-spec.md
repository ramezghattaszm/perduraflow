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
> - **Phase 2 (§11): BUILT & verified.** The second domain module (`scheduling`) + the **first
>   per-tenant binding resolver** (`binding` kernel module) consuming `masterdata.read`, a deterministic
>   EDD penalty sequencer (firm-dominant, SKIP-03 stand-in), seeded `demand_input`, and `masterdata.read
>   1.0 → 1.1` (additive). Migration `0004` applied + seeded; all five boundary/determinism proofs pass;
>   the read-first board renders web + native.

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

---

# Phase 2 — Scheduling (BUILT)

> **STATUS: BUILT & verified** (migration `0004`; binding resolver + EDD sequencer; board web + native;
> all five DoD proofs pass). Source: `docs/CLAUDE-CODE-BRIEF-PHASE-2.md`, scheduling spec §4.1/§4.4/§4.9, §5.3/§5.4,
> D2/D4/D7/D18, platform-arch A8 / §6.3 (binding model). All §0 override rules (O1–O8) + §2 schema
> rules carry forward unchanged.

## 11. Phase-2 module & the first binding resolver

| Module | Postgres schema | Kind | Owns / changes |
|---|---|---|---|
| `scheduling` *(new — second domain module)* | `scheduling` | **domain** | `demand_input`, `optimizer_run`, `schedule_version`, `scheduled_operation` |
| `binding` *(new — kernel construct)* | `binding` *(table per AS12)* | kernel | `contract_binding` (per-tenant contract→counterpart bindings) + the `BindingResolver` |
| `master-data` *(edit)* | `master_data` | domain | **`masterdata.read 1.0 → 1.1`** (additive: `listResources`, `getPrimaryRoutingForPart`) |

**The architectural first — the per-tenant binding resolver.** Phase 1 *published* `masterdata.read`;
phase 2 is its first consumer. Scheduling never injects `MASTERDATA_READ` directly — it asks the
**`BindingResolver`** for the counterpart bound to `masterdata.read` **for the caller's tenant** (O7,
A8 §6.3). Only the `platform_module` counterpart (the Phase-1 module) is implemented; `connector |
upload | native` remain later config, not code. Re-binding needs **zero scheduling code change** —
the headline boundary proof. **Kernel contracts (`org.read`) are still consumed directly** — bindings
are for *domain* contracts only.

### 11.1 Binding resolver (O7, A8 §6.3)

- **`BindingResolver`** (kernel `binding` module) resolves `(tenantId, contract)` → the counterpart
  implementation. It reads the per-tenant binding **mode** (default `platform_module`) and returns the
  counterpart registered for that mode.
- **Counterpart registry — composition-root wiring (A2):** each domain module that *fulfils* a
  contract registers its read service as a counterpart `{ contractId, mode, impl }` at the app
  composition root (so the `binding` module imports no domain module — O1). Phase 2 registers exactly
  one: `{ 'masterdata.read', 'platform_module', MASTERDATA_READ }`.
- **Consumer side:** `scheduling` injects `BindingResolver` and calls
  `resolver.resolve<MasterDataReadContract>(tenantId, MASTERDATA_READ_CONTRACT)` → a
  `MasterDataReadContract`. It depends on the **contract interface + the resolver**, never on
  `master-data`. Swapping the bound mode (or counterpart) changes only registry/config — proof #3.
- **Versioning:** a binding records `contract_id + major` (A12: pin major, float minor). Phase 2 pins
  `masterdata.read` major `1`; the additive `1.1` (11.3) floats in with no binding change.

### 11.2 `scheduling` table sketches (O2/§2.4 rules: ULID PK, `tenant_id` + index, `created_at`, soft-delete)

> Deterministic spine only (D2). Deferred & logged: actuals/closed-loop/ML/metrics/what-if/baseline/
> narration/stability (Phase 3+); net-requirements netting — **demand is a seeded fixture** (SKIP-10);
> the real optimizer (SKIP-03); approval policy stage-2 (SKIP-46); the virtualized authoring canvas
> (SKIP-40). **`setup_source`/`cycle_source`/`*_confidence` are wired now but empty** (SKIP-04).

**scheduling.demand_input** (§4.1, **seeded** — SKIP-10) — `tenant_id`, `demand_line_id` (text,
business ref), `release_reference` (text), `part_id` (**text → `masterdata.read`**, no FK),
`plant_id` (text → `org`), `customer_id` (text → `org`), `program_id` (text → `org`, nullable),
`demand_type` (enum `JIT|JIS|stock`, default `stock`), `firmness` (enum `firm|forecast`),
`required_qty` (decimal — **pre-netted**, D14/D20, not netted here), `uom` (text),
`required_date` (timestamptz), `is_active`. *(Minimal subset of §4.1; JIS block, CUM, delivery
windows deferred. Priority is read from `org` customer/program, not stored here.)*

**scheduling.optimizer_run** (§4.9) — `tenant_id`, `plant_id` (text → `org`), `trigger`
(enum `manual|scheduled|event|what_if`, phase 2 uses `manual`), `objective_summary` (text — names the
heuristic, e.g. "EDD changeover-aware (SKIP-03 stand-in)"), `status` (enum `success|infeasible|failed`),
**`stop_reason`** (text — why the run ended; deterministic-termination discipline, A16), `started_at`,
`finished_at`, `input_demand_count` (int — input snapshot size). The run header backs the board,
re-solve, and later what-if.

**scheduling.schedule_version** (§4.9) — `tenant_id`, `plant_id` (text → `org`), `status`
(enum `draft|committed|superseded`, AS11), `horizon_start` / `horizon_end` (timestamptz),
`optimizer_run_id` (→ `scheduling.optimizer_run.id`, **intra-schema FK**),
`supersedes_version_id` (→ `scheduling.schedule_version.id`, nullable, intra FK), `created_at`.

**scheduling.scheduled_operation** (§4.4, committed schedule) — `tenant_id`,
`schedule_version_id` (→ `scheduling.schedule_version.id`, intra FK), `demand_line_id` (text — the
satisfied demand line; traceability), `part_id` (**text → `masterdata.read`**),
`routing_operation_id` (**text → `masterdata.read`**), `resource_id` (**text → `masterdata.read`** —
the assigned member of the op's resource group), `op_seq` (int), `sequence_position` (int — position
in the resource's queue), `planned_start` / `planned_end` (timestamptz), `planned_qty` (decimal),
`setup_time` (decimal — effective setup used) / `cycle_time` (decimal — from `routing_operation`
std times, D7), **`setup_source`** (enum `standard|ml_adjusted`, **default `standard`**) /
**`cycle_source`** (enum, **default `standard`**), **`setup_confidence`** / **`cycle_confidence`**
(decimal, **nullable, default null**), `at_risk` (bool, default false), `at_risk_reason` (text,
nullable). **No FK to `master_data` or `org`** — all cross-module refs are text, resolved/validated
through the binding-resolved contract (proof #2).

### 11.3 `masterdata.read 1.0 → 1.1` (additive MINOR — A12, no consumer breakage)

The sequencer needs to resolve a demand part → its routing/operations, and the board needs resource
names; `1.0` exposes neither as a list/lookup. **Additive** additions (every `1.0` consumer keeps
compiling; the Phase-1 module is the producer and is unaffected):
- `listResources(tenantId): ResourceDto[]` — board rows + group-member → resource detail.
- `getPrimaryRoutingForPart(tenantId, partId): RoutingDto | null` — the active primary routing (with
  operations) for a demand part.
- Bump `MASTERDATA_READ_CONTRACT.version` → `'1.1'`. Bindings pin major `1`, so this floats in with
  no binding/resolver change.

### 11.4 Sequencer (SKIP-03) — deterministic EDD, changeover-aware (see AS9)

A transparent, reproducible heuristic — **explicitly a placeholder** for the real optimizer (D18/AQ6);
`objective_summary` labels it. Per plant, over the seeded firm demand within the horizon:
1. **Resolve** each demand line's part → primary routing → operations via the bound `masterdata.read`;
   each operation's `resource_group_id` → its eligible **active** member resources. Unresolvable
   part/routing or **no eligible resource = hard-gate failure (D4)** → run `status=infeasible`,
   `stop_reason` records the offending line; that op is not scheduled.
2. **Place** by a deterministic greedy over a **changeover-penalty model** (AS9). Maintain per-resource
   free-time (init `horizon_start`) and current changeover-attribute. Repeatedly select the next
   unplaced op minimizing
   `score = W_LATE(firmness)·max(0, projectedLatenessHours) + W_CHG·changeoverCost`, assigning it to the
   **least-loaded** eligible member (earliest free-time; tie-break lowest `resource_id`) — AS10;
   `changeoverCost = 0` if the op shares that resource's current attribute else a flat
   `CHANGEOVER_PENALTY` (matrix deferred SKIP-48 → flat per-switch cost).
   **Firm-lateness dominance (D13/D23):** `W_LATE` is firmness-weighted — `W_LATE_FIRM ≫ CHANGEOVER_PENALTY`
   so a **firm** line's lateness can **never** be traded away for a changeover saving (firm orders
   sequence effectively EDD-strict, protecting delivery), while `W_LATE_FORECAST` is modest so
   **forecast** lines may flex to group changeovers. All weights are **documented constants** (D48
   defaults); total-order tie-break `firmness(firm first) → required_date → priority (org) → part_no →
   demand_line_id`. Each op records its score components, so the choice is explainable.
3. **Time** each placement: `planned_start = max(assigned-resource free, horizon_start)`,
   `planned_end = start + setup_time + cycle_time × qty`; update that resource's free-time + current
   attribute. `setup_time`/`cycle_time` from the routing operation's std times (D7);
   `setup_source`/`cycle_source = standard`. **Delivery-window gate (D4):** `planned_end > required_date`
   → `at_risk=true`, `at_risk_reason='late'` (scheduled late, not dropped; a late **firm** line is the
   serious case the dominance rule minimizes).
4. **Determinism (D2):** the schedule timeline anchors to a **deterministic origin** (`horizon_start` =
   start-of-day of the earliest demand `required_date`, or a configured value) — **never `Date.now()`** —
   so re-running the same seed yields identical `scheduled_operation` rows (planned times + sequence).
   Only `optimizer_run.started_at/finished_at` are wall-clock; the schedule is byte-identical (proof #5).

Produces one `optimizer_run` + one `schedule_version` (lifecycle AS11).

### 11.5 Endpoints

Reads (`JwtAuthGuard`, tenant-scoped): `GET /scheduling/versions?plantId=` (selector list),
`GET /scheduling/versions/:id` (header + `scheduled_operation`s — board data),
`GET /scheduling/demand?plantId=` (seeded demand, read-only), `GET /scheduling/resources?plantId=`
(board rows, via the bound contract). Writes (`JwtAuthGuard + ConfigureGuard`):
`POST /admin/scheduling/solve { plantId }` — runs the sequencer, creates run + a **`draft`** version,
returns it (the board's "re-solve"); `POST /admin/scheduling/versions/:id/commit` — promotes
`draft → committed`, supersedes the plant's prior committed (AS11).

### 11.6 Error codes (add to §6 `ERROR_CODES` + `errors.json`)

```
SCHEDULE_VERSION_NOT_FOUND, OPTIMIZER_RUN_FAILED,
SCHEDULE_INFEASIBLE,          // a demand op had no eligible resource / unresolvable ref (D4 hard gate)
NO_DEMAND_TO_SCHEDULE         // solve called with no active firm demand in the horizon
```

### 11.7 EventBus (O5) — minimal phase-2 events

`scheduling.run.completed`, `scheduling.version.committed` through the same coordinator. No
cross-module **write** (O8); the run only *reads* master-data through the resolved contract.

### 11.8 Open phase-2 API decisions (brief §5 — see also frontend-spec FS9–FS11)

| ID | Question | Proposed | Status |
|---|---|---|---|
| AS9 | **EDD changeover-aware rule.** How does changeover-awareness compose with EDD, staying deterministic/explainable? | **Changeover-penalty model with firm-lateness dominance** (CONFIRMED): greedy minimizing `W_LATE(firmness)·latenessHours + W_CHG·changeoverCost` (flat per-switch cost; matrix deferred SKIP-48). **`W_LATE_FIRM ≫ CHANGEOVER_PENALTY`** → a firm line's lateness is never traded for a changeover (firm = effectively EDD-strict, D13/D23); `W_LATE_FORECAST` modest → forecast lines flex to group changeovers. Documented constant weights; total-order tie-break (`firmness → required_date → priority → part_no → demand_line_id`); deterministic + explainable (per-op score components recorded). | **Confirmed** (penalty term, firm-dominant) |
| AS10 | **Resource assignment within a group.** An op targets a resource *group*; which member runs it? | The **least-loaded** eligible active member — earliest current free-time; tie-break lowest `resource_id` (CONFIRMED). Spreads load across interchangeable members; deterministic. | **Confirmed** (least-loaded) |
| AS11 | **`schedule_version` lifecycle.** How does re-solve relate to versions? | **Draft-then-commit** (CONFIRMED by review): each `solve` → a new `optimizer_run` + a new `schedule_version` in status **`draft`** (passing the D4 hard gates; an `infeasible` run produces no version). A planner **Commit** action (`POST …/versions/:id/commit`) promotes `draft → committed` and supersedes the plant's current `committed` (`supersedes_version_id` set) — at most one `committed` per plant, drafts/superseded retained. The commit step is the seam the Phase-3 **approval policy** (SKIP-46) will gate; no approval routing yet. | **Confirmed** (draft-then-commit) |
| AS12 | **Binding store.** Where does the per-tenant binding config live? | A seeded kernel **`binding.contract_binding`** table `(tenant_id, contract_id, major, mode)` — D42-governed config, seeded `(tenant, 'masterdata.read', '1', 'platform_module')`. Makes per-tenant binding real + re-bind = a row change (proof #3 concrete). (Alternative: a code-level default map, no table — lighter but less faithful to "bindings are tenant config" A8 §6.3.) | **Confirmed** (binding table) |
