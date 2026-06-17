/**
 * LLM gateway contract (phase 5 — A19/A15). The platform's **narration surface**:
 * a kernel coordinator that renders an **already-computed structured rationale**
 * into plain language. **Translation only** — it never computes, ranks, decides,
 * or invents a fact. The deterministic engine produces the rationale; the gateway
 * only re-voices it. Any module that emits structured rationale can consume it.
 *
 * The translate-only guarantee is enforced at the boundary: the consumer resolves
 * the structured rationale into an ordered set of **fact lines** (the ONLY
 * admissible facts) and a headline; the gateway's prose may use nothing else. A
 * provider sits behind the interface (A2): `recorded` (deterministic replay) or
 * `anthropic` (a real model API), selected by env — no consumer change.
 */

export const LLM_GATEWAY_CONTRACT = { id: 'llm.gateway', version: '1.0' } as const

/** Narration scope: one option's rationale, or an across-options summary. */
export type NarrationMode = 'option' | 'across_options'

/**
 * The narration request — **structured facts in**. `facts` is the closed set of
 * admissible statements (already i18n-resolved from the rationale's detail keys);
 * the gateway must produce prose that introduces **no fact outside this set**
 * (the A19 boundary; DoD proof #5). The headline is the lead the prose opens with.
 */
export interface NarrationInput {
  mode: NarrationMode
  /** The resolved headline the prose should lead with. */
  headline: string
  /** The ordered, i18n-resolved fact lines — the ONLY admissible facts (translate-only). */
  facts: string[]
  /** BCP-47 locale for the prose; defaults to 'en'. */
  locale?: string
}

/**
 * The translate-only narration result — prose plus the provenance needed for the
 * D6 audit (pinned model + prompt version + provider). Never carries a new fact.
 */
export interface NarrationResult {
  prose: string
  /** The model id that produced the prose (or the recorded provider tag). */
  model: string
  /** The pinned prompt version (audit + reproducibility). */
  promptVersion: string
  /** Which provider answered (`recorded` | `anthropic`). */
  provider: string
}

/** The platform narration gateway (A19) — structured rationale in, prose out, no reasoning. */
export interface LlmGatewayContract {
  readonly contract: typeof LLM_GATEWAY_CONTRACT
  /**
   * Render the supplied facts into prose. **Translation only** — adds no fact not
   * in `input.facts`. A provider failure must surface as a thrown error the caller
   * maps to NARRATION_UNAVAILABLE (narration is never in the commit path).
   */
  narrate(input: NarrationInput): Promise<NarrationResult>
}
