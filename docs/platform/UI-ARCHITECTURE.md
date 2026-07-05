# UI Architecture Decisions & Patterns

> **Purpose:** Reusable architectural decisions for the cross-platform UI of any app built on this template.
> **Stack:** Tamagui + Expo Router + Next.js (App Router) + Solito + Zustand + TanStack Query + i18next
> **Package manager:** bun (workspaces) · **Monorepo:** Turborepo
> **Status:** Template baseline — generic. App-specific UI decisions go in `frontend-spec.md`, not here.

> **Editing rule:** This is a durable, reusable document. Do not put app-specific screens,
> routes, colors, or copy here — those belong in `frontend-spec.md`. Only change this file to
> improve a pattern that applies to _every_ app.

---

## 0. Two Principles That Govern Everything Below

These two ideas are the reason this template exists. Every rule in this document serves them.

### 0.1 Build a reusable component — never style inline per screen

If a visual pattern appears in the app — _a card with a light border and a colored left
accent_, a labelled input, a status pill, a section header — it becomes a **single
variant-driven component in `packages/ui`**, used everywhere. It is never re-coded, re-styled,
or copy-pasted into individual screens.

```tsx
// ✗ never — styling the card inline in a screen
<YStack borderWidth={1} borderColor="$borderColor" borderLeftWidth={4} borderLeftColor="$primary" ... >

// ✓ always — one component, driven by variants
<AccentCard accent="primary">...</AccentCard>
<AccentCard accent="danger">...</AccentCard>
```

The test: **if you are about to write the same style block in a second place, stop and make a
component.** Differences between uses become `variants`, not duplicated style.

### 0.2 The shared layer is library-ready

`packages/ui`, the typography components, the utilities, and the store conventions are written
so they can later be lifted into a standalone shared component library across apps. That means:

- `packages/ui` components import only from `tamagui`, `@perduraflow/config`, and each other — **never**
  from `@perduraflow/app` or any app feature. (Keeps the UI layer extractable with zero app coupling.)
- Everything is exported from a single barrel (`packages/ui/src/index.tsx`).
- No app-specific names, copy, or business logic inside `packages/ui`.

When the library is eventually extracted, it should be a `git mv` of `packages/ui` (+ `config`)
with no untangling.

---

## 1. Project Structure (Monorepo)

**Turborepo** with **bun** workspaces.

```
root/
  apps/
    expo/          ← iOS + Android (Expo Router, primary target)
    next/          ← Web (Next.js App Router, first-class)
    api/           ← NestJS API (see API-ARCHITECTURE.md)
  packages/
    app/           ← ALL shared logic: screens, hooks, stores, utils, i18n
    ui/            ← Shared Tamagui components only (library-ready, see §0.2)
    config/        ← Tamagui config, theme tokens, fonts, typography, toast
    contracts/     ← Shared API request/response types (the ONLY thing api + clients share)
```

### Golden Rule — screens hold logic, app routers only re-export

- `packages/app/features/**/*-screen.tsx` — contains ALL logic (hooks, state, handlers, navigation)
- `apps/expo/app/**/*.tsx` — single re-export only
- `apps/next/app/**/*.tsx` — single re-export only

```ts
// apps/expo/app/(auth)/login.tsx
export { LoginScreen as default } from 'app/features/auth/login-screen'

// apps/next/app/(auth)/login/page.tsx
export { LoginScreen as default } from 'app/features/auth/login-screen'
```

### The contracts boundary

Clients **never** import from `apps/api`. The only shared surface between the API and the
clients is `packages/contracts` (request/response types). This keeps the frontend decoupled
from server internals and is the seam along which the API could later split into its own repo.

---

## 2. Navigation

**Solito** for shared navigation across Expo Router and Next.js App Router. (expo-router is the
native routing engine; Solito is the cross-platform API your shared screens call.)

```ts
// In shared screens — works on both platforms
import { useRouter } from 'solito/navigation'

const router = useRouter()
router.push('/some/route')
router.replace('/(tabs)')
```

**Rule:** shared screens in `packages/app` navigate via Solito only — never import `expo-router`
or `next/navigation` directly. The route _tree_ (auth group, tabs group, detail routes) is an
app concern documented in `frontend-spec.md`; the structure below is the conventional shape:

```
app/
  _layout.tsx           ← providers, token hydration, splash
  index.tsx             ← auth redirect only
  (auth)/_layout.tsx    ← redirect if already authenticated
  (tabs)/_layout.tsx    ← tab navigator
  [resource]/[id].tsx   ← detail routes pushed over tabs
```

Tab `Tabs.Screen name` must match the full relative path (`profile/index`, not `profile`).

---

## 3. Theming (Tamagui)

### Never use hardcoded hex values — ever. All colors go through tokens.

```tsx
color="$primary"     ✓ correct
color="#2D5BE3"      ✗ never
```

### Two-layer token system

Define a **palette layer** (raw values, neutral names) and a **semantic layer** (role names the
components actually use). Components reference _only_ semantic tokens; rebranding an app is then
a palette edit with zero component changes.

