import type { ReactNode } from 'react'
import { YStack } from 'tamagui'

/** Props for {@link BarDetailSheet}. */
export interface BarDetailSheetProps {
  /** Whether the detail is shown (the parent gates mount; native uses it to drive the sheet). */
  open: boolean
  /** Dismiss — clears the selection (native sheet drag/overlay; web toggles via the bar). */
  onClose: () => void
  children: ReactNode
}

/**
 * BarDetailSheet — the click/tap detail container for a board bar (BOARD-BAR-
 * INTERACTION-NOTE). **Web** (this file): a persistent panel **below the board** so
 * the planner can click bar-to-bar without occluding the Gantt (clicking the bar
 * again, or another bar, switches/dismisses — no close button). **Native**
 * (`.native`): a bottom sheet sliding up. The content (identity + learned +
 * performance) is identical and self-contained on both.
 */
export function BarDetailSheet({ children }: BarDetailSheetProps) {
  return <YStack maxWidth={460}>{children}</YStack>
}
