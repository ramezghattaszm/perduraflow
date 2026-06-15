import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import type { ApiEnvelope, AuthResponse } from '@perduraflow/contracts'
import { useAuthStore } from '../stores/auth.store'
import { getRefreshToken, setRefreshToken } from './refresh-store'
import { getTokenStore } from './token-store'
import { API_BASE_URL as baseURL } from './api-base'

/**
 * API client (UI-ARCHITECTURE.md §11). withCredentials sends the httpOnly
 * refresh cookie on web. The request interceptor attaches the access token; the
 * response interceptor unwraps the {statusCode, data} envelope and performs a
 * single silent refresh on 401 (queued so concurrent 401s refresh once).
 */

export const apiClient = axios.create({ baseURL, withCredentials: true })

apiClient.interceptors.request.use((config) => {
  const token = getTokenStore().getAccessToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

type RetriableConfig = InternalAxiosRequestConfig & { _retry?: boolean }

let refreshing: Promise<string | null> | null = null

apiClient.interceptors.response.use(
  (response) => {
    const body = response.data
    if (body && typeof body === 'object' && 'data' in body) {
      response.data = (body as ApiEnvelope<unknown>).data
    }
    return response
  },
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined
    // A 401 from an auth endpoint (login, refresh, register, …) means bad
    // credentials / no session — NOT an expired access token. Don't attempt a
    // silent refresh + logout for those; let the original error surface so the
    // screen can show it (e.g. INVALID_CREDENTIALS on the login form).
    const isAuthRoute = original?.url?.includes('/auth/') ?? false
    if (error.response?.status === 401 && original && !original._retry && !isAuthRoute) {
      original._retry = true
      try {
        refreshing ??= doRefresh()
        const token = await refreshing
        refreshing = null
        if (token) {
          original.headers.Authorization = `Bearer ${token}`
          return apiClient(original)
        }
      } catch {
        refreshing = null
      }
      // Refresh failed → clear session.
      getTokenStore().clearAccessToken()
      await setRefreshToken(null)
      useAuthStore.getState().logout()
    }
    return Promise.reject(error)
  },
)

// Uses raw axios (not apiClient) to avoid an interceptor loop.
async function doRefresh(): Promise<string | null> {
  const refreshToken = getRefreshToken() ?? undefined
  const res = await axios.post<ApiEnvelope<AuthResponse>>(
    `${baseURL}/auth/refresh`,
    { refreshToken },
    { withCredentials: true },
  )
  const data = res.data.data
  getTokenStore().setAccessToken(data.accessToken)
  if (data.refreshToken) await setRefreshToken(data.refreshToken)
  return data.accessToken
}
