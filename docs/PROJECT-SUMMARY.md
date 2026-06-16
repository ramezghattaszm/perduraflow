# PerduraFlow — Project Summary

> Last Updated: 2026-06-14
> Purpose: Live project state for handoff between sessions.

> **State:** **Phase 0 + the decided app shell: BUILT, signed off & pushed.** **Phase 1 (minimal
> Master Data): BUILT & verified** — the first domain module (`master-data`: parts, resources +
> groups, routings + operations, certifications, operators + qualifications), `org` customer/program
> `priority`, `org.read 1.1` (additive), and the published `masterdata.read 1.0` (no resolver).
> Migration `0003` applied + seeded; `bun run check` + `next build` + expo tsc green; all four boundary
> proofs pass; CRUD/soft-delete/routing-editor/qualifications-matrix browser-verified. Spec deltas in
> api-spec §10 + frontend-spec §9–§12 (design choices AS5–AS8 / FS5–FS8 confirmed). Committed + pushed
> (`7142ddc`).
>
> **Phase 2 (deterministic scheduling core + first per-tenant binding): BUILT & verified.** The
> `scheduling` module (`demand_input`/`optimizer_run`/`schedule_version`/`scheduled_operation`), the
> kernel `binding` module + `BindingResolver` consuming `masterdata.read` per-tenant →
> `platform_module`, a deterministic EDD penalty sequencer (firm-dominant, SKIP-03 stand-in),
> `masterdata.read 1.0 → 1.1` (additive: `listResources`/`getPrimaryRoutingForPart`), and a read-first
> Gantt board (`ScheduleGantt` on `react-native-svg`, web + native). Migration `0004` applied + seeded
> (binding row, 8 demand lines, coloured parts). `bun run check` + `next build` + expo tsc green; all
> five boundary/determinism proofs pass (negative lint, no cross-schema FK, genuine re-bind,
> source/confidence fields wired, identical re-runs); board + re-solve + commit + infeasibility
> browser/API-verified. Spec deltas api-spec §11 + frontend-spec §13–§17 (AS9–AS12 / FS9–FS11
> confirmed). **Committed + pushed** (`4873456`); subsequent UI/board/keyboard/Android polish + the
> shell revision (operational/admin split, native shell, RBAC gating) committed on top (`27a00de`).
>
> **Phase 3 (execution actuals + the closed loop — learn-and-reflect): BUILT — gates green; browser
> verification with user pending.** Governed by **A18**. **Backend** (api-spec §12): sibling
> **`learning`** module (`learning` schema `execution_actual` append-only + `learned_parameter` overlay;
> the **damped snap-on-gate** rule + guardrails), the demo **simulator** fixture in `scheduling`
> (emits 4.3 actuals on the EventBus; learning consumes), SKIP-04 source/confidence **live** (zero
> schema/board change), **per-version** performance variance + OEE + Tier-B cost/unit, D56 tool-wear
> flag, `learning.read 1.0` + `masterdata.read 1.2`. Migration `0005` applied; clean reseed.
> **Verified via the real query path** — five proofs (SKIP-04 live, damped convergence, determinism,
> A18 guardrail reject, per-version isolation) + cost sanity. **UI** (frontend-spec §18–§25): board
> variance strip + learned-param settled-step panel + `$ml` bar + wear toast; **Scorecard** + **Workforce
> coverage** views; dev-only drift control; nav + i18n + both-theme stories. `bun run check` +
> `next build` + expo tsc green. AS13–AS18 / FS12–FS15 implemented as proposed. **Remaining:** browser
> verification on web + native (incl. per-version reselect) — user-driven per the brief DoD.
>
> **Phase 4 (parameter prediction — anticipatory, confidence-gated, tier-bounded): DRAFT — specs proposed,
> pending sign-off; nothing implemented.** Governed by **A18** (the *predictive* case of the trust envelope).
> Planned (api-spec §13 / frontend-spec §26–§31): a **predictor** in the `learning` module — **OLS linear
> trend** on the same `execution_actual` series → a **threshold-crossing forecast** with **confidence that
> degrades with horizon** (settled statement, damped, no ticker; new `parameter_prediction` table, retained for
> a Phase-5 accuracy measure); a **confidence×tier gate** (per-tenant threshold; **Tier-1 auto-commit / Tier-3
> always-human regardless of confidence** — A18 floor); **pre-emptive action** = a `ml_predicted` learned step
> applied via the existing overlay at next solve (**no scheduling change**, D44-stable, **reversible** by
> subsequent actuals); surfacing in **View 4 · Exception Queue** ("N need you · M auto-handled") + a board
> forward-flag; the threshold configured in **View 5 · Objective Policy** (new `policy` module + `policy.read
> 1.0`). Contracts: `learning.read 1.0 → 1.1` (additive: `getPrediction`/`listPredictions`), `TimeSource +=
> ml_predicted`. Decisions **AS19–AS22 / FS16–FS19** (all DRAFT). Out of scope (Phase-5): what-if/baseline/
> narration, auto-action outside the gate. **Awaiting RG review before any implementation.**
>
> **Demo reset + Magna scenario:** `bun run demo:reset` (apps/api `src/db/reset.ts`) restores the
> deterministic **Magna de México** dataset (docs/SEED-SCENARIO-SPEC.md) in one step — truncates all
> app-schema tables (wipes learned values, actuals, schedule versions), re-seeds the one coherent
> scenario (3 plants, GM/Stellantis/Nissan/Aftermarket tiers, stamping+weld lines w/ cost rates, named
> parts, operators+certs, the four-collision demand spine incl. `GP-1142`), and rebuilds committed
> baselines via the real engine (solve+commit through the API). **Idempotent + deterministic**; baseline
> all `std`, 0 learned, no variance (8 demand lines, 2 committed versions). Cert gap is coherent (Luis OUT
> → gap; Jorge the cheapest off-shift fill); DL-1006 is computed-late; Collision-3 `PV-22` is a tagged
> staged anchor (NMA SKIP-13). Requires the API running; docs in README §"Demo reset". Dev ports:
> **API 3010 / web 3011**.

