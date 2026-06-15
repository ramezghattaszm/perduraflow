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
