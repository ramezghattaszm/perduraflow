import { createHash } from 'node:crypto'
import { Inject, Injectable, Logger } from '@nestjs/common'
import {
  LLM_GATEWAY_CONTRACT,
  type LlmGatewayContract,
  type NarrationInput,
  type NarrationResult,
} from '@perduraflow/contracts'
import { env } from '../../config/env'
import type { LlmContentPart, LlmMessage, LlmRequest, LlmResponse, LlmTool, LlmToolCall } from './llm.canonical'
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
  'You explain a deterministic scheduler\'s decision to a production planner, in plain language.',
  'You are given a HEADLINE (the chosen option and its KPIs) and FACTS: a per-factor breakdown',
  "(each factor's value and how much it adds to the option's score), binding constraints, and how",
  'the option compares to the alternatives (with the deciding factor).',
  '',
  'Write 2–4 sentences that explain the TRADE-OFF, like a planner\'s note:',
  '- what this option prioritises (the factors it keeps low or at zero),',
  '- what it gives up (the factors it accepts as higher), and',
  '- why it beats the alternatives (name the deciding factor from the comparison).',
  '',
  'Strict rules (translate-only):',
  '- Use ONLY the supplied facts. Introduce no fact, number, cause, factor, or option not given.',
  '- You MAY characterise relative size from the given contributions — e.g. call the largest',
  '  contributor the main driver, or a zero/near-zero factor negligible — but invent no new number.',
  '- Do not re-rank or re-decide; the engine already chose. Keep every number exactly as given.',
  '- Specific and neutral, flowing prose. No preamble, no bullet lists, no "as an AI".',
].join('\n')

/**
 * The recorded prompt version (D6 audit) — the human-readable env label plus a
 * **fingerprint of the actual prompt text** (`sha256(SYSTEM_PROMPT)`). Deriving the
 * hash means any edit to the prompt automatically changes the recorded version, so
 * the audit can never silently drift from the prompt that produced a narration. The
 * env label stays for readability; the hash is the tamper-evidence. (Per-tenant /
 * DB-stored prompts are Phase 6.)
 */
/** `<env label>-<sha256(prompt)[:8]>` — fingerprints the actual prompt so the D6 audit can't drift. */
export function promptFingerprint(prompt: string): string {
  return `${env.LLM_PROMPT_VERSION}-${createHash('sha256').update(prompt).digest('hex').slice(0, 8)}`
}
const PROMPT_VERSION = promptFingerprint(SYSTEM_PROMPT)

/** A tool handler the conversation layer supplies; returns text + the ids it grounded in. */
export interface ToolDispatchResult {
  content: string
  groundedRefs?: string[]
  /** A new what-if result id this tool produced (Type-2) — surfaced to the caller. */
  resultId?: string
  isError?: boolean
}
export type ToolDispatch = (call: LlmToolCall) => Promise<ToolDispatchResult>

/** Input to the agentic tool-loop (the consumer supplies the domain prompt + tools). */
export interface ToolLoopInput {
  system: string
  messages: LlmMessage[]
  tools: LlmTool[]
  maxTokens?: number
}

/** The tool-loop outcome — final prose + the audit trail (route + grounding + provenance). */
export interface ToolLoopResult {
  text: string
  toolCalls: LlmToolCall[]
  groundedRefs: string[]
  resultIds: string[]
  model: string
  provider: string
  promptVersion: string
}

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
      params: { maxTokens: 512, temperature: 0 },
      metadata: { surface: 'narration', mode: input.mode, promptVersion: PROMPT_VERSION },
    }
    const res = await this.complete(req, config)
    return {
      prose: res.text.trim(),
      model: res.model,
      promptVersion: PROMPT_VERSION,
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

  /**
   * The **agentic tool-loop** (phase 6) — owned here, no external framework. The
   * consumer supplies a domain `system` prompt + `tools` and a `dispatch` that
   * executes a tool call (the gateway stays domain-agnostic). The loop: `complete`
   * → if the model emits tool calls, `dispatch` each, feed the results back, repeat
   * → until the model answers (no tool call) or `maxTurns` is hit. A tool error is
   * fed back (so the model self-corrects); a provider failure propagates (the caller
   * degrades). Returns the final prose + the audit trail (tool route, groundedRefs,
   * any produced result ids, model/promptVersion).
   */
  async runToolLoop(input: ToolLoopInput, dispatch: ToolDispatch, maxTurns = 4): Promise<ToolLoopResult> {
    const promptVersion = promptFingerprint(input.system)
    const messages: LlmMessage[] = [...input.messages]
    const toolCalls: LlmToolCall[] = []
    const grounded = new Set<string>()
    const resultIds = new Set<string>()
    const params = { maxTokens: input.maxTokens ?? 700, temperature: 0 }

    for (let turn = 0; turn < maxTurns; turn++) {
      const res = await this.complete({ system: input.system, messages, tools: input.tools, toolChoice: 'auto', params })
      if (res.stopReason !== 'tool_use' || res.toolCalls.length === 0) {
        return { text: res.text.trim(), toolCalls, groundedRefs: [...grounded], resultIds: [...resultIds], model: res.model, provider: res.providerName, promptVersion }
      }
      messages.push({ role: 'assistant', content: res.content })
      const results: LlmContentPart[] = []
      for (const call of res.toolCalls) {
        toolCalls.push(call)
        const r = await dispatch(call)
        r.groundedRefs?.forEach((x) => grounded.add(x))
        if (r.resultId) resultIds.add(r.resultId)
        results.push({ type: 'tool_result', toolUseId: call.id, content: r.content, isError: r.isError })
      }
      messages.push({ role: 'tool', content: results })
    }
    // Turn budget hit — one final summarizing pass with no tools so the model answers.
    const final = await this.complete({ system: input.system, messages, params })
    return { text: final.text.trim(), toolCalls, groundedRefs: [...grounded], resultIds: [...resultIds], model: final.model, provider: final.providerName, promptVersion }
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