```ts
// packages/config/src/tamagui.config.ts

// Layer 1 — palette (raw values, app-set; lives behind the semantic layer)
const palette = {
  blue9: '#2D5BE3',
  blue6: '#7EB3FF' /* … neutral scale names … */,
}

// Layer 2 — semantic roles (what components consume)
const lightColors = {
  // --- Core roles (every app defines these) ---
  primary: palette.blue9,
  primaryLight: palette.blue6,
  surface: '#FFFFFF',
  background: '#F0F4FF',
  textPrimary: '#1A1A2E',
  textSecondary: '#6B7280',
  borderColor: '#E3E8F0',
  success: '#22C55E',
  danger: '#EF4444',
  warning: '#F59E0B',
  gradientStart: '#C8E6FF',
  gradientEnd: '#4A6FE3',
  // --- Extended roles (optional; present in the template, override or ignore per app) ---
  surfaceGhost: 'rgba(255,255,255,0.18)', // translucent surface on gradients (pill inputs, etc.)
  overlay: 'rgba(0,0,0,0.2)', // scrim over images/media
  navBar: '#00429E', // tab bar / nav chrome background
  surfaceRaised: '#FFFFFF', // 3rd elevation: menus/popovers/tooltips/raised header (dark reads lighter; light = surface)
  primarySoft: 'rgba(45,91,227,0.10)', // selected nav item / active row tint
  hoverFill: 'rgba(0,0,0,0.045)', // row / nav-item / icon-button hover
}
const darkColors = {
  /* dark variants of the same semantic roles */
}

const config = createTamagui({
  tokens: { color: { ...defaultConfig.tokens.color, ...lightColors } },
  themes: {
    light: { ...defaultConfig.themes.light, ...lightColors },
    dark: { ...defaultConfig.themes.dark, ...darkColors },
  },
})
```

Actual palette values are an app decision (`frontend-spec.md`). The **semantic role names are
fixed by the template** so components are portable across apps. There are two tiers:

- **Core roles** (the 12 above) — every app sets values for these; components rely on them.
- **Extended roles** (`surfaceGhost`, `overlay`, `navBar`, `surfaceRaised`, `primarySoft`,
  `hoverFill`) — ship with the template for common chrome patterns (the app shell uses
  `surfaceRaised` for menus/popovers/tooltips, `primarySoft` for the selected nav item / active
  row, `hoverFill` for row & icon-button hover); an app may retune or leave them. Do **not**
  introduce a one-off color as a new semantic role unless it recurs — collapse it into an existing
  role (e.g. a lighter brand shade for a header bleed is `$primary`, not a new token; muted error
  text is `$danger` with opacity).

> **Deterministic avatar fills are the second raw-hex exception** (alongside the react-navigation
> tab bar below). `UserAvatar` derives a stable fill from the user id out of a small fixed
> categorical palette — these are not theme roles (they must stay constant across light/dark and
> per-user), so they live as a local `const` hex array in the component, documented as such.

### Light & dark themes (both first-class)

The template ships a complete light **and** dark theme for every semantic role. Dark mode is not
an inverted light theme — it follows modern standards:

- **No pure black / pure white.** Dark backgrounds are very dark desaturated navy/gray
  (e.g. `#0B0F1A`), not `#000`; primary text is off-white (e.g. `#E6E8EB`), not `#FFF`.
- **Elevation via lightness.** Shadows are invisible on dark, so raised surfaces get _lighter_
  than the background (`surface` lighter than `background` in dark).
- **Desaturate/lighten accents for dark.** Fully saturated brand/semantic colors vibrate on dark;
  lighten them for legibility (e.g. `primary` `#2D5BE3` → `#5B8DEF`; `danger`/`success`/`warning`
  brighter in dark).
- **WCAG contrast in both themes** — 4.5:1 body text, 3:1 UI/borders.
- Set CSS **`color-scheme`** per theme so native form controls, scrollbars, and the like match.

Values are app-overridable in `frontend-spec.md`; the template ships tuned defaults for both modes.

### SSR theme determinism (web) — required

The server must render the **same** theme the client resolves on first paint, or hydration
mismatches (a server-light vs client-dark disagreement is the classic case). Wiring:

- Persist the active theme in a **cookie**; read it in the server `layout.tsx` so SSR renders the
  real theme. Drive it with `@tamagui/next-theme`; default to system preference
  (`prefers-color-scheme`) with a user override.
- Put `suppressHydrationWarning` on the `<html>` tag (the pre-hydration theme script intentionally
  adjusts it). Note this only covers `<html>`'s own attributes — it does **not** silence deep
  child mismatches, so it is not a substitute for the rule below.
- Native mirrors system preference via React Native's `Appearance` API.

### Inline styles on web must use CSS vars, never JS-resolved colors

`useTheme().X.val` resolves a color **in JS at render time**, so an inline style built from it
bakes the server's theme and mismatches the client's. When a web component must emit an inline
style string (gradients, etc.), reference the **CSS variable** so both sides render an identical
string and the color resolves from the active theme class:

```tsx
// ✓ SSR-safe — identical on server and client, theme-correct via CSS
style={{ background: `linear-gradient(180deg, var(--gradientStart), var(--gradientEnd))` }}
// ✗ mismatches — server bakes light, client bakes dark
const start = useTheme().gradientStart.val
```

Token _props_ (`backgroundColor="$surface"`) are already safe — Tamagui compiles them to theme
classes. The `.val` escape hatch (above, and "Extracting raw values") is for **native-only**
non-Tamagui APIs (expo-linear-gradient, react-navigation), never for SSR'd web inline styles.

### Default screen is solid; gradient is opt-in

The template's default screen primitive is `Screen` — solid `$background`, safe-area aware. Auth
and app screens use it by default. `GradientScreen` remains a generic, exported primitive for apps
that want a gradient aesthetic, but using it is a **per-app design decision** recorded in
`frontend-spec.md` — gradients are not baked into the shared screens.

### Child themes — avoid them

We do **not** use Tamagui's implicit child themes (`light_Button`, etc.). Debugging is hard,
behavior is implicit, and they conflict with explicit token references. Every color in every
component references a named semantic token directly. Dark mode is a single `dark` theme swap +
`useTheme()` reads.

### react-navigation tab bar (the one raw-string exception)

```ts
// Hex required — react-navigation cannot accept Tamagui tokens
const ACTIVE_COLOR = '#2D5BE3' // $primary
const INACTIVE_COLOR = '#6B7280' // $textSecondary
```

### Responsive by default

