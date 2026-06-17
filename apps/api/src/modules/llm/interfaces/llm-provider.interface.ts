import type { LlmRequest, LlmResponse } from '../llm.canonical'

/**
 * The **thin translator adapter** contract (phase 5). An adapter does **only
 * translation**: canonical {@link LlmRequest} → provider wire format → make the call
 * → provider response → canonical {@link LlmResponse}. **Nothing else.** It is
 * **stateless and dumb** — no retries, no backoff, no error policy, no provider
 * selection, no history/tool-loop. All of that is the gateway's, written once and
 * inherited by every provider. Adding a provider is a new adapter implementing this
 * interface; the gateway, the `llm.gateway` contract, and consumers don't change.
 *
 * The adapter receives its {@link ResolvedProviderConfig} **per call** (base URL,
 * model, key, headers, wire format) — config is **data**, never baked into adapter
 * code. The adapter stays stateless; the gateway owns config resolution + selection.
 */
export const LLM_ADAPTERS = Symbol('LLM_ADAPTERS')

/** A provider's wire-format family the adapter down-converts to. */
export type WireFormat = 'anthropic' | 'openai' | 'recorded'

/**
 * Fully-resolved per-call provider config (preset + env). All provider-specific
 * concerns live here as **data**, not in adapter code.
 */
export interface ResolvedProviderConfig {
  /** Provider tag (e.g. `anthropic`, `groq`, `recorded`) — also the response provenance. */
  provider: string
  /** Endpoint (empty for `recorded`). */
  baseUrl: string
  /** Concrete model id (env override, else preset default). */
  model: string
  /** Wire format the adapter maps to. */
  format: WireFormat
  /** API key (null when none / not configured). Auth method is the adapter's concern. */
  apiKey: string | null
  /** Static headers from the preset (e.g. `anthropic-version`). */
  headers: Record<string, string>
}

/** Normalized failure kinds the gateway classifies for its retry/error policy. */
export type LlmErrorKind = 'transient' | 'auth' | 'invalid' | 'unsupported' | 'unknown'

/**
 * The error adapters throw — normalized so the **gateway** (not the adapter) owns the
 * retry/backoff/error policy. `transient` (network / 5xx / 429) is retried; the rest
 * are surfaced. Adapters classify; they never retry.
 */
export class LlmProviderError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'LlmProviderError'
  }
}

/** The thin translator adapter — canonical in, provider call, canonical out. */
export interface LlmProviderAdapter {
  /** Stable tag for selection/registry (`anthropic` | `groq` | `recorded`). */
  readonly name: string
  /**
   * Translate + call. **Translation only.** May throw {@link LlmProviderError}; the
   * gateway decides whether to retry or surface. No retries/backoff/selection here.
   */
  complete(req: LlmRequest, config: ResolvedProviderConfig): Promise<LlmResponse>
}
