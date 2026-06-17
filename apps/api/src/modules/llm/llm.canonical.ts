/**
 * The **canonical LLM request/response schema** (phase 5) — the provider-neutral
 * gateway↔adapter contract and the design centerpiece. It is a **superset**: rich
 * enough to express a system prompt, **multi-turn history**, **tools**, tool results,
 * and sampling params, even though phase-5 narration is **single-shot** (structured
 * rationale in → prose out, no loop). Getting this right is what lets phase 6 add the
 * **agentic tool-call loop** and conversation/history orchestration **with no adapter
 * reshaping** — adapters only translate this shape to/from their wire format.
 *
 * Adapters down-convert: an `anthropic`-format adapter maps to the Messages API; an
 * `openai`-format adapter (Groq, OpenAI, self-hosted) maps to chat-completions. The
 * gateway owns everything else (selection, retries, the future loop).
 *
 * This type lives inside the API (gateway↔adapter internal). The client-facing
 * narration surface stays `llm.gateway` (`NarrationInput`/`NarrationResult`).
 */

/** Conversation roles (assistant/tool used by the phase-6 loop; user/system now). */
export type LlmRole = 'system' | 'user' | 'assistant' | 'tool'

/**
 * A content part — a discriminated union so the schema is multimodal/agentic-ready.
 * Phase 5 uses only `text`; `tool_use`/`tool_result` are the phase-6 loop's currency
 * (declared now, never produced/consumed by the phase-5 single-shot path).
 */
export type LlmContentPart =
  | { type: 'text'; text: string }
  /** The model asking to call a tool (assistant turn; phase 6). */
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  /** A tool's output fed back to the model (tool turn; phase 6). */
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }

/** One conversation turn. `content` is a string convenience or explicit parts. */
export interface LlmMessage {
  role: LlmRole
  content: string | LlmContentPart[]
}

/** A tool the model may call (phase-6 agentic loop; declared, unused in phase 5). */
export interface LlmTool {
  name: string
  description: string
  /** JSON Schema for the tool's input. */
  parameters: Record<string, unknown>
}

/** Provider-neutral sampling controls; adapters map/clamp to their own names/ranges. */
export interface LlmSamplingParams {
  maxTokens: number
  temperature?: number
  topP?: number
  stopSequences?: string[]
}

/**
 * The canonical request. `system` is provider-neutral (Anthropic top-level `system`,
 * OpenAI a leading system message). `tools`/`toolChoice` are the phase-6 seam.
 * `metadata` is for tracing/audit and is NOT sent to the provider.
 */
export interface LlmRequest {
  system?: string
  messages: LlmMessage[]
  /** Declared tools (phase 6). Undefined/empty in phase 5. */
  tools?: LlmTool[]
  /** Tool-use policy (phase 6). */
  toolChoice?: 'auto' | 'none' | { name: string }
  params: LlmSamplingParams
  metadata?: Record<string, string>
}

/** Why the model stopped — normalized across providers. */
export type LlmStopReason = 'stop' | 'max_tokens' | 'tool_use' | 'stop_sequence' | 'error'

/** Token accounting (null when a provider doesn't report it). */
export interface LlmUsage {
  inputTokens: number | null
  outputTokens: number | null
}

/** A tool call the model requested (phase 6). */
export interface LlmToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

/**
 * The canonical response. `content` is the assistant's parts; `text` is the
 * concatenated text convenience; `toolCalls` is what the phase-6 loop dispatches
 * (empty in phase 5). `model`/`usage`/`providerName` are provenance for the D6 audit.
 */
export interface LlmResponse {
  content: LlmContentPart[]
  text: string
  toolCalls: LlmToolCall[]
  stopReason: LlmStopReason
  /** Concrete model id the provider actually used. */
  model: string
  usage: LlmUsage
  /** The provider that answered (e.g. `anthropic`, `groq`, `recorded`). */
  providerName: string
}

/** Collapse a message/response content to plain text (drops non-text parts). */
export function contentToText(content: string | LlmContentPart[]): string {
  if (typeof content === 'string') return content
  return content
    .filter((p): p is Extract<LlmContentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('')
}
