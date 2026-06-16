'use client'

import { useRouter } from 'solito/navigation'
import { ChevronRight } from '@tamagui/lucide-icons'
import { P, PageHeader, XStack, YStack } from '@perduraflow/ui'
import { useTranslation } from '../../i18n'
import { AdminShell } from './admin-shell'
import { ADMIN_NAV } from './nav'

/**
 * Settings / Administration landing (`/admin`) — the grouped admin nav as a list.
 * On phone it's the drill-down root reached from the drawer's Settings entry; on
 * desktop it's a deep-link fallback (the gear overlay is the primary path).
 * Visible to all roles (SR1); editing inside each screen is `canConfigure`-gated.
 */
export function AdminLandingScreen() {
  const { t } = useTranslation('admin')
  const router = useRouter()
  return (
    <AdminShell activeId="admin-home" maxWidth="medium">
      <PageHeader title={t('shell.administration')} subtitle={t('shell.settingsSubtitle')} />
      <YStack gap="$5">
        {ADMIN_NAV.map((section) => (
          <YStack key={section.id} gap="$2">
            <P size={5} weight="b" caps color="$textTertiary" paddingHorizontal="$1">
              {t(section.sectionLabelKey)}
            </P>
            <YStack borderWidth={1} borderColor="$borderColor" borderRadius="$4" overflow="hidden">
              {section.items.map((it, i) => {
                const Icon = it.icon
                return (
                  <XStack
                    key={it.id}
                    onPress={() => router.push(it.path)}
                    alignItems="center"
                    gap="$3"
                    paddingHorizontal="$4"
                    paddingVertical="$3"
                    backgroundColor="$surface"
                    borderTopWidth={i === 0 ? 0 : 1}
                    borderTopColor="$borderColor"
                    cursor="pointer"
                    hoverStyle={{ backgroundColor: '$background' }}
                    role="button"
                    aria-label={t(it.labelKey)}
                  >
                    <Icon size={20} color="$textSecondary" />
                    <P size={3} color="$textPrimary" flex={1}>
                      {t(it.labelKey)}
                    </P>
                    <ChevronRight size={18} color="$textSecondary" />
                  </XStack>
                )
              })}
            </YStack>
          </YStack>
        ))}
      </YStack>
    </AdminShell>
  )
}
