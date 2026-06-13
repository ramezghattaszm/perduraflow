import { Redirect, Stack } from 'expo-router'
import { useIsAuthenticated, useIsHydrated } from '@perduraflow/app/stores/auth.store'

export default function AppLayout() {
  const hydrated = useIsHydrated()
  const isAuthenticated = useIsAuthenticated()
  if (hydrated && !isAuthenticated) return <Redirect href="/login" />
  return <Stack screenOptions={{ headerShown: false }} />
}
