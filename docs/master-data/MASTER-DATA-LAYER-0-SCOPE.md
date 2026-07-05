# Master Data — Layer 0 scope: effectivity + revision + audit substrate

| | |
|---|---|
| **Layer** | Production Phase 1a · Layer 0 (the substrate every later layer is born on) |
| **Written against** | Actual repo state (Claude Code ground-truth report), not spec assumptions |
| **Gate** | Propose-then-confirm — **no build until this doc is signed off** |
| **Consumes** | MD1–MD15 (master-data spec), MD6/§8 (revision & retention), MD3 (resolve-as-of), D6/D10/D46 (IATF, effectivity, retention) |

> **Confirmed with RG:** identity model is **`part_no`-as-identity, per-revision rows, `id` differs per revision.**

---

## 0. What ground truth changed vs. the plan

Three assumptions in PRODUCTION-READINESS-PLAN were wrong; scope reflects reality:

1. **No kernel audit bus exists.** Only `config.config_audit` (config-specific). MD6/§8 "audited through the kernel audit framework" has no framework to hook → Layer 0 **builds a master-data audit from scratch** (§6).
2. **The O7 binding resolver IS built.** `binding/binding.resolver.ts` exists; scheduling already consumes master-data via `bindings.resolve(...)`. The "not built" comment in `masterdata.ts`/`master-data.module.ts` is stale. → the resolve-as-of contract change flows through a real seam already in place; **fix the stale comments** as part of DoD.
3. **Contract is at 1.3, not 1.0.** Layer 0 bumps `masterdata.read` **1.3 → 1.4** (additive, A12).

---

## 1. Scope boundary

**In:** the versioning substrate + audit + retention posture, applied to the four built domain entities (`part`, `routing`, `resource`, `resource_group`) and their children; the resolve-as-of service; the part-identity consumer migration the substrate forces.

**Out (later layers, unchanged here):** BOM (Layer 2), tooling/asset domain (Layer 2), UoM conversion factors (Layer 1 — part-fullest), SoR connector/upload modes (integration component / Phase 2A–4), retention *tiering* mechanics (Architecture doc).

**Explicitly not in Layer 0:** a shared kernel audit bus (recommend deferred — §6), versioning of resources (recommend deferred — §3).

---

## 2. The versioning substrate — two patterns, one principle

MD6 "never edited in place" decomposes into two requirements: **reconstructability** (resolve the data effective at a past date) and **auditability** (every change recorded). Two patterns satisfy both:

### Pattern A — Revisioned (`part`, `routing`)
Concurrent-history entities subject to engineering change. Reconstructability via **live versioned rows.**
- Durable **business key** (`part_no`; `(part_no, routing name)` for routing).
- Per-version `id` (ULID, differs per revision).
- `revision` (text) — ECN/ECR engineering revision.
- `effective_from` (timestamptz, NOT NULL), `effective_to` (timestamptz, NULL = open/current).
- `supersedes_id` (text, self-ref, nullable) — version lineage.
- **Cross-entity references are by business key + resolve-as-of, never by version `id`.**
- The **only** permitted in-place mutation is closing a prior version's `effective_to` on supersession (audited).

### Pattern B — Mutable-with-audit (`resource`, `resource_group`, `resource_group_member`, `resource_type_config`)
Operational-asset descriptors. Reconstructability via the **audit log** (and the schedule snapshot already captures the values used at build time, 4.6). No version fragmentation → **`id` stays stable** → every existing `resource_id`/`resource_group_id` reference is untouched.
- Changes update the row **in place, but every change is written to `master_data_audit`** (§6).
- Soft-delete via existing `status`/`is_active` (already present).

> **Why the split is correct, not a fudge:** the spec's **Req=Y** (part, BOM) vs **Req=N** (resource, asset) effectivity marking *is* this line. Promoting a Pattern-B entity to Pattern A later is additive (history already exists in audit) — so this is not rework if requirements change.

