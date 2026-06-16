import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import { kvStorage } from '../lib/kv-storage'

/**
 * Generic UI-state store (theme preference). Demonstrates the same
 * definition + typed-selector-hooks convention as the auth store (§6). Domain
 * stores (cart, etc.) are NOT part of the template.
 *
 * The theme preference is **persisted** across sessions via the cross-platform
 * `kvStorage` (localStorage on web, AsyncStorage on native), so a chosen theme
 * survives an app restart. On web the Tamagui theme is driven by next-theme
 * (cookie + localStorage) for SSR; on native this store is the source of truth —
 * see {@link useThemeControl} (`.native`).
 */
export type ThemePreference = 'system' | 'light' | 'dark'

interface UiState {
  themePreference: ThemePreference
  setThemePreference: (pref: ThemePreference) => void
}

const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      themePreference: 'system',
      setThemePreference: (themePreference) => set({ themePreference }),
    }),
    {
      name: 'perduraflow-ui',
      storage: createJSONStorage(() => kvStorage),
      partialize: (s) => ({ themePreference: s.themePreference }),
    },
  ),
)

export { useUiStore }

/** The theme preference ('system' | 'light' | 'dark'). Granular selector (§6). */
export const useThemePreference = () => useUiStore((s) => s.themePreference)
/** UI actions (setThemePreference), shallow-compared. */
export const useUiActions = () =>
  useUiStore(useShallow((s) => ({ setThemePreference: s.setThemePreference })))
