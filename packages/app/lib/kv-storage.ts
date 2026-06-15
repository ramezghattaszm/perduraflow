import type { StateStorage } from 'zustand/middleware'

/**
 * Cross-platform key/value storage for **non-secret UI preferences** (zustand
 * persist) — WEB impl (localStorage). The native split (`kv-storage.native.ts`)
 * uses expo-secure-store. SSR-safe: guards `localStorage` so Next server renders
 * don't throw. Not for tokens/secrets (those use the token/refresh stores, §8).
 */
export const kvStorage: StateStorage = {
  getItem: (name) => (typeof localStorage !== 'undefined' ? localStorage.getItem(name) : null),
  setItem: (name, value) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(name, value)
  },
  removeItem: (name) => {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(name)
  },
}