**Every screen and shared component must be responsive unless explicitly stated otherwise.**
Design for small screens too: layouts reflow, the app shell collapses its sidebar to a top-left
menu (lucide `Menu`) that opens it as a drawer on small screens, and modals become bottom sheets
(§17). Don't ship a desktop-only layout.

### Responsive media is mobile-first (`min-width`) — use `max-*` for "small"

The Tamagui v5 config's media queries are **min-width** (mobile-first): `media.sm` is true when the
viewport is **≥ 640**, `media.md` ≥ 768, etc. So `media.sm` is *true on desktop* — it does **not**
mean "small screen". To branch on a small/phone viewport, use the **max-width** keys:

```ts
const media = useMedia()
const isSmall = Boolean(media['max-md']) // ≤ 767.98px — phones & narrow tablets
// media.sm/md/lg = min-width (≥); media['max-sm'|'max-md'|…] = max-width (≤)
```

This is the one that bites: a naive `if (media.sm)` to "render the mobile layout" runs on desktop.

---

## 4. Typography (P / H components — permanent template fixtures)

Typography is delivered through two components, `H` (headings) and `P` (body), defined once in
`packages/ui` and driven by variants. **Screens never set raw `fontSize`/`fontWeight` for text —
they use `H`/`P`.** These components and the scale below ship with the template and are not
rewritten per app; an app may retune the pixel values in `packages/config`, but the component
API is fixed.

### The scale — one responsive scale, 5 body + 5 heading

**One scale, not two.** Body sizes are identical on web and mobile; only the **large headings shrink
on small screens** (the `max-md` breakpoint). This corrects the "smaller on mobile" instinct — the
convention is **body stays ≥16 on mobile; headings clamp down**. There is **no parallel
`HEADING_MOBILE` object** — the responsive values live on the same tokens via the existing media key.

**Body — 5 sizes, identical web + mobile** (`<P size={n}>`):

| token | fontSize | lineHeight | use |
|---|---|---|---|
| `size={1}` (lead) | 18 | 26 | intro / emphasis |
| **`size={2}` (default)** | **16** | **24** | **primary reading — the default** |
| `size={3}` (secondary) | 14 | 20 | supporting text |
| `size={4}` (caption) | 12 | 16 | captions / meta |
| `size={5}` (micro) | 11 | 15 | dense labels / badges — **floor, nothing smaller** |

**Heading — 5 sizes, large end responsive** (`<H level={…}>`):

| token | web | small (`max-md`) | lineHeight (web / small) | use |
|---|---|---|---|---|
| `level="display"` | 48 | 32 | 56 / 38 | hero |
| `level={1}` | 36 | 28 | 44 / 34 | page title |
| `level={2}` | 28 | 22 | 36 / 28 | section |
| `level={3}` | 22 | 20 | 28 / 26 | sub-section |
| `level={4}` | 18 | 18 | 24 / 24 | small heading (converges) |

Headings **diverge at the top** (48→32) and **converge at the bottom** (18 on both). Small text is
identical everywhere; only large display/title sizes clamp on small.

```
Weights:  r=400  m=500  b=600  h=700
No light (300) — Inter Light is unreliable cross-platform.
No letterSpacing — caused glyph overlap on web.
```

### Rules (the standard)

- **Body floor 16 for primary text** — never default below `size={2}` (16). `size={5}` (11) is the
  absolute floor for any text. Nothing below 11 exists.
- **Micro floor 11** — the old `≤10`/`9` sizes are gone; below 14, 1px steps are fine (12, 11) but no
  13/15 in-between cruft.
- **Min-2 step at ≥14** — no 16→15→14 1px ladder.
- **One responsive scale** — do **not** create a parallel mobile token object. Large headings are
  responsive via the `max-md` media key (see below); everything else is a single value.
- **Headings clamp on small; body does not** — mobile keeps body ≥16; only large headings shrink.
- **`letterSpacing` is zeroed across the scale** (`packages/config/src/fonts.ts`) — negative tracking
  overlapped glyphs on web. If you change the font scale, **regenerate `public/tamagui.css`** or the
  Next.js *production* build will render stale tracking while dev looks fine (see §15).
- Color still comes through semantic tokens (`color="$textPrimary"` by default).

### Component API

```tsx
import { H, P } from '@perduraflow/ui'

<H level="display">Hero</H>             // 48px web / 32px small, heavy
<H level={1}>Page title</H>             // 36px web / 28px small, bold
<H level={3} weight="h">Section</H>     // size from level, weight overridden
<P>Body copy.</P>                       // 16px regular (size={2} is the default)
<P size={5} weight="b" color="$primary">Dense label</P>  // 11px — the floor
```

```ts
// packages/ui/src/typography.tsx — shape. Large headings carry a `$max-md`
// override (the small breakpoint) on the SAME token — one scale, no mobile object.
const HEADING = {
  display: { fontSize: 48, lineHeight: 56, '$max-md': { fontSize: 32, lineHeight: 38 } },
  1:       { fontSize: 36, lineHeight: 44, '$max-md': { fontSize: 28, lineHeight: 34 } },
  2:       { fontSize: 28, lineHeight: 36, '$max-md': { fontSize: 22, lineHeight: 28 } },
  3:       { fontSize: 22, lineHeight: 28, '$max-md': { fontSize: 20, lineHeight: 26 } },
  4:       { fontSize: 18, lineHeight: 24 }, // converges — no responsive override
} as const
const BODY = { 1: 18, 2: 16, 3: 14, 4: 12, 5: 11 } as const // single value each

export const H = styled(Text, {
  name: 'H',
  fontFamily: '$heading',
  variants: { level: HEADING, weight /* r|m|b|h */ } as const,
  defaultVariants: { level: 1, weight: 'b' },
})
// P is the same shape over BODY, defaultVariants { size: 2, weight: 'r' }.
```

