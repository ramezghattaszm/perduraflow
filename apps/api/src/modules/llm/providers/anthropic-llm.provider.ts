import { Injectable } from '@nestjs/common'
import type { LlmContentPart, LlmMessage, LlmRequest, LlmResponse, LlmStopReason, LlmToolCall } from '../llm.canonical'
import { LlmProviderError, type LlmProviderAdapter, type ResolvedProviderConfig } from '../interfaces/llm-provider.interface'
import { classifyStatus, postJson } from './llm-http'

/**
 * The `anthropic` adapter — translates the canonical request to the **Messages API**
 * and back. A **thin translator only**: the gateway owns selection, retries, backoff,
 * error policy, and the future tool loop. Endpoint/model/headers come from the
 * resolved config (data); auth is `x-api-key`.
 */
@Injectable()
export class AnthropicLlmProvider implements LlmProviderAdapter {
  readonly name = 'anthropic'

  async complete(req: LlmRequest, config: ResolvedProviderConfig): Promise<LlmResponse> {
    if (!config.apiKey) throw new LlmProviderError('auth', 'anthropic: missing API key')

    const body: Record<string, unknown> = {
      model: config.model,
      max_tokens: req.params.maxTokens,
      messages: toAnthropicMessages(req.messages),
    }
    if (req.system) body.system = req.system
    if (req.params.temperature != null) body.temperature = req.params.temperature
    if (req.params.topP != null) body.top_p = req.params.topP
    if (req.params.stopSequences?.length) body.stop_sequences = req.params.stopSequences
    if (req.tools?.length) body.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }))
    if (req.toolChoice) {
      body.tool_choice =
        req.toolChoice === 'auto' ? { type: 'auto' } : req.toolChoice === 'none' ? { type: 'none' } : { type: 'tool', name: req.toolChoice.name }
    }

    const res = await postJson(config.baseUrl, { 'x-api-key': config.apiKey, ...config.headers }, body)
    if (!res.ok) throw classifyStatus(res.status, `anthropic ${res.status}: ${res.raw.slice(0, 300)}`)

    const data = res.body as AnthropicResponse
    const content: LlmContentPart[] = (data.content ?? []).map((b) =>
      b.type === 'tool_use' ? { type: 'tool_use', id: b.id!, name: b.name!, input: b.input ?? {} } : { type: 'text', text: b.text ?? '' },
    )
    const toolCalls: LlmToolCall[] = content
      .filter((p): p is Extract<LlmContentPart, { type: 'tool_use' }> => p.type === 'tool_use')
      .map((p) => ({ id: p.id, name: p.name, input: p.input }))
    const text = content.filter((p): p is Extract<LlmContentPart, { type: 'text' }> => p.type === 'text').map((p) => p.text).join('')

    return {
      content,
      text,
      toolCalls,
      stopReason: mapStop(data.stop_reason),
      model: data.model ?? config.model,
      usage: { inputTokens: data.usage?.input_tokens ?? null, outputTokens: data.usage?.output_tokens ?? null },
      providerName: config.provider,
    }
  }
}

interface AnthropicBlock { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }
interface AnthropicResponse { content?: AnthropicBlock[]; stop_reason?: string; model?: string; usage?: { input_tokens?: number; output_tokens?: number } }

/** Canonical content → Anthropic content blocks. */
function toAnthropicContent(content: string | LlmContentPart[]): unknown[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return content.map((p) =>
    p.type === 'text'
      ? { type: 'text', text: p.text }
      : p.type === 'tool_use'
        ? { type: 'tool_use', id: p.id, name: p.name, input: p.input }
        : { type: 'tool_result', tool_use_id: p.toolUseId, content: p.content, is_error: p.isError },
  )
}

/** Canonical messages → Anthropic messages (system is top-level; `tool`+`user` → user). */
function toAnthropicMessages(messages: LlmMessage[]): unknown[] {
  return messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: toAnthropicContent(m.content) }))
}

function mapStop(reason?: string): LlmStopReason {
  switch (reason) {
    case 'max_tokens':
      return 'max_tokens'
    case 'tool_use':
      return 'tool_use'
    case 'stop_sequence':
      return 'stop_sequence'
    default:
      return 'stop'
  }
}
