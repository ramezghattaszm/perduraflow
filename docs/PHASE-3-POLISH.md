# Phase 3 — polish & fixes (post-verification walk)

| | |
|---|---|
| **Origin** | Step-by-step verification of phase 3 (board, scorecard, workforce; web + native). Phase 3 backend + closed loop verified and committed. |
| **Type** | Fixes + responsive/density pass on existing screens. Mostly presentational; two are real logic bugs (cert-gap coherence, empty-state). **No** schema change except where noted. |
| **Companion** | `BOARD-SIGNALS-NOTE.md` (board signals — fold in here as item 2). Seed scenario is a **separate** spec (`SEED-SCENARIO-SPEC.md`), not part of this. |
| **Working mode** | Propose-then-confirm where a fix has a design choice; straight fix where it's mechanical. |

## 1. Small-breakpoint density pass (SHELL-LEVEL — one fix, all screens inherit)

Across Board, Scorecard, Workforce on phone/`small`, the screens are chrome-heavy and the content is buried. This is **one coherent pattern**, fixed at the shell/responsive level, not per screen:

- **Screen title → TopBar.** On `small`, the screen name (e.g. "Schedule board") renders as the TopBar title; **drop the big in-body H1**. The TopBar is otherwise wasted space on phone.
- **Drop subtitles on `small`.** "Deterministic schedule — resources across time", "Operator skills & certification…" etc. are desktop nicety; hide at `small`.
- **Condense Plant/Version selectors.** Two full-width stacked dropdowns is desktop layout shrunk. On `small`: a compact single bar (e.g. "Saltillo · Committed 2:30" → tap to pick) or two small side-by-side selectors on one row.
- **Tables by width (the rule):**
  - **Wide tables** (many columns — Workforce coverage matrix): **pin the first column** (Operator / Resource), scroll the rest horizontally. Smaller column width + smaller cells/checkboxes on `small`.
  - **Narrow tables** (few columns — Scorecard at-risk: order + reason): **stack into cards**, vertical scroll only — **no horizontal scroll**. (Horizontal scroll on a 2-column table reads as broken.)
  - *(This refines the earlier "all tables horizontal-scroll at small" → width-dependent.)*
- **Fixed-px spacing → responsive.** Several gaps are desktop-fixed (e.g. the large empty gap between "Skill & certification coverage" and the grid on Workforce). Make spacing responsive; kill the voids on `small`.
- **Promote the action above empty space.** The actionable content (re-balance/OT proposal on Workforce; the schedule itself on Board) must not sit below a void or be buried under chrome. On `small`, content-first: Gantt and proposals reachable without scrolling past empty space.

**Done when:** on a phone viewport, each screen opens on its content (schedule / metrics / coverage), title is in the TopBar, selectors are compact, no large empty gaps, tables behave by width, and the primary action is reachable without scrolling past emptiness. **No desktop layout change** — `small`-breakpoint only.

## 2. Board signals (from BOARD-SIGNALS-NOTE.md — fold in)

- **Stale-plan / drift indicator:** when committed actuals drift past threshold, a **calm visual state** (badge on Re-solve / banner) signals "re-solve to update" — **no toast**, threshold-gated, settled, no auto-re-solve.
- **Behind-plan on the lane label:** resource-level "N% behind plan" as a chip **under the resource name** (e.g. under "Press Line A"), not only a top banner. Operation-level at-risk stays **on the bar** (already correct). Two signals, two surfaces.
- Per-version, computed from rows (a clean pre-drift version shows none), no new data.

## 3. Schedule Board — other fixes