> **Exceptions (not H/P text):** SVG chart labels (`react-native-svg` `<SvgText fontSize>`),
> computed avatar initials (sized to the avatar), and emoji-as-icon glyphs are graphic dimensions,
> not the typography scale — they pass numeric sizes directly and are exempt from "no raw px". All
> *prose* text goes through `H`/`P`.

### Read / scan / glance — which size for which job

Pick the body size by the verb the user is doing:

| size | verb | where |
|---|---|---|
| **16** (`size={2}`) | **read** | prose, form inputs + values, primary list/menu items, default UI text — the most common size app-wide, **but not in dense tables** |
| **14** (`size={3}`) | **scan** | table data cells, secondary text, dense lists |
| **11** (`size={5}`) | **glance** | table headers, captions, badges, meta labels |

**Caps:** uppercase is used **only at 11px** and is **always letter-spaced** — both come from the
`caps` variant on `P` (`<P size={5} weight="b" caps>` → uppercase + ~0.05em tracking). Never set
`textTransform`/`toUpperCase()` inline, and never caps at 14px+ (reads as shouting).

### Data tables (`DataTable`, and any bespoke table e.g. `QualificationMatrix`)

- **Column headers** — 11 (`size={5}`) · weight 600 · `caps` (uppercase + tracking) · faint
  (`$textTertiary` — see the colour roles in the dashboard map below). Headers are scaffolding:
  small and quiet, they recede behind the data.
  **A header is never larger than its column's data** (inverted hierarchy is a bug).
- **Data cells** — 14 (`size={3}`) · normal case · `$textPrimary` for primary, `$textSecondary` for
  secondary/meta. Weight 400, **except the primary identifier column** (order no / name / part no) at
  **500** so the eye scans the key column down the rows. `DataTable` defaults the **first column** to
  primary; opt out with `primary={false}`.

### Badges / status pills (`StatusPill`)

- 11 (`size={5}`) · weight 600.
- **Semantic tint, never a full-saturation fill** — coloured text on a soft tinted background
  (`$success` on `$successSoft`, `$primary` on `$primarySoft`, `$danger` on `$dangerSoft`, …). Pill
  radius, padding ~2–3px vertical / ~8–10px horizontal.
- Case: **sentence case** for words ("Late", "Approved"); ALL-CAPS only for very short codes
  ("OUT", "T1") — the component renders the label verbatim, so the caller passes the right case.

**Visual-weight order in a row, loudest → quietest:** primary cell (14 / 500 / ink) → secondary cell
(14 / 400) → header (11 / 600 / caps-tracked / faint) → badge (11 / 600 / semantic tint).

### Board / dashboard element type map

The per-element standard for the Schedule Board and all dashboards (Scorecard, Workforce, and the
phase-4/5 views). Don't re-decide type per screen — map each element here. Dashboard surfaces use
the shared **`Panel`** (a titled card: header label + content slot) for chrome — never an inline
card; pass `contentPadding="$0"` for a full-bleed body like a table or a divided list.

**Colour roles** (semantic tokens): **ink** = `$textPrimary` (primary text) · **dim** =
`$textSecondary` (secondary / meta) · **faint** = `$textTertiary` (labels / scaffolding — a third,
quieter level below dim). **Semantic** = `$success` / `$warning` / `$danger` / `$ml` — **status
only, never decoration**.

**The six patterns** (everything below follows these):
1. **Labels** → `size={5}` (11) · 600 · `caps` (uppercase + tracking) · **faint**. Every "RESOURCE",
   field label, section/tile label.
2. **Values** → `size={3}` (14) · **ink** — weight **500** if identifier/primary, **600** if a number
   meant to pop.
3. **Meta / secondary** → `size={4}`–`size={3}` (12–14) · 400 · **dim**.
4. **One hero number per panel** → `H level={3}` (22) · 600 · ink (KPI *cards* go one larger,
   `level={2}` / 28). A panel gets exactly one big number; everything else stays small.
5. **Semantic colour carries status only** (behind, churn-high, at-risk, settled, +delta) — never
   decorative.
6. **Headings are rare on a dense board** — only the screen title (`H level={1}`), a panel title
   (`H level={4}`), and the one hero number (`H level={3}`/`{2}`). Everything else is `P`. If reaching
   for an `H` elsewhere, it's a label (11/600/caps/faint) or a value (14).

**Element map:**

| element | token · weight · colour |
|---|---|
| Screen title (`PageHeader`) | `H level={1}` · 600 · ink (→ TopBar on small) |
| Subtitle | `size={3}` (14) · 400 · dim (hidden on small) |
| Context-bar field label | `size={5}` (11) · 600 · caps · faint |
| Selected value (`AppSelect`) | `size={3}` (14) · 500 · ink |
| Status pill | `size={5}` (11) · 600 · semantic tint |
| Run meta | `size={4}` (12) · 400 · dim |
| Metric chip label / value (`VarianceStrip`) | label `size={4}` (12) · 500 · dim · value `size={3}` (14) · 600 · ink-or-semantic; leading dot semantic |
| Legend item | `size={5}` (11) · 400 · dim; swatch carries colour |
| Gantt axis ticks | 11 · 400 · faint (SVG) |
| Gantt "RESOURCE" header | `size={5}` (11) · 600 · caps · faint |
| Gantt resource name | `size={3}` (14) · 500 · ink |
| Gantt lane sub-label / behind chip | `size={5}` (11) · 400 dim / 600 danger tint |
| Gantt bar label / source tag | 11 · 500 / 400 · white on fill (SVG) |
| Learned panel title / subtitle | `H level={4}` (18) · ink / `size={4}` (12) · dim |
| Learned panel section labels | `size={5}` (11) · 600 · caps · faint |
| Learned hero value | `H level={3}` (22) · 600 · ink |
| Struck standard / delta / confidence | `size={3}` strike dim / `size={5}` (11) · 600 · amber tint / `size={3}` (14) · 600 · ink |
| "settled" indicator | `size={5}` (11) · 500 · green |
| KPI tile value / label / sub / delta (`KpiTile`) | `H level={2}` (28) ink / `size={5}` caps faint / `size={4}` dim / `size={4}` (12) · 600 · semantic |
| KPI bar row label / percent (`MetricBars`) | `size={3}` (14) · 400 · dim / `size={3}` (14) · 600 · ink |

