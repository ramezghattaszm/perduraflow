import type { ReactNode } from 'react'
import { YStack, type YStackProps } from 'tamagui'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

/**
 * Screen (native) — the default screen container (UI-ARCHITECTURE.md §3
 * "Default screen is solid"). Solid `$background`, safe-area aware (top/bottom
 * insets fill with the background), sensible default padding. Requires a
 * SafeAreaProvider ancestor (wired in the shared Provider). The web split uses
 * no insets.
 */
export type ScreenEdge = 'top' | 'bottom'

export interface ScreenProps extends YStackProps {
  children?: ReactNode
  /** Which safe-area edges to inset (default both). */
  edges?: ScreenEdge[]
  /** Apply default screen padding (default true). */
  padded?: boolean
}

const BASE_PAD = 16

/**
 * Default screen container (§3 "Default screen is solid"): solid `$background`,
 * safe-area aware (insets fill with the background), sensible default padding.
 * `GradientScreen` is the opt-in alternative.
 *
 * @example
 * <Screen><H level={1}>Home</H></Screen>
 */
export function Screen({
  children,
  edges = ['top', 'bottom'],
  padded = true,
  ...props
}: ScreenProps) {
  const insets = useSafeAreaInsets()
  const base = padded ? BASE_PAD : 0
  return (
    <YStack
      flex={1}
      backgroundColor="$background"
      paddingTop={base + (edges.includes('top') ? insets.top : 0)}
      paddingBottom={base + (edges.includes('bottom') ? insets.bottom : 0)}
      paddingHorizontal={base}
      {...props}
    >
      {children}
    </YStack>
  )
}
