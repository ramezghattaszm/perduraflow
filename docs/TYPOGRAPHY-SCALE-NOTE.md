# Typography scale — consolidate to one responsive scale

| | |
|---|---|
| **Targets** | the type tokens (the `HEADING`/`BODY` objects), `docs/UI-ARCHITECTURE.md` (record the standard), and all call-sites using the old sizes |
| **Type** | Token + usage refactor. Reduces 7 heading + 9 body sizes → **5 + 5**, raises the body default, makes only the large headings responsive. |
| **Principle** | **One scale, not two.** Body sizes are identical on web and mobile (floor 16 for primary reading). Only the **large headings shrink on small screens** — small text is the same everywhere, big text scales with the viewport. (This corrects the "smaller on mobile" instinct — convention is body stays ≥16 on mobile; headings clamp down.) |

## The standard

### Body — 5 sizes, identical web + mobile
| token | fontSize | lineHeight | use |
|---|---|---|---|
| `body.1` (lead) | 18 | 26 | intro / emphasis |
| **`body.2` (default)** | **16** | **24** | **primary reading — the default** |
| `body.3` (secondary) | 14 | 20 | supporting text |
| `body.4` (caption) | 12 | 16 | captions / meta |
| `body.5` (micro) | 11 | 15 | dense labels / badges — **floor, nothing smaller** |

### Heading — 5 sizes, large end responsive
| token | web fontSize | mobile fontSize | lineHeight (web / mobile) | use |
|---|---|---|---|---|
| `heading.display` | 48 | 32 | 56 / 38 | hero |
| `heading.1` | 36 | 28 | 44 / 34 | page title |
| `heading.2` | 28 | 22 | 36 / 28 | section |
| `heading.3` | 22 | 20 | 28 / 26 | sub-section |
| `heading.4` | 18 | 18 | 24 / 24 | small heading (converges) |

Note the shape: headings **diverge at the top** (48→32) and **converge at the bottom** (18 both). Small text identical everywhere; only large display/title sizes clamp on small.

## Rules
- **Body floor 16 for primary text** — never default below `body.2` (16). `body.5` (11) is the absolute floor for any text.
- **Drop everything below 11** (the old `9px` is gone). Below 14, 1px steps are fine (12/11), but keep only these few micro sizes — no 15/13 in-between cruft.
- **Min-2 step at ≥14** (the old scale had 1px steps 16→15→14→13 — remove them).
- **One scale.** Do **not** create parallel `HEADING_MOBILE` objects. The large headings are responsive via the existing media-query/breakpoint mechanism (Tamagui media tokens or a `clamp()`); everything else is a single value.

## Implementation
1. **Replace the tokens** — collapse `HEADING` to 5 (`display,1–4`) and `BODY` to 5 (`1–5`) with the values above. Headings carry both web + small values through the responsive mechanism already in use (the `small` breakpoint); body is single-valued.
2. **Migrate call-sites** — map old → new (old `BODY.4=14` → `body.3`; old default → `body.2`; old `HEADING.2=28` → `heading.2`; old `HEADING.6=15` → `heading.4`, etc.). Anything below 11 moves up to `body.5`. **No raw px font sizes left in components** — all go through tokens.
3. **Update `docs/UI-ARCHITECTURE.md`** — add a Typography section recording this as the standard: the two tables, the rules (body floor 16, micro floor 11, min-2 at ≥14, one responsive scale, headings clamp on small), and a one-line rationale (mobile keeps body ≥16; only large headings shrink). This is the source of truth going forward.
4. **Both themes / both platforms** — verify rendering on web and an iPhone-sized native viewport: body reads at 16 default, page titles shrink appropriately on small (not a 36px title on a 390px screen), nothing below 11.

## Done when
- Tokens are 5 body + 5 heading; no size below 11; default body is 16.
- Only large headings differ web vs mobile (via the responsive mechanism), via one scale — no parallel mobile object.
- No raw px font sizes in components; all call-sites use tokens.
- `UI-ARCHITECTURE.md` documents the scale + rules as the standard.
- Verified rendering web + native, both themes.
