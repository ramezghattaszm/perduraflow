# Frontend spec — App shell (AppShell)

| | |
|---|---|
| **Part of** | Phase 1 `frontend-spec.md` — section 1 (the shell every screen renders inside) |
| **Generalizes** | Phase 0's `AdminShell` → `AppShell`; the shell is identical across areas, only nav contents differ. Admin nav is one configuration; scheduling adds its own later. |
| **Scope** | One responsive web layout, reflowing at the `small` breakpoint. Not a native/Expo split — a single shell + `DataTable` implementation with breakpoint behavior. |
| **Status** | Decided — ready to build. |

---

## 1. Decisions recorded

- **Theme:** Deep Navy dark neutrals (Section 2). Light mode unchanged in character.
- **Brand hierarchy:** client-primary. The tenant identity leads (sidebar top); PerduraFlow is the subordinate product mark ("Powered by PerduraFlow", sidebar footer).
- **Account menu:** top-right of the `TopBar`, grouped with notifications.
- **Search + breadcrumb:** both kept. Global ⌘K search and a context breadcrumb live in the `TopBar`.
- **Collapse:** sidebar collapses to an icon rail; the choice **persists per user** (a user preference, server-side — not browser storage), default expanded.
- **Avatars:** two round avatar components — `OrgAvatar` (tenant) and `UserAvatar` (person). Both circular. Details in Section 4.

---

## 2. Design tokens — Deep Navy

Palette primitives (dark neutrals changed; three new roles added in **both** modes):

```
bgDark            #080B14
surfaceDark       #131926
surfaceRaisedDark #1A2030      (new — 3rd elevation layer)
inkDark           #E6E8EB
slateDark         #9AA3B2
lineDark          #232C3D
navBarDark        #0A1324
surfaceRaisedLight #FFFFFF     (new — light elevates via border/shadow, = surface)
primarySoftLight  rgba(45,91,227,0.10)   (new)
primarySoftDark   rgba(91,141,239,0.14)  (new)
hoverFillLight    rgba(0,0,0,0.045)      (new)
hoverFillDark     rgba(255,255,255,0.05) (new)
```

New semantic roles (add to both `lightColors` and `darkColors`): `surfaceRaised`, `primarySoft`, `hoverFill`.

Where they're used (so they aren't abstract): `surfaceRaised` = dropdown menus, popovers, tooltips, and the header once content scrolls beneath it; `primarySoft` = selected sidebar item and active table row; `hoverFill` = row / nav-item / icon-button hover. Elevation in dark reads by getting *lighter* (bg → surface → raised). In light, `surfaceRaised` equals surface and elevation is carried by border/shadow — intentional, not redundant.

---

## 3. Layout anatomy

```
┌──────────┬─────────────────────────────────────────┐
│ Sidebar  │ TopBar  (collapse · breadcrumb · search · bell · user) │
│ (nav)    ├─────────────────────────────────────────┤
│ full     │ Content (scrolls; PageHeader + screen)   │
│ height   │                                          │
└──────────┴─────────────────────────────────────────┘
```

- `SidebarNav`: full height, `navBar` background, right border `line`. Width **248px** expanded, **74px** collapsed; width transitions ~180ms.
- `TopBar`: 58px, over the content column only (not full-width) on desktop; `surfaceRaised` background, bottom border `line`.
- Content: `background` canvas, vertical scroll. The page's own title stays in the body via the existing `PageHeader` — the `TopBar` is utility-only and never duplicates it.

At `small`: see Section 7.

---

## 4. Brand zone & avatars

**Sidebar brand zone (top):** `OrgAvatar` + tenant name + a context line (e.g. "Tier-1 · Production"). Collapsed → `OrgAvatar` only, centered.

**Sidebar footer:** a small PerduraFlow product mark + "Powered by PerduraFlow" + version. Collapsed → product mark only.

