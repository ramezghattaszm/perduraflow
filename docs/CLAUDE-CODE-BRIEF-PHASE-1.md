# Claude Code brief — Phase 1: minimal Master Data

| | |
|---|---|
| **Builds on** | Phase 0 (closed). All Phase 0 invariants and boundary rules carry forward unchanged. |
| **This session** | The first **domain** module: minimal Master Data — parts, resources, resource groups, routings — behind contract-shaped boundaries (SKIP-02) |
| **Working mode** | Propose-then-confirm. Draft the spec deltas, present, **wait for sign-off**, then implement. Same gate as Phase 0. |

---

## 0. Mission

Stand up `master-data` as the first **domain** module, scoped to what scheduling will need in phase 2: **parts** (what's made), **resources** (lines / machines / work-centres — where), **resource groups**, and **routings** (how a part is made on resources, with standard setup + cycle times). This is the minimal in-module slice of the full Master Data module (SKIP-02); BOM, physical attributes, tooling, effectivity, and UoM conversion stay deferred.

Two architectural firsts this session, both load-bearing:

1. **First domain module** — `master-data` gets its own Postgres schema + scoped Drizzle instance, following the Phase 0 boundary pattern exactly (which you proved holds).
2. **First contract *consumption*** — resources reference `org`'s plants and calendars. Master Data consumes them through the `org.read` contract (never `org`'s tables), exactly as Phase 0's `auth`→`org` validation does. This is the consumer side of the contract model, exercised for the first time across a domain→kernel boundary.

**Not this session:** the per-tenant **binding resolver**. Its first consumer is scheduling (phase 2); building it now is abstraction ahead of its consumer. Phase 1 *publishes* the Master Data contract that phase 2's binding will resolve — nothing more on the binding front.

---

## 1. Read first

1. `docs/CLAUDE-CODE-BRIEF.md` — Phase 0 brief. **Sections 2 (invariants) and the contract-bound-module rules still bind in full.** Re-read them; they are not repeated here.
2. `docs/master-data-module-spec.md` — what Master Data owns (MD-series, the ownership principle).
3. `docs/production-scheduling-business-functional-spec.md` §5.3 (resource model), §5.4 (changeover), and the routing/operation model — Master Data owns these; scheduling consumes them (MDQ6).
4. `docs/PLATFORM-COMPLETION-LOG.md` — SKIP-02 (this build), SKIP-44 (effectivity), SKIP-45 (BOM/multi-level), SKIP-21 (contract id/version — the foundational half applies here).

---

## 2. Invariants — Phase 0 rules carry, plus these Phase 1 specifics

Everything in Phase 0 Section 2 applies unchanged: per-module schema + scoped Drizzle instance, the lint rule that makes cross-module `schema/` imports fail the build, one shared Pool, contracts as the only cross-module surface, EventBus coordinator for cross-module events, ULID PKs, tenant scope column + index on every table, soft-delete only. Additions for this session:

- **Resource → `org` references go through `org.read`, by text ID, no cross-schema FK** — identical to Phase 0's O4. `resource.plant_id` and `resource.calendar_id` are plain text, validated at write time via the `org.read` contract. A bad or inactive reference is rejected with a typed error surfaced in the UI (the Phase 0 `INVALID_PLANT_REFERENCE` pattern).
- **`org.read` evolves additively (first contract version bump).** If `org.read 1.0` does not already expose calendar read + validation, extend it to **`org.read 1.1`** — additive MINOR only (new methods, no changed/removed ones), so every Phase 0 consumer of `1.0` keeps compiling and passing untouched. This is the id/version discipline (SKIP-21, foundational half) exercised for real; prove the existing `auth` consumer is unaffected.
- **Master Data *publishes* its contract** in `packages/contracts` with `id + version` (e.g. `masterdata.read 1.0`), ready for phase 2's consumer. **No binding resolver** — the contract is published, not yet resolved through a per-tenant binding.
- **Routing operations carry the *standard* baseline.** `std_setup_time` and `std_cycle_time` on each routing operation are the deterministic baseline (D7). Phase 2's committed-schedule records will carry `setup_source`/`cycle_source` defaulting to `standard` = these values, with ML overlaying later (SKIP-04). So this session establishes the `standard` source of truth — model it cleanly; nothing here is ML.
- **Standard cycle time + calendar are the planned-throughput basis** for the "expected X/hour vs actual" story (phase 3). Capture them faithfully now (ideal cycle time per part-on-resource lives on the routing operation; resource availability comes from its `org` calendar). No throughput computation this session — just the inputs.
- **Demo fidelity limits, logged not silently dropped:** parts/routings are **current-version only** — no effectivity dating (SKIP-44); **no BOM** — parts are flat, no component structure (SKIP-45); **single UoM per part**, no conversion (part of SKIP-02). If you scope anything down beyond what these rows already cover, add a `SKIP` row in the same change.

---

## 3. This session — scope

