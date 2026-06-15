import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { UserProfile } from '@perduraflow/contracts'

/**
 * Auth state (UI-ARCHITECTURE.md §6). `hydrated` gates redirects so the store
 * can restore a session from storage/cookie before any redirect fires.
 */
interface AuthState {
  isAuthenticated: boolean
  hydrated: boolean
  user: UserProfile | null
  setAuth: (user: UserProfile) => void
  setUser: (user: UserProfile | null) => void
  setHydrated: (value: boolean) => void
  logout: () => void
}

const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  hydrated: false,
  user: null,
  setAuth: (user) => set({ isAuthenticated: true, user }),
  setUser: (user) => set({ user }),
  setHydrated: (hydrated) => set({ hydrated }),
  logout: () => set({ isAuthenticated: false, user: null }),
}))

export { useAuthStore } // raw — only for multi-value reads / getState()

/**
 * Whether a user is signed in. One of the granular selector hooks preferred for
 * reads — the raw `useAuthStore` above is only for multi-value reads /
 * `getState()` (selector contract, §6).
 */
export const useIsAuthenticated = () => useAuthStore((s) => s.isAuthenticated)
/** Whether session restore has completed — gate auth redirects on this flag. */
export const useIsHydrated = () => useAuthStore((s) => s.hydrated)
/** The current user profile, or null when signed out. */
export const useCurrentUser = () => useAuthStore((s) => s.user)
/**
 * Whether the current user may edit configuration / master data (the `canConfigure`
 * role capability — D33/RBAC). Admin screens are view-readable to everyone (SR1);
 * gate write affordances (New / Save / Deactivate) on this. Defaults to false.
 */
export const useCanConfigure = () => useAuthStore((s) => s.user?.canConfigure ?? false)
/** Auth actions (setAuth/setUser/setHydrated/logout), shallow-compared. */
export const useAuthActions = () =>
  useAuthStore(
    useShallow((s) => ({
      setAuth: s.setAuth,
      setUser: s.setUser,
      setHydrated: s.setHydrated,
      logout: s.logout,
    })),
  )
