import { LlmProviderError } from '../interfaces/llm-provider.interface'

/** Per-call transport timeout (gateway owns retries; this bounds a single attempt). */
const TIMEOUT_MS = 30_000

/** A raw HTTP response (already read) shared by the wire adapters. */
export interface HttpResult {
  ok: boolean
  status: number
  body: unknown
  raw: string
}

/**
 * POST JSON with a timeout — the transport step of an adapter's translation. A
 * **network/timeout failure is `transient`** (the gateway retries); a non-2xx is
 * returned for the adapter to classify with {@link classifyStatus}. This is transport
 * only — no retries/backoff here (that's the gateway's, once, for all providers).
 */
export async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<HttpResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: controller.signal })
    const raw = await res.text()
    let parsed: unknown = null
    try {
      parsed = raw ? JSON.parse(raw) : null
    } catch {
      parsed = null
    }
    return { ok: res.ok, status: res.status, body: parsed, raw }
  } catch (err) {
    // Network error / abort → transient (retryable by the gateway).
    throw new LlmProviderError('transient', `transport failure: ${(err as Error).message}`)
  } finally {
    clearTimeout(timer)
  }
}

/** Map an HTTP status to a normalized {@link LlmProviderError} kind. */
export function classifyStatus(status: number, message: string): LlmProviderError {
  if (status === 401 || status === 403) return new LlmProviderError('auth', message, status)
  if (status === 408 || status === 429) return new LlmProviderError('transient', message, status)
  if (status >= 500) return new LlmProviderError('transient', message, status)
  if (status === 400 || status === 422) return new LlmProviderError('invalid', message, status)
  return new LlmProviderError('unknown', message, status)
}
