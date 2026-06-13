import { Redirect, Stack } from 'expo-router'
import { useIsAuthenticated, useIsHydrated } from '@perduraflow/app/stores/auth.store'

export default function AuthLayout() {
  const hydrated = useIsHydrated()
  const isAuthenticated = useIsAuthenticated()
  if (hydrated && isAuthenticated) return <Redirect href="/home" />
  return <Stack screenOptions={{ headerShown: false }} />
}
