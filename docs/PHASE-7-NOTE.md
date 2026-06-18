# Phase 7 (future) — conversational apply

> Captured during phase-6 planning. **Deferred. Not phase 6.**

## What
The conversation can **apply** a scenario the planner explored conversationally — "yes, do that one" → the explored what-if gets applied. In phase 6 the conversation *constructs and explains* scenarios but never commits; applying is a separate deliberate human action through the existing guardrail (board/cockpit Apply). Phase 7 lets the planner apply *through the conversation*.

## Why it's phase 7, not phase 6
It's a real escalation in what the AI is trusted to do — moving the conversation from the *exploration* path into the *commit* path. Phase 6's safety story depends on "the conversation never commits" (it's an interface to the engine, not an actor on the plan); that clean boundary is what makes it safe to demo. Apply-via-conversation deserves its own deliberate design:
- **Preserve D26 (human disposes)** — conversational apply still needs an explicit confirm ("Apply the Stellantis-delay scenario? confirm") so the human disposes, just through the conversational surface.
- **Extend the audit trail** — "applied via conversation, confirmed by user X," linking the conversation record to a committed plan change (deepens D6).
- **Compose the guardrails** — confidence×tier (P4) + human-apply (P5) + conversational-apply must compose coherently.

## The trust-increment pattern
Each phase earns one increment: P4 confidence-gated parameter autonomy → P5 what-if/baseline/explanation → P6 conversational *exploration* → **P7 conversational *action*** (AI acts on the plan, with confirmation, based on the conversation). P7 comes after the conversation layer has proven itself, with its own confirmation/audit discipline — not bundled into the conversation's first version.
