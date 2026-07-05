# Claude Code brief — Phase 1: minimal Master Data + shell

| | |
|---|---|
| **Builds on** | Phase 0 (closed — kernel spine, org model, app shell). All Phase 0 invariants and boundary rules carry forward unchanged. |
| **This session** | The first **domain** module — minimal Master Data — landed into the decided app shell. |
| **Working mode** | Propose-then-confirm. Draft the spec deltas, present, **wait for sign-off**, then implement. Same gate as Phase 0 (it caught the missing-Delete bug — keep it). |

---

## 0. Mission

Stand up `master-data` as the first **domain** module, scoped to what scheduling will need, and build it into the decided shell. This session:

- **Master Data (new module):** parts, resources (lines/machines/work-centres) + resource groups, routings/operations, and the **skill/certification taxonomy + operator qualifications** (MD15) as externally-sourced canonical reference.
- **Org model (edit existing Phase 0 `org` module):** add a **priority** attribute to `customer` and `program`.
- **Shell:** build the decided `AppShell` (per `frontend-spec-shell.md`) and land the Master Data screens into it already styled.

This is the minimal in-module slice of the full Master Data module (SKIP-02); BOM, physical attributes, tooling, effectivity, UoM conversion, **order economics margin/penalty** (future phase), and the **binding resolver** (Phase 2) stay deferred.

Two architectural firsts this session, both load-bearing:
1. **First domain module** — `master-data` gets its own Postgres schema + scoped Drizzle instance, following the Phase 0 boundary pattern you proved holds.
2. **First contract *consumption*** — resources reference `org`'s plants and calendars through the `org.read` contract (never `org`'s tables), exercising the consumer side of the contract model across a domain→kernel boundary for the first time.

**Not this session:** the per-tenant **binding resolver** (first consumer is scheduling, Phase 2). Phase 1 *publishes* the Master Data contract that Phase 2's binding will resolve.

---

## 1. Read first

1. `docs/CLAUDE-CODE-BRIEF.md` — Phase 0 brief. **Section 2 (invariants) and the contract-bound-module rules still bind in full.** Re-read; not repeated here.
2. `docs/frontend-spec-shell.md` — **the decided app shell (Deep Navy tokens, TopBar, collapsible SidebarNav, responsive drawer, scroll-wrapped DataTable, round OrgAvatar/UserAvatar). This is the frontend baseline — build it, do not re-propose it.**
3. `docs/master-data/master-data-module-spec.md` (Draft v0.4) — what Master Data owns (MD-series incl. **MD15**, the ownership principle).
4. `docs/scheduling/production-scheduling-business-functional-spec.md` (Draft v0.11) — §5.3 resource model, §5.4 changeover, routing/operation model; **D54** (the eventual consumer of cert/qualification data — Phase 2+, context only).
5. `docs/platform/platform-architecture-spec.md` (Draft v0.10) and `docs/PLATFORM-COMPLETION-LOG.md` (v0.3) — SKIP-02 (this build), SKIP-44 (effectivity), SKIP-45 (BOM), SKIP-21 (contract id/version, foundational half).

---

## 2. Invariants — Phase 0 rules carry, plus these Phase 1 specifics

Everything in Phase 0 Section 2 applies unchanged: per-module schema + scoped Drizzle instance; the lint rule that makes cross-module `schema/` imports fail the build; one shared Pool; contracts as the only cross-module surface; EventBus coordinator for cross-module events; ULID PKs; tenant scope column + index on every table; soft-delete only. Additions:

- **Resource → `org` references go through `org.read`, by text ID, no cross-schema FK** — identical to Phase 0's O4. `resource.plant_id` / `resource.calendar_id` are plain text, validated at write via the `org.read` contract; a bad/inactive reference is rejected with a typed error surfaced in the UI (the Phase 0 `INVALID_PLANT_REFERENCE` pattern).
- **`org.read` evolves additively (first contract version bump).** If `org.read 1.0` doesn't already expose calendar read+validation, extend to **`org.read 1.1`** — additive MINOR only, so every Phase 0 consumer of `1.0` keeps compiling and passing untouched. Prove the existing `auth` consumer is unaffected.
- **Master Data *publishes* its contract** in `packages/contracts` with `id + version` (e.g. `masterdata.read 1.0`), ready for Phase 2's consumer. **No binding resolver.**
- **Cert/qualification + priority are reference data, externally sourced.** The skill/certification taxonomy, operator qualifications (MD15), and customer/program priority are **canonical view only**, seeded for the demo; external-system mappings live in the integration/mapping layer, not here. Master Data does **not** roster operators; `org` priority is a plain attribute, not a commercial engine.
- **Routing operations carry the *standard* baseline.** `std_setup_time` / `std_cycle_time` are the deterministic baseline (D7). Phase 2's schedule records will carry `setup_source`/`cycle_source` defaulting to `standard` = these values. Model cleanly; nothing here is ML.
- **Demo fidelity limits, logged not silently dropped:** parts/routings current-version only (no effectivity, SKIP-44); no BOM (SKIP-45); single UoM per part, no conversion (SKIP-02); margin/penalty order economics **out** (future phase — only customer/program *priority* is in). New scope-downs get a `SKIP` row in the same change.

---

## 3. This session — scope

**Module → schema/table ownership** (one Postgres schema per module, Drizzle instance scoped to it):

| Module | Schema | Owns / changes |
|---|---|---|
| `master-data` *(new)* | `master_data` | `part`, `resource`, `resource_group`, `resource_group_member`, `routing`, `routing_operation`, **`certification`** (taxonomy), **`operator`** (minimal, externally-sourced stub: id, name, home plant, optional `labor_rate`), **`operator_qualification`** (operator×certification join) |
| `org` *(edit Phase 0 module)* | `org` | add `priority` to `customer` and `program` |

