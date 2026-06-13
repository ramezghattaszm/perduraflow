/**
 * Refresh-token store — WEB. No-ops: the browser holds the refresh token in an
 * httpOnly cookie set by the API, which JS cannot read or write. The native
 * split (refresh-store.native.ts) persists it in SecureStore.
 */
export async function hydrateRefreshToken(): Promise<void> {}
export function getRefreshToken(): string | null {
  return null
}
export async function setRefreshToken(_token: string | null): Promise<void> {}
export async function clearRefreshToken(): Promise<void> {}