---

## 5. Component Architecture (Tamagui)

### Base pattern — `styled()` + variants

```ts
import { styled, YStack } from 'tamagui'

const Frame = styled(YStack, {
  name: 'ComponentName', // base styles use semantic tokens only
  variants: {
    variant: { primary: { backgroundColor: '$primary' }, ghost: { borderColor: '$primary' } },
    size: { $3: { height: 36 }, $4: { height: 44 }, $5: { height: 52 } },
  } as const,
  defaultVariants: { variant: 'primary', size: '$4' },
})
```

### Rules

- Use `styled()` for all components; express every variation as a `variant`, never a one-off prop override at the call site
- **Never duplicate a component** — if it exists, extend it with a new variant (this is §0.1)
- Every component exported from `packages/ui/src/index.tsx`; screens import from `@perduraflow/ui`, never from a component file
- Use Tamagui size tokens (`size="$4"`), never string names (`size="md"`)
- No hardcoded colors; no app-specific names inside `packages/ui` (§0.2)

### Button pattern (never pass `disabled` to a Tamagui Button)

Tamagui v2's `Button` has unstable Reanimated hook behavior when `disabled` changes between
renders ("Rendered fewer hooks than expected" on native). **Fix:** never pass `disabled` to the
Button frame; intercept `onPress` and simulate disabled with `opacity` + `pointerEvents`.

```tsx
export function AppButton({
  onPress,
  disabled,
  loading,
  children,
  variant = 'primary',
  size = '$4',
  ...props
}) {
  const isDisabled = disabled || loading
  return (
    <ButtonFrame
      opacity={isDisabled ? 0.65 : 1}
      pointerEvents={isDisabled ? 'none' : 'auto'}
      onPress={(e) => {
        if (onPress && !isDisabled) onPress(e)
      }}
      variant={variant}
      size={size}
      // NEVER pass disabled — causes Reanimated hook instability on native
      {...props}
    >
      {/* text rendered in an explicit child; see note below */}
    </ButtonFrame>
  )
}
```

Note: `styled(Button)` wraps children in an `XStack`, which breaks Tamagui v2's
`Button → Button.Text` color propagation. Render button text in an explicit `<Text>` (or `<P>`)
with the variant color rather than relying on propagation, and drive text color through the
`variant` prop, not an ad-hoc `color` override.

### Platform splits (only where the platform API differs)

| Component        | Reason                                                |
| ---------------- | ----------------------------------------------------- |
| `GradientScreen` | `expo-linear-gradient` on native, CSS gradient on web |
| `Modal`          | Native RN Modal vs web overlay                        |
| `BottomSheet`    | Native slide-up vs web panel                          |

All other components are single-file and run on both platforms. In a `.web.tsx` variant, never
import a native-only module (e.g. `expo-linear-gradient`).

### Control conventions (learned the hard way)

- **Password masking uses Tamagui's `type`, not `secureTextEntry`.** On web, Tamagui's `Input`
  treats `secureTextEntry` as a *native-only prop and ignores it* — the field stays visible. The
  unified, cross-platform prop is `type`: `type={hidden ? 'password' : 'text'}` (web → DOM
  `type=password`; native `Input` maps `type:'password'` → `secureTextEntry`). `AppInput` does this.
- **Font sizes in controls are tokens, not raw px.** Beyond `H`/`P`, control components
  (`AppInput`, `AppButton`, `OtpInput`, `AppToast`) use the `$1–$16` font size tokens (defined in
  `packages/config/fonts.ts`), e.g. `fontSize="$6"` (=16px) — never a bare number. Only
  `typography.tsx` (the H/P scale definition) holds pixel values.
- **Clickable text is `TextLink`, not `<P onPress>`.** A bare `P` with `onPress` has no pointer
  cursor and no hover affordance on web. `TextLink` (styled over `P`) adds `cursor:'pointer'` +
  primary color + hover/press opacity. Use it for "Forgot password?", "Sign up", etc.
- **Buttons signal hover/press with opacity only.** `AppButton`'s frame has
  `hoverStyle={{ opacity: 0.9 }}` / `pressStyle` — no background change — so the affordance is
  uniform across variants. Disabled buttons set `pointerEvents:'none'`, so neither fires.

---

## 6. State Management (Zustand) — one convention always

All stores in `packages/app/stores/`. Every store follows the **definition + typed selector
hooks** pattern: a raw store for multi-value reads, and granular selector hooks for everything
else (avoids needless re-renders). This shape is identical in every app.

```ts
// xxx.store.ts
interface XxxState {
  value: T
  hydrated: boolean
  setValue(v: T): void
  setHydrated(v: boolean): void
  reset(): void
}

const useXxxStore = create<XxxState>((set) => ({
  value: initial,
  hydrated: false,
  setValue: (value) => set({ value }),
  setHydrated: (hydrated) => set({ hydrated }),
  reset: () => set({ value: initial }),
}))

export { useXxxStore } // raw — only for multi-value reads
export const useXxxValue = () => useXxxStore((s) => s.value) // granular selectors — preferred
export const useIsHydrated = () => useXxxStore((s) => s.hydrated)
export const useXxxActions = () => useXxxStore((s) => ({ setValue: s.setValue, reset: s.reset }))
```

### Zustand vs direct storage

| Use Zustand                        | Use storage directly                    |
| ---------------------------------- | --------------------------------------- |
| Data needed by multiple components | One-time read on mount, write on action |
| Reactive updates needed            | Only one component uses it              |
| Auth state, counters, preferences  | Last email, "onboarding seen" flag      |

