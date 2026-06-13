'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AppButton, H, XStack, YStack } from '@perduraflow/ui'
import { useLogout } from '@perduraflow/app/hooks/useAuth'
import { useIsAuthenticated, useIsHydrated } from '@perduraflow/app/stores/auth.store'

/**
 * Minimal authenticated shell: a thin header (app name + sign out) over a
 * content slot. No domain nav — apps add their own. The client guard
 * complements the middleware (avoids a flash before hydration).
 */
export default function MainLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const logout = useLogout()
  const hydrated = useIsHydrated()
  const isAuthenticated = useIsAuthenticated()

  useEffect(() => {
    if (hydrated && !isAuthenticated) router.replace('/login')
  }, [hydrated, isAuthenticated, router])

  if (!hydrated) return null

  return (
    <YStack flex={1} backgroundColor="$background" style={{ minHeight: '100dvh' }}>
      <XStack
        alignItems="center"
        justifyContent="space-between"
        paddingHorizontal="$5"
        paddingVertical="$3"
        backgroundColor="$surface"
        borderBottomWidth={1}
        borderBottomColor="$borderColor"
      >
        <H level={4} color="$primary" cursor="pointer" onPress={() => router.push('/')}>
          PerduraFlow
        </H>
        <AppButton
          size="$3"
          variant="light"
          onPress={() => logout.mutate(undefined, { onSuccess: () => router.replace('/login') })}
        >
          Sign out
        </AppButton>
      </XStack>
      <YStack flex={1}>{children}</YStack>
    </YStack>
  )
}
