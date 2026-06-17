import { Injectable } from '@nestjs/common'
import type { LlmContentPart, LlmMessage, LlmRequest, LlmResponse, LlmStopReason, LlmToolCall } from '../llm.canonical'
import { contentToText } from '../llm.canonical'
import { LlmProviderError, type LlmProviderAdapter, type ResolvedProviderConfig } from '../interfaces/llm-provider.interface'
import { classifyStatus, postJson } from './llm-http'

/**
 * The **OpenAI-compatible** adapter — one thin translator for every chat-completions
 * backend (**Groq** now; OpenAI / self-hosted vLLM later), differing only by **config**
 * (base URL, model, key), never by code. Translates the canonical request to the
 * chat-completions wire format and back; auth is `Authorization: Bearer`. The gateway
 * owns selection/retries/backoff/error policy/the future tool loop.
 */
@Injectable()
export class OpenAiCompatLlmProvider implements LlmProviderAdapter {
  readonly name = 'groq'

  async complete(req: LlmRequest, config: ResolvedProviderConfig): Promise<LlmResponse> {
    if (!config.apiKey) throw new LlmProviderError('auth', `${config.provider}: missing API key`)

    const body: Record<string, unknown> = {
      model: config.model,
      max_tokens: req.params.maxTokens,
      messages: toOpenAiMessages(req),
    }
    if (req.params.temperature != null) body.temperature = req.params.temperature
    if (req.params.topP != null) body.top_p = req.params.topP
    if (req.params.stopSequences?.length) body.stop = req.params.stopSequences
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))
    }
    if (req.toolChoice) {
      body.tool_choice =
        req.toolChoice === 'auto' || req.toolChoice === 'none' ? req.toolChoice : { type: 'function', function: { name: req.toolChoice.name } }
    }

    const res = await postJson(config.baseUrl, { authorization: `Bearer ${config.apiKey}`, ...config.headers }, body)
    if (!res.ok) throw classifyStatus(res.status, `${config.provider} ${res.status}: ${res.raw.slice(0, 300)}`)

    const data = res.body as OpenAiResponse
    const choice = data.choices?.[0]
    const msg = choice?.message
    const text = msg?.content ?? ''
    const toolCalls: LlmToolCall[] = (msg?.tool_calls ?? []).map((c) => ({
      id: c.id,
      name: c.function.name,
      input: safeParse(c.function.arguments),
    }))
    const content: LlmContentPart[] = [
      ...(text ? [{ type: 'text', text } as const] : []),
      ...toolCalls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.input }) as const),
    ]

    return {
      content,
      text,
      toolCalls,
      stopReason: mapFinish(choice?.finish_reason),
      model: data.model ?? config.model,
      usage: { inputTokens: data.usage?.prompt_tokens ?? null, outputTokens: data.usage?.completion_tokens ?? null },
      providerName: config.provider,
    }
  }
}

interface OpenAiToolCall { id: string; function: { name: string; arguments: string } }
interface OpenAiResponse {
  choices?: { message?: { content?: string | null; tool_calls?: OpenAiToolCall[] }; finish_reason?: string }[]
  model?: string
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

/** Canonical request → OpenAI messages (system as a leading message; tool results flattened). */
function toOpenAiMessages(req: LlmRequest): unknown[] {
  const out: unknown[] = []
  if (req.system) out.push({ role: 'system', content: req.system })
  for (const m of req.messages) {
    if (m.role === 'system') {
      out.push({ role: 'system', content: contentToText(m.content) })
      continue
    }
    const parts = typeof m.content === 'string' ? [{ type: 'text', text: m.content } as LlmContentPart] : m.content
    const toolResults = parts.filter((p): p is Extract<LlmContentPart, { type: 'tool_result' }> => p.type === 'tool_result')
    const toolUses = parts.filter((p): p is Extract<LlmContentPart, { type: 'tool_use' }> => p.type === 'tool_use')
    const text = parts.filter((p): p is Extract<LlmContentPart, { type: 'text' }> => p.type === 'text').map((p) => p.text).join('')
    // tool outputs → one {role:'tool'} message per result (OpenAI convention).
    for (const r of toolResults) out.push({ role: 'tool', tool_call_id: r.toolUseId, content: r.content })
    if (toolResults.length > 0 && !text && toolUses.length === 0) continue
    if (m.role === 'assistant' && toolUses.length > 0) {
      out.push({
        role: 'assistant',
        content: text || null,
        tool_calls: toolUses.map((p) => ({ id: p.id, type: 'function', function: { name: p.name, arguments: JSON.stringify(p.input) } })),
      })
    } else {
      out.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: text })
    }
  }
  return out
}

function mapFinish(reason?: string): LlmStopReason {
  switch (reason) {
    case 'length':
      return 'max_tokens'
    case 'tool_calls':
      return 'tool_use'
    case 'stop':
      return 'stop'
    default:
      return 'stop'
  }
}

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>
  } catch {
    return {}
  }
}
