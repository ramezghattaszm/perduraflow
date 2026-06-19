# Spec — Week view + date navigation (C1 UI half)

| | |
|---|---|
| **Builds on** | The shift-model engine (committed): calendar-aware placement, `WorkingCalendar`, `ScheduleVersionDetailDto.workingWindow`, the day-axis fix (06:00–22:00 from the calendar). |
| **Why** | The engine now produces a multi-day, shift-aware schedule (06:00–22:00 working, dark overnight, Sunday closed, work spilling across days). The single-day board can't show it. This is the UI that makes the shift structure **visible**. |
| **Activates** | The FS14 "horizon as a prop seam" decision + the GANTT-FIX addendum (day/week toggle, range with prev/next). Not built from scratch — activates a deliberately-left seam on the existing Gantt. |
| **Working mode** | Propose-then-confirm. Draft + design choices, stop for sign-off, then implement. |

## Decisions (locked)
1. **Date navigation** = prev/next day arrows + date picker + **Today** button. The day axis stays the 06:00–22:00 working window for the selected date.
2. **Week view layout** = **(b) continuous multi-day Gantt** — the timeline spans the week (Mon–Sat), day boundaries marked, overnight gaps and Sunday closure visible as **literal gaps/closed columns**, work flowing across days. (NOT the days-as-columns load grid.)
3. **Day/Week = a toggle on the same board** (segmented control), reusing plant/version selectors. Same Gantt component at two horizons, not a separate screen.

## Scope

### A. Date navigation (day view)
- Prev/next-day arrows, a date picker, and a **Today** button (jump back to current date).
- The selected date drives the day view; the axis remains the calendar working window (06:00–22:00, or wider if OT/per-resource union) **for that date**.
- If the selected date is a **closed day (Sunday/holiday)** → show the day as closed (empty, "closed" state), not a blank 24h axis.
- Re-fetch / re-scope the schedule for the selected date (the engine already produces multi-day; this selects which day to view).

### B. Day/Week toggle
- A segmented control (Day | Week) on the board header. Reuses plant + version selectors and all existing board state.
- Drives the Gantt's **horizon prop** (the FS14 seam): `day` → single working window; `week` → Mon–Sat span.
- Same `ScheduleGantt` component — no new screen, no duplicated board logic.

### C. Week view (continuous multi-day Gantt)
- **Horizon = the week (Mon–Sat)** containing the navigated date (week nav: prev/next **week** when in week mode).
- Each working day rendered as its **06:00–22:00 span** (from the calendar), with:
  - **Overnight gaps** (22:00→06:00) shown as closed/empty (the dark period — no bars, visibly closed).
  - **Sunday** shown as a **closed column/day** (the working-week rhythm: 6 on, 1 off).
  - Day boundaries marked (date labels per day column/section).
- Work (op bars) flows across days — an op placed Tuesday shows under Tuesday; the multi-day schedule the engine produces is now visible end-to-end.
- **Derive working days + windows from the same `WorkingCalendar`/`workingWindow`** the engine and day-axis use — one source of truth for "what's the working week" (don't hardcode Mon–Sat/06:00–22:00 in the view; read it).

## The main UX risk to handle: density
A week-wide Gantt (6 working days × multiple resources) gets wide and dense — the risk is an unreadable smear. Handle deliberately (propose the approach):
- Compress the per-day time scale in week mode (the week view is about *which day / rough load*, not minute-precision — minute detail is the day view's job). Closed periods (overnight/Sunday) compress to thin "closed" markers rather than full-width dead space, so working time dominates the pixels.
- Horizontal scroll if needed, but aim for "a week fits the viewport at a glance" as the target.
- Day view remains the high-resolution view (drill from week → day by tapping a day → switches to day mode on that date).

## Items to propose (design choices)
- **Week-mode time compression** — how the per-day axis compresses (so 6 days fit), and how closed periods (overnight/Sunday) render (thin markers vs. proportional dead space). Lean: working time dominates pixels; closed periods are thin markers.
- **Drill-down** — tapping a day in week view → switch to day mode on that date (lean: yes, natural drill).
- **Week navigation** — prev/next week when in week mode (parallels prev/next day in day mode).
- **Closed-day rendering** — Sunday/holiday as a distinct closed column treatment (greyed, "closed" label).
- **Data scope** — does the board already fetch the full multi-day schedule, or does week mode need a wider fetch? (The engine produces multi-day; confirm the read returns the week's worth.)

## Definition of done
- `bun run check` green; `next build` + Expo render.
- **Day view:** prev/next/picker/Today work; axis is the working window for the selected date; closed days show closed.
- **Toggle:** Day|Week switches the same board's horizon; plant/version preserved.
- **Week view:** Mon–Sat continuous Gantt; **overnight gaps and Sunday closure visible as literal gaps/closed**; work flows across days; readable at a glance (density handled); derives working days/windows from the calendar (not hardcoded).
- **Drill:** tap a day → day mode on that date.
- **Browser-verified web + native:** navigate dates, toggle to week, see the multi-day shift-aware schedule with its gaps, drill into a day.
- The shift model is now **visible** — the overnight/Sunday rhythm and multi-day flow the engine produces can be seen. C1 (shift-model work-area) complete.

---

*This completes C1 (shift calendars + week view + date navigation). Next realism items: material-arrival timing (collision 3), inspection-station capacity, min run-length, operator performance modifier — per `REMAINING-ITEMS.md`.*
