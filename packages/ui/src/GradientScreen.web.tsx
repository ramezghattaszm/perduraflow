import type { ReactNode } from 'react'
import { YStack, type YStackProps } from 'tamagui'

/**
 * GradientScreen (web) — CSS linear-gradient via CSS variables.
 *
 * The gradient references the `--gradientStart` / `--gradientEnd` CSS variables
 * (the names Tamagui emits for the `$gradientStart` / `$gradientEnd` theme
 * tokens — verified from the generated CSS). This is SSR-safe: server and client
 * render the identical inline string, and the color resolves from the active
 * theme class, so there is no hydration mismatch (UI-ARCHITECTURE.md §3). Never
 * use `useTheme().X.val` here — that bakes the server's theme into the string.
 *
 * Optional `from`/`to` override with explicit colors when an app wants a fixed
 * gradient regardless of theme.
 */
export interface GradientScreenProps extends YStackProps {
  children?: ReactNode
  from?: string
  to?: string
}

/**
 * Opt-in full-screen vertical gradient (web). Uses the `--gradientStart` /
 * `--gradientEnd` CSS variables (NOT `useTheme().val`) so it's SSR-safe and
 * theme-correct (§3). `Screen` is the solid default.
 *
 * @example
 * <GradientScreen justifyContent="center"><H level={1} color="$surface">Welcome</H></GradientScreen>
 */
export function GradientScreen({ children, from, to, ...props }: GradientScreenProps) {
  const start = from ?? 'var(--gradientStart)'
  const end = to ?? 'var(--gradientEnd)'
  return (
    <YStack flex={1} style={{ background: `linear-gradient(180deg, ${start}, ${end})` }} {...props}>
      {children}
    </YStack>
  )
}
