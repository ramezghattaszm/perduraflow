# Shell revision — operational/admin split + native rollout

| | |
|---|---|
| **Targets** | `frontend-spec-shell.md` (revise), `AppShell` + nav components, the Expo app shell, and the admin/master-data/access screen routes |
| **Type** | Shell + navigation restructure + native enablement. **No** API/schema/contract/data change — screens already exist and are responsive; this moves them and makes the shell render natively. |
| **Working mode** | Propose-then-confirm. Draft the `frontend-spec-shell.md` revision + the route map, present, **wait for sign-off**, then implement. Verify by **rendering and navigating on a real iPhone-sized Expo viewport** — not inferred from `tsc`. |

## Why

The flat sidebar mixes **operational** surfaces (Board — used every shift) with **configuration** surfaces (Plants, Parts, Routings, Certifications — set up occasionally). At ~14 items with one operational screen it's already heavy, and every future module (scheduling dashboards, performance, allocation) is operational and will pile on. Split by **frequency/role**, not by module: operational in the primary nav, configuration behind a gear in a dedicated admin area.

## Part 1 — Information architecture (constant across all sizes)

- **Primary nav (operational):** Dashboard, **Board**, and a "Scheduling" group future operational screens join. Short and stable.
- **Admin area (configuration), behind a gear:** its own grouped navigation —
  - *Configuration:* Plants, Plant groups, Customers, Programs, Calendars
  - *Master Data:* Parts, Resources, Resource groups, Routings, Certifications, Operators, Qualifications
  - *Access:* Roles, Users  (fixes the orphaned "Access/Roles" at the footer today)
- The operational/admin split is **constant**; only its *rendering* adapts by breakpoint (Part 2).
- **RBAC nuance:** the gear/admin entry only appears for roles with config rights. Keep Master Data **readable** (view-only) to operational roles even where editing is admin-gated, so "go glance at a routing" doesn't require a role change — just a trip to the admin area.

## Part 2 — Rendering per breakpoint

### Desktop / iPad (room to spare)
- **Gear in the TopBar** right cluster (next to notifications + avatar) → opens the **admin area with its own left nav** (the grouped IA above). A clear back-to-app affordance returns to operations.
- Operational sidebar stays the primary left nav.

### iPhone / small (no room — this is the constraint that shapes it)
- The TopBar carries **essentials only**: menu (hamburger) left, compact context/title, avatar right. **Search collapses to an icon or into the menu. The gear is NOT in the TopBar.**
- **Gear lives in the nav drawer** — the hamburger drawer (operational nav) gets a "Settings / Administration" entry at its foot.
- The **admin area renders as a full-screen drill-down settings stack**, not a second sidebar: tapping Settings pushes a full-screen grouped list (Configuration / Master Data / Access as rows); each row pushes its screen; a back chevron walks up the stack and back to operations. (Native settings pattern — same IA as desktop, different chrome.)
- **TopBar is size-tiered:** define its contents at each breakpoint; the **gear and search are the first to relocate** when space runs out, **menu and avatar the last to go**.

## Part 3 — Native enablement (all screens)

- Make **`AppShell` render on Expo**, not just web — the responsive sidebar↔drawer behavior from the shell spec actually working natively. The admin/master-data screens are already responsive, so each comes along once the native shell renders; treat "native shell" as the unit of work, not per-screen.
- Wire the Expo routes for every operational + admin screen.
- **Respect safe-area insets** (`useSafeAreaInsets`): the TopBar sits below the status bar/notch; any drawer/sheet/stack clears the home indicator. Make this an explicit shell concern — it's the difference between native and webview-in-a-frame.

## Constraints
- Token-themed only; reuse existing `packages/ui` components and the Deep Navy tokens.
- One responsive `AppShell` + nav implementation across web + native — no separate native fork of the shell; breakpoint behavior, not platform branching, drives the differences.
- `react-native-svg`/Solito patterns already in use stay; no new nav dependency unless justified in the proposal.
- Moving screens into the admin area is a **route/nav change only** — the screens themselves don't change.

## Done when
- Operational sidebar holds only operational surfaces; Configuration / Master Data / Access live in the admin area behind the gear.
- Gear: TopBar on desktop/iPad; nav-drawer entry on small, opening a full-screen settings stack.
- Gear/admin entry is RBAC-gated; Master Data stays view-readable to operational roles.
- **Every screen renders and is navigable on Expo**, verified on an **iPhone-sized viewport** (safe-area insets correct top and bottom) **and** iPad **and** web — not inferred from a green `tsc`.
- `frontend-spec-shell.md` updated with the per-breakpoint nav model and the safe-area rule; stories updated.
- No API/schema/contract/data change — same payloads, screens relocated and shell made native.
