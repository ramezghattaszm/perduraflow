# Schedule Board — bar interaction (hover preview / click detail)

| | |
|---|---|
| **Target** | `ScheduleGantt` bar interaction + the detail panel; record in `docs/platform/UI-ARCHITECTURE.md` (interaction patterns). |
| **Type** | Interaction model. Resolves hover vs click and web vs native into one coherent rule. No schema/API change — the performance detail computes from existing actuals (per-version). |
| **Core invariant** | **Nothing is hover-only.** Hover is a web-only convenience; the **click/tap panel is the source of truth and is complete on both platforms.** Native has no hover, so anything on hover must also be in the panel. |

## Two tiers of the same information

**Tier 1 — Hover preview (web only).** Lightweight, transient tooltip following the cursor; disappears on mouse-out. Quick "what is this bar":
- Resource · demand line · scheduled (start–end) · setup · run.
- Supplementary only. **Native never shows this** — and that's fine, because every fact here is repeated in the panel.

**Tier 2 — Click / tap detail (both platforms).** The full, persistent, **self-contained** panel — does **not** assume the user saw the hover. Repeats the identity/schedule facts at top, then the detail below.

## Panel content (identical on both platforms — only the container differs)
Top → bottom:
1. **Identity / schedule** — op · resource; scheduled start–end; setup / run; source (`std`/`ml`). *(The same facts the hover preview shows — repeated so the panel stands alone.)*
2. **Learned value** *(when `ml`)* — the settled std→learned step, delta, confidence, "settled" indicator, tool-wear trigger. *(When `std`: standard times + "no learned adjustment yet — N actuals, adopts at 5".)*
3. **Performance detail (NEW)** — planned-vs-actual for this operation: planned vs actual cycle/run, variance, good/scrap if available. Per-version (this version's actuals). Computes from existing rows — no new data; reads "no actuals yet" when none.

## Container by platform
| | Web | Native |
|---|---|---|
| Hover | preview tooltip (Tier 1) | — none |
| Click / tap | **detail panel** beside/below the board (persistent; doesn't occlude the schedule) | **bottom sheet** sliding up from the bottom, full-width (Tier 2) |
| Panel content | self-contained: identity + learned + performance | self-contained: identity + learned + performance |

**Native is a bottom sheet, not a bar-anchored popover** — a popover on a small bar is cramped and covers the tapped bar; a bottom sheet gives full width for the facts + performance detail and is the native-standard pattern. Tap bar → sheet slides up → dismiss returns to the board.

**Web panel placement** — beside or below the board, persistent, so the planner can click bar-to-bar comparing without the panel occluding the Gantt.

## Rules
- **Nothing hover-only** — every hover fact is in the click panel; native parity guaranteed.
- **Panel is self-contained** — renders fully without a prior hover (repeats identity at top).
- **Selected bar shows a selected state** (outline) while its panel/sheet is open — on both platforms.
- **std and ml bars both open the panel** (already specced) — the panel adapts; performance detail shows for both.
- Per-version: the performance detail reflects the **selected** version's actuals; "no actuals yet" on a fresh version (never 0%/fabricated).
- Type per the board type map (identity labels 11/600/caps/faint; the one hero number = the learned value at heading.3; performance figures 14/ink).

## Done when
- Web: hover shows the preview; click opens a self-contained panel beside/below the board with identity + learned + performance; selected bar is outlined.
- Native: tap opens a bottom sheet with the same self-contained content; no hover dependency anywhere.
- Performance detail computes from per-version actuals (or "no actuals yet"); no hardcoding.
- Recorded in `docs/platform/UI-ARCHITECTURE.md`. Verified web + native, both themes.
