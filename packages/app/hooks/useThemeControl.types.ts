import type { ThemePreference } from '../stores/ui.store'

export type { ThemePreference }

/**
 * Unified theme control (UI-ARCHITECTURE.md §3). One API for both platforms:
 * web is backed by @tamagui/next-theme (system + cookie), native by the ui
 * store (Appearance + override). Screens use this — never the platform
 * mechanism directly.
 */
export interface ThemeControl {
  /** The user's selection: 'system' | 'light' | 'dark'. */
  preference: ThemePreference
  /** The concrete theme currently applied. */
  resolved: 'light' | 'dark'
  /** Change the preference (and persist it). */
  setTheme: (preference: ThemePreference) => void
}
