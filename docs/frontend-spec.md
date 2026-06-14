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

The template already ships a tuned light+dark palette (`packages/config/src/tamagui.config.ts`) on a
blue brand (`#2D5BE3`). It fits an industrial operations tool well; **proposal: keep the template
palette unchanged for phase 0.** Role names are fixed (UI §3); only values could change later.

| Semantic role | Light | Dark | Note |
|---|---|---|---|
| `primary` | `#2D5BE3` | `#5B8DEF` | keep (template) |
| `primaryLight` | `#7EB3FF` | `#93B4F5` | keep |
| `surface` | `#FFFFFF` | `#161B26` | keep |
| `background` | `#F7F8FA` | `#0B0F1A` | keep |
| `textPrimary` | `#1A1A2E` | `#E6E8EB` | keep |
| `textSecondary` | `#5B6472` | `#9AA3B2` | keep |
| `borderColor` | `#E3E8F0` | `#232A36` | keep |
| `success` | `#16A34A` | `#4ADE80` | keep |
| `danger` | `#DC2626` | `#F87171` | keep |
| `warning` | `#D97706` | `#FBBF24` | keep |
| `gradientStart` | `#C8E6FF` | `#1E2A4A` | keep |
| `gradientEnd` | `#4A6FE3` | `#1E3A8A` | keep |

---

## 2. Typography retune

Default. `H`/`P` scale unchanged (UI §4). Inter.

---

## 3. App-specific components (new shared components in `packages/ui`, variant-driven, library-safe)

> Built to UI §0.1 (repeated pattern → one component) and §16 (each ships a `*.stories.tsx` in both
> themes). Names stay app-agnostic so `packages/ui` remains extractable (§0.2).

| Component | Variants / props | Purpose (used by) |
|---|---|---|
| `DataTable` | `columns`, `rows`, `onRowPress`, `isLoading`, empty slot | The list view behind every admin CRUD screen (plants, customers, …). Replaces per-screen table styling. |
| `FormField` | wraps `AppInput`/`AppSwitch`/select; `label`, `error`, `required` | Labelled field for every create/edit form. |
| `SelectField` | `options`, `value`, `onChange`, `multiple` | Enum + reference pickers (e.g. `group_type`, `data_scope`, customer→program, multi-plant scope). |
| `StatusPill` | `tone` (`active`/`inactive`/`neutral`) | Row status (`plant.status`, `is_active`). |
| `PageHeader` | `title`, `actions` slot | Consistent admin page header + primary action (New …). |
| `Popup` | `open`, `onClose`, `title`, `description`, `size`, `dismissable`, `error`, `footer` | The one responsive modal (UI §17): centered dialog on desktop, native `Sheet` on small. Used declaratively for every create/edit form **and** via `usePopup` for confirms. Replaced `FormSheet`. |
| `TextLink` | `size`, `weight` (extends `P`) | Clickable inline text (pointer cursor + hover); replaces `<P onPress>` for links. |
| `ConfirmDialog` | `title`, `message`, `tone`, `onConfirm` | Predates `Popup`/`usePopup`; **superseded** by them for confirms (kept as a primitive). |
| `SidebarNav` / `NavItem` | `items`, `activeId` | Web/tablet shell navigation. |

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
