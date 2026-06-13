import * as SecureStore from 'expo-secure-store'

/**
 * Refresh-token store — NATIVE. Persists the refresh token in the device
 * Keychain/Keystore via expo-secure-store, with an in-memory cache for
 * synchronous reads. Call hydrateRefreshToken() once at startup.
 */
const KEY = 'perduraflow_refresh_token'

let cached: string | null = null

export async function hydrateRefreshToken(): Promise<void> {
  cached = await SecureStore.getItemAsync(KEY)
}

export function getRefreshToken(): string | null {
  return cached
}

export async function setRefreshToken(token: string | null): Promise<void> {
  cached = token
  if (token) await SecureStore.setItemAsync(KEY, token)
  else await SecureStore.deleteItemAsync(KEY)
}

export async function clearRefreshToken(): Promise<void> {
  cached = null
  await SecureStore.deleteItemAsync(KEY)
}
