# Claude Code build brief — Master Data Layer 0 (effectivity + revision + audit substrate)

| | |
|---|---|
| **Companion (authority)** | `docs/master-data/MASTER-DATA-LAYER-0-SCOPE.md` — read it first; rationale lives there, not duplicated here |
| **Decisions** | D-L0-1…5 **all LOCKED** (see scope §10) |
| **Discipline** | Commit-per-part; git lifecycle explicit; **stop-and-report at each checkpoint**; change nothing outside this brief |
| **Boundary rules that still hold** | O1–O8, §2.4 schema rules. **No cross-schema FK. No cross-module schema import.** master-data consumes `org.read` only via contract. |

> **Locked decisions in one line:** resources = Pattern B (mutable-with-audit, stable `id`, **no version columns, no consumer churn**); part + routing = Pattern A (versioned, resolve-as-of, `part_no` identity); DB-enforced non-overlap via `btree_gist`; audit inside master-data (O2); id-based part ops deprecated-not-removed; backfill `revision='A'`, `effective_from=created_at`, `effective_to=NULL`.

> **Out of scope — do NOT build:** BOM, tooling/asset domain, UoM factors, SoR connector/upload, retention tiering, and the **draft/publish authoring lifecycle** (parked for Layer 2 BOM). If you find yourself designing any of these, stop.

---

## Commit sequence

Each commit is a separate reviewable unit. **The tree compiles and `db:migrate` succeeds at every commit boundary except where a commit is explicitly marked ATOMIC-BREAKING** (Commit 6), which must land whole and leave the demo green. Stop and report after each commit; wait for go.

### Commit 1 — `master_data_audit` table + audit write path (additive; breaks nothing)
- New table `master_data.master_data_audit` per scope §6 (append-only: no update/delete path exposed; ULID PK, `tenant_id`+index, `created_at`). Enums: `entity_type`, `action` as `text({ enum })` with exported `as const`.
- Add a private `writeAudit(...)` on `MasterDataService` (or a thin `MasterDataAuditRepository`) — **not yet called** by revise logic (that arrives in Commit 5); wire it into the existing Pattern-B in-place updates (`resource`/`resource_group` create/update/deactivate) so the audit path is live and tested from day one.
- Migration `0020`. Seed unaffected.
- **Report:** migration diff + the audit row shape + proof a resource update writes one audit row.

### Commit 2 — `part` version columns + backfill (additive; `getPart(id)` still valid — one row per part)
- Add `revision text NOT NULL`, `effective_from timestamptz NOT NULL`, `effective_to timestamptz NULL`, `supersedes_id text NULL` (self-ref, intra-schema).
- **Backfill** every existing row: `revision='A'`, `effective_from=created_at`, `effective_to=NULL`, `supersedes_id=NULL`.
- **Drop** unique `part_tenant_part_no_unique`; **add** partial unique `(tenant_id, part_no) WHERE effective_to IS NULL`.
- Migration `0021`. Tree stays green: each part still resolves to exactly one open version.
- **Report:** migration diff; confirm backfill covered 100% of rows (count check).

### Commit 3 — `routing` version columns + `part_no` (additive; keep `part_id` for now)
- Add the four version columns (as part) + `part_no text NOT NULL`.
- **Backfill** `part_no` from `part_id → part.part_no`; backfill version columns as in Commit 2.
- Add partial unique `(tenant_id, part_no, name) WHERE effective_to IS NULL`.
- **Leave `part_id` in place** (dropped in Commit 6 with the consumer switch) — keeps tree green.
- Migration `0022`.
- **Report:** diff + backfill coverage; confirm `part_no` matches the joined value for every routing row.

### Commit 4 — exclusion constraints (custom SQL; `db:migrate:custom`)
- `drizzle/migrations/custom/`: `CREATE EXTENSION IF NOT EXISTS btree_gist;`
- On `part`: `EXCLUDE USING gist (tenant_id WITH =, part_no WITH =, tstzrange(effective_from, effective_to) WITH &&)`.
- On `routing`: same, keyed `(tenant_id, part_no, name)`.
- (Redundant-by-design with the partial-unique open-version index; belt-and-suspenders + documents the invariant. NULL `effective_to` → unbounded upper via `tstzrange(from, NULL)`.)
- **Report:** the DDL + a negative test proving an overlapping-window insert is rejected.

