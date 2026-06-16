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

---

# Phase 3 — Execution actuals + closed-loop learning (BUILT — gates green; browser verification with user)

> **STATUS: BUILT & API-verified** (migration `0005`; `learning` module + damped rule + simulator;
> `bun run check` + `next build` + expo tsc green; five proofs + per-version isolation verified via the
> real query path). AS13–AS18 implemented as proposed. Draft deltas for
> `docs/CLAUDE-CODE-BRIEF-PHASE-3.md` §4 step 1. **A18 governs**
> (reproducible · explainable · bounded; Tier-1 fully-autonomous-but-damped). Source refs: scheduling
> spec §4.3 (actuals) / §4.4 (committed schedule) / §4.5 (deviation), D3/D5/D7/D41/D54/D56/D57, platform
> A14 (ML = platform capability) / A18 (trust envelope) / A19 (narration hook). All §0 override rules
> (O1–O8) + §2 schema rules carry forward unchanged. **Nothing implemented yet.**

## 12. Phase-3 modules & ownership

| Module | Postgres schema | Kind | Owns / changes |
|---|---|---|---|
| `learning` *(new — platform ML capability, A14)* | `learning` | capability module | `execution_actual` (4.3, append-only), `learned_parameter` (D7 overlay). Runs the **damped learning rule** + guardrails; publishes `learning.read 1.0`; emits drift/wear + learned-update events |
| `scheduling` *(edit)* | `scheduling` | domain | **Consumes `learning.read`** at solve → overlays learned cycle/setup (`*_source = ml_adjusted`, `*_confidence` set); computes **performance variance** (4.4↔4.3) + **Tier-B cost/unit**. Hosts the **demo simulator** fixture (SKIP-51). No schema change to `scheduled_operation` (SKIP-04 fields already exist — proof #1) |
| `master-data` *(edit)* | `master_data` | domain | **`masterdata.read 1.1 → 1.2`** (additive): expose **cost rates** (resource run/ setup cost, overhead) for the Tier-B calc; cost *rates* stay Master-Data-owned, the *calculation* lives in scheduling |

**Module-placement ruling (brief §3 "scheduling vs sibling") — see AS13.** Actuals + learning live in a
**sibling `learning` module**, not in `scheduling` — A14 makes parameter learning a **platform capability**
(NMA + the Phase-4 predictor reuse it), and the boundary rules want a scoped schema with no cross-module
`schema/` reach. Scheduling consumes learned values **only** through the published `learning.read` contract
(like a kernel read capability; A14 — not a per-tenant binding, learning is not a swappable domain
counterpart). The **simulator** is a clearly-separated demo fixture **in `scheduling`** (it already owns the
committed schedule, so it needs no contract to read it) that emits 4.3-shaped actuals onto the **EventBus**;
`learning` subscribes and persists them. Scheduling→learning is **event-only** (O8: no cross-module write),
the real closed-loop shape (A4 actuals stream / D5 replay), and the simulator is cleanly swappable for a real
MES connector behind the same actuals event (SKIP-51).

### 12.1 `learning` table sketches (O2/§2.4 rules: ULID PK, `tenant_id` + index, `created_at`)

> **No migration touches `scheduling.scheduled_operation`** — its `setup_source`/`cycle_source`/
> `*_confidence` exist from Phase-2 `0004` (SKIP-04). Phase 3 adds a `learning` schema only. Migration `0005`.

**learning.execution_actual** (§4.3, **append-only — D5/D57 retain forever**, no soft-delete: actuals are
immutable history) — `tenant_id`, `actual_event_id` (text, business ref, unique-within-tenant),
`schedule_version_id` (text → `scheduling`, no FK), `scheduled_operation_id` (text → `scheduling`, no FK —
the `schedule_job_id` link, 4.3), `resource_id` (text → `masterdata.read`), `routing_operation_id` (text →
`masterdata.read`), `part_id` (text → `masterdata.read`), `actual_start` / `actual_end` (timestamptz),
`actual_setup_time` (decimal, nullable), `actual_cycle_time` (decimal, nullable), `good_qty` (decimal),
`scrap_qty` (decimal, default 0), `downtime_minutes` (decimal, default 0), `downtime_reason` (text,
nullable), `source` (enum `simulator|manual`, default `simulator` — SKIP-51 provenance), `seq` (int — the
deterministic emission order within a run, so windowed learning is order-stable, D2). **Append-only**: never
updated/deleted (Phase-5 measured baseline D57 + replay D5 read this tail).

**learning.learned_parameter** (D7 overlay — the **structured** learned record; A18 provenance) — `tenant_id`,
`resource_id` (text), `routing_operation_id` (text), `param` (enum `cycle|setup`), `std_baseline` (decimal —
the master-data standard at adoption, retained alongside; D7), `learned_value` (decimal, nullable — the
current settled step; null = not yet adopted, scheduler uses standard), `source` (enum `standard|ml_adjusted`
— mirrors the board's tag), `confidence` (decimal 0–1, nullable), `sample_count` (int), `window_size` (int),
`window_mean` (decimal) / `window_stddev` (decimal — the basis behind the value, explainability A18/A19),
`status` (enum `learning|held|rejected` — `rejected` = breached a guardrail, kept standard, flagged),
`last_stepped_at` (timestamptz, nullable — when it last took a decisive step; **not** per-actual),
`updated_at`. **Unique** `(tenant_id, resource_id, routing_operation_id, param)` — one settled record per
parameter, **not** a time series (convergence-not-motion; the *actuals* are the series, this is the held
step). Structured value+source+confidence+basis = the Phase-4-predictor-readable / Phase-5-narratable shape
(forward-hooks).

### 12.2 Actuals ingestion + the simulator (SKIP-51)

- **Ingestion** (`learning`): subscribes to `execution.actual.recorded` (EventBus) and **appends** an
  `execution_actual` row (idempotent on `actual_event_id`); each append re-runs the damped rule (§12.3) for
  the affected `(resource, routing_operation, param)`. A direct `POST /learning/actuals` (manual entry,
  `source=manual`) exists for completeness but the demo path is the event.
- **Simulator** (`scheduling`, demo fixture — dev/staging only, **never in operational/admin nav**): reads a
  **committed** `schedule_version`'s `scheduled_operation`s (own module) and, in deterministic `seq` order,
  emits one 4.3 actual per op. Default model: `actual = planned × (1 + ε)`, `ε` from a **seeded PRNG**
  (seed = `versionId : seq`, small bounded noise ±~3%) → reproducible (D2). `good_qty`/`scrap_qty` from a
  seeded yield; `downtime_minutes` from a seeded availability draw. See AS15 for the **drift trigger**.

### 12.3 The damped learning rule (the load-bearing decision — AS14)

Per `(tenant, resource_id, routing_operation_id, param)` over the **ordered** actuals series (by `seq`):

- `n` = sample count; `μ_w`, `σ_w` = mean/stddev of the **trailing window** `W = WINDOW (8)` (or all if fewer).
- **Confidence** `c = clamp(n / N_TRUST, 0,1) · (1 − clamp((σ_w/μ_w) / CV_MAX, 0,1))` — rises with samples,
  penalised by dispersion. Constants `N_TRUST=8`, `CV_MAX=0.5` (documented D48 defaults; per-tenant
  configurable later D42). Deterministic from the series → reproducible (D2/A18).
- **State machine with hysteresis (the damping — "decisive step, then hold"):**
  - `status=learning`, `learned_value=null` → scheduler uses **standard**.
  - **Adopt (one decisive step):** when `n ≥ MIN_SAMPLES (5)` **and** `c ≥ CONF_ADOPT (0.6)` **and**
    `|μ_w − std|/std ≥ STEP_BAND (0.05)` → set `learned_value = μ_w`, `source=ml_adjusted`, `status=held`,
    stamp `last_stepped_at`. (Standard → learned in **one** move, not a crawl.)
  - **Hold (convergence, not motion):** once `held`, further actuals **do not move** `learned_value` unless a
    **new sustained material drift** clears `|μ_w − learned_value|/learned_value ≥ RESTEP_BAND (0.08)` across
    the full window → then one **re-step** to the new `μ_w` (a new settled value). Small fluctuations inside
    the band never move it; `confidence` keeps rising with `n` while the value holds.
- **Why snap-on-gate, not EWMA:** an EWMA "slow factor" still produces a **visibly moving** number every
  actual — it fights the storyboard ("the board shows the step, not the stream"). The damping lives in the
  **gate** (min-samples + confidence + sustained-band), so the displayed value is a *settled step*. EWMA is the
  considered-and-rejected alternative (AS14).
- **Determinism (D2/proof #3):** identical actuals (same seed) → identical `learned_value`, `confidence`,
  `status`, and therefore identical re-solved schedule. All thresholds are documented constants.

### 12.4 Guardrail bounds (A18 *bounded* — AS16, proof #4)

A learned value passes these **before the scheduler may use it**:

- **Max deviation:** `|learned_value − std|/std ≤ MAX_DEV (0.5)`. Breach → **do not adopt**, keep `standard`,
  set `status=rejected`, emit `learning.anomaly.flagged` (notification) — *rejected, not silently committed*
  (the demonstrable bound).
- **Confidence-to-use:** the scheduler overlays a learned value only when `status=held` **and**
  `confidence ≥ CONF_USE (0.6)`; otherwise it uses `standard` (a recorded-but-untrusted value never reaches a
  committed schedule).
- **Positivity / sanity:** `learned_value > 0` and within absolute sane limits.
- **Near-horizon stability (D44 seam):** learned re-steps apply on the **next solve** (a new `draft`), never
  retroactively to an in-execution/committed op — the Phase-2 draft-then-commit split already enforces this;
  full stability-window protection is SKIP-49.

### 12.5 Learned values into the schedule (SKIP-04 goes live — behavior-only, proof #1)

At solve, for each placed op the sequencer calls `learning.read.getLearnedParameter(tenant, resourceId,
routingOperationId, param)`:
- returns a `held`, guardrail-passing value → use it for `setup_time`/`cycle_time`; set
  `setup_source`/`cycle_source = ml_adjusted` and `*_confidence`. The higher learned cycle on the drifted
  resource lengthens its ops → the greedy **re-sequences to avoid starvation** (the demo beat).
- returns null / not-yet-trusted → keep `standard` (today's behavior).

**No schema change, no board restructure** — only the values written into the already-existing
`scheduled_operation` fields change. Show the diff is behavior-only (proof #1).

### 12.6 Performance variance (deterministic, no ML — AS17)

Computed in `scheduling` from `scheduled_operation` (4.4) ↔ `execution_actual` (4.3), per resource/line over
the version window (all **derived from rows**, no literals):
- **Throughput attainment** = Σ actual `good_qty` / Σ planned `planned_qty`.
- **Behind-plan %** = `1 − attainment` (the "Line A running N% behind" chip).
- **Schedule adherence** = ops started within tolerance of `planned_start` / total ops.
- **Churn metric (D57)** = ops whose `(resource, sequence_position, planned_start)` changed beyond a
  threshold between the prior committed version and the new one / total ops.
- **OEE A·P·Q** (Scorecard): Availability = runtime/(runtime+downtime); Performance = (std_cycle×good_qty)/
  runtime; Quality = good_qty/(good_qty+scrap_qty); OEE = A·P·Q. **In scope:** Scorecard breakdown + blended
  OEE. **Deferred (note):** a standalone per-shift OEE trend dashboard (not demo-critical).

### 12.7 Tool-wear flag (D56)

The same drift the learning rule acts on: when a `cycle` parameter's `learned_value` is adopted/re-stepped
**above** `std` by ≥ `WEAR_THRESHOLD (configurable; default = STEP_BAND)` and sustained, `learning` emits a
typed **`learning.drift.detected`** event `{resourceId, routingOperationId, deviationPct, confidence}` to the
notification surface (SKIP-23, bell/toast). **A signal only** — not maintenance scheduling (SKIP-15). It is a
byproduct of learning the true cycle, not separate machinery (D56).

### 12.8 Tier-B cost model (cost/unit — AS18)

- **Rates are Master-Data-owned** (seeded engineering reference; `masterdata.read 1.2` exposes them):
  resource `run_cost_per_hour`, `setup_cost`, plant/tenant `overhead_per_unit`; labor from existing
  `operator.labor_rate` (MD15). The **calculation lives in scheduling** (it costs the schedule it produces).
- **Cost/unit** (per op, then aggregated) = `(setup_cost + run_cost_per_hour × runtimeHours +
  laborComponent + overhead_per_unit × good_qty) / good_qty`. Computed from **seeded rows**, never typed
  (no-hardcoding proof: change a rate row → cost/unit changes).
- **Tier-B only as far as the views need** (Scorecard cost/unit). **Tier C stays a deferred additive seam**
  (`margin = price − cost`) — *not built* (VIEW-PLAN; SKIP-13).

### 12.9 `masterdata.read 1.1 → 1.2` + `learning.read 1.0` (contracts)

- **`masterdata.read 1.2`** (additive MINOR, A12): add cost-rate fields to the resource DTO (`runCostPerHour`,
  `setupCost`) + a tenant/plant `overheadPerUnit` lookup; existing consumers unaffected; binding pins major 1.
- **`learning.read 1.0`** (new published contract, consumed directly by scheduling — A14 platform capability,
  **not** a binding): `getLearnedParameter(tenant, resourceId, routingOperationId, param) →
  { value, source, confidence, sampleCount, windowMean, status } | null`;
  `listLearnedParameters(tenant, plantId?)` (board/variance panel). Structured (forward-hook: Phase-4
  predictor extends it; Phase-5 narration verbalises it).

### 12.10 Endpoints

Reads (`JwtAuthGuard`, tenant-scoped): `GET /learning/parameters?plantId=` (learned overlays for the
board/panel), `GET /scheduling/variance?versionId=` (performance variance strip + Scorecard),
`GET /scheduling/scorecard?plantId=&versionId=` (OTIF/OEE/cost-per-unit/at-risk — **per-version**:
`versionId` optional, defaults to the plant's latest committed; each version reports its **own**
actuals, the Phase-5 plan-comparison substrate), `GET /workforce/coverage?plantId=&shift=`
(operator×station coverage + readiness + cert-gap, via `masterdata.read`). Writes
(`JwtAuthGuard + ConfigureGuard`): `POST /workforce/proposals/:id/confirm` (D54 OT call-in confirmed
proposal — human-disposed). **Demo/dev-only** (staging-gated, not in nav):
`POST /dev/scheduling/simulate { scheduleVersionId, drift?: { resourceId, param, magnitude, rampOverEvents } }`
(SKIP-51 simulator + AS15 drift trigger).

### 12.11 Error codes (add to §6 `ERROR_CODES` + `errors.json`)

```
ACTUAL_ALREADY_RECORDED,        // idempotent re-ingest of an actual_event_id
LEARNED_VALUE_REJECTED,         // guardrail breach (surfaced for proof #4 / anomaly view)
SCHEDULE_VERSION_NOT_COMMITTED, // simulator requires a committed version
COVERAGE_NOT_FOUND, WORKFORCE_PROPOSAL_NOT_FOUND
```

### 12.12 EventBus (O5) — Phase-3 events

`execution.actual.recorded` (simulator→learning), `learning.parameter.updated` (a decisive step/re-step),
`learning.drift.detected` (D56 wear flag → notifications), `learning.anomaly.flagged` (guardrail reject).
All through the coordinator; no cross-module **write** (O8) — scheduling only *reads* `learning.read`.

### 12.13 Open phase-3 API decisions (brief §5 — see also frontend-spec FS12–FS15)

| ID | Question | Proposed | Status |
|---|---|---|---|
| AS13 | **Module placement** — actuals/learning in `scheduling` or a sibling? | **Sibling `learning` module** (A14 platform capability; NMA + Phase-4 predictor reuse; scoped schema, no cross-module reach). Scheduling consumes `learning.read` directly; the **simulator is a demo fixture in `scheduling`** emitting actuals on the EventBus; learning persists + learns. Alternative (all in `scheduling`) rejected: couples a reusable capability to one domain + makes Phase-4/NMA reuse a refactor. | **Proposed** |
| AS14 | **The damped update rule** (load-bearing). | **Windowed snap-on-gate with hysteresis hold** (§12.3): trailing-window mean, adopt in **one decisive step** once min-samples + confidence + step-band clear, then **hold** until a new sustained material drift clears the re-step band. Confidence rises with samples. Deterministic constants. **EWMA rejected** (visible per-actual motion fights "convergence not motion"). | **Proposed** (decisive-step-then-hold) |
| AS15 | **Simulator drift control.** | **Seeded PRNG** (`versionId:seq`) → default ±~3% noise; **drift trigger** = dev/staging endpoint `{resourceId, param, magnitude (~0.08), rampOverEvents}` ramps the chosen resource's cycle to `+magnitude` over N events (Collision-2). Deterministic, demo-fixture, never in nav; swappable for a real connector (same actuals event). | **Proposed** |
| AS16 | **Guardrail bounds.** | **Max-deviation 50% → reject + flag** (`status=rejected`, anomaly event, keep standard); **confidence-to-use ≥ 0.6 + status=held** before the scheduler overlays; positivity; re-steps apply next-solve not retroactively (D44 seam). Show a breach rejected (proof #4). | **Proposed** |
| AS17 | **Performance-variance scope + OEE cut.** | Compute attainment / behind-plan% / adherence / **churn (D57)** + **OEE A·P·Q**; surface on the **board variance strip** (operational summary) **and** the **Scorecard** (full screen). **Deferred:** standalone per-shift OEE trend dashboard (not demo-critical). | **Proposed** |
| AS18 | **Tier-B cost placement.** | **Rates Master-Data-owned** (`masterdata.read 1.2`: resource run/setup cost, overhead; labor from MD15), **calculation in `scheduling`**; cost/unit from seeded rows only. Tier-C (`margin=price−cost`) deferred additive seam, not built. | **Proposed** |

---

# Phase 4 — Parameter prediction (anticipatory, confidence-gated, tier-bounded) (BUILT — gates green; 7 API proofs)

> **STATUS: BUILT** (migration `0006`; predictor + confidence×tier gate in `learning`, new `policy` module;
> `bun run check` + `next build` + expo tsc green; the seven §6 proofs demonstrated via the real API path —
> predict-from-drift, gate auto/propose + tier-3 bound, reversible, transparent, determinism, horizon-decay,
> boundary). AS19–AS22 implemented as proposed.
> **A18 governs** — this operationalizes the **predictive** case of the trust envelope: every prediction is
> **reproducible** (D2; OLS on the seeded actuals series), **explainable** (the fitted window + slope + R²
> are the retrievable basis, A19 hook), and **bounded** (confidence×tier gate; D44 stability; reversible by
> actuals). Source refs: platform **A18** (trust envelope + autonomy gradient — Tier 1/2/3), **A14** (ML
> parameter prediction — this is its *predictive* arm), A16/A17 (boundary widens with track record); scheduling
> spec D5 (closed loop), D3 (ML targets), D56 (the tool-wear drift this projects), D26 (human-disposes Tier-3),
> D44 (don't destabilize the committed near-horizon), D2 (determinism). All §0 override rules (O1–O8) + §2
> schema rules carry forward unchanged. Decisions **AS19–AS22** below; UI in frontend-spec §26–§30 (FS16–FS19).

## 13. Phase-4 modules & ownership

| Module | Postgres schema | Kind | Owns / changes |
|---|---|---|---|
| `learning` *(edit)* | `learning` | capability module | **New `parameter_prediction`** (the forecast record: predicted value, threshold-crossing horizon, confidence, basis, proposed action + tier, **disposition**, outcome seam). Hosts the **predictor** (A14 predictive arm — reads the same `execution_actual` series the learner reads) + the **confidence×tier gate**. On auto-commit (Tier-1 ≥ threshold) writes a **predicted** `learned_parameter` step (so the existing `learning.read` overlay path applies it — *no scheduling change*). `learning.read 1.0 → 1.1` (additive); emits prediction events |
| `policy` *(new — per-tenant autonomy/objective config, D42)* | `policy` | kernel-ish config | `autonomy_config` (the **confidence threshold** per tier + tier behavior; safe defaults D48). Publishes `policy.read 1.0` (the gate reads it). Objective trade-off weights (service floor / OT / churn) are a **named seam for Phase-5 View-5**, not built now |
| `scheduling` *(unchanged)* | `scheduling` | domain | **No change** — it already overlays whatever `learning.read` returns at solve; a pre-emptively-adopted predicted value flows through the existing path (the D44 draft-then-commit split already keeps it off the in-execution op). Pre-emptive action = a higher learned cycle on next solve → the greedy re-sequences (same mechanism as Phase-3) |

**Module-placement ruling (brief §3 "confirm placement") — AS19.** The predictor lives in **`learning`**: it
reads the same `execution_actual` series the damped learner reads, extends the same structured record, and is
the A14 capability NMA will also consume. The **autonomy config** (the gate's threshold) is **tenant policy**,
not a learning internal, so it lives in a new small **`policy`** module the gate reads via `policy.read` —
keeping "what the tenant is allowed to automate" separate from "the ML that produces a candidate" (clean for
Phase-5 when View-5 grows objective weights). Scheduling is untouched (the pre-emptive value reaches it only
through the existing `learning.read` overlay).

### 13.1 `learning.parameter_prediction` table sketch (O2/§2.4 rules: ULID PK, `tenant_id` + index, `created_at`)

> Migration `0006` adds `learning.parameter_prediction` only (no change to `execution_actual` / `learned_parameter`
> / scheduling). **Retained, not discarded** (forward-hook): predictions + their outcome are the substrate for a
> Phase-5 *prediction-accuracy* measure — append a new row per settled re-forecast; never hard-delete.

**learning.parameter_prediction** — `tenant_id`, `resource_id` (text), `routing_operation_id` (text),
`param` (enum `cycle|setup`), `predicted_value` (decimal — the fitted value at the crossing), `threshold`
(decimal — what it's predicted to cross, from policy/std-band), `crossing_at` (timestamptz, nullable — the
forecast clock time; null = "no crossing within horizon"), `horizon_minutes` (int — how far out),
`confidence` (decimal 0–1 — **already horizon-degraded**), `fit_slope` (decimal — value/event drift),
`fit_r2` (decimal 0–1 — fit quality, the basis), `window_size` (int), `sample_count` (int),
`proposed_action` (enum `preadjust_parameter|reprioritize|none` — what the forecast implies),
`action_tier` (enum `tier1|tier2|tier3` — the A18 consequence tier of that action),
`disposition` (enum `auto_committed|queued|approved|dismissed|superseded`), `applied_learned_value` (decimal,
nullable — what was written on auto-commit/approve, for reversibility/audit), `outcome` (enum
`pending|materialized|corrected|expired`, default `pending` — **Phase-5 accuracy seam**, set later by the
closed loop), `superseded_by` (text, nullable — the re-forecast that replaced this one; settled-step chain,
not a ticker), `created_at`, `updated_at`. **One *live* prediction per `(tenant, resource, routing_operation,
param)`** (the rest are `superseded`/historical) — convergence-not-motion in forward form.

### 13.2 The prediction model (AS19) — simplest honest extrapolation

Per `(tenant, resource_id, routing_operation_id, param)`, on the **ordered `execution_actual` series** (by
`seq`, the same series §12.3 learns from — the actual measured `actual_cycle_time`/`actual_setup_time`, **never
a fabricated trend**):

- **Fit:** ordinary least-squares **linear regression** over the trailing window `W_PRED = 8` (or all if
  fewer; **require `n ≥ MIN_PRED_SAMPLES = 5`** or no prediction). Yields `slope` (drift per event),
  `intercept`, and **`r2`** (fit quality). Linear is the **placeholder honest model** — explainable ("fitted
  the last N actuals, +X/event"), deterministic, and swappable for a real predictive model later (as the
  greedy heuristic stands in for the optimizer). EWMA/ARIMA = considered-later alternatives.
- **Threshold:** the value the parameter is predicted to *cross* = `std × (1 + WEAR_BAND)` by default
  (`WEAR_BAND` = the §12.7 wear threshold), **per-tenant overridable** in Objective Policy. Only forecast a
  crossing when the trend heads **toward** it (`slope > MIN_SLOPE` and current fitted value below threshold) —
  a flat/declining series predicts **no crossing** (honest: no trend → no forecast).
- **Horizon:** `eventsToCross = (threshold − fittedNow) / slope`; convert events→clock via the resource's
  **cadence** (mean planned op duration on that resource, or mean inter-actual Δt from the series).
  `horizon_minutes = eventsToCross × cadence`. **Cap at `H_MAX = 480 min`** (8h); beyond → "no crossing within
  horizon" (`crossing_at = null`, no proposed action).
- **Confidence — degrades with horizon (the honest core):**
  `confidence = fitConfidence × horizonDecay` where
  `fitConfidence = clamp(n / N_TRUST, 0,1) × clamp(r2, 0,1)` (samples × fit quality, mirrors §12.3) and
  `horizonDecay = clamp(1 − horizon_minutes / H_MAX, CONF_FLOOR (0.1), 1)` — **a near crossing carries ~fit
  confidence; a far one decays toward the floor** (proof #6). All deterministic constants → same series, same
  `(value, crossing_at, horizon, confidence)` (D2, proof #5).
- **Damped re-forecast (no live ticker — proof #1):** the predictor re-runs on each new actual (like the
  learner), but **only writes a new settled prediction** when the crossing moves beyond `RE_FORECAST_BAND`
  (crossing time shifts > ~1 cadence-event) **or** the gate disposition would change; small wiggles leave the
  live row untouched. Superseded predictions are chained (`superseded_by`), never animated. The UI renders a
  **settled statement** ("predicted to cross ~14:00 · conf 0.8 · 2h"), not a creeping gauge.

### 13.3 Confidence×tier gate (AS20) — the spine

For each live prediction with a `proposed_action`, the gate (in `learning`, reading `policy.read`) sets
`disposition` — **confidence is the dial *inside* a tier, never a bypass *around* it (A18):**

- **`action_tier` classification** (by what the action changes, not by confidence):
  `preadjust_parameter` (cycle/setup) → **Tier 1**; an objective-weight nudge → **Tier 2** (seam, Phase-5);
  any allocation / who-gets-shorted / certification / safety-sequencing consequence → **Tier 3**.
- **Tier 1:** `confidence ≥ tier1AutoThreshold` → **`auto_committed`** (pre-emptive adopt, §13.4); below →
  **`queued`** (proposes; awaits approval).
- **Tier 2:** advisory-first default → **`queued`**; if the tenant has opted into bounded auto AND confidence
  ≥ threshold AND the change stays within configured bounds → `auto_committed` (still logged/auditable).
  *(Config seam this phase; the built predictive action is Tier-1.)*
- **Tier 3:** **always `queued` (human disposes, D26) — regardless of confidence.** A 0.99-confident Tier-3
  prediction still cannot auto-commit (proof #2 — demonstrate a predicted allocation/late-order consequence
  routing to a human at high confidence).
- Threshold + tier behavior are **per-tenant config** (`policy.autonomy_config`, §13.5), safe default
  conservative (D48). The gate is deterministic given the prediction + config.

### 13.4 Pre-emptive action — reversible + transparent + D44-stable (AS21)

- **Auto-commit (Tier-1 ≥ threshold) or human-approved** → `learning` writes a `learned_parameter` step set
  to the **predicted** value with a **distinct provenance** (`source = ml_predicted`, a new `TimeSource`
  member, vs `ml_adjusted` for an *observed* adoption — the board/panel reads "predicted", honest that it acts
  ahead of evidence). The existing `learning.read` overlay path then applies it at the **next solve** — **no
  scheduling change** (proof: behavior-only). The higher predicted cycle lengthens the drifting resource's ops
  → the greedy re-sequences to avoid the predicted starvation, **ahead** of the drift.
- **Reversible (proof #3):** acting on a *forecast* is a real escalation, so the closed loop is the safety
  net — subsequent **real actuals** keep feeding the §12.3 damped learner; if the predicted drift doesn't
  materialize, the learner **re-steps to the true value** (RESTEP_BAND) and `outcome` is set `corrected`. A
  wrong forecast self-corrects; it is never stuck or irreversible.
- **Transparent (proof #4):** every `auto_committed` prediction is logged + surfaced in the **Exception Queue**
  as *auto-handled* ("pre-emptively adjusted [resource] cycle for predicted wear · confidence X · ~T") — a
  human can always see what the system did on a forecast even when it needed no approval. Never silent.
- **D44 stability:** the pre-adjust applies on a **new draft** (next solve), never retroactively to an
  in-execution/committed op — the Phase-2 draft-then-commit split already enforces this; same discipline as a
  reactive re-step (§12.4). A pre-emptive change must not thrash the committed near-horizon.

### 13.5 `policy` module + autonomy config (AS22)

**policy.autonomy_config** (one row per tenant; O2/§2.4 rules) — `tenant_id` (unique), `tier1_auto_threshold`
(decimal 0–1, **default 0.75** — conservative D48), `tier2_mode` (enum `advisory|bounded_auto`, default
`advisory`), `tier3_mode` (enum `always_human`, fixed — **not** tenant-relaxable; the A18 floor),
`wear_band_override` (decimal, nullable — the crossing threshold band if the tenant tunes it; else §12.7
default), `updated_at`. **`policy.read 1.0`** (new published contract): `getAutonomyConfig(tenant) →
{ tier1AutoThreshold, tier2Mode, tier3Mode, wearBand }`. Edited via the Objective-Policy view
(`ConfigureGuard`). Objective trade-off **weights** (service floor / max OT / churn tolerance / expedite
premium) are a **documented seam** in this schema for Phase-5 View-5 — **not built now**.

### 13.6 Contracts — `learning.read 1.0 → 1.1` (additive) + `policy.read 1.0` (new)

- **`learning.read 1.1`** (additive MINOR, A12 — no consumer breakage; binding-free, A14):
  `getPrediction(tenant, resourceId, routingOperationId, param) → ParameterPredictionDto | null` (the live
  forecast) and `listPredictions(tenant, plantId?) → ParameterPredictionDto[]` (Exception Queue + board
  flags). `ParameterPredictionDto` = `{ resourceId, routingOperationId, param, predictedValue, threshold,
  crossingAt, horizonMinutes, confidence, fitR2, proposedAction, actionTier, disposition, appliedLearnedValue,
  outcome }` — **structured** (forward-hook: A19 narration verbalizes it; the outcome field is the accuracy
  seam). `TimeSource` enum gains `ml_predicted` (additive).
- **`policy.read 1.0`** (new, consumed by `learning`'s gate — a platform read, not a binding): `getAutonomyConfig`.

### 13.7 Endpoints

Reads (`JwtAuthGuard`, tenant-scoped): `GET /learning/predictions?plantId=` (live forecasts + dispositions —
Exception Queue & board flags), `GET /policy/autonomy` (the configured thresholds — Objective Policy view).
Writes (`JwtAuthGuard + ConfigureGuard`): `POST /learning/predictions/:id/approve` (human-dispose a queued
prediction → applies the pre-adjust, §13.4), `POST /learning/predictions/:id/dismiss` (reject a queued
prediction), `PUT /policy/autonomy` (set the confidence threshold + tier modes — D42, audited). **The
predictor itself runs on actual-ingest** (no manual trigger endpoint); the existing **demo simulator**
(`POST /dev/scheduling/simulate` with a `drift`) is what produces the observed drift the predictor projects —
no new dev surface needed.

### 13.8 Error codes (add to §6 `ERROR_CODES` + `errors.json`)

```
PREDICTION_NOT_FOUND,            // approve/dismiss a missing/superseded prediction
PREDICTION_NOT_QUEUED,           // approve/dismiss one that isn't awaiting a human (already auto/applied)
TIER3_REQUIRES_HUMAN,            // (defensive) an attempt to auto-commit a Tier-3 action — the bound
AUTONOMY_CONFIG_INVALID          // threshold out of 0–1, or attempt to relax tier3_mode
```

### 13.9 EventBus (O5) — Phase-4 events

`learning.prediction.updated` (a settled re-forecast — Exception Queue refresh), `learning.prediction.autocommitted`
(Tier-1 ≥ threshold pre-adjust applied → auto-handled row + audit), `learning.prediction.queued` (needs-human →
Exception Queue). All through the coordinator; no cross-module **write** (O8) — scheduling still only *reads*
`learning.read`; `learning` *reads* `policy.read`.

### 13.10 Open phase-4 API decisions (brief §5 — see also frontend-spec FS16–FS19)

| ID | Question | Proposed | Status |
|---|---|---|---|
| AS19 | **Predictor placement + model.** | **In `learning`** (reads the same actuals series; A14 capability). **OLS linear trend** over the trailing window (`W_PRED=8`, `n≥5`) → slope → **threshold-crossing horizon**; **confidence = (samples × fit-R²) × horizon-decay** so it **degrades with horizon**. Deterministic, damped (settled re-forecast past a band; no live ticker), bounded (`H_MAX=8h`; no trend → no forecast). Simplest honest extrapolation, a placeholder for a real model. Alternatives (EWMA/ARIMA/ML) deferred. | **DRAFT** |
| AS20 | **Confidence×tier gate.** | Gate in `learning` reads per-tenant threshold (`policy.read`). **Tier-1** param pre-adjust auto-commits at `confidence ≥ tier1AutoThreshold` (default **0.75**), else queues; **Tier-2** advisory-first (bounded-auto opt-in); **Tier-3 always human regardless of confidence** (the A18 floor — proof #2). Confidence is the dial **inside** a tier, never a bypass around the gradient. | **DRAFT** |
| AS21 | **Pre-emptive action — reversible/transparent/stable.** | Auto-commit/approve writes a **`ml_predicted`** learned step → applies via the existing overlay at **next solve** (no scheduling change, D44 draft-then-commit). **Reversible:** real actuals re-step the learner if the drift doesn't materialize (`outcome=corrected`, proof #3). **Transparent:** every auto-commit logged + shown auto-handled in the Exception Queue (proof #4). Never silent, never irreversible. | **DRAFT** |
| AS22 | **Autonomy config placement + retention.** | New small **`policy`** module owns `autonomy_config` (threshold + tier modes; tier3 fixed-human) + `policy.read 1.0`; edited in Objective Policy (View 5). Objective trade-off weights = Phase-5 seam, not built. **`parameter_prediction` retained** (append per settled re-forecast; `outcome` seam) for the Phase-5 accuracy measure — don't discard. Alternative (fold config into `learning`) rejected: couples tenant policy to the ML producer. | **DRAFT** |