**Module → schema/table ownership:**

| Module | Postgres schema | Owns tables (minimal) |
|---|---|---|
| `master-data` | `master_data` | `part`, `resource`, `resource_group`, `resource_group_member`, `routing`, `routing_operation` |

Sketch (refine field-level in your draft; ground every field in a spec ref):

- **`part`** — part number, description, `part_type` (`finished`\|`component`\|`raw`), base UoM, status. No BOM, no effectivity.
- **`resource`** — name, `resource_type` (`line`\|`machine`\|`cell`\|`work_center`), `plant_id` (→ `org` via `org.read`), `calendar_id` (→ `org` via `org.read`), status. MDQ6: resources live here; scheduling consumes them.
- **`resource_group`** + **`resource_group_member`** — named grouping of resources (§5.3); a resource may belong to multiple groups.
- **`routing`** — header: `part_id` (intra-module FK to `part`), status. Current-version only.
- **`routing_operation`** — `routing_id`, sequence number, target `resource_id` *or* `resource_group_id` (intra-module), `std_setup_time`, `std_cycle_time`, and the changeover attribute key(s) (§5.4) modeled but not yet sequenced. These standard times are the `standard` baseline (D7).

**Contracts:**
- Consume `org.read` (bump to `1.1` if calendar read/validate isn't already there — additive).
- Publish `masterdata.read 1.0` with `id + version` (part/resource/routing read + reference-validation methods), for phase 2's consumer. No resolver.

**Screens (admin), full CRUD incl. soft-delete from the start, browser-verified:** Parts, Resources, Resource Groups, Routings. Reuse the Phase 0 `AdminResourceScreen` / `FormSheet` / 8-component pattern where it fits. **Routings need a header-plus-operations master-detail editor** that the flat `FormSheet` pattern doesn't cover — propose that UI pattern in your `frontend-spec` delta (see Section 5).

**Out of scope:** scheduling, the binding resolver, optimizer, actuals, ML, BOM, effectivity, UoM conversion, tooling/physical-attribute domains, cloud providers, Kafka provider.

---

## 4. Working protocol

1. **Draft the deltas** to `docs/api-spec.md` and `docs/frontend-spec.md` (the `master-data` module + tables, the `org.read 1.1` bump, the `masterdata.read 1.0` publication, the new screens and the routing-editor pattern), plus the `PROJECT-SUMMARY.md` state update. **Present and stop for sign-off. Do not implement tables or screens yet.**
2. On sign-off: implement — schema + migration + seed, the module, contract changes, screens.
3. Verify against Section 5, including the boundary proofs.
4. Propose before any large or irreversible move.

---

## 5. Items to propose in your draft (genuine design choices — don't just pick)

- **Routing editor UI pattern.** Header + ordered operations is a master-detail form, not a flat CRUD modal. Propose the pattern (inline operations table inside the routing sheet? dedicated routing-detail route? add/reorder/remove operation rows) and which new `packages/ui` component(s) it needs.
- **Resource capacity granularity.** Confirm ideal cycle time lives at routing-operation grain (per part-on-resource), and whether `resource` also carries any nominal/theoretical rate or none in the demo. Propose minimal.
- **Changeover attributes.** §5.4 keys changeover off part attributes. Propose what minimal attribute(s) the routing operation carries now (modeled, not yet driving sequencing) vs. deferred.

---

## 6. Definition of done — Phase 1

- `bun run check` (typecheck + doc lint + boundary lint) green; API builds and boots; `next build` succeeds; `expo` type-checks clean.
- Migration applies; seed creates sample parts, resources (referencing seeded plants + calendars), resource groups, and at least one routing with operations.
- **Full CRUD including soft-delete on every new screen, browser-verified** — create → edit → deactivate → list reflects each change. (Don't repeat Phase 0's CRU-without-D gap; ship Delete from the first pass.)
- **Boundary proofs (show these in the hand-back):**
  1. `master-data` is its own Postgres schema with a Drizzle instance scoped to only its tables; the lint rule **fails the build** on a deliberate cross-module `schema/` import (negative-tested, then reverted), same as Phase 0.
  2. `resource.plant_id` / `resource.calendar_id` are text, **no cross-schema FK**; FK audit shows only `master_data`→`master_data` intra-module FKs. A bogus/inactive plant *and* calendar reference is rejected through `org.read` with a typed error visible in the UI; valid active ones pass — verified live.
  3. `org.read` bumped to `1.1` is additive: the Phase 0 `auth` consumer of the contract compiles and passes unchanged — show it.
  4. `masterdata.read 1.0` is published in `packages/contracts` with `id + version`; confirm **no binding resolver** was built.
- Docs reflect what was built; completion log updated (SKIP-02 progress; any new fidelity SKIP rows).
- Stop at this checkpoint. Do not start phase 2.

---

*Phase 2 (deterministic scheduling core + the first end-to-end per-tenant binding) gets its own brief once Phase 1 is signed off.*