---

## 1. What we are building

A **client-agnostic manufacturing operations platform** (first deployment: Magna). **Production
scheduling is module #1**; the platform kernel is built underneath it (no platform-first phase —
A11), scoped to what this module needs but with clean contribution seams so module #2 (Master Data)
slots in without rework. The platform is **modular and contract-bound**: any module is replaceable
by another platform module or a third party by satisfying its contract, with zero consumer change.

**This session (phase 0)** stands up the **kernel spine + shared organizational model with config
screens**: tenancy, identity/auth/roles, and the org model (Plant, Plant group, Customer, Program,
Calendar), plus the app shell and admin CRUD. Later phases: Master Data, the deterministic
scheduling core, execution actuals + performance metrics, ML parameter prediction.

---

## 2. Repository

**Location:** `/Users/RamezGhattas/Documents/Work/Company/SupplyChain/PerduraFlow`

**Stack:** Tamagui + Expo Router + Next.js (App Router) + Solito + Zustand + TanStack Query +
i18next · NestJS + Drizzle + PostgreSQL · bun monorepo (Turborepo) · API runs on Node.

**Structure:**
```
apps/    expo/  next/  api/
packages/  app/  ui/  config/  contracts/
```
Monorepo already scaffolded and installed (template baseline present; slug `perduraflow` applied).

---

## 3. Docs

| File | Purpose |
|---|---|
| `CLAUDE.md` | Build instructions (template-level) |
| `docs/CLAUDE-CODE-BRIEF.md` | Kickoff brief — phase 0 scope + invariants (governs this build) |
| `docs/API-ARCHITECTURE.md` | Reusable API patterns (note: §3 overridden — see api-spec §0) |
| `docs/UI-ARCHITECTURE.md` | Reusable UI patterns |
| `docs/platform-architecture-spec.md` | Platform architecture (A-series) |
| `docs/production-scheduling-business-functional-spec.md` | Module #1 business/functional (D-series) |
| `docs/master-data-module-spec.md` · `net-requirements-…` · `network-material-allocation-…` | Future-module context |
| `docs/PLATFORM-COMPLETION-LOG.md` | Demo→full gap tracker (SKIP-NN; governs scope) |
| `docs/api-spec.md` | This app's API decisions (phase 0) |
| `docs/frontend-spec.md` | This app's UI decisions (phase 0) |

---

## 4. App identity

- Display name: PerduraFlow
- Slug: perduraflow
- Bundle id: com.perduraflow.app
- Database: perduraflow

---

## 5. Status

> **Phase 0 = BUILT & VERIFIED.** Specs signed off (rulings AS1–AS4, FS1–FS4; SKIP-52 added).
> Built per the brief §4 step 3 to the §5 definition of done. Demo/infra template modules
> (example, notifications, storage, generic admin) were removed and `users` folded into `auth`
> (api-spec §1) to keep `user` single-owner and the boundary crisp.

### API modules (phase 0)
| Module | Status | Notes |
|---|---|---|
| `tenant` (kernel) | Built | `tenant` schema; scoped Drizzle instance; scoping active (SKIP-01). |
| `auth` (kernel) | Built | `auth` schema: user(role_id), role, approval_tier, otp_code; seeded editable role set (SKIP-43 = structure); profile + admin user/role CRUD; consumes `org.read` (O4). |
| `org` (kernel) | Built | `org` schema: plant, plant_group(+member), customer, program, calendar; admin CRUD; exposes `org.read` `1.0`. |
| EventBus coordinator | Built | + local in-memory provider (SKIP-05); cross-module publishes flow through it. |
| `packages/contracts` | Built | `org.read` `1.0` (`id + version`, SKIP-21), rbac + org DTOs, app error codes. |

