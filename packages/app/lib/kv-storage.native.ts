import * as SecureStore from 'expo-secure-store'
import type { StateStorage } from 'zustand/middleware'

/**
 * Cross-platform key/value storage for non-secret UI preferences (zustand
 * persist) — NATIVE impl. Backed by expo-secure-store (already a dependency; no
 * AsyncStorage added). Async, which zustand persist supports via
 * createJSONStorage. Keys are alphanumeric/`._-` per SecureStore rules.
 */
export const kvStorage: StateStorage = {
  getItem: (name) => SecureStore.getItemAsync(name),
  setItem: (name, value) => SecureStore.setItemAsync(name, value),
  removeItem: (name) => SecureStore.deleteItemAsync(name),
}
