import type { ReactNode } from 'react'
import { XStack, YStack } from 'tamagui'
import { H, P } from './typography'

/** Value-colour tone for a headline KPI. `info` = notable-but-fine (e.g. slack); default neutral. */
export type KpiTone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral'

const TONE_COLOR = { ok: '$success', warn: '$warning', bad: '$danger', info: '$primary', neutral: '$textPrimary' } as const

/** Props for {@link KpiTile}. */
export interface KpiTileProps {
  /** The headline value, pre-formatted by the caller (e.g. "96.2%", "$142"). */
  value: string
  /** Uppercase metric label (e.g. "On-time-in-full"). */
  label: string
  /** Secondary caption (e.g. "service level", "vs $148 baseline"). */
  caption?: string
  /** Optional trend direction → a coloured arrow. */
  trend?: 'up' | 'down'
  /** Whether `trend` up is good (green) — most KPIs up=good; cost up=bad. Default true. */
  upIsGood?: boolean
  /** Colour the value by state (e.g. utilization > 100% = bad). Default neutral ($textPrimary). */
  valueTone?: KpiTone
  /** When set, the tile is pressable (cursor + hover) — e.g. an at-risk count that drills to the work list. */
  onPress?: () => void
}

/**
 * KpiTile — one metric card (KPI row, Scorecard/Cockpit). Pure presentational: the
 * caller passes a **formatted** value (no number-crunching here, no literals — the
 * value is computed upstream from seeded rows). Build a row with {@link KpiTileRow}.
 *
 * @example
 * <KpiTile value="96.2%" label="On-time-in-full" caption="service level" trend="up" />
 */
export function KpiTile({ value, label, caption, trend, upIsGood = true, valueTone = 'neutral', onPress }: KpiTileProps) {
  const good = trend === 'up' ? upIsGood : !upIsGood
  return (
    <YStack
      flexGrow={1}
      flexShrink={1}
      flexBasis={180}
      minWidth={150}
      backgroundColor="$surface"
      borderWidth={1}
      borderColor="$borderColor"
      borderRadius="$5"
      padding="$4"
      gap="$1"
      {...(onPress
        ? { onPress, cursor: 'pointer', hoverStyle: { borderColor: '$primary' }, pressStyle: { opacity: 0.9 } }
        : {})}
    >
      <XStack alignItems="baseline" gap="$1">
        <H level={2} color={TONE_COLOR[valueTone]}>
          {value}
        </H>
        {trend ? (
          <P size={4} weight="b" color={good ? '$success' : '$danger'}>
            {trend === 'up' ? '↑' : '↓'}
          </P>
        ) : null}
      </XStack>
      <P size={5} weight="b" caps color="$textTertiary">
        {label}
      </P>
      {caption ? (
        <P size={4} color="$textSecondary">
          {caption}
        </P>
      ) : null}
    </YStack>
  )
}

/** Responsive KPI tile row (wraps on small screens). */
export function KpiTileRow({ children }: { children: ReactNode }) {
  return (
    <XStack gap="$3" flexWrap="wrap">
      {children}
    </XStack>
  )
}