**Verified live:** migrations apply (3 schemas, 11 tables, no cross-schema FK); seed creates tenant +
admin + 3 tiers + 8 roles + sample org rows; API boots on Node; login → `/users/me` → org CRUD
persists; role create with a bogus plant ref rejected `INVALID_PLANT_REFERENCE` via `org.read` (O4);
401 on unauthenticated write. Boundary lint **rejects** a cross-module `schema/` import (negative-tested).

### Frontend (phase 0)
| Area | Status | Notes |
|---|---|---|
| App shell + nav | Built | `AdminShell` (web sidebar via `SidebarNav`); empty dashboard landing (D34/A6 registration stub). |
| Admin CRUD screens | Built | dashboard + plants, plant-groups, customers, programs, calendars, roles, users — full CRUD incl. soft-delete (Deactivate + ConfirmDialog; status column); server errors surfaced inline in FormSheet. Wired into `apps/next`. |
| New `packages/ui` components | Built | PageHeader, StatusPill, FormField, SelectField, DataTable, FormSheet, ConfirmDialog, SidebarNav (+ stories, both themes). |
| Auth screens | Existing | Template baseline reused; `expo` unchanged (type-checks clean). |

**Verified:** `next build` succeeds (all 8 admin/dashboard routes + auth); `expo` type-checks clean;
`bun run check` (typecheck + doc lint + boundary lint) green; contracts/config/ui build clean.
**Browser smoke (Playwright, Next dev + API):** logged in as the seeded admin and ran
create → edit → soft-delete on all 7 admin screens — every change reflected in the list (8/8 pass,
0 page errors). The Roles screen surfaces `INVALID_PLANT_REFERENCE` as a visible inline message when
a role is scoped to a deactivated plant (the `org.read` O4 path, end to end through the UI).

---

## 6. Environment variables

Template set only for phase 0: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
`JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `PORT`, `NODE_ENV`, `CORS_ORIGIN`, `EMAIL_*`,
`STORAGE_*`. No app-specific vars added. Never commit secrets.

---

## 7. Completion-log entries touched by phase 0

Phase 0 builds the **foundational, built-now** halves of these; the heavier machinery stays deferred
(no new SKIP rows needed unless a fresh scope-down appears during implementation):

- **SKIP-01** Tenancy active (column + scoped queries + single tenant); isolation hardening deferred.
- **SKIP-05** EventBus coordinator + local provider built; Kafka provider deferred.
- **SKIP-21** Contracts carry `id + version` (`org.read` `1.0`); A12 registry/wire machinery deferred.
- **SKIP-28** Deployment shape B (one deployable, contract-bound, swappable transport).
- **SKIP-43** Seed the role structure (data scope + approval tier); full per-dashboard action matrix deferred.
- **SKIP-25** Local accounts + basic role gating; per-tenant OIDC/SAML + shop-floor sessions deferred.

---

## 8. Known issues / in progress

1. Admin CRUD verified end-to-end in a real browser (Playwright over the Next dev server + API):
   create → edit → soft-delete on all 7 screens, plus the Roles `INVALID_PLANT_REFERENCE` inline
   message. No outstanding screen issues.
2. Storybook stories ship with each new `packages/ui` component, but a Storybook runner/CI check is
   not yet wired (SKIP for later; UI §16 satisfied by "stories ship with the component").
3. The dev DB pre-existed; old template tables may linger in the `public` schema (harmless — the
   kernel uses the `tenant`/`auth`/`org` namespaces). A clean DB run is `db:setup` on an empty DB.
4. Deactivate is the soft-delete action (status→inactive for plants; `isActive=false` elsewhere);
   lists keep showing deactivated rows with an "Inactive" pill (never hard-deleted, per the schema rules).
5. **Inherited (phase-0), fixed in phase 1:** `packages/ui/src/OtpInput.tsx` had a ref-typing
   mismatch (a `(el: TextInput|null) => void` ref callback on a Tamagui `Input`) that was invisible
   to the `bun run typecheck` gate (which doesn't include `apps/expo`) and only surfaced when phase-1
   ran `tsc -p apps/expo` (stricter RN types) for the DoD. Pre-existing, **not introduced by phase 1**;
   fixed with a localized cast so expo type-checks clean. Consider adding `apps/expo`/`apps/next` to
   the turbo `type-check` set so such inherited issues are caught by the standard gate.

---

## 9. Upcoming work (priority order)

1. Optional: browser click-through of the 7 admin screens + Storybook runner in CI.
2. Phase 1 (separate brief): minimal Master Data behind contract-shaped boundaries; the first
   per-tenant **binding** appears (scheduling consumes Master Data) → build the binding resolver (O7),
   which has no consumer until then.
3. As later phases add modules, promote SKIP rows (EventBus Kafka provider, contract registry A12
   machinery, RBAC depth, tenancy hardening) from "built-now foundation" to full implementations.
