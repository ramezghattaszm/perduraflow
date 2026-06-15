import { XStack, YStack } from 'tamagui'
import { P } from './typography'

/** One labelled bar (e.g. an OEE factor). */
export interface MetricBarItem {
  label: string
  /** 0–1 fraction. */
  value: number
}

/** Props for {@link MetricBars}. */
export interface MetricBarsProps {
  items: MetricBarItem[]
}

/**
 * MetricBars — labelled horizontal percentage bars (Scorecard OEE A·P·Q breakdown,
 * reusable). Controlled/presentational: `items=[{label, value 0–1}]`, all computed
 * upstream. Token-themed.
 *
 * @example
 * <MetricBars items={[{ label: 'Availability', value: 0.88 }]} />
 */
export function MetricBars({ items }: MetricBarsProps) {
  return (
    <YStack gap="$3">
      {items.map((it) => (
        <XStack key={it.label} alignItems="center" gap="$3">
          <P size={5} color="$textSecondary" width={104}>
            {it.label}
          </P>
          <XStack flex={1} height={8} borderRadius="$4" backgroundColor="$surfaceRaised" overflow="hidden">
            <YStack width={`${Math.round(Math.max(0, Math.min(1, it.value)) * 100)}%`} backgroundColor="$primary" borderRadius="$4" />
          </XStack>
          <P size={5} weight="b" width={44} style={{ textAlign: 'right' }}>
            {Math.round(it.value * 100)}%
          </P>
        </XStack>
      ))}
    </YStack>
  )
}
