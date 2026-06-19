import { useEffect, useState } from 'react'
import { Platform } from 'react-native'

const isWeb = Platform.OS === 'web'

/** Read a JSON value from sessionStorage — web only, safe during SSR and on native. */
function readSession<T>(key: string): T | undefined {
  if (!isWeb || typeof window === 'undefined') return undefined
  try {
    const raw = window.sessionStorage.getItem(key)
    return raw == null ? undefined : (JSON.parse(raw) as T)
  } catch {
    return undefined
  }
}

/**
 * Session-scoped state — like `useState`, but on **web** the value is persisted to
 * `sessionStorage`, so it **survives a page refresh** within the same tab/session and is
 * cleared when the tab closes (deliberately not `localStorage` — it shouldn't leak across
 * sessions). On **native** there is no refresh, so it's plain in-memory state (no storage).
 *
 * The value starts at `initial` on the server and the first client render (so there's no
 * SSR hydration mismatch), then any stored value is restored in an effect after mount.
 *
 * @example
 * const [viewDate, setViewDate] = useSessionState('board.viewDate', todayMs)
 */
export function useSessionState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(initial)

  // Restore the stored value after mount (web only) — keeps SSR/first-render === `initial`.
  useEffect(() => {
    const stored = readSession<T>(key)
    if (stored !== undefined) setValue(stored)
  }, [key])

  const set = (next: T): void => {
    setValue(next)
    if (isWeb && typeof window !== 'undefined') {
      try {
        window.sessionStorage.setItem(key, JSON.stringify(next))
      } catch {
        /* storage disabled/full → in-memory only */
      }
    }
  }

  return [value, set]
}
