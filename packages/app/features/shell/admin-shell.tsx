'use client'

import { type ReactNode, useState } from 'react'
import { useRouter } from 'solito/navigation'
import { Menu } from '@tamagui/lucide-icons'
import {
  AppButton,
  H,
  Portal,
  ScrollView,
  SidebarNav,
  useMedia,
  XStack,
  YStack,
} from '@perduraflow/ui'
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
 * Admin shell — the kernel UI chrome (D34/A6). Responsive: a persistent left
 * SidebarNav on larger screens; on small screens (≤ md) the sidebar collapses
 * behind a top-left menu (lucide) that opens it as a drawer. Each admin screen
 * renders inside it with its `activeId`; navigation is via Solito.
 */
export function AdminShell({ activeId, maxWidth = 'fullscreen', children }: AdminShellProps) {
  const router = useRouter()
  const { t } = useTranslation('admin')
  const user = useCurrentUser()
  const logout = useLogout()
  const media = useMedia()
  const isSmall = Boolean(media['max-md'])
  const [navOpen, setNavOpen] = useState(false)

  // Selecting an item also closes the drawer (no-op on large screens).
  const items = ADMIN_NAV.map((e) => ({
    id: e.id,
    label: t(e.labelKey),
    onPress: () => {
      router.push(e.path)
      setNavOpen(false)
    },
  }))

  const brand = (
    <H level={4} color="$primary">
      PerduraFlow
    </H>
  )
  const signOut = (
    <YStack gap="$2">
      <AppButton
        size="$3"
        variant="light"
        onPress={() =>
          logout.mutate(undefined, {
            onSuccess: () => {
              setNavOpen(false)
              router.replace('/login')
            },
          })
        }
      >
        {user?.name ? `Sign out (${user.name})` : 'Sign out'}
      </AppButton>
    </YStack>
  )
  const sidebar = (
    <SidebarNav items={items} activeId={activeId} sectionLabel={t('nav.section')} header={brand} footer={signOut} />
  )

  const max =
    typeof maxWidth === 'number'
      ? maxWidth
      : !maxWidth || maxWidth === 'fullscreen'
        ? undefined
        : widthProps[maxWidth].maxWidth

  if (isSmall) {
    return (
      <YStack flex={1} backgroundColor="$background" style={{ minHeight: '100dvh' }}>
        <XStack
          alignItems="center"
          gap="$2"
          paddingHorizontal="$4"
          paddingVertical="$3"
          backgroundColor="$surface"
          borderBottomWidth={1}
          borderBottomColor="$borderColor"
        >
          <XStack
            onPress={() => setNavOpen(true)}
            cursor="pointer"
            padding="$2"
            marginLeft="$-2"
            borderRadius="$4"
            hoverStyle={{ backgroundColor: '$background' }}
            role="button"
            aria-label="Open menu"
            accessibilityLabel="Open menu"
          >
            <Menu size={24} color="$textPrimary" />
          </XStack>
          {brand}
        </XStack>
        <ScrollView flex={1}>
          <YStack flex={1} padding="$4" gap="$4" width="100%">
            {children}
          </YStack>
        </ScrollView>
        {navOpen ? (
          <Portal>
            <YStack
              position="fixed"
              top={0}
              left={0}
              right={0}
              bottom={0}
              zIndex={200000}
              backgroundColor="$overlay"
              pointerEvents="auto"
              onPress={() => setNavOpen(false)}
            >
              <YStack onPress={(e) => e.stopPropagation()} height="100%">
                {sidebar}
              </YStack>
            </YStack>
          </Portal>
        ) : null}
      </YStack>
    )
  }

  return (
    <XStack flex={1} backgroundColor="$background" style={{ minHeight: '100dvh' }}>
      {sidebar}
      <ScrollView flex={1}>
        <YStack flex={1} padding="$6" gap="$5" maxWidth={max} width="100%" alignSelf="center">
          {children}
        </YStack>
      </ScrollView>
    </XStack>
  )
}
