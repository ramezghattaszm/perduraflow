import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'

/**
 * Generic UI-state store (theme preference). Demonstrates the same
 * definition + typed-selector-hooks convention as the auth store (§6). Domain
 * stores (cart, etc.) are NOT part of the template.
 */
export type ThemePreference = 'system' | 'light' | 'dark'

interface UiState {
  themePreference: ThemePreference
  setThemePreference: (pref: ThemePreference) => void
}

const useUiStore = create<UiState>((set) => ({
  themePreference: 'system',
  setThemePreference: (themePreference) => set({ themePreference }),
}))

export { useUiStore }

/** The theme preference ('system' | 'light' | 'dark'). Granular selector (§6). */
export const useThemePreference = () => useUiStore((s) => s.themePreference)
/** UI actions (setThemePreference), shallow-compared. */
export const useUiActions = () =>
  useUiStore(useShallow((s) => ({ setThemePreference: s.setThemePreference })))
