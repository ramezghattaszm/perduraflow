# CLAUDE.md — Template Build Instructions

Read this file first, before doing anything, every session. It is the contract for building
**any** app on this template. It does not repeat the architecture docs — it indexes the
non-negotiable rules and points into them.

This is a **reusable starter template** (Tamagui + Expo + Next.js + NestJS, bun monorepo).
Nothing here is app-specific. App-specific decisions live in `docs/api-spec.md` and
`docs/frontend-spec.md`, which are created per app from the `*.template.md` skeletons.

---

## 0. First-run initialization

When this template is used to start a new app, do these once, before building features:

1. **Ask for the app identity** if not provided: display name, slug (lowercase, no spaces),
   and iOS/Android bundle identifier.
2. **Replace placeholders** everywhere they appear:
   - `PerduraFlow` → display name (app.json/app.config, page titles)
   - `perduraflow` → slug — drives the **workspace scope** (`@perduraflow/ui`, `@perduraflow/api`, …),
     the database name, the presence cookie `perduraflow_auth`, and env prefixes
   - `com.perduraflow.app` → bundle identifier (iOS/Android)
   - The workspace scope is project-specific by design (e.g. slug `magna` → `@magna/ui`, `@magna/api`);
     replacing `perduraflow` sets it everywhere. Use a scope distinct from the slug only if asked.
3. **Create the app spec docs** from the skeletons:
   - `docs/api-spec.template.md` → `docs/api-spec.md`
   - `docs/frontend-spec.template.md` → `docs/frontend-spec.md`
   - `docs/PROJECT-SUMMARY.template.md` → `docs/PROJECT-SUMMARY.md`
4. **Do not edit** `docs/API-ARCHITECTURE.md` or `docs/UI-ARCHITECTURE.md` for app specifics —
   those are durable template docs. App decisions go in the spec docs from step 3.

Stop after init and confirm the app builds (`bun web`, `bun native`, `bun --filter @perduraflow/api dev`)
before starting features.

---

## 1. Document map

| Doc | Role | Editable per app? |
|---|---|---|
| `CLAUDE.md` (this file) | Entry point + rules index | No (template-level) |
| `docs/API-ARCHITECTURE.md` | Reusable API patterns + rules | No |
| `docs/UI-ARCHITECTURE.md` | Reusable UI patterns + rules | No |
| `docs/api-spec.md` | This app's API decisions (modules, tables, scope key, error codes, env) | Yes |
| `docs/frontend-spec.md` | This app's UI decisions (palette, routes, screens, copy) | Yes |
| `docs/PROJECT-SUMMARY.md` | This app's live state / handoff | Yes |

Before building anything, read the two architecture docs and the two app spec docs.

---

## 2. Non-negotiable rules (index)

These hold for every app. Each points to the authoritative section.

### Data & API
- **ULID `text` primary keys**, app-layer generated via `generateId()`; FKs are `text`; never
  `serial`/`integer`; one ID strategy across the schema → *API §2*
- **Soft delete only** (`isActive=false` / status transitions); migrations never edited after
  creation → *API §2*
- **Tenant/scope every user-facing query** from the JWT, server-side; the column exists even in
  single-tenant apps → *API §4*
- **Module boundaries:** no cross-module repo imports, no cross-module joins, side effects via
  `EventEmitter2`, event names as constants → *API §3*
- **Security:** 403 not 404 on ownership failures; `assertOwnership()` always; public/private/admin
  DTO tiers; `/me` derives id from JWT only; admin routes need both guards; never expose secrets → *API §11*
- **Pluggable provider pattern** for any swappable infra (storage/email/SMS/…): Service is the only
  export, provider selected by env var → *API §10*
- **Zod-validated env at startup**, fail fast → *API §12*
- **JSDoc on exported surfaces** — intent and contracts (ownership/tenant, `@throws`, side effects),
  not restated types → *API §14*

### UI
- **Build a reusable component — never style inline per screen.** A repeated visual pattern
  becomes one variant-driven component in `packages/ui`. If you'd write the same style block
  twice, make a component → *UI §0.1*
- **`packages/ui` is library-ready:** imports only `tamagui`/`@perduraflow/config`/itself, never `@perduraflow/app`;
  one barrel export; no app names inside → *UI §0.2*
