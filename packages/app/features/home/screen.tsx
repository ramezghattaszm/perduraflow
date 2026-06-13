'use client'

import { useRouter } from 'solito/navigation'
import { AppButton, H, P, Screen } from '@perduraflow/ui'
import { useCurrentUser } from '../../stores/auth.store'

/**
 * Minimal authenticated landing screen. Replace with your app's home.
 * Demonstrates H/P typography, semantic tokens, the auth store, and Solito
 * navigation — the shape every shared screen follows.
 */
export function HomeScreen() {
  const router = useRouter()
  const user = useCurrentUser()

  return (
    <Screen gap="$4">
      <H level={1} color="$primary">
        Welcome{user?.name ? `, ${user.name}` : ''}
      </H>
      <P size={3} color="$textSecondary">
        You're signed in. This is your home screen — start building here.
      </P>
      <AppButton onPress={() => router.push('/profile')}>Profile</AppButton>
    </Screen>
  )
}
