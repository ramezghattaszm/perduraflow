/**
 * Theme cookie (web SSR determinism, UI-ARCHITECTURE.md §3). The resolved theme
 * is persisted here client-side and read in the server `layout.tsx` so the first
 * server paint renders the same theme the client will resolve — no flash, no
 * hydration mismatch. Pure constants/helpers (no React) so a server component
 * can import them.
 */
export const THEME_COOKIE = 'perduraflow_theme'

export type ResolvedTheme = 'light' | 'dark'

/** Tamagui emits `t_light` / `t_dark` theme classes on the root element. */
export function themeClassName(theme?: string): string | undefined {
  if (theme === 'dark') return 't_dark'
  if (theme === 'light') return 't_light'
  return undefined
}

export function isResolvedTheme(value: string | undefined): value is ResolvedTheme {
  return value === 'light' || value === 'dark'
}
