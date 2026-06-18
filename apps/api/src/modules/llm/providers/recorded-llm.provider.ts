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
    // Conversation (tool-loop) fallback: a deterministic, **safe** Type-1 path — route
    // to retrieval once, then surface the data. (Not full routing; the safe degrade
    // path of phase-6 §3 when a live provider misbehaves.)
    const retrieve = req.tools?.find((t) => t.name === 'retrieve_what_if')
    if (retrieve) {
      const hasResult = req.messages.some(
        (m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'tool_result'),
      )
      if (!hasResult) {
        const call = { id: 'rec-retrieve', name: retrieve.name, input: {} }
        return {
          content: [{ type: 'tool_use', ...call }],
          text: '',
          toolCalls: [call],
          stopReason: 'tool_use',
          model: config.model,
          usage: { inputTokens: null, outputTokens: null },
          providerName: config.provider,
        }
      }
      const safe = 'Here are the current options and their computed trade-offs — see the structured data alongside.'
      return { content: [{ type: 'text', text: safe }], text: safe, toolCalls: [], stopReason: 'stop', model: config.model, usage: { inputTokens: null, outputTokens: null }, providerName: config.provider }
    }

    // Narration path (no tools): stitch the gateway-supplied headline + facts.
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
