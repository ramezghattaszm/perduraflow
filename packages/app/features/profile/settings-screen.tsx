'use client'

import { AppButton, H, P, Screen, XStack } from '@perduraflow/ui'
import { useThemeControl } from '../../hooks/useThemeControl'
import type { ThemePreference } from '../../hooks/useThemeControl.types'

/**
 * Generic settings: theme preference via the unified useThemeControl hook, so
 * the toggle works on both web (next-theme) and native (ui store).
 */
const OPTIONS: ThemePreference[] = ['system', 'light', 'dark']

export function SettingsScreen() {
  const { preference, setTheme } = useThemeControl()

  return (
    <Screen gap="$4">
      <H level={3}>Settings</H>
      <P size={4} color="$textSecondary">
        Theme
      </P>
      <XStack gap="$2" flexWrap="wrap">
        {OPTIONS.map((option) => (
          <AppButton
            key={option}
            size="$3"
            variant={preference === option ? 'primary' : 'light'}
            onPress={() => setTheme(option)}
          >
            {option}
          </AppButton>
        ))}
      </XStack>
    </Screen>
  )
}
