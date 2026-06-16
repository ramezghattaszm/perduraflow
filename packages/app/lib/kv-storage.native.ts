import AsyncStorage from '@react-native-async-storage/async-storage'
import type { StateStorage } from 'zustand/middleware'

/**
 * Cross-platform key/value storage for non-secret UI preferences (zustand
 * persist) — NATIVE impl. Backed by AsyncStorage (the right tool for non-secret
 * device-local prefs; SecureStore is reserved for tokens/secrets — see the
 * refresh store). Async, which zustand persist supports via createJSONStorage.
 * The web split (`kv-storage.ts`) uses localStorage.
 */
export const kvStorage: StateStorage = {
  getItem: (name) => AsyncStorage.getItem(name),
  setItem: (name, value) => AsyncStorage.setItem(name, value),
  removeItem: (name) => AsyncStorage.removeItem(name),
}
