# Bar detail — separate operation-level from resource-level (rewrite)

| | |
|---|---|
| **Target** | `BarDetailSheet` / `LearnedParamPanel` (op detail) + a resource/line-level surface for wear & prediction |
| **Type** | Restructure, not just relabel. The panel currently **conflates the operation with the whole line**, and the last change **wrongly removed** the tool-wear warning and the performance metrics. |
| **Root cause** | Tool wear + the wear prediction are **resource-level** facts (about Press Line A across its day). They were placed inside an **operation** panel, making "this op's cycle (0.3→0.32)" read as if the *operation* crosses the wear line. And "has a prediction" was conflated with "has no actuals", so performance metrics were dropped. |

## The model — two surfaces, two subjects

### A. Operation panel (click a bar) — OPERATION-LEVEL ONLY
Shows *this operation's* facts:
- Identity: op · resource · scheduled start–end · setup · run · source.
- **This op's cycle** — measured value (e.g. 0.3→0.32) **when actuals exist**, with measured vocabulary.
- **Performance — planned vs actual (RESTORE THIS).** Show whenever the op **has actuals**, independent of any prediction: cycle planned→actual, run planned→actual, good/scrap. The last change removed it by conflating "predicted" with "no actuals" — they're independent. **Rule: performance shows when actuals exist, period.**
- **No** wear prediction, **no** wear proximity bar, **no** prediction-confidence here — those are line-level (Surface B). The op panel may carry a small "Press Line A predicted wear → see line" pointer, but not the prediction itself.

### B. Resource / line surface (click the lane, or a wear flag on the line) — RESOURCE-LEVEL ONLY
Owns the *line's* wear & forecast as **aggregated impact — NOT raw per-op numbers.**

**CRITICAL: do NOT show `0.3→0.32` (or any single op's cycle step) on the line.** That number is one operation's measurement — it belongs on the **job panel** (Surface A, performance). The line **synthesizes the consequence**, it does not repeat an operation's cycle. The job *measures*; the line *shows what it means*.

- **Tool-wear warning (RESTORE — D56).** "Cycle drift on Press Line A crossed threshold — flagged · re-sequenced to protect downstream." The honest "this is happening" signal; line/tool fact.
- **Wear prediction** — "Press Line A predicted to cross the wear line in 3.8h (~05:31)" — resource-level settled statement.
- **Wear proximity track** — horizontal track: std (left) → **wear-line notch** (sharp vertical tick, +5%) → current wear level as the **rounded amber fill** approaching it. "How worn" = how close to the line. (Aggregate wear level, not a single op's two numbers.)
- **Confidence** — attaches to the **prediction**. Distinct from the proximity track: a **labeled ring** ("53%" inside, "Confidence" beneath). **The ring must have a VISIBLE stroke** — use an accent/ml-violet token for the ring stroke against the surface; do not draw it in a colour that matches the background (an invisible ring is the current bug — either the stroke colour matches the surface, or the ring shape was never built and only the number renders). Confirm which and fix: visible circular stroke + centered %, label beneath.
- **Overall impact (the line's real job) —** synthesized consequence: "**N downstream op(s) affected** · kept fed by the pre-emptive adjustment", "**Maintenance recommended**". This is what the line answers — *what does the wear mean for my line* — not the raw cycle of one operation. (Quantified $/late-order impact + costed solutions = Phase 5.)

**The division in one line:** the **job** shows the cycle change (`0.3→0.32`, in performance); the **line** shows the overall impact (prediction + how-worn + downstream consequence + maintenance). No raw per-op cycle numbers on the line.

## Why this resolves the confusion
- The raw cycle step (`0.3→0.32`) lives **only on the job** (it's one op's measurement); the **line shows the synthesized impact** (prediction + how-worn + downstream + maintenance). The job measures, the line means. No duplicated per-op number on the line.
- Two similar bars disappear: proximity (line, horizontal bar) vs confidence (line, labeled ring) are now visually and locationally distinct — and the ring is actually visible.
- The tool-wear warning and performance metrics come back, each on the correct surface.

## Provenance vocabulary (keep from prior fix)
- **`ml_predicted` (forecast):** "Predicted from trend" · no "settled" · no planned-vs-actual. (Lives on Surface B.)
- **`ml_adjusted` (measured):** "Learned from N actuals · settled" + performance. (Op panel, when actuals exist.)
- **`standard`:** standard times + "no learned adjustment yet — N actuals, adopts at K".

## Other fixes (carry over)
- **Horizon vs absolute time reconcile** — "3.8h" and "~05:31" from one origin, or show one.
- **Drop redundant chips** — once the proximity track shows "+5% vs std" spatially, drop the separate "+5% vs std" chip (it's said twice).
- **Layout bug** — the web panel/card is pinned to the viewport bottom (`100vh`/`flex:1` against the viewport). Size to content with internal scroll; don't pin to the window.
- Type per the board type map; semantic colour for status only; settled, no ticker; no hardcoding (provenance/confidence/performance from rows).

## Done when
- Op panel shows operation facts + performance-vs-actual **whenever actuals exist** (restored, includes the `0.3→0.32` cycle change), and carries **no** line-level wear/prediction/confidence (at most a pointer to the line).
- Line/resource surface shows the **tool-wear warning** (restored), the wear prediction, the proximity track (rounded fill + sharp wear-line notch), confidence as a **visible labeled ring**, and the **aggregated impact** (N downstream affected + maintenance recommended) — and **no raw per-op cycle numbers** (no `0.3→0.32` on the line).
- The confidence ring renders with a visible stroke (not background-coloured / not number-only).
- The op-vs-line split is clean (job measures, line means); horizon/time reconcile; redundant chips dropped; panel sizes to content.
- Verified web + native, both themes.