- **Typography is `H`/`P` components** with variants — never raw `fontSize`/`fontWeight` in screens → *UI §4*
- **No hardcoded hex** — semantic tokens only; two-layer palette→semantic; no child themes → *UI §3*
- **Light & dark are first-class** — both themes defined for every role; cookie-deterministic SSR theme;
  web inline styles use CSS vars, never `.val`; `Screen` (solid) is the default, `GradientScreen` opt-in → *UI §3*
- **No hardcoded strings** — i18next; `errors.json` mirrors API error codes → *UI §9*
- **Utilities are utilities** — all shared helpers in `packages/app/utils/`, never inline in a screen → *UI §12*
- **Zustand: one convention** — definition + typed selector hooks; granular selectors preferred → *UI §6*
- **Screens hold logic; app routers only re-export**; shared screens navigate via Solito only → *UI §1, §2*
- **Clients import `packages/contracts`, never `apps/api`** → *UI §1*
- **Tamagui Button:** never pass `disabled`; use `opacity`+`pointerEvents`+`onPress` guard → *UI §5*
- **TSDoc + Storybook on exported components/hooks/stores** — usage + `@example`; a `*.stories.tsx`
  (both themes) ships with every `packages/ui` component → *UI §16*

---

## 3. Build order

Build in this order. Stop after each phase and confirm before the next.

- [ ] **Phase 0** — Init (§0): placeholders, spec docs, confirm empty build
- [ ] **Phase 1** — Theme tokens (palette → semantic) + fonts + typography `H`/`P` (`packages/config`, `packages/ui`)
- [ ] **Phase 2** — Shared UI components (`packages/ui/src/`) — variant-driven, exported from the barrel
- [ ] **Phase 3** — Utilities (`packages/app/utils/`)
- [ ] **Phase 4** — Zustand stores (`packages/app/stores/`)
- [ ] **Phase 5** — API client + QueryClient + token store (`packages/app/lib/`)
- [ ] **Phase 6** — React Query hooks (`packages/app/hooks/`) + `packages/contracts` types
- [ ] **Phase 7** — i18n (`packages/app/i18n/`)
- [ ] **Phase 8** — Shared screens (`packages/app/features/`)
- [ ] **Phase 9** — Wire screens into `apps/expo/app/`
- [ ] **Phase 10** — Wire screens into `apps/next/app/`

API modules are built against `docs/API-ARCHITECTURE.md` + `docs/api-spec.md` and can proceed in
parallel with the UI phases, starting from the `example` module as the template.

---

## 4. Commands (bun)

```bash
bun install                         # install workspace
bun web                             # Next.js dev (apps/next)
bun native                          # Expo dev (apps/expo)
bun --filter @perduraflow/api dev            # API dev (Node runtime)
bun --filter @perduraflow/config build       # build shared config
bun --filter @perduraflow/ui build           # build shared ui

# Database (API)
bun run db:setup                    # create the app database
bun --filter @perduraflow/api db:generate    # generate migration
bun --filter @perduraflow/api db:migrate     # apply migrations
bun --filter @perduraflow/api db:seed        # seed

# Quality
bun run typecheck                   # all workspaces
bun run lint
```

> Confirm script names against the scaffolded `package.json` — the Tamagui starter sets `web`/`native`.

---

## 5. General coding rules

- **TypeScript strict everywhere** — no `any` (narrow instead)
- No hardcoded hex, no hardcoded user-facing strings, no inline utilities, no duplicated components
- No cross-feature imports — features import from `@perduraflow/ui` and `@perduraflow/app/hooks`, never from each other
- Prefer extending a component with a new variant over creating a near-duplicate

## 6. What not to do

- Do not edit `API-ARCHITECTURE.md` / `UI-ARCHITECTURE.md` for app-specific needs — use the spec docs
- Do not add a new UI/styling library or bypass the Tamagui design system
- Do not pass `disabled` to a Tamagui Button
- Do not import `expo-linear-gradient` (or other native-only modules) in `.web.tsx` files
- Do not import from `apps/api` in any client; cross only through `packages/contracts`
- Do not skip i18n for user-facing text, or hardcode colors
- Do not start the next build phase until the current one is confirmed

---

## Revision History

| Version | Date | Notes |
|---|---|---|
| 1.0 | — | Rewritten from the Mercor CLAUDE.md into a template entry point: init/placeholder flow, doc map, non-negotiable rules index with pointers, generic build order, bun commands. |
