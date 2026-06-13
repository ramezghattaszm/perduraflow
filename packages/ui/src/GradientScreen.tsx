import type { ReactNode } from 'react'
import { LinearGradient } from 'expo-linear-gradient'
import { YStack, useTheme, type YStackProps } from 'tamagui'

/**
 * GradientScreen (native) — full-screen vertical gradient using the
 * $gradientStart → $gradientEnd semantic tokens. Web uses a CSS-gradient split
 * (GradientScreen.web.tsx) so this native-only module is never imported on web
 * (UI-ARCHITECTURE.md §5).
 */
export interface GradientScreenProps extends YStackProps {
  children?: ReactNode
  /** Override the start/end colors; defaults to the theme gradient tokens. */
  from?: string
  to?: string
}

/**
 * Opt-in full-screen vertical gradient (`$gradientStart` → `$gradientEnd`),
 * native (expo-linear-gradient). `Screen` is the solid default; using a gradient
 * is a per-app design decision (§3).
 *
 * @example
 * <GradientScreen justifyContent="center"><H level={1} color="$surface">Welcome</H></GradientScreen>
 */
export function GradientScreen({ children, from, to, ...props }: GradientScreenProps) {
  const theme = useTheme()
  const start = from ?? theme.gradientStart?.val ?? '#C8E6FF'
  const end = to ?? theme.gradientEnd?.val ?? '#4A6FE3'
  return (
    <LinearGradient
      colors={[start, end]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={{ flex: 1 }}
    >
      <YStack flex={1} {...props}>
        {children}
      </YStack>
    </LinearGradient>
  )
}
