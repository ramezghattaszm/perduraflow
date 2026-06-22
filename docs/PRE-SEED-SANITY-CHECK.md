# Pre-Seed Sanity Check & Polish Walk

> The structured gate before demo seeding. Walk every surface systematically, on both platforms, checking three things at each: **does it work** (functional), **does it look right** (polish), **is it demo-ready** (coherent). This is an *integration* check — different from the per-feature verifications. Those proved each feature responds to its input; this proves the whole system hangs together when walked like a user.
>
> **Roles:** RG walks the running app (functional/coherence/polish observation). Assistant structures + diagnoses findings → fix batches. Claude Code does Layer 0 (build health) + fixes what the walk surfaces.
>
> **How to use:** tick each check. For functional bugs → note under the surface. For polish → flag in the Polish column (P), fixed in batch after the walk (often shared root cause). Re-run this whole checklist after seeding and again before the demo as a regression pass.

**Legend:** ☐ todo · ✓ pass · ✗ fail (note) · P polish-flag (note) · N/A · 🔁 re-check after fix

---

## Layer 0 — Build & environment health (Claude Code, before the walk)
- ✓ `.next` lock flake resolved — root cause: orphaned `next dev` + `nest --watch` survive sessions and hold the shared `.next/dev/lock` (any port). **Fixed at the root:** env-driven `distDir` (`NEXT_DIST_DIR`) + smoke tests run in an isolated `.next-smoke` dir → suite runs green **in parallel with a live `bun web`**, no process-killing (orphan-prevention). Verified: 60/60 with web dev running.
- ✓ Clean-tree typecheck + enforced gate + full test suite — typecheck 5/5; `bun run check` (eslint + boundaries + docs) green; **60 tests / 11 files green**.
- ✓ `demo:reset` restores known-clean state — 3 plants · 5 resources · 6 parts · 7 operators · **56 demand lines** · 9 historical outcomes · **2 committed baselines** (Saltillo + Ramos, real engine) · **78 scheduled ops** · 0 learned · no variance.
- ✓ Next (web) boots clean — HTTP 307 → login, Ready ~0.8s (only a middleware→proxy deprecation warning).
- ✓ Expo (native) boots + bundles — `expo export` bundled **4072 modules** → iOS bundle 8.49 MB, exit 0; hoisted-linker works. (Full simulator launch not run; the at-risk bundle builds.)
- ✓ Version sanity — code + running system at **wi-10 / aps-w2** (live what-if `weightSetVersion: aps-w2`); migrations **0000–0012, all 13 applied**.

**Notes (known-deferred / caveats):**
- ⚠ `demo:reset` **requires the API running** — the baseline-schedule step solves+commits over the API; with the API down it warns and leaves 0 committed versions (board empty until Re-solve). Run it with `bun --filter @perduraflow/api dev` up.
- ⚠ `bun run lint` is **Biome** (repo-wide, **not** the enforced gate) and carries a **known-deferred ~782-error baseline** since Initial commit (mostly `scripts/`); zero in recently-touched files. The enforced gate is `bun run check`. Baseline cleanup is out of scope (polish).

**Gate:** Layer 0 fully green. ✓ Cleared — foundation is provably clean.

---

## Layer 1 — Screen-by-screen functional walk (WEB FIRST)

For each surface: loads with seed? interactions work? reflects current engine state? anything broken/stale/wrong?

### 1.1 — Board (the centerpiece)
- ☐ Loads with seeded schedule; opens on the schedule's first working day (not a blank/idle view)
- ☐ Day view: bars render, axis = working window (06:00–22:00), not 00:00→last-op
- ☐ Week view: day-cell axis, ~10px/h compression, "Closed" markers, Sunday closed column
- ☐ Date-nav: clamps to version horizon, drill-down (tap day → day mode) works
- ☐ Bar selection → selects order/op (feeds screen-context)
- ☐ Resource/lane selection works
- ☐ Realism visible: lines run to ~21:00 (not idle by 11am); shifts/closures honored
- ☐ Conditions detected + surfaced (tool-wear, line-down, material) where seeded
- ☐ What-if trigger → option-set renders; "See options" works (the fixed bug)
- ☐ Plant switch / version switch clean
- ☐ P: _______________________________________________

### 1.2 — Scorecard
- ☐ Loads; both arms selectable (engine-lift / historical)
- ☐ Engine-lift arm: plan-vs-plan, no OEE (null) — correct
- ☐ Historical arm: execution-vs-execution, has OEE — correct
- ☐ Scope toggle (whole plant / per line) filters correctly
- ☐ Per-KPI rows: OTIF, cost/unit, OEE, late, throughput, churn — values + deltas
- ☐ Cost shows (now a real objective — cost/unit + baseline cost delta visible)
- ☐ Empty/flat state honest (fresh seed = flat lift, shown as such not faked)
- ☐ P: _______________________________________________

### 1.3 — Exception Queue
- ☐ Loads; at-risk orders listed with reasons (material / late / window)
- ☐ Row selection works (the Pass-C addition) — selected highlight
- ☐ At-risk reasons correct + legible (material gate, capacity, precedence)
- ☐ P: _______________________________________________

### 1.4 — Workforce
- ☐ Loads; coverage grid (operator × cert/station) renders
- ☐ Readiness %, cert-gap count, call-in proposals shown
- ☐ Operator row-select works (the Pass-D addition) — selected highlight
- ☐ Coverage framed advisory (gaps = observation, certs soft per C3) — not "blocking"
- ☐ Operator performance visible/consistent (Ana 0.85, Sofía 1.10 effect)
- ☐ P: _______________________________________________