### Hydrated flag (web)

Web loses in-memory Zustand state on reload. Gate auth redirects on a `hydrated` flag so the
store can populate from storage before any redirect fires (`if (!hydrated) return null`).

---

## 7. Data Fetching (TanStack Query)

All hooks in `packages/app/hooks/`. Query keys centralized in one file.

```ts
export const QUERY_KEYS = {
  me: () => ['me'] as const,
  list: (params?: any) => ['list', params] as const,
  item: (id: string) => ['item', id] as const,
}

export function useItem(id: string) {
  return useQuery({
    queryKey: QUERY_KEYS.item(id),
    queryFn: () => apiClient.get(`/items/${id}`).then((r) => r.data),
    enabled: !!id,
  })
}
```

```ts
new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false, retry: 1 } },
})
```

**v5 note:** `onSuccess` was removed from `useQuery`; sync side effects (e.g. a badge count in a
store) via `useEffect` on `query.data`.

---

## 8. Auth Architecture

### Token storage

| Token   | Web                           | Mobile      |
| ------- | ----------------------------- | ----------- |
| Access  | Memory only (never persisted) | Memory only |
| Refresh | httpOnly cookie (set by API)  | SecureStore |

`TokenStore` interface covers the **access** token only (`getAccessToken` / `setAccessToken` /
`clearAccessToken`); the refresh token is handled per platform and never in this interface.

### Silent refresh

Axios response interceptor handles 401s: web posts `/auth/refresh` (browser sends the httpOnly
cookie); native posts with `{ refreshToken }` from SecureStore. Queue concurrent 401s, refresh
once, drain the queue; use raw axios for the refresh call to avoid an interceptor loop.

### Session restore / hydration

- **Web:** on mount, if a presence cookie exists, silently `POST /auth/refresh`, set the access
  token, then `setHydrated(true)`.
- **Mobile:** on mount, hydrate the token store from SecureStore, then `setHydrated(true)`.
- **Biometric (native only):** if a refresh token is stored, offer Face ID / Touch ID →
  `POST /auth/refresh` on success. The login screen gets a `.native.tsx` split for the biometric
  button; the shared `login-screen.tsx` has no biometric.

---

## 9. i18n

All user-facing strings go through i18next — no hardcoded copy anywhere.

```
packages/app/i18n/
  index.ts             ← initI18n() (idempotent), re-exports useTranslation
  locales/en/
    common.json
    errors.json        ← ALL API error codes as keys
    [feature].json
```

- `initI18n()` is idempotent (`if (i18next.isInitialized) return`) — safe under React strict mode
- Type-safe translations via the `i18next` module augmentation
- `errors.json` mirrors the API's error codes; resolve messages from `getApiErrorCode(err)`
- React Native lacks `Intl` — add `import 'intl-pluralrules'` at the app entry point

---

## 10. Real-Time (WebSocket) — when the app needs it

Client uses `socket.io-client` from shared screens: connect on mount with the access token,
join the resource room, handle inbound events, clean up on unmount. Use **optimistic** sends
with a `tempKey`, reconcile pending → confirmed by `tempKey` (not body text), and roll back on
failure. Because the access token expires in 15 min, set a proactive refresh timer (~14 min)
that reconnects with a fresh token; always clear it on cleanup. (Pattern only — wired per app.)

---

## 11. API Client

```ts
export const apiClient = axios.create({
  baseURL:
    process.env.EXPO_PUBLIC_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    'http://localhost:3000/api/v1',
  withCredentials: true, // required for httpOnly cookie refresh
})

apiClient.interceptors.request.use((config) => {
  const token = getTokenStore().getAccessToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})
// response interceptor: silent refresh on 401 (see §8)
```

Request/response _types_ come from `packages/contracts` — the client imports contract types,
never anything from `apps/api`.

---

## 12. Utility Functions — always utilities, never inline

All shared helpers live in `packages/app/utils/` and are imported where needed. **Never write a
utility inline in a screen.** If logic is reused or is non-trivially testable (formatting,
parsing, narrowing, date math), it is a utility.

```ts
// packages/app/utils/error.ts
export function getApiErrorCode(err: unknown): string | null {
  try {
    if (err && typeof err === 'object' && 'response' in err) {
      const code = (err as any).response?.data?.code
      return typeof code === 'string' ? code : null
    }
    return null
  } catch {
    return null
  } // never throws
}

// other common utilities: format.ts (numbers/currency), time.ts (timeAgo/relative), etc.
```

---

## 13. Toast System

- `useToast()` from `packages/app/hooks/useToast` — never call `@tamagui/toast` directly in screens
- All defaults in `packages/config/src/toast.ts` — change once, applies everywhere
- Foundation: `@tamagui/toast` (handles native/web split)
- Types: `info | warning | success | error`; positions are web-only (native shows top-center)
- `duration=0` = persistent (only `clearToasts()` removes); queue with a config `maxQueueLength`

```ts
// packages/config/src/toast.ts — colors via semantic tokens
export const toastConfig = {
  defaultDuration: 4000,
  defaultPosition: 'top-center',
  defaultType: 'info',
  defaultDismissible: true,
  maxQueueLength: 3,
  nativePosition: 'top-center',
  colors: {
    info: { background: '$primary', text: '$surface', icon: 'ℹ️' },
    warning: { background: '$warning', text: '$textPrimary', icon: '⚠️' },
    error: { background: '$danger', text: '$surface', icon: '✕' },
    success: { background: '$success', text: '$surface', icon: '✓' },
  },
}
```

```tsx
const { showToast, clearToasts } = useToast()
showToast('Saved')
showToast('Something went wrong', { type: 'error' })
showToast('Processing…', { duration: 0 }) // persistent
```

Wrap the app root with `ToastProvider` and render the app's `Toast` + `ToastViewport` from `@perduraflow/ui`.