**⇒ DECISION D-L0-1 (confirm): resource/resource_group = Pattern B (recommended) vs Pattern A.**
Pattern A roughly **doubles** the consumer blast radius (every resource reference → resolve-as-of). Recommend **B**.

---

## 3. Per-entity application

| Entity | Pattern | Business key | New columns | Reference change |
|---|---|---|---|---|
| `part` | **A** | `(tenant_id, part_no)` | `revision`, `effective_from`, `effective_to`, `supersedes_id` | consumers resolve by `part_no` |
| `routing` | **A** | `(tenant_id, part_no, name)` | `revision`, `effective_from`, `effective_to`, `supersedes_id`; **`part_id` → `part_no`** | `part_id` FK removed; op children ride routing version |
| `routing_operation` | child of A | — (rides routing version) | none | copied onto new routing version on revise |
| `resource` | **B** | stable `id` | none | none |
| `resource_group` | **B** | stable `id` | none | none |
| `resource_group_member` | **B** | stable `id` | none | none |
| `resource_type_config` | **B** | stable `id` | none | none |

---

## 4. Schema deltas (concrete — against ground-truth columns)

### `master_data.part`
- **DROP** unique `part_tenant_part_no_unique (tenant_id, part_no)`.
- **ADD** `revision text NOT NULL`, `effective_from timestamptz NOT NULL`, `effective_to timestamptz NULL`, `supersedes_id text NULL` (self-ref, intra-schema).
- **ADD** partial unique index `(tenant_id, part_no) WHERE effective_to IS NULL` — at most one open version per part.
- **ADD** (custom SQL, §8) GiST exclusion constraint: no two rows share `(tenant_id, part_no)` with overlapping `[effective_from, effective_to)`.
- **Backfill:** every existing row → `revision = 'A'`, `effective_from = created_at`, `effective_to = NULL`, `supersedes_id = NULL`.

### `master_data.routing`
- **ADD** version columns (as part) + **ADD** `part_no text NOT NULL`.
- **Backfill** `part_no` by joining current `part_id → part.part_no`; then **DROP** `part_id` (FK + column).
- **ADD** partial unique `(tenant_id, part_no, name) WHERE effective_to IS NULL`.
- **ADD** (custom SQL) exclusion constraint on `(tenant_id, part_no, name)` overlapping windows.

### `master_data.routing_operation`
- No structural change. On routing revise, the service **copies op rows** onto the new `routing_id`.

### `master_data.resource` / `resource_group` / `resource_group_member` / `resource_type_config`
- **No schema change.** (Pattern B — history via audit.) Confirm D-L0-1.

### `master_data.master_data_audit` — NEW (§6)

> **Note:** existing rows carry no `updated_at` bump on backfill; the migration sets version columns directly. `updated_at` remains the ordinary row-touch timestamp; version state lives in `effective_from/to`.

---

## 5. Resolve-as-of service (MD3) + contract 1.4

**Internal domain service — `MasterDataResolver`:**
- `resolvePart(tenantId, partNo, asOf = now) → PartVersion` — window-containment query (`effective_from <= asOf AND (effective_to IS NULL OR effective_to > asOf)`).
- `resolveRouting(tenantId, partNo, { name?, primaryOnly?, asOf = now }) → RoutingVersion` (+ operations).
- `revisePart(tenantId, partNo, changes, { effectiveFrom, revision, ecnRef? }) → newVersion` — **transactional:** close prior open version (`effective_to = effectiveFrom`), insert new open version (`supersedes_id = prior.id`), write audit. Native-SoR only, `configure`/master-data-admin gated.
- `reviseRouting(...)` — analogous; copies op rows.

