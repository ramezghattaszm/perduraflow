import { Redirect } from 'expo-router'
import { useIsAuthenticated, useIsHydrated } from '@perduraflow/app/stores/auth.store'

export default function Index() {
  const hydrated = useIsHydrated()
  const isAuthenticated = useIsAuthenticated()
  if (!hydrated) return null
  return <Redirect href={isAuthenticated ? '/home' : '/login'} />
}