Sketch (refine field-level in your draft; ground every field in a spec ref):

- **`part`** — number, description, `part_type` (`finished`\|`component`\|`raw`), base UoM, status. No BOM, no effectivity.
- **`resource`** — name, `resource_type` (`line`\|`machine`\|`cell`\|`work_center`), `plant_id` (→`org` via `org.read`), `calendar_id` (→`org` via `org.read`), status. MDQ6: resources live here; scheduling consumes them.
- **`resource_group`** + **`resource_group_member`** — named grouping; a resource may belong to multiple (§5.3).
- **`routing`** — `part_id` (intra-module FK), status. Current-version only.
- **`routing_operation`** — `routing_id`, sequence, target `resource_id` or `resource_group_id` (intra-module), `std_setup_time`, `std_cycle_time`, changeover attribute key(s) (§5.4, modeled not yet sequenced). Standard times = the `standard` baseline (D7).
- **`certification`** — code, name, description (MD15 taxonomy).
- **`operator`** + **`operator_qualification`** — minimal externally-sourced operator stub and which certifications each holds (MD15). Seeded; no rostering.
- **`org.customer` / `org.program`** — add `priority` (simple ordinal/tier).

**Contracts:** consume `org.read` (bump to `1.1` if calendar read/validate isn't there — additive); publish `masterdata.read 1.0` with `id + version` (part/resource/routing/certification read + reference-validation). No resolver.

**Shell + screens:** build `AppShell` per `frontend-spec-shell.md` first (Deep Navy, TopBar, collapsible SidebarNav, drawer, OrgAvatar/UserAvatar, scroll DataTable), generalizing Phase 0's `AdminShell`. Then **full CRUD incl. soft-delete, browser-verified** screens for: Parts, Resources, Resource Groups, Routings, Certifications, Operators (with qualifications). Add `priority` to the existing Customers/Programs screens. Reuse the Phase 0 `AdminResourceScreen`/`FormSheet` pattern; **Routings need a header-plus-operations master-detail editor** the flat pattern doesn't cover — propose it (Section 5).

**Out of scope:** scheduling, the binding resolver, optimizer, actuals, ML, BOM, effectivity, UoM conversion, tooling/physical-attribute domains, order economics margin/penalty, cloud providers, Kafka provider.

---

## 4. Working protocol

1. **Draft the deltas** to `docs/platform/api-spec.md` and `docs/frontend-spec.md` (the `master-data` module + tables, the `org` priority edit, the `org.read 1.1` bump, the `masterdata.read 1.0` publication, the shell build + new screens + routing-editor pattern), plus the `PROJECT-SUMMARY.md` state update. The shell follows `frontend-spec-shell.md` — incorporate, don't re-derive. **Present and stop for sign-off. Do not implement tables or screens yet.**
2. On sign-off: build the shell, then schema + migration + seed, the module, contract changes, screens.
3. Verify against Section 6, including the boundary proofs.
4. Propose before any large or irreversible move.

---

## 5. Items to propose in your draft (genuine design choices — don't just pick)

- **Routing editor UI pattern** — header + ordered operations is master-detail, not a flat modal. Propose the pattern (inline operations table? dedicated route? add/reorder/remove) and the new `packages/ui` component(s).
- **Operator-qualifications UI** — operator×certification is a many-to-many; propose how it's edited (multi-select on the operator, a matrix, etc.).
- **Resource capacity granularity** — confirm ideal cycle time lives at routing-operation grain; whether `resource` carries any nominal rate or none. Propose minimal.
- **Changeover attributes** — §5.4 keys changeover off part attributes; propose the minimal attribute(s) the operation carries now (modeled, not yet sequenced) vs deferred.

---

## 6. Definition of done — Phase 1

- `bun run check` (typecheck + doc lint + boundary lint) green; API builds and boots; `next build` succeeds; `expo` type-checks clean.
- Migration applies; seed creates sample parts, resources (referencing seeded plants + calendars), resource groups, ≥1 routing with operations, a certification set, operators with qualifications, and customer/program priorities.
- **Shell built per `frontend-spec-shell.md`** — Deep Navy, collapsible sidebar (persisted), TopBar (search/bell/avatar menu), responsive drawer at `small`, round OrgAvatar (logo-or-placeholder) + UserAvatar, DataTable horizontal-scroll at `small`.
- **Full CRUD incl. soft-delete on every new screen, browser-verified** — create → edit → deactivate → list reflects each change. (Don't repeat Phase 0's CRU-without-D gap; ship Delete from the first pass.)
- **Boundary proofs (show in the hand-back):**
  1. `master-data` is its own Postgres schema, Drizzle instance scoped to only its tables; the lint rule **fails the build** on a deliberate cross-module `schema/` import (negative-tested, then reverted).
  2. `resource.plant_id` / `resource.calendar_id` are text, **no cross-schema FK**; FK audit shows only intra-module FKs. A bogus/inactive plant *and* calendar ref is rejected through `org.read` with a typed UI error; valid ones pass — verified live.
  3. `org.read` bumped to `1.1` is additive: the Phase 0 `auth` consumer compiles and passes unchanged — show it.
  4. `masterdata.read 1.0` is published in `packages/contracts` with `id + version`; confirm **no binding resolver** was built.
- Docs reflect what was built; completion log updated (SKIP-02 progress; any new fidelity SKIP rows). Stop at this checkpoint. Do not start Phase 2.

---

*Phase 2 (deterministic scheduling core + the first end-to-end per-tenant binding) gets its own brief once Phase 1 is signed off.*
