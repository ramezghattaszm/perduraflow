'use client'

import { useState } from 'react'
import { useRouter } from 'solito/navigation'
import { ChevronRight, Menu, PanelLeft, Search, Settings } from '@tamagui/lucide-icons'
import {
  IconButton,
  NotificationBell,
  P,
  Portal,
  Separator,
  UserAvatar,
  XStack,
  YStack,
} from '@perduraflow/ui'
import { useTranslation } from '../../i18n'
import { useLogout } from '../../hooks/useAuth'
import { useCurrentUser } from '../../stores/auth.store'

type OpenMenu = 'none' | 'bell' | 'account'

export interface TopBarProps {
  isSmall: boolean
  collapsed: boolean
  /** Desktop: collapse/expand the sidebar rail. */
  onToggleCollapse: () => void
  /** Small screens: open the off-canvas nav drawer. */
  onOpenDrawer: () => void
  /** Desktop/iPad: open the admin/config overlay panel (the gear). Omitted on small. */
  onOpenAdmin?: () => void
  /** Safe-area top inset (status bar / notch) — native; 0 on web. */
  insetTop?: number
  /** Utility breadcrumb segments, e.g. ["Administration", "Plants"]. */
  breadcrumb?: string[]
  /** Screen title shown next to the menu on `small` (the in-body H1 is dropped there). */
  title?: string
}

/**
 * TopBar — the shell's utility bar (UI shell spec §5): collapse/menu toggle,
 * breadcrumb, ⌘K search affordance (presentational this phase), NotificationBell,
 * and the UserAvatar account menu. Only one of {notifications, account} is open at
 * a time; clicking the scrim closes both. Never duplicates the page title — that
 * stays in the body PageHeader.
 */
export function TopBar({ isSmall, collapsed, onToggleCollapse, onOpenDrawer, onOpenAdmin, insetTop = 0, breadcrumb, title }: TopBarProps) {
  const { t } = useTranslation('admin')
  const router = useRouter()
  const user = useCurrentUser()
  const logout = useLogout()
  const [open, setOpen] = useState<OpenMenu>('none')

  const signOut = () => {
    setOpen('none')
    logout.mutate(undefined, { onSuccess: () => router.replace('/login') })
  }

  const go = (path: string) => {
    setOpen('none')
    router.push(path)
  }

  return (
    <XStack
      height={58 + insetTop}
      paddingTop={insetTop}
      alignItems="center"
      gap="$3"
      paddingHorizontal="$3"
      backgroundColor="$surfaceRaised"
      borderBottomWidth={1}
      borderBottomColor="$borderColor"
    >
      {isSmall ? (
        <>
          <IconButton icon={Menu} label={t('shell.openMenu')} onPress={onOpenDrawer} color="$textPrimary" />
          {title ? (
            <P size={3} weight="b" color="$textPrimary" numberOfLines={1} flex={1}>
              {title}
            </P>
          ) : null}
        </>
      ) : (
        <IconButton
          icon={PanelLeft}
          label={collapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar')}
          onPress={onToggleCollapse}
        />
      )}

      {!isSmall && breadcrumb && breadcrumb.length > 0 ? (
        <XStack alignItems="center" gap="$1.5">
          {breadcrumb.map((seg, i) => (
            <XStack key={`${i}-${seg}`} alignItems="center" gap="$1.5">
              {i > 0 ? <ChevronRight size={14} color="$textSecondary" /> : null}
              <P size={3} weight={i === breadcrumb.length - 1 ? 'b' : 'r'} color={i === breadcrumb.length - 1 ? '$textPrimary' : '$textSecondary'}>
                {seg}
              </P>
            </XStack>
          ))}
        </XStack>
      ) : null}

      <YStack flex={1} />

      {!isSmall ? (
        <XStack
          alignItems="center"
          gap="$2"
          height={34}
          paddingHorizontal="$3"
          borderRadius="$6"
          borderWidth={1}
          borderColor="$borderColor"
          backgroundColor="$background"
          cursor="pointer"
          hoverStyle={{ backgroundColor: '$hoverFill' }}
          role="button"
          aria-label={t('shell.search')}
        >
          <Search size={16} color="$textSecondary" />
          <P size={4} color="$textSecondary">
            {t('shell.search')}
          </P>
          <XStack
            marginLeft="$2"
            paddingHorizontal="$2"
            paddingVertical="$0.5"
            borderRadius="$3"
            backgroundColor="$surfaceRaised"
            borderWidth={1}
            borderColor="$borderColor"
          >
            <P size={5} color="$textSecondary">
              ⌘K
            </P>
          </XStack>
        </XStack>
      ) : null}

      {!isSmall && onOpenAdmin ? (
        <IconButton icon={Settings} label={t('shell.administration')} onPress={onOpenAdmin} />
      ) : null}

      <NotificationBell
        open={open === 'bell'}
        onOpenChange={(o) => setOpen(o ? 'bell' : 'none')}
        title={t('shell.notifications')}
        emptyText={t('shell.allCaughtUp')}
      />

      <YStack>
        <XStack
          onPress={() => setOpen(open === 'account' ? 'none' : 'account')}
          cursor="pointer"
          borderRadius="$10"
          pressStyle={{ opacity: 0.7 }}
          role="button"
          aria-label={user?.name ?? t('shell.account.profile')}
        >
          <UserAvatar id={user?.id} name={user?.name} src={user?.avatarUrl} size={32} />
        </XStack>
        {open === 'account' ? (
          <Portal>
            <YStack
              position="fixed"
              top={0}
              left={0}
              right={0}
              bottom={0}
              zIndex={250000}
              pointerEvents="auto"
              onPress={() => setOpen('none')}
            />
            <YStack
              position="fixed"
              top={56}
              right={8}
              width={280}
              zIndex={250001}
              pointerEvents="auto"
              backgroundColor="$surfaceRaised"
              borderColor="$borderColor"
              borderWidth={1}
              borderRadius="$5"
              elevation="$4"
              overflow="hidden"
            >
              <XStack gap="$3" alignItems="center" padding="$4" borderBottomWidth={1} borderBottomColor="$borderColor">
                <UserAvatar id={user?.id} name={user?.name} src={user?.avatarUrl} size={38} />
                <YStack flex={1}>
                  <P size={3} weight="b" numberOfLines={1}>
                    {user?.name}
                  </P>
                  <P size={4} color="$textSecondary" numberOfLines={1}>
                    {user?.email}
                  </P>
                </YStack>
              </XStack>
              <MenuRow label={t('shell.account.profile')} onPress={() => go('/profile')} />
              <MenuRow label={t('shell.account.preferences')} onPress={() => go('/settings')} />
              <Separator borderColor="$borderColor" />
              <MenuRow label={t('shell.account.signOut')} danger onPress={signOut} />
            </YStack>
          </Portal>
        ) : null}
      </YStack>
    </XStack>
  )
}

function MenuRow({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <XStack
      onPress={onPress}
      paddingHorizontal="$4"
      paddingVertical="$3"
      cursor="pointer"
      hoverStyle={{ backgroundColor: '$hoverFill' }}
      role="button"
      aria-label={label}
    >
      <P size={3} color={danger ? '$danger' : '$textPrimary'}>
        {label}
      </P>
    </XStack>
  )
}
