/**
 * Safely extract the API error code from a thrown axios error. Never throws.
 * Pair with i18n errors.json to render a localized message
 * (UI-ARCHITECTURE.md §9, §12).
 */
export function getApiErrorCode(err: unknown): string | null {
  try {
    if (err && typeof err === 'object' && 'response' in err) {
      const code = (err as { response?: { data?: { code?: unknown } } }).response?.data?.code
      return typeof code === 'string' ? code : null
    }
    return null
  } catch {
    return null
  }
}