**`masterdata.read` 1.3 → 1.4 (additive, A12):**
- **Add** `resolvePart(partNo, asOf?)`, `resolveRouting(partNo, asOf?)`, `revisePart`, `reviseRouting`, `resolvePartVersions(partNo)` (history list).
- **Add** `PartVersionDto`/`RoutingVersionDto` (carry `revision`, `effectiveFrom`, `effectiveTo`).
- **Deprecate-not-remove** id-based `getPart(id)` etc. (D-L0-4): keep them compiling for A12 must-ignore; all consumers migrate off them in this layer; hard removal is a future MAJOR (2.0).
- `org.read` **unchanged** (still 1.1).

---

## 6. Audit design (from scratch — no kernel bus)

New table **`master_data.master_data_audit`** (append-only; never updated/deleted):

| col | type | notes |
|---|---|---|
| `id` | text PK | ULID |
| `tenant_id` | text | indexed |
| `entity_type` | text enum | `part\|routing\|resource\|resource_group\|resource_group_member\|resource_type_config` |
| `business_key` | text | `part_no`, `resource.id`, etc. |
| `version_id` | text | the row `id` affected |
| `action` | text enum | `create\|revise\|supersede\|update\|deactivate` |
| `actor` | text | user id from JWT (`@CurrentUser`) |
| `source_ref` | text NULL | ECN/ECR id, or connector source ref |
| `effective_from` | timestamptz NULL | for revisioned actions |
| `changed_fields` | jsonb | `{ field: { old, new } }` |
| `created_at` | timestamptz | `defaultNow()` |

- Written by `MasterDataService`/`MasterDataResolver` on every create/revise/supersede (Pattern A) and every in-place update/deactivate (Pattern B).
- **D-L0-3 (LOCKED):** audit lives **inside master-data** (`master_data.master_data_audit`), owned by the module per **O2** — each module owns its own store. This is the correct end state, not a way-station: a module auditing its own revisions is clean ownership, and a shared cross-cutting write target would cut against O2. `config` already owns `config_audit` the same way. **No kernel audit bus** is planned; if a platform-wide audit *query* surface is ever wanted, it's a read-side aggregation (its own decision), and this table won't obstruct it. The schema is shaped for master-data's needs, not for a speculative extraction.

---

## 7. Retention posture (D46)

