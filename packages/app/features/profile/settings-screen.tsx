'use client'

import { Check, Monitor, Moon, Sun } from '@tamagui/lucide-icons'
import type { ComponentType } from 'react'
import { type ColorTokens, P, PageHeader, XStack, YStack } from '@perduraflow/ui'
import { useTranslation } from '../../i18n'
import { useThemeControl } from '../../hooks/useThemeControl'
import type { ThemePreference } from '../../hooks/useThemeControl.types'
import { AdminShell } from '../shell/admin-shell'

const OPTIONS: { value: ThemePreference; labelKey: string; icon: ComponentType<{ size?: number; color?: ColorTokens }> }[] = [
  { value: 'system', labelKey: 'preferences.system', icon: Monitor },
  { value: 'light', labelKey: 'preferences.light', icon: Sun },
  { value: 'dark', labelKey: 'preferences.dark', icon: Moon },
]

/**
 * Preferences — per-user appearance settings. The theme selector is backed by the
 * unified {@link useThemeControl} hook, so it works on both web (next-theme, with
 * the SSR cookie) and native (the ui store + Appearance). Reachable from the
 * account menu's "Preferences" entry.
 */
export function SettingsScreen() {
  const { t } = useTranslation('admin')
  const { preference, setTheme } = useThemeControl()

  return (
    <AdminShell activeId="preferences" maxWidth="small">
      <PageHeader title={t('preferences.title')} subtitle={t('preferences.subtitle')} />
      <YStack gap="$2">
        <P size={3} weight="b" color="$textPrimary">
          {t('preferences.theme')}
        </P>
        <P size={5} color="$textSecondary">
          {t('preferences.themeHint')}
        </P>
        <YStack
          marginTop="$2"
          borderWidth={1}
          borderColor="$borderColor"
          borderRadius="$4"
          overflow="hidden"
        >
          {OPTIONS.map((opt, i) => {
            const Icon = opt.icon
            const active = preference === opt.value
            return (
              <XStack
                key={opt.value}
                onPress={() => setTheme(opt.value)}
                alignItems="center"
                gap="$3"
                paddingHorizontal="$4"
                paddingVertical="$3"
                backgroundColor={active ? '$primarySoft' : '$surface'}
                borderTopWidth={i === 0 ? 0 : 1}
                borderTopColor="$borderColor"
                cursor="pointer"
                hoverStyle={{ backgroundColor: active ? '$primarySoft' : '$hoverFill' }}
                role="button"
                aria-label={t(opt.labelKey)}
              >
                <Icon size={20} color={active ? '$primary' : '$textSecondary'} />
                <P size={4} flex={1} color={active ? '$primary' : '$textPrimary'} weight={active ? 'b' : 'r'}>
                  {t(opt.labelKey)}
                </P>
                {active ? <Check size={18} color="$primary" /> : null}
              </XStack>
            )
          })}
        </YStack>
      </YStack>
    </AdminShell>
  )
}
