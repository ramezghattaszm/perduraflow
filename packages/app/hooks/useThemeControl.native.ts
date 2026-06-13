import { useColorScheme } from 'react-native'
import { useThemePreference, useUiActions } from '../stores/ui.store'
import type { ThemeControl } from './useThemeControl.types'

/**
 * useThemeControl — NATIVE. Backed by the ui store (the expo root reads it for
 * the Tamagui theme) with the OS Appearance resolving 'system'.
 */
export function useThemeControl(): ThemeControl {
  const preference = useThemePreference()
  const colorScheme = useColorScheme()
  const { setThemePreference } = useUiActions()
  const resolved = preference === 'system' ? (colorScheme === 'dark' ? 'dark' : 'light') : preference
  return { preference, resolved, setTheme: setThemePreference }
}