---

## 14. Expo Setup Notes

- Entry-point imports (top of `apps/expo/app/_layout.tsx`, in order): `@tamagui/native/setup-zeego`, `intl-pluralrules`, then global CSS if used
- Use `npx expo install` for any package with native code; `bun add` only for pure-JS packages
- Disable typed routes in monorepos (`experiments.typedRoutes: false`) — the generated union is too strict for workspace paths
- Full `npx expo run:ios` / `run:android` rebuild required when: adding native code, changing bundle id/name, or adding config plugins. Metro hot reload covers JS-only changes.

---

## 15. Next.js Setup Notes

- `NextTamaguiProvider` from `@tamagui/next-plugin` wraps the app in `apps/next/app/layout.tsx`
- Server-side auth check uses a **presence cookie** (`perduraflow_auth`) — never the JWT itself; middleware only checks presence
- Client-side guard: check a `hydrated` flag before any auth redirect to avoid flash redirects (`if (!hydrated) return null`)

### The static `public/tamagui.css` MUST be regenerated from config — never hand-maintained

`NextTamaguiProvider` links a **static stylesheet** `<link rel="stylesheet" href="/tamagui.css" />`
(served from `apps/next/public/tamagui.css`) and, in **production only**, the runtime CSS injection
**excludes the design-system layer**:

```tsx
config.getCSS({ exclude: process.env.NODE_ENV === 'production' ? 'design-system' : null })
```

Consequence of this split:
- **Dev** regenerates the full design-system CSS (theme tokens **and** per-size font
  `letterSpacing`/`lineHeight`/`weight`) at runtime from `packages/config` → always current.
- **Prod** does **not** — the design-system rules come **only** from the static
  `public/tamagui.css`. If that file drifts from `packages/config/src/fonts.ts`, production renders
  **stale typography while dev looks fine.** The canonical symptom: headings (`H`) with the *old*
  negative heading `letterSpacing` baked in → glyphs too close / overlapping. (See §4 — we zero
  `letterSpacing` across the scale; a stale file re-introduces the negative tracking it removed.)

**The rule:** `public/tamagui.css` is a **generated artifact**, regenerated from the live config —
never edited by hand and never left to go stale. It is regenerated by
`apps/next/scripts/generate-tamagui-css.ts` (writes `config.getCSS()`), wired as the `generate:css`
script and as `prebuild`, so **`next build` always refreshes it** (the prod Docker build also runs
it explicitly before `next build`). After any change to fonts, theme tokens, or `tamagui.config`,
run `bun run --filter @perduraflow/next generate:css` and commit the updated file.

---

## 16. Documentation (TSDoc + Storybook)

Same comment engine as the API (TSDoc/JSDoc — one documentation language across the repo), with a
different emphasis, plus one UI-specific requirement: **Storybook**.

### TSDoc on exported components, hooks, and stores
Document **usage and contract**, not prop types. The highest-value line is an `@example` with the
canonical JSX.
- **Components:** what variants are *for*, gotchas written **on-site**, and an `@example`. Signature
  rules belong in the component's own comment so the editor surfaces them at the call site (e.g.
  AppButton's "never pass `disabled`" and "text color via `variant`, not a `color` override").
- **Hooks:** what it returns and its lifecycle/side effects (fires a refetch, writes the cookie).
- **Stores:** the selector contract (raw store for multi-value reads; granular selector hooks otherwise).

```tsx
/**
 * Primary action button. Variant drives both background and text color.
 *
 * @remarks Never pass `disabled` — pass `disabled`/`loading` as props and the component simulates
 * it via opacity + pointerEvents (see §5). Text color is controlled by `variant`.
 *
 * @example
 * <AppButton variant="primary" size="$4" onPress={save}>Save</AppButton>
 */
```

Don't restate prop types; don't document a component without an `@example`.

### Storybook — the UI's proof artifact (first-class requirement)
TSDoc describes a component; Storybook **renders** it — every variant and state, in **both
themes**, interactively. It's the UI equivalent of the API's acceptance test and enforces §0.1
(reuse over inline): a contributor sees the component already exists before reinventing it.
- A `*.stories.tsx` for every exported component in `packages/ui`, covering each variant and key
  states (loading, error, empty, long content).
- `@storybook/addon-themes` toggling **light/dark** — every story viewable in both (catches the
  theme-legibility / white-on-solid bug class at the component level, before a screen).
- Stories render through the real Tamagui config (same provider as the app).
- New component → its stories land in the **same** change. A component without stories is incomplete.

### Enforcement
`eslint-plugin-jsdoc` scoped to **exported** declarations in the typecheck/lint gate (comment
present + valid tags, no forced `@param` descriptions). Storybook enforced by "stories ship with
the component" and, optionally, a CI check that every exported `packages/ui` component has a
matching `*.stories.tsx`.

---

## 17. Overlays — modals, sheets & popups

One overlay primitive — **`Popup`** (in `packages/ui`) — used both for forms and confirms. Two rules
govern it. (`ConfirmDialog` predates it and is a deprecated alias; `FormSheet` was folded into `Popup`.)

### Rule 1 — overlays render through a Portal, never a bare absolute YStack

A `position:absolute` overlay resolves against the **nearest positioned ancestor**. Inside the app
shell (a `ScrollView`/flex layout) that box collapses to roughly the content height, so a "full
screen" scrim ends up a thin strip at the top and the centered card is invisible (this is a real bug
we hit). Render overlays through a **Tamagui `Portal`** (mounts at the app root, outside the scroll
container) with **`position="fixed"`** so the scrim covers the whole viewport, and a high `zIndex`
(we use `200000`) so it sits above other overlays:

```tsx
<Portal>
  <YStack position="fixed" top={0} left={0} right={0} bottom={0} zIndex={200000}
    backgroundColor="$overlay" alignItems="center" justifyContent="center"
    onPress={dismissable ? onClose : undefined}>
    <YStack onPress={(e) => e.stopPropagation()} backgroundColor="$surface" /* …card… */>{children}</YStack>
  </YStack>
</Portal>
```

