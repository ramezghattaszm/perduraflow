# Conversation — decide-support capabilities (goal-seek + structured comparison)

> Two capabilities central to the vision "the chat helps me decide": **suggest a value** (goal-seek) and **side-by-side comparison**. The investigation found neither fabricates *today*, but both have structural holes that will leak: suggest-a-value has a **latent guess hole** + is fragile (one phrasing 400s), and side-by-side is an **LLM-transcribed** table (a mis-copy surface on grounded data). Both fixes follow the established discipline: **grounded-by-construction** and **render-don't-retype**.
>
> Build order: **#1 goal-seek first** (higher-stakes — it's where grounding could slip). Design both, stop for review.

---

## #1 — Goal-seek (suggest a value) — THE GROUNDING-CRITICAL BUILD

### The problem (from the investigation)
- `evaluate_what_if` is **single-shot** — takes a concrete value, returns one result. There is **no grounded value-search** (no tool that, given a lever + a goal, finds the value that achieves it).
- Today the model improvises: deflects, or ad-hoc iterates `evaluate` (capped by `maxTurns=4`, doesn't converge, and one phrasing **400'd** by exhausting the turn budget then the gateway's no-tools final pass rejecting a tool call).
- **Latent guess hole:** the grounding guard only fires when `toolCalls.length === 0`. A turn that calls a tool **and then appends an ungrounded "I'd suggest ~4h" in prose** is NOT caught. Not active today, but structural.

### The fix — a deterministic goal-seek tool (grounded by construction)
A new tool that searches *server-side* (one tool call, internal iteration) so the value is always engine-derived, never the model's.

**Tool shape (propose exact name/params):**
```
goal_seek (a.k.a. find_value) — find the value of a lever that achieves a goal.
The ENGINE searches (the model never picks the value). Returns the grounded minimal
value that achieves the goal, or "no value within bounds achieves it."
params: {
  lever:  { kind: 'overtime', resourceId } | { kind: 'demand_qty', demandLineId } | …
  goal:   'clear_at_risk' | { kind: 'hit_due_date', demandLineId, by } | …
  // bounds come from config (OT cap, qty limits) — not params
}
```

**Mechanism:**
- The engine **binary-searches** the lever over its valid range, calling the existing `evaluate` internally for each candidate, converging to the **minimal value** that achieves the goal (you want the least OT that clears it, not "some OT that works").
- Runs **inside the tool** (server-side iteration in one dispatch call) — NOT the LLM burning conversation turns. This removes the `maxTurns` fragility (the GP-1142 400) entirely.
- **Bounded with an honest "can't":** the search range comes from config (OT cap per resource/day, quantity limits). If no value within bounds achieves the goal → return `"no value within bounds achieves it"` (e.g. "even the max 4h OT doesn't clear it"). The boundary is grounded — never a fabricated "try 50h" outside what's possible.
- **Returns the grounded result:** the minimal achieving value + the resulting plan/KPIs (so the answer is "4h of OT clears it — here's the resulting schedule"). The value AND its effect are both engine-derived.

**Grounding (the whole point):**
- The value is **tool-derived by construction** — the engine produced it; the LLM reports it. A value-suggestion can no longer be the model's guess because the *tool* computes it.
- **Close the guard hole regardless:** a turn asserting a *suggested scheduling value* must have it traceable to a tool result, not merely "a tool was called." At minimum: the prompt forbids appending a suggested value that didn't come from a tool; routing sends value-suggestion questions to `goal_seek` (which grounds them). Consider whether the guard can check that an asserted numeric value appears in a tool result (harder, but the structural close).
- **Routing:** "how much OT to clear it / what quantity clears GP-1142 / add OT until it clears" → `goal_seek`. Distinguish from single-shot evaluate ("add 4h OT" = evaluate a given value; "how much OT do I need" = goal-seek for the value).

**Determinism (D2):** binary search over a deterministic engine is deterministic — same goal + lever + bounds → same value. Pure.

**Verification:**
- "How much OT clears the at-risk on Press A?" → `goal_seek` → grounded minimal value + resulting plan; the value matches an independent `evaluate` at that value (it actually clears it) and `evaluate` at value−1 step (it doesn't — confirms minimal).
- "What quantity clears GP-1142?" → converges (no 400, no turn-budget exhaustion).
- **Unachievable goal** → honest "no value within bounds achieves it" (e.g. cap reached), never a fabricated out-of-bounds value.
- **No ungrounded guess:** a value-suggestion answer always carries the goal-seek tool call; no suggested value appears without a tool result behind it.
- Determinism: same query → same value.

---

## #2 — Structured comparison (side-by-side) — PRESENTATION INTEGRITY

### The problem (from the investigation)
- "Compare side by side" → the LLM renders a **markdown table by transcribing** numbers from the grounded artifact into prose. Accurate in the sample, but a **transcription surface** — a mis-copied figure is possible even though the *source* is grounded.
- `WhatIfOptionSet` renders **stacked individual cards** (vertical, one per option), not a columnar options×KPIs comparison — and only on **evaluate** turns, not on a **compare** (retrieve) turn.
- Same class as the echo fix: **a grounded number retyped by an LLM is no longer guaranteed grounded.**

### The fix — a structured comparison artifact, rendered deterministically
- A **comparison artifact** rendered from the what-if result — **options × KPIs/factors, columnar** (rank / feasibility / OTIF / late / throughput / cost / changeovers / displacement), like `TurnOptionSet` renders the option-set deterministically.
- **Render-don't-retype:** the table's numbers come from the structured artifact directly — the LLM does **not** retype them. The LLM **narrates the trade-off** ("Option A is cheaper but finishes later; B protects delivery at higher cost") *around* the rendered table. Same division as the echo: structured data rendered faithfully + LLM voices the meaning.
- **Appears on compare turns** — when the user asks to compare (a retrieve turn over the active result), the comparison artifact renders (today the cards only appear on evaluate turns). So "compare these side by side" produces the rendered comparison, not a transcribed one.
- Uses the **precomputed comparatives** (the "why not B" substrate from Pass A / phase-5) — the relative data already exists; this presents it.

**Verification:**
- "Compare these options side by side" → a structured columnar comparison renders (options × KPIs), numbers identical to the artifact (no transcription — assert the rendered values equal the result's values).
- The LLM narration accompanies it (the trade-off in words) without retyping the figures.
- Renders on a compare/retrieve turn (not only evaluate).

---

## Why these matter (the vision)
Retrieve (Type-1) is *information*; evaluate (Type-2) is *scenarios*. **Goal-seek and side-by-side are decide-support** — "help me choose": suggest the value that achieves my goal, and show me the options' impacts comparably. That's the difference between "a chat that answers questions about the schedule" and "a chat that helps me make the decision" — the stronger differentiator, and the stated vision.

Both close real holes (the latent guess hole; the transcription surface) and both follow the discipline that's held throughout: **grounded-by-construction** (the engine produces values/comparisons; the LLM reports/narrates, never produces) and **render-don't-retype** (structured data displayed faithfully; the LLM voices meaning around it).

## Out of scope
- The LLM ever *picking* a value (only the engine searches).
- Any action/commit (goal-seek and compare are read/evaluate + explain; human still applies via the guardrail).
- The rename (last).
