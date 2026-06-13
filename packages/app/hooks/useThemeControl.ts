import { useThemeSetting } from '@tamagui/next-theme'
import type { ThemeControl, ThemePreference } from './useThemeControl.types'

/**
 * useThemeControl — WEB. Backed by @tamagui/next-theme: `set` switches the
 * theme (and the cookie sync persists it for SSR), `current` is the preference
 * ('system' included), `resolvedTheme` is the applied light/dark.
 */
export function useThemeControl(): ThemeControl {
  const { current, resolvedTheme, set } = useThemeSetting()
  return {
    preference: (current as ThemePreference | undefined) ?? 'system',
    resolved: resolvedTheme === 'dark' ? 'dark' : 'light',
    setTheme: (preference) => set(preference),
  }
}
