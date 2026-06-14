'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { YStack } from '@perduraflow/ui'
import { useIsAuthenticated, useIsHydrated } from '@perduraflow/app/stores/auth.store'

/**
 * Authenticated area guard. The visual chrome (sidebar, sign-out) lives in the
 * shared AdminShell rendered by each screen, so this layout only enforces auth:
 * it waits for hydration, then redirects unauthenticated users to /login (the
 * client guard complements the presence-cookie middleware).
 */
export default function MainLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const hydrated = useIsHydrated()
  const isAuthenticated = useIsAuthenticated()

  useEffect(() => {
    if (hydrated && !isAuthenticated) router.replace('/login')
  }, [hydrated, isAuthenticated, router])

  if (!hydrated) return null

  return (
    <YStack flex={1} backgroundColor="$background" style={{ minHeight: '100dvh' }}>
      {children}
    </YStack>
  )
}