### Commit 5 — `MasterDataResolver` (resolve/revise) + `masterdata.read` 1.4 (additive)
- `MasterDataResolver` (scope §5): `resolvePart`, `resolveRouting` (window-containment, `asOf` default now), `resolvePartVersions`, and transactional `revisePart`/`reviseRouting` (close prior window → insert new open version `supersedes_id=prior.id` → **call `writeAudit`**; `revise*` gated by `configure`/master-data-admin, native-SoR only; `reviseRouting` copies op rows onto the new routing version).
- `packages/contracts/src/masterdata.ts`: bump `1.3 → 1.4`; **add** `resolvePart`/`resolveRouting`/`resolvePartVersions`/`revisePart`/`reviseRouting` ops + `PartVersionDto`/`RoutingVersionDto`. **Keep** id-based `getPart` etc. present (deprecate via JSDoc, do not remove — D-L0-4). `org.read` untouched (1.1).
- Fix the stale `"no binding resolver (O7)"` comments in `masterdata.ts` / `master-data.module.ts`.
- Additive; existing consumers still compile on the old ops.
- **Report:** contract diff; a test showing `revisePart` produces a 2nd version, closes v1's window, writes audit, and `resolvePart(asOf=v1-era)` still returns v1.

### Commit 6 — ATOMIC-BREAKING: part-identity consumer migration
Land whole; tree green + demo builds an identical schedule at the end.
- **routing:** switch routing→part access to resolve-by-`part_no`; **drop `routing.part_id`** (FK + column) — migration `0023`.
- **scheduling `material_requirement`:** `part_id → part_no`, `component_part_id → component_part_no` (text refs, no FK) — migration `0024`; update `listMaterialRequirements` + the material-gate fold (`scheduling.service.ts` ~764–768 / ~237–240) to resolve components via `resolvePart(part_no, buildAsOf)`.
- **scheduling part reads:** the `bindings.resolve(MASTERDATA_READ_CONTRACT)` path (`scheduling.service.ts:213`) switches part/routing reads to `resolvePart`/`resolveRouting` with the **schedule build date as `asOf`**; populate the audit trace `master_data_asof` (4.6) from that `asOf`.
- **Sweep:** grep the repo — **zero** consumers may hold a part *version id*; all part references are `part_no` + resolve-as-of.
- **Report:** the grep result (must be empty), the migration diffs, and a diff-of-schedule proof (see DoD).

### Commit 7 — re-seed + verification
- `db/seed.ts`: `part` rows carry `revision='A'`/`effective_from`/`effective_to=NULL`; `routing` rows use `part_no` + version columns; `material_requirement` seed (`:860`, SAL-1004→coil) uses `part_no`/`component_part_no`. Idempotent.
- Run `demo:reset` → `db:seed`; then build the demo schedule.
- **Report:** seed runs clean; **the demo talk-track schedule is byte-for-byte equivalent** to pre-Layer-0 (current versions resolve to today's data).

---

## Acceptance gate (DoD — scope §9, all must pass)

- [ ] part + routing versioned; `resolve*(part_no, asOf)` window-correct; `revise*` transactional (new open version, prior window closed, audit written).
- [ ] `btree_gist` exclusion rejects overlapping windows (negative test green).
- [ ] `master_data_audit` records every create/revise/supersede/update/deactivate (incl. Pattern-B resource updates).
- [ ] **grep proves no consumer holds a part version `id`**; id-based part ops deprecated (present, unused).
- [ ] `masterdata.read` at `1.4`; `org.read` unchanged; **no new cross-schema FK**; O2/O3 intact.
- [ ] stale O7 comments corrected.
- [ ] `demo:reset` + `db:seed` green; **demo schedule identical** to pre-Layer-0.

---

## Stop conditions (report, don't improvise)
- Any Pattern-B table appears to need a version column → **stop** (that means we mis-scoped D-L0-1).
- Any consumer can't resolve a part with an available `asOf` (no build date to anchor to) → **stop and report**; do not default silently to `now`.
- Backfill can't achieve 100% coverage (orphan routing→part, null `created_at`) → **stop**; data-quality issue to surface, not paper over (D45 spirit).
- Any change would touch BOM / asset / UoM-factor / connector / draft-publish surface → **stop** (out of scope).
