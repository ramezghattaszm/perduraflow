import { useCallback } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { UpdateProfileRequest, UserPreferences, UserProfile } from '@perduraflow/contracts'
import { apiClient } from '../lib/axios'
import { queryClient } from '../lib/query-client'
import { QUERY_KEYS } from '../lib/query-keys'
import { useAuthActions, useAuthStore, useIsAuthenticated } from '../stores/auth.store'

/** Query for the current user (`GET /users/me`). Enabled only when authenticated. */
export function useMe() {
  const isAuthenticated = useIsAuthenticated()
  return useQuery({
    queryKey: QUERY_KEYS.me(),
    queryFn: () => apiClient.get<UserProfile>('/users/me').then((r) => r.data),
    enabled: isAuthenticated,
  })
}

/** Updates the current user's profile; on success updates the auth store + me query cache. */
export function useUpdateProfile() {
  const { setUser } = useAuthActions()
  return useMutation({
    mutationFn: (body: UpdateProfileRequest) =>
      apiClient.patch<UserProfile>('/users/me', body).then((r) => r.data),
    onSuccess: (user) => {
      setUser(user)
      queryClient.setQueryData(QUERY_KEYS.me(), user)
    },
  })
}

/**
 * Persists a UI preferences patch (e.g. sidebar collapse) server-side. Updates
 * the auth store optimistically so the UI reflects the change immediately, then
 * PATCHes `/users/me`; the mutation's onSuccess reconciles with the server copy.
 * Preferences are server-persisted, never browser storage (UI shell spec §6).
 */
export function useUpdatePreferences() {
  const { setUser } = useAuthActions()
  const update = useUpdateProfile()
  return useCallback(
    (prefs: UserPreferences) => {
      const current = useAuthStore.getState().user
      if (current) setUser({ ...current, preferences: { ...current.preferences, ...prefs } })
      update.mutate({ preferences: prefs })
    },
    [setUser, update],
  )
}
