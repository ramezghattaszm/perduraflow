import { XStack, YStack } from 'tamagui'
import { P } from './typography'

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

/** A resolved rationale factor row (the screen resolves i18n → these strings). */
export interface FactorRow {
  /** Resolved factor label, e.g. "Firm lateness". */
  label: string
  /** Resolved detail sentence, e.g. "6h firm-order lateness across 2 order(s)". */
  detail: string
  /** Signed weighted contribution to the score (penalties are positive). */
  contribution: number
  direction: 'improves' | 'worsens' | 'neutral'
}

/** Props for {@link FactorBar}. */
export interface FactorBarProps extends FactorRow {
  /** The largest contribution in the set — bars scale against it. */
  max: number
}

/**
 * FactorBar — one objective factor's contribution as a labeled magnitude bar. Length
 * is proportional to |contribution| / max; colour encodes direction (a penalty that
 * worsens the score is `$warning`, an improvement `$ml`, neutral faint). The numeric
 * contribution stays visible — the bar is a glance aid, the number is the fact.
 */
export function FactorBar({ label, detail, contribution, direction, max }: FactorBarProps) {
  const frac = max > 0 ? clamp(Math.abs(contribution) / max, 0, 1) : 0
  const color = direction === 'improves' ? '$ml' : direction === 'worsens' ? '$warning' : '$textTertiary'
  return (
    <YStack gap="$1.5">
      <XStack justifyContent="space-between" alignItems="center" gap="$2">
        <P size={4} weight="m" color="$textPrimary">
          {label}
        </P>
        <P size={4} weight="b" color="$textSecondary">
          {contribution > 0 ? `+${contribution}` : String(contribution)}
        </P>
      </XStack>
      <XStack height={6} borderRadius="$4" backgroundColor="$surfaceRaised" overflow="hidden">
        <YStack width={`${frac * 100}%`} backgroundColor={color} borderRadius="$4" />
      </XStack>
      <P size={5} color="$textTertiary">
        {detail}
      </P>
    </YStack>
  )
}
