import type { LlmSamplingParams } from '../llm.canonical'
import type { WireFormat } from '../interfaces/llm-provider.interface'

/**
 * Provider **config presets** (phase 5) — data, not code. A built-in provider ships
 * with a preset (base URL, default model, wire format, default params, headers, and
 * the env var holding its key). There is **no hardcoded-vs-custom distinction** —
 * only "has a preset or not"; a future per-tenant config (phase 6) overrides the
 * same fields. For phase 5 the **active provider/model/key come from env**, and the
 * preset supplies the rest.
 */
export interface ProviderPreset {
  /** Endpoint (empty for `recorded`). */
  baseUrl: string
  /** Default model when env doesn't override (`LLM_MODEL`). */
  defaultModel: string
  /** Wire-format family the adapter down-converts to. */
  format: WireFormat
  /** Default sampling params (overridable per request). */
  defaultParams: Partial<LlmSamplingParams>
  /** Static headers the adapter sends (e.g. Anthropic's version header). */
  headers: Record<string, string>
  /** Name of the env var holding the API key (key-ref; IAM/other auth is adapter-internal later). */
  apiKeyEnv: string | null
}

/**
 * Built-in presets. `groq` is an **OpenAI-compatible** endpoint (config-driven URL),
 * so it and any future OpenAI-compatible backend (OpenAI, self-hosted vLLM, …) reuse
 * the one `openai`-format adapter — only this data differs.
 */
export const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  recorded: {
    baseUrl: '',
    defaultModel: 'recorded',
    format: 'recorded',
    defaultParams: { temperature: 0 },
    headers: {},
    apiKeyEnv: null,
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-haiku-4-5',
    format: 'anthropic',
    defaultParams: { temperature: 0 },
    headers: { 'anthropic-version': '2023-06-01' },
    apiKeyEnv: 'ANTHROPIC_API_KEY',
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
    defaultModel: 'llama-3.3-70b-versatile',
    format: 'openai',
    defaultParams: { temperature: 0 },
    headers: {},
    apiKeyEnv: 'GROQ_API_KEY',
  },
}
