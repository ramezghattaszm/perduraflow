import { XStack, YStack } from 'tamagui'
import { P } from './typography'

/** One variance chip's tone (drives dot + value colour). */
export type VarianceTone = 'ok' | 'warn' | 'bad'

/** One chip on the variance strip. */
export interface VarianceChip {
  label: string
  /** Pre-formatted value (e.g. "6% behind plan", "94%", "low", "7 of 11 ops"). */
  value: string
  tone: VarianceTone
}

/** Props for {@link VarianceStrip}. */
export interface VarianceStripProps {
  chips: VarianceChip[]
}

const DOT = { ok: '$success', warn: '$warning', bad: '$danger' } as const
const VAL = { ok: '$textPrimary', warn: '$warning', bad: '$danger' } as const

/**
 * VarianceStrip — board-adjacent performance chips (phase 3): affected resource
 * "N% behind plan", throughput attainment, churn, learned-param count. Presentational
 * — every value is computed upstream from the version's actuals (no literals). Not a
 * separate dashboard; it sits on the board as the operational summary.
 *
 * @example
 * <VarianceStrip chips={[{ label: 'Press Line A', value: '6% behind plan', tone: 'bad' }]} />
 */
export function VarianceStrip({ chips }: VarianceStripProps) {
  return (
    <XStack gap="$2" flexWrap="wrap">
      {chips.map((c) => (
        <XStack
          key={c.label}
          alignItems="center"
          gap="$2"
          backgroundColor="$surface"
          borderWidth={1}
          borderColor={c.tone === 'bad' ? '$danger' : c.tone === 'warn' ? '$warning' : '$borderColor'}
          borderRadius="$4"
          paddingVertical="$2"
          paddingHorizontal="$3"
        >
          <YStack width={8} height={8} borderRadius={999} backgroundColor={DOT[c.tone]} />
          <P size={4} color="$textSecondary">
            {c.label}
          </P>
          <P size={4} weight="b" color={VAL[c.tone]}>
            {c.value}
          </P>
        </XStack>
      ))}
    </XStack>
  )
}
