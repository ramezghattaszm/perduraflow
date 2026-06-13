import type { TokenStore } from '@perduraflow/app/lib/token-store'

/**
 * Web token store: access token in memory + a JS-readable PRESENCE cookie
 * (`perduraflow_auth`, value just "1"). The middleware checks the presence
 * cookie for SSR redirects; the real refresh token stays in the API's httpOnly
 * cookie (UI-ARCHITECTURE.md §8, §15). Never store the access token itself here.
 */
const AUTH_COOKIE = 'perduraflow_auth'
const MAX_AGE = 90 * 24 * 60 * 60

let token: string | null = null

function setPresenceCookie(present: boolean): void {
  if (typeof document === 'undefined') return
  document.cookie = present
    ? `${AUTH_COOKIE}=1; path=/; max-age=${MAX_AGE}; samesite=lax`
    : `${AUTH_COOKIE}=; path=/; max-age=0; samesite=lax`
}

export const webTokenStore: TokenStore = {
  getAccessToken: () => token,
  setAccessToken: (next) => {
    token = next
    setPresenceCookie(Boolean(next))
  },
  clearAccessToken: () => {
    token = null
    setPresenceCookie(false)
  },
}
