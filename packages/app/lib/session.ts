import axios from 'axios'
import type { ApiEnvelope, AuthResponse } from '@perduraflow/contracts'
import { useAuthStore } from '../stores/auth.store'
import { getRefreshToken, hydrateRefreshToken, setRefreshToken } from './refresh-store'
import { getTokenStore } from './token-store'

const baseURL =
  process.env.EXPO_PUBLIC_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3000/api/v1'

/**
 * Restore a session on app start (UI-ARCHITECTURE.md §8). Native: hydrate the
 * refresh token from SecureStore. Both: attempt one silent refresh (web sends
 * the httpOnly cookie; native sends the token in the body). Always sets the
 * `hydrated` flag so auth redirects can proceed. Uses raw axios to avoid the
 * apiClient 401-refresh interceptor loop.
 */
export async function restoreSession(): Promise<void> {
  const { setAuth, setHydrated } = useAuthStore.getState()
  try {
    await hydrateRefreshToken()
    const res = await axios.post<ApiEnvelope<AuthResponse>>(
      `${baseURL}/auth/refresh`,
      { refreshToken: getRefreshToken() ?? undefined },
      { withCredentials: true },
    )
    const data = res.data.data
    getTokenStore().setAccessToken(data.accessToken)
    if (data.refreshToken) await setRefreshToken(data.refreshToken)
    setAuth(data.user)
  } catch {
    // No valid session — remain unauthenticated.
  } finally {
    setHydrated(true)
  }
}
