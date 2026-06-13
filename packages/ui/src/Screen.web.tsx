import type { ReactNode } from 'react'
import { YStack, type YStackProps } from 'tamagui'

/**
 * Screen (web) — solid `$background`, default padding. No safe-area insets on
 * web (use the CSS `env(safe-area-inset-*)` selector if a mobile-web app needs
 * them). Mirrors the native API (UI-ARCHITECTURE.md §3, §5).
 */
export type ScreenEdge = 'top' | 'bottom'

export interface ScreenProps extends YStackProps {
  children?: ReactNode
  edges?: ScreenEdge[]
  padded?: boolean
}

const BASE_PAD = 16

/**
 * Default screen container (web): solid `$background` + default padding, no
 * safe-area insets. Mirrors the native API (§3).
 *
 * @example
 * <Screen><H level={1}>Home</H></Screen>
 */
export function Screen({ children, edges, padded = true, ...props }: ScreenProps) {
  void edges // native-only; kept for API parity
  return (
    <YStack flex={1} backgroundColor="$background" padding={padded ? BASE_PAD : 0} {...props}>
      {children}
    </YStack>
  )
}
