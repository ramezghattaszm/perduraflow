# PerduraFlow — Frontend Spec

> App-specific UI decisions. The reusable patterns live in `UI-ARCHITECTURE.md` — this file only
> records what is unique to PerduraFlow.
>
> Scoped to **phase 0**: the **app shell** (auth/login, navigation, an empty dashboard landing as a
> kernel registration point — D34/A6) + **admin/config CRUD screens** for the organizational model.
> No scheduling, master data, or domain screens this session.
>
> **STATUS: PROPOSAL — awaiting sign-off. No screens implemented yet.**

---

## 1. Palette (semantic token values)

Blue brand (`#2D5BE3`) on a tuned light+dark palette (`packages/config/src/tamagui.config.ts`). The
dark neutrals were retuned to **Deep Navy** (UI shell spec §2) and three extended roles added in both
modes (`surfaceRaised`, `primarySoft`, `hoverFill`). Role names are fixed (UI §3); values are the app
decision below.

| Semantic role | Light | Dark | Note |
|---|---|---|---|
| `primary` | `#2D5BE3` | `#5B8DEF` | keep (template) |
| `primaryLight` | `#7EB3FF` | `#93B4F5` | keep |
| `surface` | `#FFFFFF` | `#131926` | Deep Navy (dark retuned) |
| `background` | `#F7F8FA` | `#080B14` | Deep Navy (dark retuned) |
| `textPrimary` | `#1A1A2E` | `#E6E8EB` | keep |
| `textSecondary` | `#5B6472` | `#9AA3B2` | keep |
| `borderColor` | `#E3E8F0` | `#232C3D` | Deep Navy (dark retuned) |
| `success` | `#16A34A` | `#4ADE80` | keep |
| `danger` | `#DC2626` | `#F87171` | keep |
| `warning` | `#D97706` | `#FBBF24` | keep |
| `gradientStart` | `#C8E6FF` | `#1E2A4A` | keep |
| `gradientEnd` | `#4A6FE3` | `#1E3A8A` | keep |
| `navBar` | `#00429E` | `#0A1324` | sidebar / nav chrome (Deep Navy on dark) |
| `surfaceRaised` | `#FFFFFF` | `#1A2030` | menus/popovers/tooltips/raised header (dark elevates lighter) |
| `primarySoft` | `rgba(45,91,227,0.10)` | `rgba(91,141,239,0.14)` | selected nav item / active row tint |
| `hoverFill` | `rgba(0,0,0,0.045)` | `rgba(255,255,255,0.05)` | row / nav-item / icon-button hover |

---

## 2. Typography retune

Default. `H`/`P` scale unchanged (UI §4). Inter.

---

## 3. App-specific components (new shared components in `packages/ui`, variant-driven, library-safe)

> Built to UI §0.1 (repeated pattern → one component) and §16 (each ships a `*.stories.tsx` in both
> themes). Names stay app-agnostic so `packages/ui` remains extractable (§0.2).

