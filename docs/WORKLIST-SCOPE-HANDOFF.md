# Claude Code task — scope the work-list (open work, week-bounded)

**Problem:** post-seed, the work-list renders every order, past and future (~650 rows). A work-list is an *action* surface — executed history doesn't belong on it. Fix the scope.

**Sequencing:** land this **before** the seed-build verification gate, so the seed renders into a sane list. Independent of the seed data — this is a query/status-engine + work-list-UI change.

**Branch:** same as the seed work.

---

## The rule (agreed)

The work-list shows **open work for the viewed week, plus everything overdue-but-open** — and nothing executed.

Three filters, in order:

1. **Status (the core fix):** show only **open/unexecuted** orders — planned / committed / in-progress / at-risk / late-but-open. **Exclude executed / closed / historical.** This alone removes the past-window rows; they live on the KPI surfaces (cockpit historical OEE, scorecard), not here.

2. **Horizon = the viewed *week*** — the working week currently shown on the board, defaulting on load to the working week containing `today`. The work-list and the Gantt show the same week; week nav moves both.
   - **The day/week toggle is zoom, not scope.** Zooming the Gantt to a single day must **not** rescope the list. The horizon unit is always the week.
   - **A selected day is a lens, not a cut** — highlight / scroll-to / emphasize that day's rows, but never hide the rest of the week's open work. Tuesday's selection must not hide Wed–Fri.

3. **Overdue-but-open is always pinned** — an open order past its due (e.g. due last Tuesday, still not done) is the highest-priority item on the floor. It shows **regardless of the week bound, the day toggle, or any day selection** — surfaced in an overdue lane / pinned at top. **Do not filter the horizon by date** (`planned_start >= today` would hide exactly these). Filter by *status* (open vs done); bound the *forward* edge to the viewed week; carry overdue forward unconditionally.

**Net:** open work · viewed-week forward bound · overdue-but-open always · day = lens.

---

## Guardrails / invariants

- **At-risk stays canonical.** The work-list status engine is the source the cockpit/scorecard/baseline reconcile from. Excluding executed orders does **not** change the at-risk count (executed orders aren't at-risk), and overdue-but-open are retained, so every genuinely at-risk/late-open order is still counted. The status engine should compute over the **open-work** set; this change must be a **display/query scope**, not a change to how at-risk is computed. Verify the cockpit at-risk count is unchanged after the fix.
- **Rolling anchor.** "Current week" derives from **injected `today`**, not wall clock — the working week (Mon–Fri, calendar-aware) containing `today`. Must survive `demo:reset` on any day, consistent with the seed.
- **Don't conflate the two surfaces.** Day/shift-tight scoping is correct for a per-line/operator **dispatch view** ("today's run order for Press A" — the operator/line-lead's now-and-next). That is a *separate* surface and is **not** in scope here — do not let the planner work-list and a dispatch view inherit each other's scope. (No need to build the dispatch view in this task; just keep the boundary clean so the work-list doesn't become day-scoped.)

---

## Build

1. **Locate** the work-list query / status engine (the one that drives canonical at-risk — REMAINING-ITEMS calls it "the work-list status engine") and the work-list UI on the board. Report where both live before editing.
2. **Status + horizon filter** at the query/engine level: open-work only; forward-bounded to the viewed week (default = week containing injected `today`); overdue-but-open retained unconditionally. Commit: `fix(scheduling): scope work-list to open work + viewed week + overdue`
3. **Day-as-lens in the UI:** the day/week toggle and any day selection emphasize/scroll, never rescope. Commit: `fix(board): day selection is a lens on the work-list, not a scope cut`

## Verify (report before closing)
- Past executed orders gone from the work-list; present on cockpit/scorecard.
- Default load (as-if `today = Mon Jun 29`) shows week 1's open work; all four standing-beat anchors (SAL-1002 operator, SAL-1001 wear, SAL-1004 material, RAM-2001 at-risk) visible, not diluted.
- Selecting a day highlights but doesn't hide the rest of the week.
- An overdue-but-open order (seed one if none exists, or confirm against a late beat) stays pinned regardless of week/day.
- Cockpit at-risk count unchanged vs. pre-fix (canonical reconciliation intact).
- `demo:reset` on Jun 27/28 lands the work-list on the correct rolling week.
