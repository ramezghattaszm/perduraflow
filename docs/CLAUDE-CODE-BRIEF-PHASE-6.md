# Claude Code brief — Phase 6: conversational layer (Q&A + scenario exploration)

| | |
|---|---|
| **Builds on** | Phases 0–5. All prior invariants carry. Sits on: phase-5's **queryable structured rationale** (the Type-1 substrate), the **change-set-general what-if engine** (the Type-2 target), and the **LLM gateway** whose canonical schema was built to accept **tool-use** (phase-5 §5.5). |
| **This session** | A planner **converses** with the system — asks questions answered from stored deterministic data, and explores new scenarios routed to the real engine — grounded, never fabricated, never auto-committing. The demo's differentiator. |
| **Working mode** | Propose-then-confirm. Draft deltas + design choices, **stop for sign-off**, then implement. |

## 0. Mission

"Users understand alternates based on scenarios they create." Two question types, **exhaustive**:

- **Type 1 — explain/analyze already-computed data.** Answer from the **stored deterministic artifact** (the full what-if result: options, factors w/ contributions, constraints w/ slack, comparatives, costed KPIs, placements) — not just the rationale summary. The LLM **retrieves and analyzes** (sort, compare, difference, explain) stored computed facts. **No engine call.** ("Why was Defer recommended?", "what drove Service Now's cost?", "how close was firm-delivery to breaking?", "which option minimizes displacement?")
- **Type 2 — compute something new.** The stored data has no answer → the LLM **constructs a change-set** from the question and **calls the what-if engine** (a tool), then explains the result. The result becomes **new Type-1-able stored data**. ("What if I delay Stellantis and add overtime?")

The cycle: **Type 2 generates** new deterministic data; **Type 1 explores** stored data; a conversation flows between them (create → understand → create).

**Plus an out-of-scope path** (NOT a third type): a question that's neither — off-domain or unanswerable ("what's the weather") → the LLM **declines honestly** ("I can't help with that"), never fabricates. Recognizing the boundary and refusing gracefully is required behavior.

**Scope discipline — LANGUAGE + ORCHESTRATION over phase-5's engine. NO new engine, NO LLM-computed results, NO auto-action, NO conversational-apply (phase 7).** Hold the line.

## 1. Read first
1. Prior briefs (esp. **phase 5** — the rationale schema, the what-if engine, the LLM gateway + canonical/tool schema).
2. `platform-architecture-spec.md` — A19 (narration/translation-only — extends to conversation), A18, A2/A15 (gateway/coordinator), D6 (audit).
3. `production-scheduling-business-functional-spec.md` — D55 (what-if), D2 (reproducible), D26 (human disposes).
4. The phase-5 **stored what-if result** (`what_if_result` jsonb + `StructuredRationale`) — the Type-1 substrate; and the **what-if engine** entry point — the Type-2 tool.
5. The **LLM gateway** — the canonical request/response schema (built to carry tools/history), the provider adapters (anthropic/groq/recorded), the translate-only enforcement.
6. `PHASE-7-NOTE.md` — conversational-apply is explicitly NOT in scope.

## 2. Invariants — prior rules carry, plus these

- **Ground, never fabricate (the safety spine).** In BOTH types the LLM **never produces a scheduling answer from its own reasoning.** Type 1: every cited fact is a **stored computed value** (it reads, it doesn't invent). Type 2: the result comes from the **engine** (the LLM constructs the change-set and calls the engine; it never estimates the result). The forbidden move: answering a scheduling/computation question from the model's own reasoning without retrieving or computing. The LLM reasons about **language, which facts to surface, and what to compute** — never about *what the scheduling answer is*.
- **The engine + rationale-retrieval are TOOLS the LLM calls** through the gateway's **tool-loop** (the agentic loop deferred from phase 5, built here, **in the gateway**, owned — no external framework). Type 2 = LLM emits a tool call (a change-set) → gateway executes against the what-if engine → feeds result back → LLM narrates. Type 1 = a retrieval tool over the stored rationale. The loop is bounded and deterministic where the engine is.
- **Conversations are persistent, named, auditable records** (D6 + future fine-tuning) — NOT ephemeral chat state. ID = **ULID** (codebase convention; time-sortable → turns sort chronologically by id). Each conversation has a **human-referenceable name** (auto-generated from content, user-editable). Each turn records **`groundedRefs`** (which stored result/rationale ids it grounded in — the audit proof of non-fabrication) + tool calls + model/promptVersion.
- **History carries forward — for reference resolution, not as a fact source.** Follow-ups ("what about B?", "why is that worse?", "now add OT to that") resolve against prior turns — but the **facts re-ground in the stored artifact**, freshly, every turn. History says *what we're talking about*; the stored data says *what's true*. (Prevents the long-conversation drift where the LLM misremembers a number and reasons from it.)
- **Conversation constructs and explains; the human applies; the LLM never commits.** Type 2 builds a change-set and the engine evaluates it → the planner sees options → the planner **Applies through the existing board/cockpit guardrail (D26)**. The conversation is the interface to the engine, never an actor on the plan. **Conversational-apply is phase 7.**
- **Translate-only extends to conversation.** The same enforcement as phase-5 narration — prose grounded in structured/computed facts, no invented facts/numbers/factors. Per-turn provenance logged.
- **Determinism where it counts.** The *engine* results are deterministic (D2). The LLM's phrasing varies (it's language), but every *fact* it states is a deterministic stored/computed value. Same change-set → same engine result, however the conversation phrases it.

