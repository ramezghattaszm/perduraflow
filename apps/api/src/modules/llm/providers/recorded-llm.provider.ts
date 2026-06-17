import { Injectable } from '@nestjs/common'
import { contentToText, type LlmRequest, type LlmResponse } from '../llm.canonical'
import type { LlmProviderAdapter, ResolvedProviderConfig } from '../interfaces/llm-provider.interface'

/**
 * The `recorded` adapter — the default. **Deterministic replay**: it composes prose
 * purely by stitching the facts the gateway already placed in the user message,
 * calling out to nothing. Two roles: the offline/demo/test default (no network, same
 * input → same prose), and the **provable** translate-only baseline (it can only
 * re-voice the supplied facts, so every sentence traces to a fact by construction —
 * DoD proof #5).
 *
 * Like every adapter it is a **thin translator**: canonical request in → (no network)
 * → canonical response out. It honours the same interface so swapping to a real
 * provider is config, not code.
 */
@Injectable()
export class RecordedLlmProvider implements LlmProviderAdapter {
  readonly name = 'recorded'

  async complete(req: LlmRequest, config: ResolvedProviderConfig): Promise<LlmResponse> {
    const userMsg = [...req.messages].reverse().find((m) => m.role === 'user')
    const content = userMsg ? contentToText(userMsg.content) : ''
    const lines = content.split('\n').map((l) => l.trim()).filter(Boolean)
    const headline = lines.find((l) => !l.startsWith('- ')) ?? ''
    const facts = lines.filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim())
    const prose = [headline, facts.join(' ')].filter(Boolean).join(' ')
    return {
      content: [{ type: 'text', text: prose }],
      text: prose,
      toolCalls: [],
      stopReason: 'stop',
      model: config.model,
      usage: { inputTokens: null, outputTokens: null },
      providerName: config.provider,
    }
  }
}
