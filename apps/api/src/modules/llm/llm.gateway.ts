import { Inject, Injectable, Logger } from '@nestjs/common'
import {
  LLM_GATEWAY_CONTRACT,
  type LlmGatewayContract,
  type NarrationInput,
  type NarrationResult,
} from '@perduraflow/contracts'
import { env } from '../../config/env'
import type { LlmRequest, LlmResponse } from './llm.canonical'
import {
  LLM_ADAPTERS,
  LlmProviderError,
  type LlmProviderAdapter,
  type ResolvedProviderConfig,
} from './interfaces/llm-provider.interface'
import { PROVIDER_PRESETS } from './providers/presets'

/**
 * The translate-only system prompt (A19) — **provider-neutral**, owned by the
 * gateway, never an adapter. It hard-bounds the model to re-voicing the supplied
 * facts: no new facts/numbers, no ranking/deciding/recommending. Pinned via
 * `LLM_PROMPT_VERSION` for the D6 audit.
 */
const SYSTEM_PROMPT = [
  'You are a translation surface for a deterministic manufacturing scheduler.',
  'You are given a HEADLINE and a list of FACTS that the engine already computed.',
  'Rewrite them into one short, plain-language paragraph for a planner.',
  'Strict rules:',
  '- Use ONLY the facts provided. Introduce no new fact, number, cause, or recommendation.',
  '- Do not rank, decide, or compute. The engine already decided; you only explain.',
  '- Keep every number exactly as given. Do not round or infer.',
  '- Be concise and neutral. No preamble, no "as an AI", no bullet points.',
].join('\n')

/** Retry policy for transient provider failures (gateway-owned, inherited by all adapters). */
const MAX_ATTEMPTS = 3
const BASE_BACKOFF_MS = 200

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * The **smart gateway** (A19/A15) — the stateful, smart half of the LLM surface.
 * Adapters are thin/dumb translators; the gateway owns **everything else, written
 * once and inherited by every provider**: provider **selection**, **config
 * resolution** (preset + env), **retries + backoff**, **error classification**, the
 * provider-neutral **translate-only prompt**, and the **single-shot call seam**
 * ({@link complete}) that the phase-6 tool-call loop will wrap (no adapter reshaping).
 *
 * The structured rationale stays the source of truth; this only verbalises the facts
 * the consumer resolved from it. Phase-5 narration is single-shot — no tools, no loop.
 */
@Injectable()
export class LlmGateway implements LlmGatewayContract {
  readonly contract = LLM_GATEWAY_CONTRACT
  private readonly logger = new Logger('LlmGateway')
  private readonly adapters: Map<string, LlmProviderAdapter>

  constructor(@Inject(LLM_ADAPTERS) adapters: LlmProviderAdapter[]) {
    this.adapters = new Map(adapters.map((a) => [a.name, a]))
  }

  /**
   * Render the supplied facts into prose — single-shot, translate-only. Builds a
   * canonical request (translate-only system prompt + the resolved headline/facts)
   * and runs it through {@link complete}.
   * @throws on provider failure (after retries) — the caller maps it to NARRATION_UNAVAILABLE.
   */
  async narrate(input: NarrationInput): Promise<NarrationResult> {
    const userContent = [input.headline, ...input.facts.map((f) => `- ${f}`)].join('\n')
    const config = this.resolveConfig()
    const req: LlmRequest = {
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
      params: { maxTokens: 320, temperature: 0 },
      metadata: { surface: 'narration', mode: input.mode, promptVersion: env.LLM_PROMPT_VERSION },
    }
    const res = await this.complete(req, config)
    return {
      prose: res.text.trim(),
      model: res.model,
      promptVersion: env.LLM_PROMPT_VERSION,
      provider: res.providerName,
    }
  }

  /**
   * The orchestrated **single-shot** model call — selection + retries/backoff +
   * error policy, provider-neutral. **This is the phase-6 seam**: the agentic
   * tool-call loop will call `complete` repeatedly (dispatching `response.toolCalls`,
   * appending results to `req.messages`) until `stopReason !== 'tool_use'`. The loop
   * is **not built** in phase 5 — only this single call.
   */
  async complete(req: LlmRequest, config?: ResolvedProviderConfig): Promise<LlmResponse> {
    const cfg = config ?? this.resolveConfig()
    const adapter = this.adapters.get(cfg.provider)
    if (!adapter) throw new LlmProviderError('invalid', `No adapter for provider '${cfg.provider}'`)
    return this.callWithRetry(adapter, req, cfg)
  }

  /** Resolve the active provider's config: preset (data) + env (active provider/model/key). */
  resolveConfig(): ResolvedProviderConfig {
    const provider = env.LLM_PROVIDER
    const preset = PROVIDER_PRESETS[provider] ?? PROVIDER_PRESETS.recorded!
    const apiKey = preset.apiKeyEnv ? (process.env[preset.apiKeyEnv] ?? null) : null
    return {
      provider,
      baseUrl: preset.baseUrl,
      model: env.LLM_MODEL ?? preset.defaultModel, // env overrides the preset default
      format: preset.format,
      apiKey,
      headers: preset.headers,
    }
  }

  /** Retry transient failures with exponential backoff + jitter; surface the rest. */
  private async callWithRetry(adapter: LlmProviderAdapter, req: LlmRequest, config: ResolvedProviderConfig): Promise<LlmResponse> {
    let lastErr: unknown
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        return await adapter.complete(req, config)
      } catch (err) {
        lastErr = err
        const transient = err instanceof LlmProviderError && err.kind === 'transient'
        if (!transient || attempt === MAX_ATTEMPTS - 1) throw err
        const delay = BASE_BACKOFF_MS * 2 ** attempt + Math.floor(Math.random() * BASE_BACKOFF_MS)
        this.logger.warn(`provider '${config.provider}' transient failure (attempt ${attempt + 1}/${MAX_ATTEMPTS}), retrying in ${delay}ms`)
        await sleep(delay)
      }
    }
    throw lastErr
  }
}

/** DI token for consumers that inject the gateway by its contract interface. */
export const LLM_GATEWAY = Symbol('LLM_GATEWAY')