### Rule 2 — there is one global popup at a time (`usePopup`)

Imperative alerts/confirms go through a single global popup, not per-screen modal state:

- **`Popup`** (component) — responsive: a centered **dialog** on `≥ md`, a real Tamagui **`Sheet`**
  (with the **`native`** flag, so iOS/Android get the platform bottom sheet) on small screens,
  branched via `media['max-md']` (see §3 "Responsive media"). Fixed header · scrollable body · footer,
  so tall forms scroll while actions stay put. High `zIndex` so confirms clear an open form popup.
- **`popup.store.ts`** (`usePopup`) — a Zustand store holding **one** `PopupOptions | null`
  (`show` replaces, `hide` clears). Options: `title`, `message`, `content`, `buttons`
  (`{ text, tone, onPress }` — `onPress` returning `false` keeps it open), `size`, `dismissable`.
- **`PopupHost`** — rendered once in the app `Provider` (next to the Toast host), so
  `usePopup().show(...)` works anywhere. Pattern mirrors the Toast system (§13).

```tsx
const { show } = usePopup()
show({ title: t('actions.deactivate'), message: t('common.deactivateConfirm'), buttons: [
  { text: t('actions.cancel'), tone: 'light' },
  { text: t('actions.deactivate'), tone: 'danger', onPress: () => deactivate() },
] })
```

`Popup` is used **two ways**: (1) **declaratively** for create/edit forms — render
`<Popup open onClose title footer={…} dismissable={false} error={…}>` with the screen owning the form
state (fields as `children`, Cancel/Save as `footer`, `dismissable={false}` so a stray scrim tap
doesn't discard input); (2) via the **`usePopup` store** for one-off confirms/alerts. Do **not** push
a stateful form through the `usePopup` store — its serialized, single-global, fire-and-forget model
fits confirms, not live forms.

### Tamagui `Sheet` gotchas (web)

- The **`animation` prop goes on the `<Sheet>` root** (the controller drives the frame's slide). With
  no animation the frame sits **off-screen** — the sheet looks like it "didn't open".
- Use **percentage `snapPoints`** (e.g. `snapPoints={[60]}`). `snapPointsMode="fit"` measured 0 height
  on web and left the frame off-screen.
- The **`animation` prop type doesn't resolve** through this workspace's config build (the motion
  driver's keys don't surface on styled props), so it's applied with a localized `@ts-expect-error`
  — valid at runtime. If the config typing is ever fixed, that suppression will flag itself.

---

## 18. Interaction — hover vs click, web vs native (Schedule Board bars)

The board bar interaction is the reference pattern for any "preview vs detail" surface.

**Core invariant — nothing is hover-only.** Hover is a **web-only convenience**; the **click/tap panel
is the source of truth and is complete on both platforms.** Native has no hover, so every fact a hover
shows must also live in the click panel.

**Two tiers of the same information:**
- **Tier 1 — hover preview (web only).** A transient, **non-interactive** tooltip (`pointerEvents:"none"`,
  via Portal) following the bar; gone on mouse-out. Quick "what is this": resource · demand line ·
  scheduled · setup · run. Native never shows it — and that's fine, because every fact repeats below.
- **Tier 2 — click / tap detail (both platforms).** The full, **self-contained** panel — it does **not**
  assume the hover was seen, so it repeats the identity/schedule facts at top, then the detail.

**Panel content (identical on both platforms; only the container differs):** identity/schedule →
learned value (`ml`: settled std→learned step, delta, confidence, "settled", tool-wear trigger; `std`:
standard times + "no learned adjustment yet") → **performance** (planned-vs-actual cycle/run, variance,
good/scrap; per the **selected version's** actuals; "no actuals yet" when none — never 0%/fabricated).

**Container by platform** (`BarDetailSheet`, web / `.native` split):
- **Web** — a **persistent panel below the board** (doesn't occlude the Gantt, so the planner clicks
  bar-to-bar comparing). Clicking a bar **selects** it (no occluding popover); clicking it again, or
  another bar, switches/dismisses — no close button.
- **Native** — a **bottom sheet** sliding up full-width (a bar-anchored popover is cramped and covers
  the tapped bar). Tap → sheet up; drag/overlay dismiss → board.

**Selected state** — the open bar shows a **selected outline** (an outset ring, distinct from the
at-risk inset border) on both platforms.

**Type** — per the board type map (§4): identity labels 11/600/caps/faint; the one hero number is the
learned value at `heading.3`; performance figures 14/ink (semantic tint only on variance/scrap).

---

## Revision History

| Version | Date | Notes                                                                                                                                                                                                                                                                                    |
| ------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | —    | Generalized from the Mercor UI architecture; de-branded; bun + Turborepo; added §0 governing principles (reuse-over-inline, library-ready), §4 typography (H/P), §12 utilities and §6 stores elevated to fixed conventions; added `packages/contracts` boundary; two-layer token system. |
| 1.1     | 2026-06-14 | Added §17 Overlays (Portal-rendered modals; `usePopup` single global popup → dialog on desktop / native `Sheet` on small; Tamagui Sheet gotchas). §3 responsive media is mobile-first (`min-width`; use `max-*` for small). §5 control conventions: password masking via `type` not `secureTextEntry`, font-size tokens in controls, `TextLink` for clickable text, button hover = opacity only. |
| 1.2     | 2026-06-14 | §3 "Responsive by default" principle (every screen/component responsive unless stated). App shell collapses its sidebar to a top-left menu (lucide) drawer on small screens. Nav selection is a primary-colored font with **no** background/box. Overlay scrims set `pointerEvents:"auto"` (the Portal host is `pointer-events:none`, which inherits). |
