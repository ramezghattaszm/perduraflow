# Schedule Board — real-time signals on the plan (write-up)

| | |
|---|---|
| **Target** | Schedule Board (`ScheduleGantt` + board screen) |
| **Type** | New visual affordances on an existing screen. Data already computed (variance, drift, at-risk) — this **surfaces** it; no new schema, no new metric. |
| **Principle** | **Calm visual indicators, not toasts.** The board should show — at a glance, on the thing it's about — when the committed plan is drifting, behind, or at risk, so the planner knows to act without manually re-solving. Settled indicators, never a live per-actual ticker (convergence-not-motion applies here too). |

## Item 1 — Stale-plan / drift signal (know when to re-solve)

**Problem:** after actuals drift, the board gives no signal that the committed plan no longer matches reality — the planner has to re-solve blind to find out.

**Fix:** when actuals for the *committed* version drift past a threshold, surface it on the board:
- A **badge/state on the Re-solve control** ("drift detected — re-solve to update") and/or a **calm banner**.
- Driven by the drift the loop already computes (committed plan vs incoming actuals).
- **Threshold-gated and settled** — appears when divergence crosses a bound and holds; does **not** flicker per actual. No auto-re-solve (human triggers it — D26/A18 posture).
- **No toast** (per RG — toasts overwhelm). A persistent visual state instead.

## Item 2 — Behind-plan / at-risk on the resource lane (signal on the thing it's about)

**Problem:** "Press Line A is 11% behind plan" shows only as a top message; the eye looks for it on the resource.

**Fix:** surface variance **on the lane label**, under the resource name:
- Resource-level **"N% behind plan"** chip under the lane name (e.g. under "Press Line A") — the variance is about that resource, so it belongs there.
- Keep operation-level **at-risk on the bar** (red inset border/dot) — already correct; planned-late lives on the bar, behind-plan lives on the lane. Two distinct signals, two surfaces.
- Top banner can stay as a plant-level summary, but the per-resource signal must be on the lane.

## Shared rules
- **Calm, settled, threshold-gated** — indicators appear when something crosses a bound and hold; no live twitching, no toast spam.
- **Per-version** — signals reflect the *selected* version's actuals-vs-plan (the seam already built); an old version shows its own behind/at-risk, not the latest.
- **No hardcoding** — every indicator computes from seeded rows through the real path; a clean pre-drift version shows no behind/drift signal (nothing to compute from).
- **No new data** — variance, drift, and at-risk are already computed; this surfaces them visually only.

## Deferred (noted, not now)
- A board-level **events/activity panel** ("all messages about tool-wear and other signals") — RG wants this eventually. **Home:** the **Exception Queue** (View 4, phases 4–5) for the full prioritized list, or a lighter board-adjacent activity log. **Not** the bell (stays a short recent feed) and **not** the LearnedParamPanel (per-operation). Decide queue-vs-activity-log when picked up.

## Done when
- After drift, the committed board shows a calm "plan stale / re-solve" indicator (no toast); behind-plan shows as a chip under the affected resource lane; operation at-risk stays on the bar.
- All signals are threshold-gated and settled (no per-actual flicker), per-version, and computed from seeded rows (a clean version shows none).
- No schema/API change — surfacing existing computed values.
