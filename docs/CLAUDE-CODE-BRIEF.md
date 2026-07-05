# Claude Code kickoff brief — Manufacturing operations platform, module #1

| | |
|---|---|
| **You are building** | Production scheduling (module #1) as a vertical slice on a platform kernel |
| **Repo home** | `docs/CLAUDE-CODE-BRIEF.md` |
| **Status** | Session 1 kickoff — phase 0 |
| **Working mode** | Propose-then-confirm. Draft, present, **wait for sign-off**, then implement. Do not skip the gate. |

---

## 0. Mission

Build a client-agnostic manufacturing operations platform. Production scheduling is module #1; the kernel is built underneath it (no platform-first phase — A11), scoped to what this module needs, but with clean contribution seams so module #2 slots in without rework. This session stands up **phase 0** only: the kernel spine + the shared organizational model, with config screens. Later phases add Master Data, the scheduling core, execution actuals + performance metrics, and ML.

The whole slice plan (for context, **not** this session's scope):

- **Phase 0 — kernel spine + org model** ← *this session*
- Phase 1 — minimal Master Data (parts, resources/lines, routings, calendars) behind contract-shaped boundaries
- Phase 2 — deterministic scheduling core (schedule versions, committed schedule, EDD heuristic sequencer)
- Phase 3 — execution actuals + deterministic performance metrics (OEE, adherence, throughput, at-risk)
- Phase 4 — ML parameter prediction (stubbed for the demo; plumbing wired)

---

## 1. Read first (in this order)

1. `docs/platform/API-ARCHITECTURE.md` — reusable API patterns. **Binding.**
2. `docs/platform/UI-ARCHITECTURE.md` — reusable UI patterns. **Binding.**
3. `docs/scheduling/production-scheduling-business-functional-spec.md` — what the module does (D-series).
4. `docs/platform/platform-architecture-spec.md` — how the platform is built (A-series).
5. `docs/PLATFORM-COMPLETION-LOG.md` — what the demo deliberately scopes down/skips and why. **Governs scope.**
6. Master Data / Net-requirements / Network-allocation specs — context only; not built this session.

The two architecture docs are the template baseline (PerduraFlow). The four specs are the source of truth for *what*; never encode decisions that contradict them.

> **Template override — read this.** `API-ARCHITECTURE.md §3` describes a *modular monolith* (in-process `EventEmitter2`, "call module B's service," one shared Drizzle barrel/Pool). **We are not building that.** This platform is **modular and contract-bound**: any module is replaceable by another platform module or a third party. Section 2 below replaces §3's boundary rules; record the replacement in `api-spec.md` as an explicit, documented override of the template. Everything else in the two architecture docs stands.

---

## 2. Non-negotiable invariants

Carry these from line one — they are expensive to retrofit.

**Contract-bound modules — replaces API §3 (A7/A8). The litmus test for every boundary decision: *could a third party replace this module by satisfying its contract, with zero change to any consumer?* If not, the boundary is wrong.**

- **Contracts are the only shared surface between modules.** Inter-module contracts live in `packages/contracts` (alongside the client↔API contracts the template already isolates there), each carrying an `id + version` from day one. A module imports another module's **contract** and nothing else — never its code, types, repositories, or tables.
- **A binding sits between every consumer and every domain contract**, resolving *per tenant* to one of `{ platform_module | connector | upload | native }` (D35/A8). The demo implements only `platform_module` and `native`; the indirection exists so adding `connector` (a third party) is later a config change, not a refactor. *(First real binding appears in phase 1, when scheduling consumes Master Data. Don't build the resolver before it has a consumer — but consume through the contract interface from the start so the seam is real.)*
- **Each module owns its own store — mechanically isolated.** One Postgres **schema/namespace per module**, each module's Drizzle instance scoped to *only its own tables*, so a cross-module join **cannot compile**. No cross-schema FKs and no cross-schema joins, ever. Cross-module references are stored as plain `text` IDs and validated through the other module's contract at write time — exactly as they would be if that module were a separate service. A CI/lint rule forbids importing another module's `schema/`. This "can't compile" enforcement is what keeps the B→A switch cheap; convention alone silently rots into a monolith.
- **Inter-module events go through the EventBus coordinator** (A4) with its **local in-memory provider** for the demo (SKIP-05) — never raw `EventEmitter2` across a module boundary. Intra-module, `EventEmitter2` is fine.
- **Transport behind the contract is swappable.** In-process-behind-the-contract now; an HTTP/Kafka adapter later promotes a module to its own service with no consumer change (deployment shape B → A, on demand, per module).
- **Cross-module writes:** any operation that writes across two modules in one local transaction is a future saga/outbox point — flag it with a `SKIP` row when it first appears (SKIP-06) rather than discovering it at extraction.

**Kernel vs domain — don't over-bind.** The kernel's **organizational model** (Plant, Plant group, Customer, Program, Calendar) and identity/tenancy are *shared reference data consumed by every module* (A10/D17), **not** replaceable domain modules. Modules consume the org model through a **kernel-provided read interface** (contract-shaped, boundary enforced — no reaching into kernel tables), but it sits behind **no per-tenant binding** — there is one org model and it is kernel. Per-tenant bindings are for *domain* contracts (net-requirements, capacity, master data, …), the things a third party can actually replace.

**Schema rules (API §2), every table, no exceptions:**
- `text` ULID primary keys, generated in the app layer (`generateId()`), never DB-generated.
- Foreign keys are `text`, matching the referenced PK.
- **Every table carries a tenant scope column and is indexed on it; every query is tenant-scoped.** Tenancy is **active from day one**, not dormant — the per-tenant bindings above *are* tenancy, so modularity and tenant-awareness are one fabric. The demo runs one tenant; only cross-tenant isolation *hardening* and the second topology are deferred (SKIP-01).
- `createdAt` with `defaultNow()`; soft delete (`isActive=false` / status transition), never hard delete.
- Migrations are never edited after creation.

**Contract seams — Master Data (A8/A13):** when later phases consume Master Data (parts, resources, BOM, assets), they bind to the **part/asset contract**, never the module — per the rules above. Shape that contract interface now even while the data is in-module (SKIP-02), so promoting Master Data to the full module (or a third party's) is a binding change.

**Deterministic-decision invariant (D2):** the sequencer owns the schedule; ML only predicts parameters; GenAI never generates the plan. Schedule records (phase 2+) carry `setup_source`/`cycle_source` (`standard`|`ml_adjusted`) and `*_confidence`, defaulting to `standard`/null. Wire the fields from the first schedule table so nothing changes when ML lands (SKIP-04).

**UI (UI §0):** repeated visual pattern → one variant-driven component in `packages/ui`; screens in `packages/app/features`, app routers re-export only; navigate via Solito; colors through tokens, never hex; every new shared component gets a Storybook story.

**Completion-log discipline:** any new place you scope down or stub relative to the specs gets a `SKIP-NN` row in `PLATFORM-COMPLETION-LOG.md` in the same change. The log is the gate between demo and full build.

---

## 3. This session — phase 0 scope

**Module → schema/table ownership (phase 0)** — one Postgres schema per module, Drizzle instance scoped to it (Section 2):

| Module | Postgres schema | Owns tables |
|---|---|---|
| `tenant` | `tenant` | `tenant` (single seeded row; scoping machinery active) |
| `auth` | `auth` | `user`, `role`, refresh/session as the template defines |
| `org` | `org` | `plant`, `plant_group`, `plant_group_member`, `customer`, `program`, `calendar` |

`auth` references `org` (a role's data scope names plants) **by `text` ID only, no cross-schema FK**, validated through `org`'s read interface — proving the boundary discipline inside the kernel before any domain module exists.

**Phase 0 also establishes the foundational seams** (built now, not deferred): schema-per-module isolation + the CI/lint rule that makes cross-module queries uncompilable; the `packages/contracts` convention with `id + version`; the kernel org-model read interface; and the **EventBus coordinator with its local in-memory provider**. The per-tenant binding *resolver* is **not** built this session — it has no consumer until phase 1.

Notes grounded in the specs:
- `plant_group` has `group_type` (`cluster`|`division`|`region`|`custom`) and `allows_resource_sharing` (default `false`); a plant may join multiple groups (D49).
- Firm fence sits on `customer` (default) with `program` override (D23/D38) — model the fields; enforcement is later.
- `calendar` carries `shift_patterns`, `holidays`, `maintenance_windows` (D17).
- `role` = permission set + data scope + approval tier shape (D33); seed a default editable role set. Full RBAC depth is SKIP-43 — seed the structure, don't build the full matrix.

**Config screens (admin):** Plants, Plant groups, Customers, Programs, Calendars, Roles, Users — CRUD, each a thin screen over shared `packages/ui` components. Plus the **app shell**: auth/login, navigation, an empty dashboard landing (the dashboard framework is kernel — stub it as a registration point, D34/A6).

**Out of scope this session:** any scheduling, parts/BOM, resources-as-master-data, optimizer, actuals, ML, cloud providers, Kafka provider, the per-tenant binding resolver, and cross-tenant isolation *hardening* (tenancy itself is active; only its hardening + second topology are deferred). All tracked in the completion log.

---

## 4. Working protocol

1. Confirm/instantiate the PerduraFlow monorepo (`apps/api`, `apps/next`, `apps/expo`, `packages/{app,ui,config,contracts}`).
2. **Draft `docs/platform/api-spec.md`, `docs/frontend-spec.md`, `docs/PROJECT-SUMMARY.md`** from the templates, scoped to phase 0 (module/table map above, scope key, roles, route tree, palette, screens). **Present them and stop for sign-off. Do not implement tables or screens yet.**
3. On sign-off: implement phase 0 — schema + migrations + seed, the three modules, the admin screens, the app shell.
4. Verify before declaring done (Section 5).
5. Propose before any large or irreversible move (new dependency, deviation from a spec, anything that needs a `SKIP` row).

---

## 5. Definition of done — phase 0

- `bun install` clean; API builds and boots on Node; `next` and `expo` build.
- Migrations apply; seed creates one tenant, an admin user, the default roles, and a couple of sample plants/customers/programs/calendars.
- Log in as the seeded admin; CRUD each org entity through its screen; changes persist.
- Every table has the tenant scope column + index and an app-generated ULID PK; no hard deletes.
- **Each module is in its own Postgres schema with a Drizzle instance scoped to only its tables; the CI/lint rule rejects any import of another module's `schema/`; there are no cross-schema FKs or joins.** `auth`→`org` references are `text` IDs validated through `org`'s interface.
- **The EventBus coordinator + local provider exists; no raw cross-module `EventEmitter2`.** `packages/contracts` holds the org read interface with an `id + version`.
- New `packages/ui` components have Storybook stories.
- No violation of the Section 2 invariants; `api-spec.md` / `frontend-spec.md` / `PROJECT-SUMMARY.md` reflect what was built; completion log updated if anything was scoped down beyond what it already records.

---

*Hand this file to Claude Code as the opening message, with the repo and the six docs in Section 1 available. Phase 1 gets its own brief once phase 0 is signed off.*