Layer 0 = **retention-capable**, not retention-*enforcing*: nothing hard-deletes, versions accumulate, supersession closes windows (never removes rows), audit is append-only. Actual life+15yr enforcement + hot/object-storage tiering → deferred to the compliance/architecture slice, flagged. Layer 0 must not *preclude* it (it doesn't — the model is never-purge by construction).

---

## 8. Migration + re-seed plan

**Drizzle migration `0020` (next after `0019`):**
1. `part` deltas (§4) + backfill.
2. `routing` deltas + `part_no` backfill + drop `part_id`.
3. create `master_data_audit`.
4. Pattern-B tables: no change (pending D-L0-1).

**Custom SQL migration** (`drizzle/migrations/custom/`, run via `db:migrate:custom`):
- `CREATE EXTENSION IF NOT EXISTS btree_gist;`
- GiST exclusion constraints on `part` and `routing` (non-overlapping windows per business key).
- **D-L0-2 (confirm):** DB-enforced non-overlap via `btree_gist` (recommended — the invariant is load-bearing for IATF correctness) vs. app-level enforcement only.

**Consumer migration (forced by part-identity shift — part of Layer 0):**
- `scheduling.material_requirement`: `part_id` → `part_no`, `component_part_id` → `component_part_no` (text refs, no FK). Repo `listMaterialRequirements` + the material-gate fold (`scheduling.service.ts` ~764–768/237–240) resolve part via `resolvePart(part_no, buildAsOf)`.
- `scheduling.service.ts:213` already resolves master-data via `bindings.resolve(MASTERDATA_READ_CONTRACT)` → switch part reads to `resolvePart`/`resolveRouting` with the schedule's build date as `asOf`.
- Audit trace `master_data_asof` (4.6): populate from the `asOf` used.
- Any other holder of a part version id → migrate to `part_no`. **DoD: grep proves zero id-based part references remain in consumers.**

**Re-seed (`db/seed.ts`):**
- `part` rows: add `revision='A'`, `effective_from`, `effective_to=NULL`.
- `routing` rows: `part_no` instead of `part_id`; version columns.
- `material_requirement` seed (`:860`, SAL-1004→coil): `part_no`/`component_part_no`.
- Idempotent; verify via `demo:reset` → `db:seed`.

---

## 9. Definition of done

- [ ] `part`, `routing` versioned; `resolvePart/resolveRouting(part_no, asOf)` return the window-correct version; `revisePart/reviseRouting` create a new open version, close the prior window, write audit — transactionally.
- [ ] Exclusion constraints reject overlapping windows (test proves it).
- [ ] `master_data_audit` records every create/revise/supersede/update/deactivate.
- [ ] All five `masterdata.read` consumers migrated to resolve-as-of; **grep proves no consumer holds a part version `id`**; id-based part ops deprecated (present, unused).
- [ ] `masterdata.read` at `1.4`; `org.read` unchanged at `1.1`; O2/O3 intact; **no cross-schema FK introduced**.
- [ ] Stale "no binding resolver (O7)" comments corrected.
- [ ] `demo:reset` + `db:seed` green; **demo talk-track builds an identical schedule** (current versions resolve to today's data → zero behavioral change).

---

## 10. Decisions (D-L0-1…7) — all LOCKED + BUILT

> The first five were signed off before build; D-L0-6/7 emerged during the build and were confirmed with RG. All are now built (Layer 0 Commits 1–6b). Commit shas below are the authoritative evidence.

| ID | Decision | Outcome (built) |
|---|---|---|
| **D-L0-1** | resource/resource_group: Pattern B (audit, stable id) vs Pattern A (versioned) | **Pattern B** — mutable-with-audit, stable `id`, no version columns, no consumer churn. Built C1 (`master_data_audit` + Pattern-B create/update/deactivate audit). |
| **D-L0-2** | Non-overlap: DB `btree_gist` exclusion vs app-level only | **DB-enforced** — `part_effectivity_no_overlap` / `routing_effectivity_no_overlap` GiST EXCLUDE (custom SQL). Built C4; negative test proves overlapping-window insert rejected (incl. closed windows the partial index can't see). |
| **D-L0-3** | Audit home: inside master-data (owned per O2) | **Inside master-data** — `master_data.master_data_audit`, append-only, no kernel bus. Built C1. |
| **D-L0-4** | Old id-based part ops: deprecate-not-remove vs clean-remove (2.0) now | **Deprecate** — `getPart`/`getRouting`/`getPrimaryRoutingForPart` kept on `masterdata.read` (JSDoc `@deprecated`, A12 must-ignore), **zero live callers** after C6/C6b; hard removal is a future 2.0 MAJOR. |
| **D-L0-5** | Backfill revision label for existing rows | **`'A'`**, `effective_from = created_at`, `effective_to = NULL`, `supersedes_id = NULL`. Built C2 (part) / C3 (routing); 100% backfill coverage verified. |
| **D-L0-6** | Historical part-version-id snapshots: migrate to `part_no` vs freeze | **FREEZE** — `scheduled_operation.part_id` + `execution_actual.part_id` stay version-pinned (frozen snapshots of what was planned/ran), allowlisted alongside `supersedes_id`. Migrating them would break reconstructability. Forward refs (`demand_input`, `material_requirement`/`availability`, `routing`) migrated to business key. Built C6. |
| **D-L0-7** | Pattern-A edits: redirect through `revise*` (never in-place); explicit `revision`/`effectiveFrom` | **Redirect built** — admin `updatePart`/`updateRouting` route through `revise*` (new effectivity-dated version, prior window closed, audited); no-op edits write nothing. **UI hedge taken**: service auto-derives `revision`/`effectiveFrom` when the admin form omits them (explicit-input form is a REMAINING-ITEMS follow-up). Built C6b. |