- **Every bar opens the LearnedParamPanel (std + ml).** Currently only `ml` bars respond; `std` bars no-op. Make `onBarSelect` fire for all bars; panel renders two states — **ml**: the std→learned settled step + confidence + trigger (as now); **std**: standard cycle/setup, `source = standard`, and an explicit "no learned adjustment yet" state (ideally "N actuals so far — adopts at 5"). One component, two states. (Forward-hook: this is the surface phases 4–5 extend.)
- **Lane sub-label fix.** Under the resource name it shows the raw `resource_type` ("Line") as a literal. Show a meaningful secondary value (resource area/description) or omit — don't echo the type enum.
- **Plant selection persistence → local/async.** Persist selected plant in local/AsyncStorage (cross-platform abstraction, **not** cookies, **not** DB — it's view state). **Validate on load** against the user's visible plants; fall back to a default if stale. (Same pattern for other view state: sidebar collapse, last version, horizon toggle.)

## 4. Scorecard fixes

- **Arrows / deltas:** restore the ↑/↓ and delta values — but **compare to the previous version** (version-over-version), **not** the manual baseline. The "vs manual baseline" comparison is the **Phase-5 arm** and must stay a stub — **do not fake a baseline number** to fill the gap.
- **OEE breakdown in a card.** Match the panel/card treatment of the other sections (currently bare).
- **Rounded bar ends** on the A·P·Q bars (minor CSS). *(Optional: colour-code by threshold — confirm before adding a colour; keep it calm.)*
- **At-risk row richer + badge.** Currently order + plain-text "late". Add a **sub-line with the real reason** (e.g. "late by N · op 10 on Press Line A") and render the reason as a **badge/tag**. **Do not hardcode "qty raised"** — the sub-line computes from the order's actual reason in the current scenario (here: lateness from drift).
- **Empty state ≠ 0%.** A freshly committed version with **no actuals** must read **"— / no actuals yet / not yet run"**, NOT 0% (performance/quality) or a 0% OEE. 0%-for-no-data is the bug (a computed-from-nothing value). Availability defaulting to 100% with no data is the same issue — show "no data".
- **Line/resource drill-down (the substantive one).** The Scorecard is plant-level only; there's no way to scope to a line. Add **drill-down**: plant-level by default, click a line (from the OEE breakdown or an at-risk row) → that line's scorecard. The drift story is line-specific (Press Line A), so the plant number needs to be traceable to the line causing it. Per-line OEE breakdown makes the breakdown diagnostic (loss isn't uniform across lines).

## 5. Workforce — cert-gap logic + scenario coherence (REAL logic bug)

Currently Jorge is **OUT** yet shows **qualified (checked)** for LEAK, and the proposal calls **Jorge** in — while also saying "no certified operator." Self-contradictory.

- **OUT overrides qualified in the grid.** An OUT operator cannot cover any station regardless of certification — their cells render **unavailable** (greyed/struck), not as live coverage. Certification (holds the cert) and availability (present this shift) are two facts; the cell must reflect both.
- **Coherent gap + proposal.** The gap exists **because** the leak-certified operator is OUT; the proposal must call in a **different operator who is both certified AND available** on OT — never the person who's out. The proposal target must satisfy: certified-for-the-gap-station + available + within OT rules.
- This depends on a coherent **seed scenario** (one certified operator out, another certified+available to call in) — see the seed spec. The logic fix and the scenario fix go together; neither works alone.
- Keep it a **proposal you approve** (D54 / D26 confirmed-fill), never auto-assignment.

## Cross-cutting guardrails (apply to all the above)
- **No hardcoding** — every displayed value computes from seeded rows through the real path. Don't fill a gap (baseline delta, at-risk reason, empty OEE) with a literal.
- **Phase-5 seams stay stubbed** — manual-baseline comparison (Scorecard) is Phase 5; leave it named, don't fake it.
- **Calm, settled, per-version** — signals threshold-gated, no toasts/flicker, reflecting the selected version.
- **`small`-breakpoint only** for the density pass — no desktop layout regression.
- **Verify web + native** for anything touching layout (the density pass especially) — render, don't infer from `tsc`.

---

# Proposed approach — the two design items (DRAFT — awaiting sign-off)

> Mechanical fixes (3b, 4b–4e, item-5 grid logic) are **implemented + gate-green + API-verified**. These
> two have design choices, so they stop here for review. `small` = the `max-md` breakpoint via `useMedia`.

## Item 1 — small-breakpoint density pass (shell-level)

**Principle:** one responsive pass, `small`-only, **no desktop change**. Content-first.

1. **Title → TopBar (the mechanism choice).** `AppShell` gains an optional `title` prop; on `small` the
   TopBar renders it (the bar is otherwise empty on phone). `PageHeader` becomes responsive — on `small`
   it **drops the H1 + subtitle** and renders only its `actions` in a compact row (Board Re-solve/Commit
   stay reachable). Each operational screen passes `title` to `AdminShell` (one line each). *Recommended
   over a title-context/store — explicit prop, no new global.*
2. **Selectors condense.** The stacked full-width Plant/Version `FormField` selectors collapse on `small`
   to **two compact selectors on one row** (drop the field labels; the placeholder carries meaning). Factor
   the repeated Plant(+Version) selector into a shared `ContextSelectors` so Board/Scorecard/Workforce/
   simulator share one responsive implementation. *(Alternative: a single summary chip → opens a picker
   sheet. Heavier; recommend the two-compact-selectors row.)*
3. **Tables by width (the real choice — DataTable gains a responsive mode):**
   - **Narrow tables** (Scorecard at-risk — 2 cols): add a **`stackOnSmall` card mode** to `DataTable` —
     on `small` each row renders as a stacked card (label + detail + reason badge), **vertical scroll only,
     no horizontal scroll**. Benefits every narrow table. *This is the main new build.*
   - **Wide tables** (Workforce coverage matrix): keep the **pinned first column** + horizontal scroll
     (already pinned); on `small` shrink `ROW_LABEL_WIDTH` / `CELL_WIDTH` / the checkbox via `useMedia`.
4. **Spacing + content-first.** Replace fixed gaps with `useMedia`-driven spacing (kill the void above the
   Workforce grid); ensure the Gantt and the OT proposal sit above empty space on `small`.

**Done when:** on a phone viewport each screen opens on its content, title in the TopBar, compact selectors,
no large gaps, narrow tables stack / wide tables pin-and-scroll, primary action reachable. Desktop unchanged.
**Verified by rendering on web + an iPhone-sized native viewport** (not inferred from `tsc`).

**Genuine choices for RG:** (a) `DataTable` `stackOnSmall` card mode (recommended) vs per-screen card lists;
(b) selectors → two-compact-row (recommended) vs summary-chip-opens-picker; (c) confirm Board actions
(Re-solve/Commit) stay in the body compact row vs move into the TopBar.

## Item 4 — Scorecard line/resource drill-down (+ version-over-version deltas, 4a)

**Goal:** the Scorecard is plant-level only; make the plant number traceable to the line causing it (the
drift is Press-Line-A-specific), and restore ↑/↓ deltas — **version-over-version, never the manual baseline**
(that arm stays the Phase-5 stub).

1. **Per-line scope (endpoint).** `GET /scheduling/scorecard?versionId=&resourceId=` — optional `resourceId`
   filters the metrics (OTIF/OEE/cost/throughput/at-risk) to that resource's ops. Default (no `resourceId`)
   = plant-level as today. Per-line OEE breakdown makes the loss diagnostic (it isn't uniform across lines).
2. **Drill-down UI.** Plant-level by default; a **line selector** (or click a line in the OEE breakdown /
   an at-risk row) scopes to that line, with a "← Plant" affordance to return. Computed from rows; empty-state
   rules carry (a line with no actuals → "no actuals yet").
3. **Version-over-version deltas (4a).** The scorecard returns a `previous` snapshot — the prior version's
   `{otif, costPerUnit, oee}` (the version this one **supersedes**, else the prior committed; null if none) —
   and the UI renders the ↑/↓ + delta on the KPI tiles by diffing current vs `previous`. **Not** the manual
   baseline. `KpiTile` already has a `trend` prop; this feeds it real values.

**Contract delta:** `ScorecardDto` gains `previous: { otif: number; costPerUnit: number | null; oee: OeeDto | null } | null`
and the endpoint accepts `resourceId`. No schema change.

**Genuine choices for RG:** (a) drill-down trigger — a line **selector** vs **clickable** OEE/at-risk rows
(recommend clickable rows + a scope chip); (b) "previous version" = the superseded one (recommend) vs the
prior committed; (c) per-line OEE breakdown shown as the same A·P·Q bars scoped to the line (recommend).

**Guardrail restated:** the **manual-baseline** delta stays a named Phase-5 stub — these deltas are
version-over-version only; do not fake a baseline number.