### 1.5 — Master Data / Admin
- ☐ Loads; the config surfaces present
- ☐ Calendars form: shift times, holidays, AND workingDays multi-toggle (admin #1)
- ☐ Resources form: otCapMinutes + Tier-B cost rates (admin #2)
- ☐ Operators form: performanceFactor field (the C5 side-landing)
- ☐ Master-data completeness validation blocks scheduling on missing data (D45)
- ☐ Create/edit/soft-delete work; 403-not-404 ownership holds
- ☐ P: _______________________________________________

### 1.6 — Copilot (functional presence; full walk in Layer 3)
- ☐ Slide-over opens, travels with content (not a separate screen)
- ☐ Renders option-set on evaluate/goal-seek turns; comparison on compare turns
- ☐ Conversations persist (named, ULID, per-turn grounding)
- ☐ Recorded fallback provider path healthy
- ☐ P: _______________________________________________

---

## Layer 2 — Cross-surface coherence (the integration check — only shows in a full walk)

The seams between screens — where features meet.
- ☐ **Board what-if ↔ Scorecard baseline agree** — the lift story coheres across the two surfaces (not just Copilot-never-disagrees; board-to-scorecard too)
- ☐ **Screen-context wire fires end-to-end live** — select order on board → open Copilot → "explain this" → resolves to it (the real session, not the unit test)
- ☐ **The six realism constraints cohere as ONE schedule** — calendar + material + inspection + min-batch + operator-perf + cost all visible together, telling one story, not six disconnected features
- ☐ **Cost-as-objective visible in decisions** — reroute-vs-OT now shows cost nudging the cheaper plan (the C6 behavior, in the actual flow)
- ☐ **Plant switch coherent across ALL surfaces** — board, scorecard, exception, workforce, copilot all re-scope together
- ☐ **Version switch coherent** — committed vs draft, immutability holds
- ☐ **Conditions → exception queue → copilot** — a detected condition shows on board, lists in exception queue, is discussable in copilot — one fact, three surfaces, consistent
- ☐ P: _______________________________________________

---

## Layer 3 — Copilot full conversational walk (one flowing session, not isolated tests)

Exercise the whole surface as a planner would — across topics in one thread. Each should work *and* the thread should hold together.
- ☐ **Type-1 retrieve** — "what's the OTIF?" / "explain this option" → grounded, natural English
- ☐ **Type-2 scenario** — "what if I delay GP-1142 and add 4h OT" → both applied (compound, not silently dropped), option-set renders
- ☐ **Never-silently-drop** — a partially-honorable compound → "Applied X, not Y because Z" (the ledger echo)
- ☐ **Goal-seek (suggest a value)** — "how much OT clears the at-risk on Press A?" → grounded minimal value OR honest "elsewhere"/"not achievable" (note which the seed gives)
- ☐ **Compare (side-by-side)** — "compare these options" → columnar comparison renders, LLM narrates without retyping figures
- ☐ **Content-grounding baseline** — "explain this lift" → grounded, matches scorecard
- ☐ **Content-grounding coverage** — "where are we short?" → grounded, matches workforce
- ☐ **Screen-context named-wins** — order selected, ask about a *different* named order → resolves the named one
- ☐ **Screen-context deictic** — "delay this" with selection → resolves the selection
- ☐ **Entity resolution** — by release reference (GM-830-…) and disambiguation (ambiguous → asks)
- ☐ **Labor boundary** — "assign X to leak-test" → explains coverage, declines to assign
- ☐ **The thread coheres** — switching topics mid-conversation, context carries, no confusion/contradiction
- ☐ P: _______________________________________________

---

## Layer 4 — Native (Expo) pass — everything above, on native

Deferred the whole build. Native has surfaced real bugs before (Tamagui linker, render diffs). Walk Layers 1–3 on native.
- ☐ Board day + **week view** (density is the risk — ~10px/h on a phone)
- ☐ Scorecard (dense KPI grid on narrow viewport)
- ☐ Exception queue + selection
- ☐ Workforce coverage grid (dense matrix on a phone — the real density test)
- ☐ Master-data forms (form inputs on native)
- ☐ **Copilot slide-over on native** — the panel, option-set, comparison table, goal-seek echo all render on a narrow viewport
- ☐ Navigation / plant-switch / version-switch on native
- ☐ Touch interactions (tap-select, drill-down) feel right
- ☐ P (native-specific): _______________________________________________

---

## Layer 5 — Polish (batch, after the walk surfaces items)

Collect all P-flags from Layers 1–4, then fix in batch (shared root causes — one token fix often resolves many).
- ☐ Typography scale consistent (the TYPOGRAPHY-SCALE-NOTE applied uniformly)
- ☐ Spacing / density / alignment consistent across surfaces
- ☐ Two-layer semantic token theming applied uniformly (no hardcoded colors)
- ☐ Loading states (the "Thinking…" feel; skeleton vs spinner)
- ☐ Empty states styled (not just functional)
- ☐ Transitions / interaction feedback (selection, hover, tap)
- ☐ Dense-screen legibility (week view, coverage grid)
- ☐ Copilot polish (message rendering, the rendered tables/echoes, slide-over feel)
- **Collected P-flags:**
  - _______________________________________________
  - _______________________________________________
  - _______________________________________________

---

## Exit criteria (gate to seeding)
- ☐ Layers 0–4 walked, functional bugs fixed
- ☐ Layer 5 polish batch done (or remaining items consciously deferred as non-demo-critical)
- ☐ Cross-surface coherence (Layer 2) holds — the system tells ONE story
- ☐ Native (Layer 4) demo-viable (or consciously web-only for the demo, decided)
- ☐ This checklist is the re-runnable regression pass — re-walk after seeding, again before demo

**Then:** demo seeding (F) on a known-clean, coherent, polished foundation.
