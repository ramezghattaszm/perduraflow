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
