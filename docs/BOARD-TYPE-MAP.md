# Board / dashboard element type map (add to UI-ARCHITECTURE.md)

| | |
|---|---|
| **Purpose** | Per-element type/weight/colour for the board & dashboards, so it's not re-decided per screen. Applies to the Schedule Board now and is the standard for Scorecard, Workforce, and the phase-4/5 views. |
| **Depends on** | the typography scale (`TYPOGRAPHY-SCALE-NOTE.md`) — uses those tokens. |

## Colour roles (map to existing tokens)
- **ink** = primary text (`--ink`) · **dim** = secondary (`--dim`) · **faint** = labels/scaffolding (`--faint`)
- **semantic** = green / amber / danger / ml-violet — **status only, never decoration**

## The six patterns (the rules everything below follows)
1. **Labels** → `body.5` (11) · 600 · ALL-CAPS + ~0.05em tracking · **faint**. (Every "RESOURCE", "Plant", section label.)
2. **Values** → `body.3` (14) · **ink** — weight **500** if identifier/primary, **600** if a number meant to pop.
3. **Meta / secondary** → `body.4`–`body.3` (12–14) · 400 · **dim**.
4. **One hero number per panel** → `heading.3` (22) · 600 · ink. A panel gets exactly **one** big number; everything else stays small.
5. **Semantic colour carries status only** (behind, churn-high, at-risk, settled, +delta) — never used decoratively.
6. **Headings are rare on a dense board** — only: screen title (`heading.1`), panel title (`heading.4`), the one hero number (`heading.3`). **Everything else is body (P).** If reaching for an H elsewhere, it's a label (11/600/caps) or a value (14).

## Element map — Schedule Board (top → bottom)

**Page header**
- Screen title — `heading.1` · 600 · ink *(→ TopBar on small)*
- Subtitle — `body.3` (14) · 400 · dim *(hidden on small)*

**Context bar (selectors / range)**
- Field labels ("Plant","Version") — `body.5` (11) · 600 · caps+tracked · faint
- Selected values — `body.3` (14) · 500 · ink
- Range label ("Mon · Jun 15") — `body.3` (14) · 500 · ink; chevrons · dim
- Horizon toggle (Day/Week) — `body.4` (12) · 500 · active ink / inactive dim

**Status + run meta**
- Status pill ("Committed") — `body.5` (11) · 600 · semantic tint (green)
- Run meta ("Run: Success · 11 ops · 8 demand") — `body.4` (12) · 400 · dim

**Metric chips (attainment / churn / learned)**
- Metric label — `body.4` (12) · 500 · dim
- Metric value — `body.3` (14) · 600 · ink, *or semantic when it's a status* (churn "High"→amber, behind→danger)
- Leading dot — semantic colour
- *(These are compact status chips, distinct from the larger Scorecard KPI tiles below.)*

**Legend**
- Items — `body.5` (11) · 400 · dim; swatch carries colour

**Gantt — axis & lanes**
- Axis ticks ("06:00") — `body.5` (11) · 400 · faint
- "RESOURCE" header — `body.5` (11) · 600 · caps+tracked · faint
- Resource name — `body.3` (14) · 500 · ink
- Lane sub-label (area) — `body.5` (11) · 400 · dim
- Behind-plan chip — `body.5` (11) · 600 · danger tint

**Gantt — bars**
- Bar label (part no) — `body.5` (11) · 500 · white (on fill)
- Bar source tag ("· ml") — `body.5` (11) · 400 · white @ reduced opacity
- At-risk — border/dot, not type

**Learned-param detail panel**
- Panel title (op · resource) — `heading.4` (18) · 600 · ink
- Panel subtitle — `body.4` (12) · 400 · dim
- Section labels ("Learned cycle time") — `body.5` (11) · 600 · caps+tracked · faint
- **Hero: learned value ("76m")** — `heading.3` (22) · 600 · ink
- Struck standard ("70m") — `body.3` (14) · 400 · dim · strikethrough
- Delta ("+8%") — `body.5` (11) · 600 · amber tint
- Confidence % — `body.3` (14) · 600 · ink
- Body / explanation — `body.3` (14) · 400 · dim
- "settled" indicator — `body.5` (11) · 500 · green

## Larger KPI tiles (Scorecard — the big metric cards, distinct from board chips)
- Tile value ("91%", "$4.17") — `heading.2` (28) · 600 · ink *(the tile's hero number)*
- Tile label ("ON-TIME-IN-FULL") — `body.5` (11) · 600 · caps+tracked · faint
- Tile sub ("service level", "vs $148") — `body.4` (12) · 400 · dim
- Delta arrow/value (↑6.1) — `body.4` (12) · 600 · semantic

## KPI bar charts (OEE A·P·Q)
- Row label ("Availability") — `body.3` (14) · 400 · dim
- Percent value — `body.3` (14) · 600 · ink
- Bar — token fill, rounded ends

## Done when
- Every board/dashboard text element uses the token/weight/colour above; no raw px, no ad-hoc weights/colours.
- Labels are 11/600/caps/faint everywhere; each panel/tile has exactly one hero number; semantic colour appears only on status.
- The map + six patterns are recorded in `docs/UI-ARCHITECTURE.md` as the dashboard standard (applies to Scorecard, Workforce, phase-4/5 views).
- Verified web + native, both themes.
