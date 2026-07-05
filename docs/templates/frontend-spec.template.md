# PerduraFlow — Frontend Spec

> App-specific UI decisions. The reusable patterns live in `UI-ARCHITECTURE.md` — this file only
> records what is unique to PerduraFlow. Fill each section; delete guidance notes as you go.

---

## 1. Palette (semantic token values)

> Set the raw values behind the fixed semantic roles (UI §3). Role names do not change;
> only their values do.

| Semantic role | Light | Dark |
|---|---|---|
| `primary` | | |
| `primaryLight` | | |
| `surface` | | |
| `background` | | |
| `textPrimary` | | |
| `textSecondary` | | |
| `borderColor` | | |
| `success` | | |
| `danger` | | |
| `warning` | | |
| `gradientStart` | | |
| `gradientEnd` | | |

---

## 2. Typography retune (optional)

> Component API is fixed (`H`/`P`, UI §4). Only adjust pixel values if needed; otherwise "default".

- Heading sizes: _(default / overrides)_
- Body sizes: _(default / overrides)_
- Font family: _(default Inter / other)_

---

## 3. App-specific components

> Components unique to this app (still variant-driven, in `packages/ui`, library-safe).
> The repeated-pattern → component rule (UI §0.1) applies.

| Component | Variants | Notes |
|---|---|---|
| | | |

---

## 4. Route tree

> The app's navigation structure (UI §2). Shared screens in `packages/app/features`,
> re-exported into both app routers.

```
(auth)/ ...
(tabs)/ ...
[resource]/[id]
```

---

## 5. Screens

| Screen | Feature folder | Platform split? | Notes |
|---|---|---|---|
| | | | |

> **Screen aesthetic (solid vs gradient) is a per-app decision.** The template default
> screen container is `Screen` — solid `$background`, safe-area aware (UI §3 "Default screen is
> solid"). `GradientScreen` (theme-driven `$gradientStart` → `$gradientEnd`) is exported and
> available for apps that want a gradient look. Record the choice here (e.g. "auth screens use
> `GradientScreen`; the rest use `Screen`").

---

## 6. i18n namespaces

> Beyond `common` + `errors` (UI §9).

- Namespaces: _(e.g. `auth`, `feature-x`)_

---

## 7. Real-time UI

- Screens with live updates: _(if any)_

---

## 8. Open UI decisions

| ID | Question | Status |
|---|---|---|
| | | |
