import { styled, XStack } from 'tamagui'
import { P } from './typography'

/**
 * Status pill — a small rounded chip whose color is driven by `tone`. One
 * component for every row-status indicator (plant status, active/inactive),
 * so screens never re-style a status badge inline (UI §0.1).
 *
 * Badge type rules (UI §4): text is 11px / weight 600; color is a **semantic
 * tint** — coloured text on a soft tinted background, never a full-saturation
 * fill. Pass **sentence-case** words ("Active") or ALL-CAPS for very short codes
 * ("OUT", "T1") — the component renders the label verbatim.
 *
 * @example
 * <StatusPill tone="active">Active</StatusPill>
 */
const PillFrame = styled(XStack, {
  name: 'StatusPill',
  alignItems: 'center',
  alignSelf: 'flex-start',
  borderRadius: '$10',
  paddingHorizontal: '$2.5', // ~10px
  paddingVertical: '$1', // ~2px
  variants: {
    tone: {
      active: { backgroundColor: '$successSoft' },
      inactive: { backgroundColor: '$hoverFill' },
      neutral: { backgroundColor: '$primarySoft' },
      danger: { backgroundColor: '$dangerSoft' },
      warning: { backgroundColor: '$warningSoft' },
    },
  } as const,
  defaultVariants: { tone: 'neutral' },
})

// Coloured text paired with each tone's soft tint (semantic tint, not a fill).
const TEXT_COLOR = {
  active: '$success',
  inactive: '$textSecondary',
  neutral: '$primary',
  danger: '$danger',
  warning: '$warning',
} as const

export type StatusTone = 'active' | 'inactive' | 'neutral' | 'danger' | 'warning'

/**
 * Status pill. `tone` drives both the soft background tint and the text color.
 *
 * @example
 * <StatusPill tone={plant.status === 'active' ? 'active' : 'inactive'}>{plant.status}</StatusPill>
 */
export function StatusPill({ tone = 'neutral', children }: { tone?: StatusTone; children: string }) {
  return (
    <PillFrame tone={tone}>
      <P size={5} weight="b" color={TEXT_COLOR[tone]}>
        {children}
      </P>
    </PillFrame>
  )
}