## 3. The sixth principle — graceful degradation is FIRST-CLASS (live demo)
Unlike phases 4–5, the conversation is **live, interactive, freeform** in front of the customer. So:
- The LLM failing mid-conversation **never breaks anything** — stored results stay visible/usable, the structured data is always there, a failed turn degrades to "I couldn't process that — here's the data" without losing the decision surface.
- The conversational analogue of phase-5's non-blocking narration, **mandatory** given the live setting.
- The **`recorded` provider path** should be able to back a scripted demo conversation as a fallback (like phase-5 narration) — confirm the demo can degrade to a safe path if live Groq misbehaves.

## 4. This session — scope
- **Intent routing** — classify each turn: Type 1 (retrieve from stored result) / Type 2 (construct change-set → engine) / out-of-scope (decline). Deterministic-enough, explainable.
- **The tool-loop in the gateway** — Type-1 retrieval tool over the stored rationale; Type-2 what-if tool (construct change-set → `what-if` engine → result). Gateway owns the loop, retries, history. Built on the canonical/tool schema from phase 5.
- **Change-set construction** — translate a natural-language scenario ("delay Stellantis and add OT") into the structured `ChangeSet` the engine accepts (reuse phase-5's change-set types). Compound change-sets allowed (this is the open-exploration the engine was built change-set-general for).
- **Conversation persistence** — `conversation` (ULID, name, tenant, plant?, createdBy/At, status) + `conversation_turn` (ULID, role, content, groundedRefs, toolCalls, model/promptVersion). Tenant-scoped, strict isolation.
- **The conversation UI** — a chat surface that streams responses (SSE — the gateway/provider streams; no WebSocket), shows the grounded structured data alongside the prose (the source of truth always visible, like narration), and links Type-2 results into the existing option-set/Apply components (so "Apply" goes through the normal guardrail).
- **Out-of-scope handling** — honest decline for non-Type-1/2 questions.

**Forward-hooks (Phase 7 — name, build nothing):** conversational-apply (apply an explored scenario via the conversation, with explicit confirm preserving D26) — do NOT build; the stored conversation + grounded result is its substrate.

**Out of scope:** conversational-apply / auto-action (P7), new engine capability, LLM-computed results, WebSocket, real-time invalidation push (deferred follow-up), the optimizer (post-demo).

## 5. Items to propose (genuine design choices)
- **Intent routing mechanism** — how a turn is classified Type-1 / Type-2 / out-of-scope. (LLM-classified with a constrained prompt? a tool the LLM chooses? a hybrid?) Must be reliable and explainable; mis-routing a Type-2 as Type-1 would fabricate. **This is the most important choice — it's the ground-vs-compute decision.**
- **The Type-1 retrieval surface** — what queries over the stored rationale the retrieval tool supports (by option, factor, constraint, comparative; sort/compare/difference). Rich enough to answer unanticipated Type-1 questions from the stored artifact.
- **Change-set construction from language** — how natural-language scenarios map to `ChangeSet`; how ambiguity is handled (ask to clarify vs. best-effort); how an unconstructable request is declined.
- **The tool-loop** — turn limits, retry/error handling, how tool results feed back, history-trimming.
- **Conversation naming** — auto-generation (from first meaningful turn / content), editable.
- **The chat UI** — streaming, structured-data-alongside-prose, linking Type-2 results to the Apply components, graceful-degradation states.

## 6. Definition of done — Phase 6
- `bun run check` green; API builds/boots; `next build` + Expo render.
- **Proofs:**
  1. **Type 1 — explain from stored data.** "Why was Defer recommended?" / "what drove the cost?" answered from the stored result, **no engine call**, every fact traceable to the stored artifact.
  2. **Type 1 — analyze stored data.** A question requiring sorting/comparing/differencing stored options ("which option minimizes displacement?", "how close was firm-delivery to breaking?") answered correctly from stored values.
  3. **Type 2 — construct + route.** "What if I delay Stellantis and add overtime?" → a `ChangeSet` is constructed → the **what-if engine** is called → the result is explained; the result is now stored and Type-1-able.
  4. **Ground-never-fabricate.** Demonstrate every factual claim (both types) traces to a stored value or an engine result — `groundedRefs` records it. A question the LLM can't ground → it declines, doesn't invent.
  5. **Out-of-scope decline.** An off-domain/unanswerable question is declined honestly, no fabrication.
  6. **History carries forward.** A follow-up ("why is that worse?") correctly resolves the reference from prior turns AND re-grounds the facts in the stored artifact (not chat memory) — show a number staying correct across a multi-turn thread.
  7. **Human applies, LLM never commits.** A Type-2 scenario → options → Apply goes through the existing board/cockpit guardrail (D26); the conversation never commits.
  8. **Persistence + provenance.** Conversation stored (ULID, name, turns with groundedRefs/model/promptVersion); retrievable by id, findable by name; tenant-isolated.
  9. **Graceful degradation.** LLM failure mid-conversation degrades to "couldn't process — here's the data", decision surface intact; (and a `recorded`/safe path can back a scripted demo).
  10. **Determinism of facts.** The same Type-2 change-set yields the same engine result regardless of conversational phrasing.
- **Browser-verified (web + native):** a full conversation — explain current options (T1) → analyze them (T1) → propose a new scenario (T2 → engine → options) → follow-up on the new result (T1) → Apply via the guardrail; structured data visible alongside prose throughout; graceful on a forced LLM failure.
- Forward-hook present (conversational-apply substrate) — **not built.**
- Docs updated; completion log. **After this, the demo is feature-complete** (engine 0–5 + conversational differentiator 6). Remaining = realism batch (shifts first) + staging. Stop at this checkpoint.

---

*Phase 7 (conversational apply — act on an explored scenario via the conversation, with explicit confirm preserving D26) is the next trust increment, deferred. The pattern: P4 confidence-gated params → P5 what-if/explain → P6 conversational exploration → P7 conversational action.*
