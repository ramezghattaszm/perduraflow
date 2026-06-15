# ScheduleGantt — visual fix note (Phase 2 polish, no scope/data change)

| | |
|---|---|
| **Target** | `packages/ui` `ScheduleGantt` (and the board screen that feeds it) |
| **Type** | Render-only fix. **No** API, schema, contract, sequencer, or data change. The data is already correct; only the visual encoding is wrong. |
| **Reference** | `docs/perduraflow-gantt-mockup.html` (the target look, same Saltillo data) |

## The problem

Bars are rendered as equal-width chips packed left-to-right and overlapping, so the schedule has **no time scale** — the one thing a Gantt must show (*when* a job runs and *how long*) is exactly what's missing. The `· std` tag is printed *inside* each bar where it collides with the part number. Fix is entirely in `ScheduleGantt`'s rendering.

## Fixes, in priority order

### 1. Position and size every bar by time (the 80% fix)
Map time to x with a single scale over the version horizon:

```
pxPerMin = trackWidth / (horizonEnd - horizonStart)   // minutes
bar.x     = (op.planned_start - horizonStart) * pxPerMin
bar.width = (op.planned_end   - op.planned_start) * pxPerMin
```

- `horizonStart`/`horizonEnd` come from the `schedule_version` (already returned).
- A short op becomes a narrow bar at its real start; a long op a wide one. Overlap disappears because bars no longer share a cell — they sit at their actual times.
- Enforce a small **minimum width** (e.g. 6px) so a tiny op stays clickable, but never fake the width beyond that.

### 2. Real time axis + gridlines
- Header row: hour ticks (or shift boundaries) across the horizon, labelled `HH:00`.
- Faint vertical gridlines down through every lane at each tick (`rgba(255,255,255,.04)`).
- This is what gives the eye a scale; right now there's a lone date label and nothing to measure against.

### 3. Labels only where they fit
- Render the part label inside a bar **only if** `bar.width > ~74px`; otherwise omit it (truncate with ellipsis if partially fitting). Never print full-length text in a sub-label-width chip.
- **Move `· std` (source) out of the bar.** It's metadata, not identity. Put source/confidence in the **hover/press tooltip** and the legend, not inside the rect. (Phase 3 then flips `std → ml` + confidence as a tooltip change, no layout fight.)
- Tooltip (`onBarPress` / title) carries the full detail: part, `start–end`, `setup Xm / run Ym`, source, and at-risk reason if any.

### 4. Swim-lanes with height
- Taller lanes (~62px), vertical padding so bars don't touch row edges, a pinned **resource-label column** on the left, optional faint alternating row tint.

### 5. Encode setup / changeover / at-risk (data already exists)
- **Setup vs run:** render the head of each bar (width = `setup_time / (setup+cycle)`) as a hatched/darker segment, the remainder solid. Makes changeover cost visible — needed for the AS9 changeover story.
- **Changeover marker:** where two adjacent jobs on a resource differ in the changeover attribute, draw a thin accent tick at the boundary. (Use the same `changeover_attribute_key` the sequencer used.)
- **At-risk:** a `$danger` inset border + a small dot, **not** a different fill — a late bar must still read as a bar. Drive from the existing `at_risk` field.

## One decision to make explicitly: scroll vs. fit
A full shift at a readable scale is wider than the viewport. Pick one and state it:
- **(Recommended) Horizontal scroll** with the **resource-label column pinned** — shop-floor-appropriate, keeps bars at a readable scale. Reuse the `small`-breakpoint horizontal-scroll pattern from `DataTable`.
- **Fit-to-horizon** — whole shift always visible, bars get narrow. Simpler, worse for dense schedules.

Implement scroll-with-pinned-labels unless you have a reason not to; note the choice in the frontend-spec.

## Constraints
- Stays `react-native-svg` (`<Rect>`/`<Line>`/`<Text>`), one component rendering web + native — no platform split, no new dep. The positioning math above is identical on both.
- Token-themed only (no hex); at-risk uses `$danger`, changeover uses `$accent`.
- `ScheduleGantt` stays **presentational/controlled** — props `resources`, `operations`, `horizonStart`, `horizonEnd`, `onBarPress?`. No data fetching inside it.
- Keep the deferred virtualized authoring canvas (SKIP-40) able to supersede it behind the **same** `scheduled_operation` data — don't bake assumptions that block that.

## Done when
- Bars sit at their start time and their width equals their duration against an hour axis with gridlines; no overlap.
- Labels appear only where they fit; source/confidence live in tooltip + legend, not inside bars.
- Setup, changeover, and at-risk are visually distinct and driven by existing fields.
- Renders identically on `apps/next` and `apps/expo`; story added/updated (both themes).
- Horizontal scroll with a pinned resource-label column (or the chosen alternative), noted in the frontend-spec.
- No change to API, schema, contract, sequencer, or the data returned — verify the same `GET /scheduling/versions/:id` payload now renders correctly.

---

## Addendum — horizon mode (Day / Week) + range + plant selector

`ScheduleGantt` takes a **`horizon` prop (`day | week`)** — one component, two renderings (not two Gantts). The cockpit (View 1) defaults to **Day** and toggles to **Week**.

- **Day (default — what exists):** axis = **hours** (e.g. 06:00–18:00); bars = **individual operations** at real `planned_start`/duration, with setup/changeover/at-risk encoding. This is the board already built/fixed.
- **Week:** axis = **day columns** (Mon–Fri, with dates); each resource row shows **aggregate load per day** (utilization/load bar or heat per day cell) — **not** every operation across the week (that's the unreadable chip-soup case). Tapping a day drills into the Day view for that date. Week's per-day load is **computed from the same `scheduled_operation` rows** the day view uses — same data, aggregated; no separate dataset.

**Header controls (cockpit):**
- **Horizon toggle** — Day / Week segmented control. `NEW`.
- **Range** — the explicit span with prev/next stepping: "Mon Jun 15" (day) or "Jun 15–19" (week). Always state the range; never an ambiguous "this week" with no dates. `NEW`.
- **Plant selector** — **reuse the phase-2 board's plant chip-selector (already built)**; do not rebuild.

**No-hardcoding (applies here too):** day bars, week aggregates, and the range all derive from seeded `scheduled_operation` / `schedule_version` rows through the real endpoint — no fixture values in the component. Replacing the seed with real data changes rows only, not the component.