**`OrgAvatar` (new) — round, tenant identity:**
- Circular (border-radius 50%). Sizes: 34px brand zone, 30px collapsed/small.
- If `tenant.logoUrl` is set → render the image, cover-fit, circular-clipped.
- If not → a neutral **no-logo placeholder**: a generic building/organization glyph (`ti-building`) in `slate` on a `surfaceRaised` circular fill. This is the org equivalent of a default user avatar — it reads as "organization, no logo set," never as broken.
- The repo ships **only the placeholder**. Real client logos (including Magna's) are tenant-supplied at runtime via `logoUrl` — no third-party logo art committed.

**`UserAvatar` (new) — round, person identity:**
- Circular. If `user.avatarUrl` set → image; else → initials on a deterministic colored fill (derived from the user id, so it's stable per user). 32px in the `TopBar`, 38px in the account-menu header.

---

## 5. TopBar

Left → right:

- **Collapse toggle** (desktop) — panel icon; collapses/expands the sidebar. At `small` this slot becomes the **menu button** (hamburger) that opens the drawer. Same anchor position in both.
- **Breadcrumb** — area / screen (e.g. "Administration / Plants"). Hidden at `small`.
- **Spacer.**
- **Global search** — a ⌘K affordance opening a command/search palette. Presentational target this phase (wire the palette shell; full search index later). Hidden at `small`.
- **`NotificationBell`** (new) — bell with an unread dot; opens a popover on `surfaceRaised`. Phase 1 is presentational — an empty/"all caught up" state and seeded sample items only; the real engine is SKIP-23.
- **`UserAvatar` button** → **account menu** (on `surfaceRaised`): header (avatar + name + email), then Your profile, Preferences, divider, Sign out (danger). No caret — the avatar is self-explanatory.

Only one of {account menu, notification popover} open at a time; outside-click closes both.

---

## 6. SidebarNav (modify the Phase 0 component)

- **Sections** with muted uppercase labels (`Administration`, `Access`, …). Items: icon + label.
- **Active item:** `primarySoft` fill, `primary` text/icon, a 3px `primary` left accent bar.
- **Hover:** `hoverFill`.
- **Collapsed rail (74px):** labels, section headers, brand text, and footer text hidden; icons centered; **tooltip on hover** shows the label (new `Tooltip` use). Active accent bar flush to the rail's left edge.
- **Persistence:** collapsed/expanded is a per-user preference, read on load and written on toggle through the user-preferences mechanism (server-side; never `localStorage`/`sessionStorage`). Default expanded.

---

## 7. Responsive — `small` breakpoint

- Sidebar leaves the flow and becomes an **overlay drawer** (off-canvas left), revealed by the `TopBar` menu button, with a scrim that closes it on tap.
- `TopBar` goes full-width; breadcrumb and search hide; bell + `UserAvatar` (avatar only, no name) remain; the tenant mark may appear beside the menu button.
- **Data tables stay full-width with all columns and scroll horizontally** — `DataTable` rows keep a min-width and sit inside an `overflow-x:auto` wrapper. No column-dropping; the timezone/region/etc. columns remain, the row scrolls. (Decision: preserve data over auto-hiding.)

---

## 8. Component inventory

**New (each ships a Storybook story in both themes):**
- `AppShell` — the layout (sidebar + topbar + content + drawer/scrim), owns collapse + drawer state.
- `TopBar` — search, breadcrumb, `NotificationBell`, `UserAvatar` + account menu.
- `OrgAvatar`, `UserAvatar` — round, per Section 4.
- `NotificationBell` — bell + unread dot + popover (presentational this phase).
- `Tooltip` — for collapsed-rail labels (if not already present).

**Modified:**
- `SidebarNav` — sections, active accent, collapse + tooltips + drawer mode, persistence (Section 6).
- `DataTable` — horizontal-scroll wrapper + row min-width at `small` (Section 7).

---

## 9. Completion-log touchpoints

- **SKIP-23** (notifications) — the bell + popover are presentational only this phase; rules→recipients→channels engine deferred. No change to the row beyond noting the UI stub exists.
- **SKIP-53 (new) — tenant branding management.** `OrgAvatar` renders `logoUrl`-or-placeholder now; uploading/managing a tenant's logo (and wider per-tenant theming) is a later admin feature. `logoUrl` is set via seed/config for the demo. Add this row.
- Collapse persistence rides the existing user-preferences mechanism; if that mechanism is itself minimal in the demo, note it where it's first used rather than here.

---

*Build this shell first in Phase 1, then land the Master Data screens (Parts, Resources, Resource Groups, Routings) into it already styled.*

---

# Revision 2 — operational / admin split + native (IMPLEMENTED — code gates green; device verification with user)

> Source: `docs/SHELL-REVISION-NOTE.md`. **No API/schema/contract/data change** — screens already
> exist and are responsive; this is a navigation/IA restructure + making the shell render natively.
> Revises §6 (SidebarNav) and §5/§7 (TopBar / responsive) above; the Deep Navy tokens, OrgAvatar,
> DataTable scroll, etc. are unchanged.

## R2.1 Information architecture (constant across all sizes)

Split by **frequency/role**, not by module:

- **Operational** (primary nav, used every shift): **Dashboard**, **Scheduling → Board** (future
  scheduling/performance/allocation screens join the Scheduling group). Short and stable.
- **Admin / configuration** (occasional, behind a **gear**): its own grouped navigation —
  - **Configuration:** Plants, Plant groups, Customers, Programs, Calendars
  - **Master Data:** Parts, Resources, Resource groups, Routings, Certifications, Operators, Qualifications
  - **Access:** Roles, Users
- The split is **constant**; only its *rendering* adapts by breakpoint (R2.2).
- **RBAC:** the admin entry is gated (see SR1). **Master Data stays view-readable** to operational
  roles ("glance at a routing" without a role change); write affordances are config-gated.

Two nav configs replace today's single flat `ADMIN_NAV`:
- `OPERATIONAL_NAV` — `[Dashboard]`, `[Scheduling: Board]`.
- `ADMIN_NAV` — `[Configuration: …]`, `[Master Data: …]`, `[Access: …]`.

`AppShell` stays **one component** with the **operational sidebar always primary**
(`OPERATIONAL_NAV`); no platform fork, no separate admin shell. The **admin nav is a separate overlay**
(SR3): a slide-over panel on desktop/iPad (toggled by the TopBar gear) and a settings drill-down stack
on phone (SR4). Admin screens render in the normal content area; on desktop the operational sidebar
stays visible, so returning to operations is one click (no dedicated "back to app" affordance needed).

## R2.2 Rendering per breakpoint (one implementation, breakpoint-driven)

**Desktop / iPad (`≥ md`):**
- Operational left sidebar = primary nav, **always visible**.
- **Gear in the TopBar right cluster** (next to bell + avatar) → opens an **overlay slide-over panel**
  with the grouped `ADMIN_NAV` (Configuration / Master Data / Access). Selecting an item navigates to
  that admin screen (rendered in the content area) and closes the panel; the operational sidebar stays
  put, so one click returns to operations (SR3 — overlay panel, not a sidebar-swap area).

**iPhone / small (`max-md`):**
- TopBar carries **essentials only**: hamburger (left), compact title, avatar (right). **Search
  collapses to an icon; the gear is NOT in the TopBar.**
- **Gear lives in the nav drawer** — the hamburger drawer (operational nav) gets a **"Settings /
  Administration"** entry at its foot (RBAC-gated).
- The admin area renders as a **full-screen settings drill-down stack** (not a second sidebar):
  Settings → a grouped list (Configuration / Master Data / Access as rows) → a row pushes its screen →
  a back chevron walks up the stack and back to operations. Same IA as desktop, native chrome.
- **TopBar is size-tiered** — relocate in this order as width shrinks: **gear → search** go first;
  **menu + avatar** are last to go.

## R2.3 Route map (unified Solito paths; same path web + native)

> **Namespaced `/admin/<group>/*`** (SR2). All config/master-data/access screens relocate under their
> group — including Configuration (was `/admin/*`) and Access (was `/admin/*`), plus Master Data (was
> `/master-data/*`). Screens are unchanged — route/nav move only. Old paths can 301/redirect if needed.

| Area | Screen | Path (web `apps/next` + native `apps/expo`) | Moved from |
|---|---|---|---|
| Operational | Dashboard | `/` | (same) |
| Operational | Board | `/scheduling/board` | (same) |
| Admin landing | Settings/Admin home | `/admin` (phone: grouped list; desktop: gear opens the overlay panel) | (new) |
| Configuration | Plants … Calendars | `/admin/config/plants`, `/admin/config/plant-groups`, `/admin/config/customers`, `/admin/config/programs`, `/admin/config/calendars` | `/admin/*` |
| Master Data | Parts … Qualifications | `/admin/master-data/parts`, `/admin/master-data/resources`, `/admin/master-data/resource-groups`, `/admin/master-data/routings`, `/admin/master-data/routings/[id]`, `/admin/master-data/certifications`, `/admin/master-data/operators`, `/admin/master-data/qualifications` | `/master-data/*` |
| Access | Roles, Users | `/admin/access/roles`, `/admin/access/users` | `/admin/*` |

- **Web (`apps/next`):** operational screens under `(main)/`; admin screens under
  `(main)/admin/<group>/`. No separate admin layout — admin screens render in the normal `AppShell`
  (operational sidebar visible); the grouped admin nav is the gear-toggled overlay panel.
- **Native (`apps/expo`):** mirror under `(app)/` and `(app)/admin/<group>/` (same Solito paths).
  `(app)/admin` is the grouped settings list; `(app)/admin/<group>/<screen>` are stack-pushed full
  screens (SR4). **Every operational + admin screen gets an Expo route** (today only Board is wired).

## R2.4 Native enablement + safe-area (the difference between native and webview-in-a-frame)

- **`AppShell` renders on Expo**, not just web: the responsive sidebar↔drawer behavior works natively.
  Replace web-only chrome with cross-platform equivalents — root height via `flex:1` (native) /
  `100dvh` (web) behind a single style, and the small-screen drawer as a Tamagui-primitive overlay
  (absolute full-screen scrim + panel) rather than `position:fixed`. Breakpoint, not platform, drives
  the sidebar-vs-drawer choice; only the lowest-level "fill the screen / overlay" primitive differs.
- **Safe-area insets** (`useSafeAreaInsets`, `react-native-safe-area-context` — already a `packages/ui`
  dep): the **TopBar sits below the status bar/notch** (`paddingTop += insets.top`); the **drawer,
  settings stack, and any sheet clear the home indicator** (`paddingBottom += insets.bottom`). Web
  insets are 0, so this is inert on web. Make it an explicit shell concern.
- `react-native-svg` / Solito patterns stay; **no new nav dependency** proposed (Expo Router stack +
  Tamagui overlays cover the drill-down + drawer — SR4).

## R2.5 Open decisions (genuine choices — see the sign-off questions)

| ID | Question | Decision |
|---|---|---|
| SR1 | **Master Data RBAC for operational roles.** | **CONFIRMED:** admin entry (gear / Settings) **visible to all** authed users; the admin area + Master Data are fully **viewable**; **write affordances** (New/Edit/Deactivate, the gear→edit paths) are **hidden unless `canConfigure`**. ("Glance at a routing" works; editing stays config-gated.) |
| SR2 | **Admin route structure + Master Data relocation.** | **CONFIRMED: namespaced `/admin/<group>/*`** — `/admin/config/*`, `/admin/master-data/*`, `/admin/access/*`. All config/master-data/access screens relocate (incl. Plants/Roles); Master Data moves out of `/master-data/*`. |
| SR3 | **Desktop/iPad admin chrome.** | **CONFIRMED: overlay panel** — the gear opens a slide-over admin-nav panel over the current operational screen; the operational sidebar stays primary (no sidebar-swap area, no back-to-app row). |
| SR4 | **Native admin pattern + nav dep.** | **CONFIRMED: Expo Router stack drill-down** (Settings list → screen → back chevron) + Tamagui overlay for the operational drawer; **no new nav dependency.** |
