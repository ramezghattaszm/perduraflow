import type { ReactNode } from 'react'
import { XStack, YStack } from 'tamagui'
import { StatusPill, type StatusTone } from './StatusPill'
import { P } from './typography'

/** Props for {@link ExceptionRow}. */
export interface ExceptionRowProps {
  /** Identity — e.g. "Press Line A · cycle" (the primary line). */
  title: string
  /** The settled statement — e.g. "Predicted to cross ~14:00 · conf 0.82 · 2h horizon". */
  statement: string
  /** Tier / severity pill (right of the identity). */
  badge?: { label: string; tone: StatusTone }
  /** Auto-handled rows render quiet (no action control); needs-you rows pass `actions`. */
  actions?: ReactNode
  /** Top divider (between rows). */
  divided?: boolean
  /** Makes the row selectable (e.g. to set the deictic referent for the Copilot). */
  onPress?: () => void
  /** Selected state — a soft highlight; pairs with `onPress`. */
  selected?: boolean
}

/**
 * ExceptionRow — one Exception-Queue row (View 4, BOARD/DASHBOARD type map). Identity
 * (14/500/ink) + a **settled statement** (prediction / consequence — never a live
 * ticker) + a tier/severity `StatusPill`, with an optional action control. Two
 * shapes: **auto-handled** (no actions, quiet) and **needs-you** (Approve/Dismiss/
 * Sign-off). Presentational; the screen computes the strings + wires the actions.
 */
export function ExceptionRow({ title, statement, badge, actions, divided, onPress, selected }: ExceptionRowProps) {
  return (
    <XStack
      gap="$3"
      alignItems="center"
      justifyContent="space-between"
      paddingVertical="$3"
      paddingHorizontal="$4"
      borderTopWidth={divided ? 1 : 0}
      borderTopColor="$borderColor"
      backgroundColor={selected ? '$primarySoft' : undefined}
      onPress={onPress}
      cursor={onPress ? 'pointer' : undefined}
      hoverStyle={onPress && !selected ? { backgroundColor: '$backgroundHover' } : undefined}
    >
      <YStack flex={1} gap="$1">
        <XStack gap="$2" alignItems="center" flexWrap="wrap">
          <P size={3} weight="m" color="$textPrimary">
            {title}
          </P>
          {badge ? <StatusPill tone={badge.tone}>{badge.label}</StatusPill> : null}
        </XStack>
        <P size={3} color="$textSecondary">
          {statement}
        </P>
      </YStack>
      {actions ? (
        <XStack gap="$2" alignItems="center">
          {actions}
        </XStack>
      ) : null}
    </XStack>
  )
}