| Component | Variants / props | Purpose (used by) |
|---|---|---|
| `DataTable` | `columns` (incl. per-column `sortable` / `sortValue`), `rows`, `onRowPress`, `isLoading`, empty slot | The list view behind every admin CRUD screen (plants, customers, …). Sortable columns toggle asc → desc → unsorted on header click (↑/↓ indicator). Replaces per-screen table styling. |
| `FormField` | wraps `AppInput`/`AppSwitch`/select; `label`, `error`, `required` | Labelled field for every create/edit form. |
| `SelectField` | `options`, `value`, `onChange`, `multiple` | Enum + reference pickers (e.g. `group_type`, `data_scope`, customer→program, multi-plant scope). |
| `StatusPill` | `tone` (`active`/`inactive`/`neutral`) | Row status (`plant.status`, `is_active`). |
| `PageHeader` | `title`, `actions` slot | Consistent admin page header + primary action (New …). |
| `Popup` | `open`, `onClose`, `title`, `description`, `size`, `dismissable`, `error`, `footer` | The one responsive modal (UI §17): centered dialog on desktop, native `Sheet` on small. Used declaratively for every create/edit form **and** via `usePopup` for confirms. Replaced `FormSheet`. |
| `TextLink` | `size`, `weight` (extends `P`) | Clickable inline text (pointer cursor + hover); replaces `<P onPress>` for links. |
| `ConfirmDialog` | `title`, `message`, `tone`, `onConfirm` | Predates `Popup`/`usePopup`; **superseded** by them for confirms (kept as a primitive). |
| `SidebarNav` / `NavItem` | `sections` (label + icon items), `activeId`, `collapsed`, `header`/`footer` render props | Shell navigation: labelled sections, active = `primarySoft` fill + `primary` icon/text + 3px accent bar, hover `hoverFill`, collapses to a 74px icon rail with `AppTooltip` labels (UI shell spec §6). |
| `OrgAvatar` | `src`, `name`, `size` | Round tenant identity; logo or building-glyph placeholder on `surfaceRaised` (SKIP-53). |
| `UserAvatar` | `id`, `name`, `src`, `size` | Round person identity; image or initials on a deterministic per-id fill. |
| `IconButton` | `icon` (lucide), `label`, `active` | Square borderless chrome affordance (collapse/menu/bell); `hoverFill` hover, `aria-label`. |
| `NotificationBell` | `open`, `onOpenChange`, `items`, `title`, `emptyText` | Bell + unread dot + popover on `surfaceRaised` (presentational; SKIP-23). |
| `AppTooltip` | `label`, `placement`, `disabled` | Lightweight hover label for the collapsed rail (named to avoid Tamagui's `Tooltip`). |

Existing template components reused as-is: `Screen`, `AppButton`, `AppInput`, `AppSwitch`,
`EmptyState`, `H`/`P`, toast.

### Popups & soft-delete conventions (this app)

- **Confirms/alerts go through `usePopup`** (`packages/app/stores/popup.store.ts`) — one global popup
  at a time, rendered by `PopupHost` in the app `Provider` (UI §17). Don't add per-screen confirm
  state. The admin **Deactivate** action on every entity closes its edit form popup, then
  `show({ title, message, buttons: [Cancel, Deactivate] })`.
- **Soft delete = Deactivate, never hard delete** (API schema rule). Plants transition
  `status → 'inactive'`; every other org/auth entity sets `isActive=false`. Lists keep showing the
  deactivated row with an "Inactive" `StatusPill` (no row removal). The `Deactivate` button shows
  only while editing an existing row.
- **Create/edit forms use `Popup` declaratively** (`open`/`footer`/`error`, `dismissable={false}`,
  screen owns the form state) — not the `usePopup` store. One overlay primitive for forms and confirms.

### App shell (`features/shell/`) — see `frontend-spec-shell.md`

- **`AppShell`** composes `SidebarNav` + **`TopBar`** + scrolling content; **`AdminShell`** is the
  admin `nav` configuration of it (`ADMIN_NAV` = `Administration` / `Access` sections in `nav.ts`).
  Other areas (scheduling) supply their own `nav`.
- **`TopBar`** holds the collapse/menu toggle, breadcrumb (active section / screen), a presentational
  ⌘K search affordance, the `NotificationBell`, and the `UserAvatar` account menu. Only one of
  {notifications, account} is open at once; the page title is never duplicated here (stays in `PageHeader`).
- **Brand hierarchy is client-primary**: the tenant `OrgAvatar` + name + context line lead the sidebar
  top; PerduraFlow is the subordinate "Powered by" mark in the footer. Tenant name/logo come from
  `/users/me` (`tenantName` / `tenantLogoUrl`); logo is seed/config only for now (SKIP-53).
- **Responsive**: at `media['max-md']` the sidebar becomes an off-canvas drawer (Portal scrim) opened
  from the TopBar menu button; `DataTable` keeps all columns and scrolls horizontally (no column drop).
- **Sidebar collapse is a per-user preference persisted server-side** — `user.preferences` JSON on the
  user row, read from the auth store and written via `useUpdatePreferences()` (optimistic) → `PATCH
  /users/me`. **Never `localStorage`/`sessionStorage`** for this.

---

## 4. Route tree

Shared screens in `packages/app/features`; app routers (`apps/next`, `apps/expo`) re-export only
(UI §1). Navigate via Solito (UI §2).

```
(auth)/                       ← existing template auth (login, register, forgot/reset, verify-otp, onboarding)
(app)/                        ← authenticated shell; redirect to (auth) if not authed
  index                       ← dashboard landing (EMPTY — kernel registration point, D34/A6; SKIP framework)
  admin/
    plants            · plants/[id]
    plant-groups      · plant-groups/[id]
    customers         · customers/[id]
    programs          · programs/[id]
    calendars         · calendars/[id]
    roles             · roles/[id]
    users             · users/[id]
  profile · settings          ← existing
```

Detail/edit can be a route (`[id]`) or a `Popup` modal over the list — **decided: `Popup` modal over
the list** for CRUD (fewer routes, faster authoring), with `[id]` kept for deep-linkable detail
where useful.

---

## 5. Screens

All are thin screens over shared `packages/ui` components (UI §0.1). The seven admin screens share
one **`AdminResourceScreen` pattern** (list via `DataTable` + create/edit `Popup`), differing
only by config (columns, form fields, hooks) — not duplicated layout.

| Screen | Feature folder | Platform split? | Notes |
|---|---|---|---|
| Dashboard landing | `features/dashboard/` | no | Empty; renders registered dashboard tiles (none yet) — the D34/A6 registration point as a stub. |
| Plants | `features/admin/plants/` | no | CRUD: name, timezone, region, location, status. |
| Plant groups | `features/admin/plant-groups/` | no | CRUD: name, group_type, allows_resource_sharing, **member plants** (multi-select via org). |
| Customers | `features/admin/customers/` | no | CRUD: name, firm_fence_days. |
| Programs | `features/admin/programs/` | no | CRUD: customer (select), name, firm_fence_days (override). |
| Calendars | `features/admin/calendars/` | no | CRUD: name, plant (optional), shift_patterns / holidays / maintenance_windows (basic JSON-backed editors for phase 0 — **SKIP-52**; maintenance_windows plant-level, no resource_id). |
| Roles | `features/admin/roles/` | no | CRUD: name, data_scope, scoped plants/groups, approval tier. Per-dashboard action matrix = SKIP-43 (not built). |
| Users | `features/admin/users/` | no | CRUD: name, email, role (select), verified. |
| App shell / nav | `features/shell/` | (web sidebar vs native tabs) | `SidebarNav` on web/tablet; native tab/drawer. Capability follows role (D34). |

- **Screen aesthetic:** `Screen` (solid `$background`) for the app/admin shell. `GradientScreen`
  for auth screens (template default look). No gradients in the admin area.
- **Surfaces (D34):** web + tablet are **full authoring peers** for these config screens; **phone is
  restricted** (no `edit`) — phase-0 admin CRUD targets web/tablet. The phone-restricted surface
  rules are honored by the shell but phone editing is simply not exposed.

---

## 6. i18n namespaces

Beyond `common` + `errors` (UI §9), add: `admin` (labels/actions for the CRUD screens),
`org` (entity field labels: plant/customer/program/calendar/role). `errors.json` mirrors the new
API codes (api-spec §6). No hardcoded strings.

---

## 7. Real-time UI

None in phase 0.

---

## 8. Open UI decisions

| ID | Question | Status |
|---|---|---|
| FS1 | Keep the template blue palette unchanged for phase 0. | **Confirmed** |
| FS2 | CRUD edit via `Popup` modal over the list (was `FormSheet`; consolidated onto `Popup`). | **Confirmed** |
| FS3 | Calendar fields get basic JSON-backed editors in phase 0; richer structured shift/holiday/maintenance builders later → **SKIP-52** in the completion log. maintenance_windows plant-level (no resource_id). | **Confirmed** |
| FS4 | Web nav: persistent left `SidebarNav`. | **Confirmed** |

---

# Phase 1 — Master Data screens (BUILT)

> **STATUS: BUILT & browser-verified** (CRUD incl. soft-delete on Certifications; routing
> master-detail editor; qualifications matrix toggle; org-ref validation errors). Source:
> `docs/CLAUDE-CODE-BRIEF-PHASE-1.md`, `docs/master-data-module-spec.md`. The shell is **already
> built and decided** (`frontend-spec-shell.md`, §1–§3 above) — Master Data screens land **into** it;
> the shell is not re-proposed. API side: api-spec §10.

## 9. Phase-1 nav & route tree

Master Data is a **domain area**, so it gets its **own sidebar section** (`AppShell` already supports
multiple `NavSection`s — admin used `Administration`/`Access`). Nav config (`features/shell/nav.ts`)
gains a `Master data` section; the `org` priority edits ride the **existing** Customers/Programs admin
screens (no new routes).

```
(app)/
  master-data/
    parts             · parts/[id]
    resources         · resources/[id]
    resource-groups   · resource-groups/[id]
    routings          · routings/[id]      ← master-detail editor route (FS5)
    certifications    · certifications/[id]
    operators         · operators/[id]
    qualifications                          ← operators × certs matrix (FS6)
  admin/
    customers …       ← + priority field (existing screen, edited)
    programs  …       ← + priority field (existing screen, edited)
```

## 10. Phase-1 screens

Five reuse the Phase-0 **`AdminResourceScreen`** pattern (list `DataTable` + create/edit `Popup`,
full CRUD incl. soft-delete from the first pass — no repeat of the Phase-0 CRU-without-D gap).
**Routings** needs a master-detail editor the flat pattern doesn't cover (FS5).

| Screen | Feature folder | Pattern | Fields / notes |
|---|---|---|---|
| Parts | `features/master-data/parts/` | AdminResourceScreen | `part_no`, description, `part_type` (select), base UoM, **material / gauge / colour** (physical attrs, MD11), status. Sortable name/type/status. |
| Resources | `features/master-data/resources/` | AdminResourceScreen | name, `resource_type` (select), **plant** (select via `org.read`), **calendar** (select via `org.read`), **rate / rate_uom** (optional nominal), status. Bad/inactive plant **or** calendar ref → typed inline error (`INVALID_PLANT_REFERENCE` / `INVALID_CALENDAR_REFERENCE`, the Phase-0 pattern). |
| Resource groups | `features/master-data/resource-groups/` | AdminResourceScreen | name, plant (select), **member resources** (multi-select `SelectField`, like Phase-0 plant-group members). |
| Routings | `features/master-data/routings/` | **list + Popup (header) → `routings/[id]` editor** | List + create-header via `Popup` (part select, name, is_primary, status); row click → dedicated route with header + `OperationsEditor` (op_seq, resource-group, std setup/cycle, changeover_attribute_key; add/reorder/remove) (FS5/FS8). |
| Certifications | `features/master-data/certifications/` | AdminResourceScreen | code, name, description, status. |
| Operators | `features/master-data/operators/` | AdminResourceScreen | name, **home plant** (select), `labor_rate` (optional), status. **Qualifications edited on the matrix screen below, not here** (FS6). |
| Qualifications | `features/master-data/qualifications/` | **matrix screen** | Operators × certifications **grid of checkboxes** (`QualificationMatrix`); toggling a cell creates/removes an `operator_qualification` row (FS6). Own nav item under Master data. |
| Customers *(edit)* | `features/admin/customers/` | existing | **+ `priority`** (select `standard\|high\|critical`). |
| Programs *(edit)* | `features/admin/programs/` | existing | **+ `priority`** (select; override — blank = inherit customer). |

- **Surfaces (D34):** web + tablet are authoring peers; phone restricted (no edit) — same as Phase 0.
- **i18n:** add a **`masterData`** namespace (entity + field labels); extend `errors.json` with the
  api-spec §10.4 codes. No hardcoded strings.

## 11. New `packages/ui` components (variant-driven, library-safe, both-theme stories — UI §0.2/§16)

| Component | Purpose | Notes |
|---|---|---|
| `OperationsEditor` | The routing master-detail body: an **ordered, editable operations table** — add row, **reorder** (up/down), remove, inline-edit each op's `op_seq`, resource-group (select), `std_setup_time`, `std_cycle_time`, `changeover_attribute_key`. | Controlled (`value: OperationRow[]`, `onChange`); the screen owns persistence. Generic enough to reuse for any ordered child-rows editor. |
| `QualificationMatrix` | Operators × certifications **checkbox grid** (FS6): rows = operators, columns = certifications, cell toggle = create/remove an `operator_qualification`. | Controlled (`rows`, `cols`, `value: Set<operatorId×certId>`, `onToggle`); horizontal-scroll wrapper at `small` like `DataTable`. Reusable for any 2-axis many-to-many. |
| *(reuse)* `SelectField multiple` | Resource-group members. | Already exists (Phase-0 plant-group members) — no new component. |

## 12. Open phase-1 UI decisions (brief §5 — see also api-spec AS5–AS8)

| ID | Question | Proposed | Status |
|---|---|---|---|
| FS5 | **Routing editor UI pattern** (header + ordered operations is master-detail, not a flat modal). | **Hybrid:** routings **list** + **create-header** stay in the `Popup` pattern; **editing** a routing opens a **dedicated `routings/[id]` route** showing the header card + an inline **`OperationsEditor`** (add/reorder/remove operations, saved with the header). | **Confirmed** (hybrid: route for edit) |
| FS6 | **Operator-qualifications UI** (operator×certification many-to-many). | A dedicated **`QualificationMatrix` screen** (operators × certifications checkbox grid; toggle = create/remove `operator_qualification`). Operator identity CRUD stays on the Operators screen; qualifications are not edited on the operator Popup. | **Confirmed** (matrix screen) |
| FS7 | **Master Data placement in nav** — own section vs under Administration. | Its **own `Master data` sidebar section** (it's a domain area, not kernel admin). | **Confirmed** |
| FS8 | **Routing list → edit navigation.** | Row click on the routings list navigates to `routings/[id]` (Solito), not a Popup (consistent with FS5). | **Confirmed** |

---

# Phase 2 — Scheduling board (BUILT)

> **STATUS: BUILT & browser-verified** (read-first Gantt on `react-native-svg`, web + native routes;
> plant/version selectors, re-solve → draft, commit → committed; source tag rendered). Source:
> `docs/CLAUDE-CODE-BRIEF-PHASE-2.md`, scheduling spec §4.4/§4.9. The shell is already built
> (`frontend-spec-shell.md`); the board renders **into** it. API side: api-spec §11.

## 13. Phase-2 nav & route

A new **"Scheduling"** sidebar section (its own domain area, like Master data). Read-first this phase:

```
(app)/
  scheduling/
    board                      ← read-first Gantt + version selector + re-solve + commit (SKIP-40)
```

`nav.ts` gains a `Scheduling` section with one item, **Board** (icon `GanttChartSquare`/`CalendarClock`).
**The board is wired into BOTH `apps/next` and `apps/expo`** — unlike the admin/master-data screens
(web/tablet authoring), the board is **iPad/native first-class** (FS9), so it ships a native route too.
`ScheduleGantt` is `react-native-svg`-based and renders identically on both.

## 14. Board screen (`features/scheduling/board/`)

Read-first (SKIP-40) — **no drag-to-author** (deferred with the virtualized canvas). Layout:

- **Controls row:** a **plant selector** (from `org.read` plants) → a **version selector** (the
  plant's `schedule_version`s, newest first, labelled `status · created_at`) → a **Re-solve** button
  (→ new `draft` version, auto-selected) → a **Commit** button shown on a `draft` version
  (promotes `draft → committed`, supersedes the prior committed — AS11). Both writes are
  ConfigureGuard-gated.
- **`ScheduleGantt`** (new `packages/ui`): resources (lines) as rows, time horizontal across the
  version horizon, `scheduled_operation`s as bars positioned by `planned_start`/`planned_end`. A bar
  shows the part + a small **source chip** (`std`, from `setup_source`/`cycle_source`) and, when
  present, a **confidence** badge (null now → not shown; SKIP-04 carry-through renders with zero board
  change in Phase 3). **At-risk** bars get a `$danger` border + an at-risk marker.
- **Empty/infeasible states:** no demand → `EmptyState` ("nothing to schedule"); an `infeasible` run →
  a banner naming the offending demand (the D4 hard-gate outcome, not a silent drop).
- A small **run/version detail** strip: trigger, status, `stop_reason`, horizon, op count.

`bindings`/sequencer are server-side; the board is a pure consumer of `GET /scheduling/versions/:id`.

## 15. New `packages/ui` components (variant-driven, both-theme stories — UI §0.2/§16)

| Component | Purpose | Notes |
|---|---|---|
| `ScheduleGantt` | Read-first Gantt: resource rows × **hour time axis with gridlines**; bars **positioned by `planned_start` and sized by duration** (no equal-width chips). Encodes **setup head** (shaded), **changeover** attribute-switch (accent tick), **at-risk** (`$danger` inset border + dot, not a different fill). Labels render **only where they fit**; source/confidence live in the **legend + press tooltip**, never inside a bar. | Controlled/presentational (`resources`, `bars`, `horizonStart/End`, `onBarPress?`); **`react-native-svg`** (FS9), theme-token colours. **Decision: horizontal scroll with a pinned resource-label column** (shop-floor-appropriate, bars stay readable; reuses the DataTable scroll pattern) — not fit-to-horizon. Press hit-targets are Tamagui overlays over the SVG (reliable web+native). The deferred virtualized authoring canvas supersedes it behind the same `scheduled_operation` data. |

## 16. i18n

Add a **`scheduling`** namespace (board labels, version/run status, at-risk, source/confidence,
re-solve, empty/infeasible copy); extend `errors.json` with api-spec §11.6 codes.

## 17. Open phase-2 UI decisions (brief §5 — see also api-spec AS9–AS12)

| ID | Question | Proposed | Status |
|---|---|---|---|
| FS9 | **Gantt rendering approach** (explicitly *not* the virtualized canvas; **iPad/native is first-class**). | **`react-native-svg`** (CONFIRMED) — already installed (15.12.1), Next transpiles/aliases it, so the **same `<Svg>` JSX renders web AND native/iPad, no platform split, no new dep**; theme colours from tokens. **Scroll decision: horizontal scroll + pinned resource-label column** (GANTT-FIX §"scroll vs fit") — bars stay at a readable scale; reuses the DataTable scroll pattern. Bars are time-positioned/duration-sized with setup/changeover/at-risk encoding; source/confidence in legend + press tooltip. The deferred virtualized canvas (SKIP-40) supersedes it behind the same data. | **Confirmed + BUILT** (react-native-svg; scroll + pinned labels) |
| FS10 | **Board context selection.** How does the planner pick what to view? | **Plant selector → version selector**; default to the first plant + its newest `committed` version (or newest `draft` if none committed). **Re-solve** → new `draft`, auto-selected; **Commit** (on a draft) → `committed`, supersedes prior (AS11). | **Confirmed** (draft-then-commit) |
| FS11 | **Source/confidence rendering while empty (SKIP-04).** | Always render a **source chip** (`std`) on every bar; render a **confidence** badge only when non-null (null now → omitted). Phase 3's closed loop flips values with **zero board change**. | **Confirmed** |

---

# Phase 3 — Closed loop on the board + two demo views (BUILT — gates green; browser verification with user)

> **STATUS: BUILT** (board variance strip + learned-param panel + `$ml` bar + wear toast; Scorecard +
> Workforce views; dev-only drift control; nav + i18n; both-theme stories). `bun run check` +
> `next build` + expo tsc green. FS12–FS15 implemented as proposed. Draft deltas for
> `docs/CLAUDE-CODE-BRIEF-PHASE-3.md` §4 step 1 / §3a. Designs:
> `docs/perduraflow-six-views.html` (Views 2 & 3) + `docs/perduraflow-gantt-mockup.html` (board) — **build to
> them; sample numbers are representative, never literals (no-hardcoding invariant)**. Phase 3 adds **new
> components on the existing board**, **two of the six views**, and **one demo-only control** — no invented
> screens. API side: api-spec §12. **Nothing implemented yet.**

## 18. Phase-3 nav & routes

The board stays where it is (`scheduling/board`); Phase 3 lights up the **operational nav** with the two
role-tailored views (VIEW-PLAN — these *are* the operational app, RBAC-gated by role):

```
(app|main)/
  scheduling/board               ← existing board + NEW variance strip + learned-param panel + ml bars
  scorecard                      ← View 2 · Service–Cost Scorecard (plant manager)  NEW
  workforce                      ← View 3 · Workforce coverage (supervisor)          NEW
```

`nav.ts`: add **Scorecard** and **Workforce** under the operational `Scheduling`/Operations sections
(icons e.g. `Gauge`, `Users`). Both wired into **`apps/next` and `apps/expo`** (web + native, DoD). The
**simulator drift control is NOT in nav** (FS15) — a dev/staging-only surface. Views 1/4/5 stay deferred
(phases 4–5).

## 19. Board additions (existing screen — new components, no restructure)

- **Bars `std`→`ml` + confidence (behavior change, proof #1).** The Phase-2 source chip flips `std`→`ml`
  from `setup_source`/`cycle_source`; the confidence badge (already conditional) now renders because
  `*_confidence` is non-null. **An `ml` bar gets a distinct fill** (`$ml` deep-violet `#7c5cff`, per the
  gallery) — not tag-only (FS13). No board restructure; the tooltip carries learned value + std (struck) +
  confidence + sample basis.
- **Variance strip (NEW `VarianceStrip`, board-adjacent).** Chips from `GET /scheduling/variance`: affected
  resource **"N% behind plan"**, throughput attainment, churn, learned-param count. The affected lane label
  also carries a small **"behind"** chip. All computed (no literals).
- **Learned-parameter detail panel (NEW `LearnedParamPanel`).** On bar select: the learned value as **one
  settled step** — `std` struck-through → `learned`, a **two-point track (not a time-series)**, rising
  confidence, sample basis (`n`, window mean), and the **triggering signal** (tool-wear). This is the
  convergence beat **and** the structured "why" (Phase-5 narration forward-hook). **Decision FS12:** a
  click-to-open **panel** (not inline-on-bar) — keeps the bar clean, gives room for the std→learned track +
  basis, and is the natural home for the later narration line.
- **Tool-wear flag** → the existing notification bell / toast (SKIP-23) from `learning.drift.detected`. No new
  screen.

## 20. View 2 · Service–Cost Scorecard (`features/scorecard/`) — plant manager

The **full performance screen** (build to gallery View 2), all phase-3-computable from
`GET /scheduling/scorecard`:
- **KPI tile row** (NEW `KpiTile` + `KpiTileRow`): OTIF, Cost/unit (Tier-B), OEE — value + caption.
- **OEE breakdown bars** (NEW `MetricBars`): Availability · Performance · Quality with %.
- **At-risk orders list** (reuse `DataTable`): order/customer + reason + status pill (from scheduling).
- **Baseline-comparison arm is a Phase-5 seam (D57): leave it as a named, visibly-disabled placeholder
  ("vs manual baseline — phase 5"), DO NOT fake it.** The board's variance strip is this screen's operational
  summary (both exist).

## 21. View 3 · Workforce coverage (`features/workforce/`) — supervisor

Build to gallery View 3, from `GET /workforce/coverage`:
- **Coverage grid: reuse `QualificationMatrix` (BUILT phase 1), re-skinned** to coverage/readiness — cells
  Qualified / Not-qualified / **Cert-gap**, an **OUT** marker on absent operators, `*` on cert-required
  stations. (Add a `tone`/legend variant to the existing component; no new grid.)
- **Next-shift readiness %** (NEW small stat) + "N certification gap(s)".
- **Re-balance / OT call-in proposal** (NEW `CoverageProposal`): the cert-gap → **named** qualified operator
  **OT call-in**, a **human-confirmed proposal** (D54: `POST /workforce/proposals/:id/confirm`) — labor-aware,
  **not rostering** (D43). Approve = ConfigureGuard-gated.

## 22. Demo-only control — simulator drift trigger (FS15)

A **clearly-separated dev/staging surface** (e.g. a `/dev/simulator` route shown only when a `demo`/dev flag
is set, or a Storybook-style control) — **never in operational or admin nav**. Picks a committed version +
optional drift `{resource, magnitude, ramp}` → `POST /dev/scheduling/simulate`. It is staging scaffolding for
the demo, cleanly removable; the loop it drives is the real mechanism.

## 23. New `packages/ui` components (variant-driven, both-theme stories — UI §0.2/§16)

| Component | Purpose | Notes |
|---|---|---|
| `KpiTile` / `KpiTileRow` | KPI value + caption + delta arrow | Pure presentational; values passed in (no fetch, no literals) |
| `MetricBars` | Labelled horizontal % bars (OEE A·P·Q; reusable) | Token colours; controlled `items=[{label,pct}]` |
| `VarianceStrip` | Board-adjacent variance chips | Controlled; `$danger` for behind-plan |
| `LearnedParamPanel` | std→learned **two-point** step + confidence + basis + wear signal | **Not** a chart; the convergence render (FS12); narration slot reserved |
| `CoverageProposal` | Cert-gap → named-operator OT confirmed proposal | Approve action via prop callback (ConfigureGuard upstream) |
| `QualificationMatrix` *(extend)* | add coverage/readiness skin (Qualified/Not/Cert-gap tones, OUT, `*`) | Re-skin the BUILT component; no new grid |

`ScheduleGantt` gains an **`ml` bar fill** (token `$ml`) — a colour branch, not a restructure (FS13). (The
GANTT-FIX **horizon Day/Week** addendum is a **View-1/cockpit** concern, phases 4–5; note it as a `horizon`
prop seam, build Day-only now unless RG wants Week this phase — FS14.)

## 24. i18n

Add **`scorecard`** + **`workforce`** namespaces (KPI labels, OEE, at-risk, coverage, readiness, proposal
copy); extend the **`scheduling`** namespace (variance strip, `ml` source, learned-param panel, wear-flag
toast); extend `errors.json` with api-spec §12.11 codes. **No hardcoded user-facing strings.**

## 25. Open phase-3 UI decisions (brief §5 — see also api-spec AS13–AS18)

| ID | Question | Proposed | Status |
|---|---|---|---|
| FS12 | **Convergence render** — detail panel vs inline-on-bar (brief §3a / VIEW-PLAN open #3). | **Click-to-open `LearnedParamPanel`** showing std→learned as a **two-point settled step** (struck std → learned), confidence, sample basis, wear signal. Keeps the bar uncluttered, fits the "why" + the Phase-5 narration slot. Inline-on-bar rejected (no room; risks implying live motion). | **Proposed** (panel) |
| FS13 | **`ml` bar colour** — distinct colour vs tag-only (VIEW-PLAN open #4). | **Distinct fill** `$ml` (deep violet `#7c5cff`, gallery) + the `ml` tag — a learned op reads differently at a glance; still a bar (encoding parity with at-risk's border-not-fill rule preserved since source≠risk). RG aesthetic call. | **Proposed** (distinct `$ml`) |
| FS14 | **Gantt horizon Day/Week this phase?** (GANTT-FIX addendum). | **Day-only now**; add `horizon` as a prop **seam** only. Week aggregation is a **View-1 cockpit** feature (phases 4–5); building it now is out of phase-3 scope. | **Proposed** (seam only) |
| FS15 | **Where does the drift trigger live?** | **Dev/staging-only surface** behind a demo flag (`/dev/simulator`), **never** in operational/admin nav; clearly removable demo scaffolding. | **Proposed** |

---

# Phase 4 — Parameter prediction: Exception Queue + Objective Policy (BUILT — gates green; web-verified)

> **STATUS: BUILT** (`next build` + expo tsc green; web-verified both themes — Exception Queue auto-handled +
> needs-you, Objective Policy threshold round-trip, board prediction block + lane flag). FS16–FS19 as proposed.
> _(superseded draft note:)_ Phase 4 lights
> up **View 4 · Exception Queue** (the *autonomy-demonstrated* screen) and the autonomy half of **View 5 ·
> Objective Policy** (the confidence threshold + tier config), and adds a **forward-looking predicted-crossing
> flag** to the board. **All numbers compute from rows** (predictions/confidence/horizon from `learning.read
> 1.1`); **sample values here are representative, never literals** (no-hardcoding). Predictions render as
> **settled statements** (convergence-not-motion, forward form) — no live ticker. Type per the board/dashboard
> type map (UI §4) + the `Panel` chrome (UI §0.1). Decisions **FS16–FS19**; backend api-spec §13 (AS19–AS22).

## 26. Phase-4 nav & routes

The operational nav gains the two planner/ops-leader views (RBAC-gated, VIEW-PLAN): **Exception Queue**
(planner — alongside Cockpit, which stays Phase-5) and **Objective Policy** (ops leader). Routes:
`scheduling/exceptions` (View 4) and `admin/objective-policy` *(or operational `objective-policy`)* (View 5).
Board stays at `scheduling/board`. View 1 (Cockpit) + View 6 (How-It-Connects) remain deferred.

## 27. View 4 · Exception Queue (`features/exceptions/`) — planner *(autonomy demonstrated, not named)*

- **Header:** **"N need you · M auto-handled"** — the auto-handled count is *the beat* (graduated autonomy made
  visible without narration). `M` = count of `auto_committed` predictions; `N` = queued (needs-human). Both
  computed, never literal.
- **List:** prioritized `ExceptionRow`s (a new `packages/ui` component), grouped/sorted **needs-you first**,
  then auto-handled. Each row (per the board type map):
  - **identity** — resource · op (14/500/ink); **prediction as a settled statement** — "Predicted to cross
    threshold ~14:00 · confidence 0.82 · 2h horizon" (figures 14/ink; label 11/caps/faint); a **tier/severity
    `StatusPill`** (Tier-3 `danger`, queued Tier-1 `warning`/`neutral`, auto-handled `active`/green or a quiet
    "auto" tone).
  - **auto-handled row** — "Pre-emptively adjusted [resource] cycle for predicted wear" + confidence/horizon +
    a **View** action (read-only audit; already applied + reversible). Quiet/low-severity treatment.
  - **needs-you row** — the prediction + proposed action + an **Approve / Dismiss** control (`ConfigureGuard`);
    **Tier-3** rows always land here (even at high confidence) with **Sign-off**, never an auto badge.
- **Sources (Phase-4 build = predictions-first, composed client-side — no premature aggregator):** the
  predictive rows from `learning.read 1.1`; the queue **also lists** existing exception signals it can already
  read (at-risk orders from `scheduling.scorecard`, cert-gaps from `workforce.coverage`) as needs-you rows, so
  the screen is the real cross-system queue VIEW-PLAN describes — but the **new** Phase-4 data is the predictive
  auto-handled/queued rows + the auto-handled count.

## 28. View 5 · Objective Policy (`features/objective-policy/`) — ops leader *(autonomy config)*

- **Phase-4 scope = the autonomy controls only** (a *config* screen legitimately **names** the rules — different
  context from the live demo's "don't narrate the model", VIEW-PLAN §5):
  - **Confidence threshold** — the Tier-1 auto-commit threshold (a slider/`AppInput` 0–1, default 0.75) with a
    plain-language read ("Auto-apply predicted parameter changes at ≥ 75% confidence; below, queue for review").
  - **Tier behavior** — Tier-1 (auto, threshold-gated), Tier-2 (advisory ↔ bounded-auto toggle, seam),
    **Tier-3 always human** shown **read-only/locked** (the A18 floor — visibly not relaxable).
  - **Wear band** (optional) — the crossing threshold the predictor measures against, if the tenant tunes it.
- **Objective trade-off weights** (service floor / max OT / churn / expedite) + **priority tiers** (the phase-1
  customer/program priority UI) are **Phase-5 seams** — a labelled placeholder section, not built now.
- Reads `GET /policy/autonomy`; writes `PUT /policy/autonomy` (`ConfigureGuard`, audited).

## 29. Board addition — forward-looking predicted-crossing flag (existing screen, no restructure)

A resource with a **live predicted crossing** gets a **calm settled lane flag** (reuse the §19 behind-plan
chip pattern, a `warning`/`ml` tint): "predicted wear ~14:00" — a **statement, not a creeping gauge** (FS18).
The bar-detail panel (the §17/`LearnedParamPanel`) gains a **prediction block** when a forecast exists for the
op: "Predicted: cross threshold ~14:00 · conf 0.8 · 2h" + (if auto-committed) a "pre-applied" note — the
forward form of the learned-step render, structured for A19 (Phase-5).

## 30. New `packages/ui` components (variant-driven, both-theme stories — UI §0.2/§16)

| Component | Purpose |
|---|---|
| `ExceptionRow` (+ `ExceptionQueue` list) | One queue row — identity + settled prediction statement + tier/severity `StatusPill` + per-row action (View / Approve / Dismiss / Sign-off). Auto-handled vs needs-you variants. Narration slot reserved. |
| `ThresholdControl` *(or reuse `AppInput`+`FormField`)* | The 0–1 confidence threshold setter with a plain-language read; Tier rows (Tier-3 locked). |

Reuse: `Panel` (titled cards), `StatusPill` (now has `danger`/`warning` tones), `DataTable`/list, `PageHeader`,
`ContextSelectors`, `KpiTile` (the "N need you · M auto-handled" counts). No new styling primitives.

## 31. Open phase-4 UI decisions (brief §5 — see also api-spec AS19–AS22)

| ID | Question | Proposed | Status |
|---|---|---|---|
| FS16 | **Exception-Queue row shape** (auto-handled vs needs-you). | One `ExceptionRow` with two variants: **auto-handled** (quiet, confidence/horizon + read-only **View**) and **needs-you** (prediction + proposed action + **Approve/Dismiss/Sign-off**). Header **"N need you · M auto-handled"** carries the autonomy beat (counts computed). Settled statements, no ticker. | **DRAFT** |
| FS17 | **Objective Policy autonomy controls** (this phase's cut). | Build **only the autonomy half**: confidence threshold (0–1, default 0.75) + tier behavior with **Tier-3 locked-human** visible; objective weights/priority = labelled Phase-5 seam. A config screen may **name** the rules (VIEW-PLAN §5). | **DRAFT** |
| FS18 | **Forward-looking flag rendering.** | A **calm settled lane flag** ("predicted wear ~14:00") + a **prediction block** in the bar-detail panel — a *statement*, reusing the behind-plan-chip pattern. **No** live gauge / countdown (convergence-not-motion, forward form). | **DRAFT** |
| FS19 | **New components vs reuse.** | New `ExceptionRow`/`ExceptionQueue` only; everything else **reuses** `Panel`/`StatusPill`(+danger/warning)/`KpiTile`/`DataTable`/`PageHeader`. No new styling primitive. | **DRAFT** |

---

## 32. Phase-5 surfaces — what-if options (D55), baselines (D57), narration (A19)

**BUILT & browser-verified** (web Cockpit options + Scorecard baseline arms; native `tsc` green). EVALUATE / COMPARE / EXPLAIN through defined triggers — no conversational UI (Phase 6).

### 32.1 New `packages/ui` components (variant-driven, both-theme stories — UI §0.2/§16)
- **`FactorBar`** — one objective factor as a labeled magnitude bar (length ∝ |contribution|; colour by direction); the number stays the fact.
- **`RationaleView`** — the structured rationale, **always the source of truth**: factor bars + binding constraints (✓/⚠) + comparatives. Pure presentation; the screen resolves i18n keys.
- **`NarrationBlock`** — the translate-only prose **alongside** the rationale; states `loading`/`ready`/`unavailable` (honest, zero functional impact).
- **`OptionCard`** — a ranked option: header (rank · label · Recommended/infeasible) + costed-KPI deltas + (expanded) rationale + narration + **Apply** (live the moment the rationale exists; never waits on narration). Apply via `AppButton loading` (no `disabled` on Button).
- **`BaselineDeltaStrip`** — arm selector (Engine lift / Historical) over a live-vs-baseline KPI table with honest deltas + the active arm's honest caption + a true **empty state**.
- **`ResourceWearPanel`** gained an optional `action` ("See options") — the so-what trigger.

### 32.2 Hooks (`hooks/useWhatIf.ts`) + i18n
`useWhatIf` (evaluate), `useWhatIfResult`, `useNarration`, `useBaseline`, `useApplyOption`. New namespaces **`whatif`** + **`baseline`**; `errors.json` mirrors the new codes. Backend keys are `namespace.path` form, resolved by **`resolveKey()`** (i18n index) — keeps the structured rationale i18n-driven, not LLM-authored.

### 32.3 Wiring
- **`features/whatif/whatif-option-set.tsx`** — maps `WhatIfResultDto` → resolved UI props; fetches the across-options narration async (non-blocking); handles Apply. Reused by the board change-evaluation **and** the so-what scene.
- **Cockpit (View 1 = Schedule Board):** an "Evaluate a change" `Panel` with the demand collision trigger (GP-1142 +20%) → the option-set; the resource wear panel's "See options" routes the prediction so-what (prediction → impact → costed options → narration) to the **same** component.
- **Scorecard (View 2):** a "Vs baseline" `Panel` (`BaselinePanel`) with both arms (frozen computed / historical from seed) + honest empty-state, scoped to the drill-down line.

### 32.4 Phase-5 UI decisions (brief §5)
| ID | Question | Decision | Status |
|---|---|---|---|
| FS20 | **Rationale always-visible vs narration.** | `RationaleView` is the source of truth, **always rendered**; `NarrationBlock` renders **alongside**, never replacing. Delete narration → no decision info lost. | **BUILT** |
| FS21 | **Apply gating.** | Apply is live the moment the rationale exists; independent of narration state (loading/unavailable). Human action → new draft. | **BUILT** |
| FS22 | **i18n for the structured rationale.** | Backend emits i18n keys (`namespace.path`) + params; `resolveKey()` resolves them. Narration is the EN language surface (server-resolved facts), separate from the i18n-keyed structured form. | **BUILT** |
