'use client'

import type { ReactNode } from 'react'
import { useRouter } from 'solito/navigation'
import { AppButton, H, ScrollView, SidebarNav, XStack, YStack } from '@perduraflow/ui'
import { useTranslation } from '../../i18n'
import { useLogout } from '../../hooks/useAuth'
import { useCurrentUser } from '../../stores/auth.store'
import { ADMIN_NAV } from './nav'

export interface AdminShellProps {
  maxWidth?: number | 'small' | 'medium' | 'large' | 'fullscreen'
  activeId: string
  children: ReactNode
}

const widthProps = {
  small: { maxWidth: 800 },
  medium: { maxWidth: 1100 },
  large: { maxWidth: 1800 },
}
/**
 * Admin shell — the kernel UI chrome (D34/A6): a left SidebarNav over a scrolling
 * content area. Each admin screen renders inside it with its `activeId`, so the
 * app routers only re-export screens (UI §1). Navigation is via Solito.
 */
export function AdminShell({ activeId, maxWidth = 'fullscreen', children }: AdminShellProps) {
  const router = useRouter()
  const { t } = useTranslation('admin')
  const user = useCurrentUser()
  const logout = useLogout()

  const items = ADMIN_NAV.map((e) => ({
    id: e.id,
    label: t(e.labelKey),
    onPress: () => router.push(e.path),
  }))

  const max =
    typeof maxWidth === 'number'
      ? maxWidth
      : !maxWidth || maxWidth === 'fullscreen'
        ? undefined
        : widthProps[maxWidth].maxWidth

  return (
    <XStack flex={1} backgroundColor="$background" style={{ minHeight: '100dvh' }}>
      <SidebarNav
        items={items}
        activeId={activeId}
        sectionLabel={t('nav.section')}
        header={
          <H level={4} color="$primary">
            PerduraFlow
          </H>
        }
        footer={
          <YStack gap="$2">
            <AppButton
              size="$3"
              variant="light"
              onPress={() =>
                logout.mutate(undefined, { onSuccess: () => router.replace('/login') })
              }
            >
              {user?.name ? `Sign out (${user.name})` : 'Sign out'}
            </AppButton>
          </YStack>
        }
      />
      <ScrollView flex={1}>
        <YStack flex={1} padding="$6" gap="$5" maxWidth={max} width="100%" alignSelf="center">
          {children}
        </YStack>
      </ScrollView>
    </XStack>
  )
}
