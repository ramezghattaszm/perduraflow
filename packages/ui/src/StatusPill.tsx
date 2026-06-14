import { styled, XStack } from 'tamagui'
import { P } from './typography'

/**
 * Status pill — a small rounded chip whose color is driven by `tone`. One
 * component for every row-status indicator (plant status, active/inactive),
 * so screens never re-style a status badge inline (UI §0.1).
 *
 * @example
 * <StatusPill tone="active">Active</StatusPill>
 */
const PillFrame = styled(XStack, {
  name: 'StatusPill',
  alignItems: 'center',
  alignSelf: 'flex-start',
  borderRadius: '$10',
  paddingHorizontal: '$3',
  paddingVertical: '$1',
  borderWidth: 1,
  variants: {
    tone: {
      active: { backgroundColor: '$success', borderColor: '$success' },
      inactive: { backgroundColor: '$surface', borderColor: '$borderColor' },
      neutral: { backgroundColor: '$primaryLight', borderColor: '$primaryLight' },
    },
  } as const,
  defaultVariants: { tone: 'neutral' },
})

const TEXT_COLOR = { active: '$surface', inactive: '$textSecondary', neutral: '$textPrimary' } as const

export type StatusTone = 'active' | 'inactive' | 'neutral'

/**
 * Status pill. `tone` drives both background and text color.
 *
 * @example
 * <StatusPill tone={plant.status === 'active' ? 'active' : 'inactive'}>{plant.status}</StatusPill>
 */
export function StatusPill({ tone = 'neutral', children }: { tone?: StatusTone; children: string }) {
  return (
    <PillFrame tone={tone}>
      <P size={6} weight="m" color={TEXT_COLOR[tone]}>
        {children}
      </P>
    </PillFrame>
  )
}
