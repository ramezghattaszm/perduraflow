'use client'

import { useRouter } from 'solito/navigation'
import { AppAvatar, AppButton, H, P, Screen, Separator, XStack, YStack } from '@perduraflow/ui'
import { useLogout } from '../../hooks/useAuth'
import { useTranslation } from '../../i18n'
import { useCurrentUser } from '../../stores/auth.store'

/**
 * Stripped generic profile: avatar + identity, an (empty) nav list for apps to
 * extend, and sign-out. No domain rows (My Listings / Favorites were Mercor).
 */
export function ProfileScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const user = useCurrentUser()
  const logout = useLogout()

  return (
    <Screen gap="$5">
      <XStack gap="$3" alignItems="center">
        <AppAvatar size="$6" name={user?.name} src={user?.avatarUrl ?? undefined} />
        <YStack>
          <H level={4}>{user?.name ?? '—'}</H>
          <P size={4} color="$textSecondary">
            {user?.email ?? ''}
          </P>
        </YStack>
      </XStack>

      <Separator />

      {/* Empty nav list — apps add their own rows here. */}
      <YStack flex={1} gap="$1">
        <XStack
          paddingVertical="$3"
          cursor="pointer"
          onPress={() => router.push('/settings')}
          hoverStyle={{ opacity: 0.7 }}
        >
          <P size={3}>Settings</P>
        </XStack>
        <Separator />
      </YStack>

      <AppButton variant="danger" loading={logout.isPending} onPress={() => logout.mutate()}>
        {t('common:signOut')}
      </AppButton>
    </Screen>
  )
}
