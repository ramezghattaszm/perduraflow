/**
 * Access-token store (UI-ARCHITECTURE.md §8). Covers the ACCESS token only —
 * always in memory, never persisted. The refresh token is handled per platform
 * (cookie on web, SecureStore on native) and never goes through this interface.
 */
export interface TokenStore {
  getAccessToken(): string | null
  setAccessToken(token: string | null): void
  clearAccessToken(): void
}

class MemoryTokenStore implements TokenStore {
  private token: string | null = null
  getAccessToken(): string | null {
    return this.token
  }
  setAccessToken(token: string | null): void {
    this.token = token
  }
  clearAccessToken(): void {
    this.token = null
  }
}

let store: TokenStore = new MemoryTokenStore()

export function setTokenStore(next: TokenStore): void {
  store = next
}
export function getTokenStore(): TokenStore {
  return store
}
