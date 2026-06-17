import { XStack, YStack } from 'tamagui'
import { EmptyState } from './EmptyState'
import { P } from './typography'

/** One KPI compared live-vs-baseline (values pre-formatted by the screen). */
export interface BaselineKpiRow {
  label: string
  live: string
  baseline: string
  delta: string
  tone: 'up' | 'down' | 'neutral'
}

/** A selectable baseline arm tab. */
export interface BaselineArm {
  id: string
  label: string
  active: boolean
  onPress: () => void
}

/** Props for {@link BaselineDeltaStrip}. */
export interface BaselineDeltaStripProps {
  arms: BaselineArm[]
  /** The honest label/hint for the active arm (e.g. "the lift our intelligence adds"). */
  caption: string
  rows: BaselineKpiRow[]
  /** Empty-state (no historical baseline yet) — never a fabricated comparison. */
  empty?: boolean
  emptyTitle?: string
  emptyHint?: string
  liveHeader: string
  baselineHeader: string
  deltaHeader: string
}

const toneColor = (tone: BaselineKpiRow['tone']) => (tone === 'up' ? '$success' : tone === 'down' ? '$danger' : '$textTertiary')

/**
 * BaselineDeltaStrip — the plan-comparison surface (D57): an arm selector
 * (frozen-engine / measured-historical) over a live-vs-baseline KPI table with
 * honest deltas, the active arm's honest caption, and a true **empty state** when no
 * historical baseline exists (never fabricated). Pure presentation.
 */
export function BaselineDeltaStrip({ arms, caption, rows, empty, emptyTitle, emptyHint, liveHeader, baselineHeader, deltaHeader }: BaselineDeltaStripProps) {
  return (
    <YStack gap="$3">
      <XStack gap="$2" flexWrap="wrap">
        {arms.map((a) => (
          <YStack
            key={a.id}
            paddingVertical="$1.5"
            paddingHorizontal="$3"
            borderRadius="$10"
            backgroundColor={a.active ? '$primarySoft' : '$surfaceRaised'}
            cursor="pointer"
            onPress={a.onPress}
          >
            <P size={4} weight="m" color={a.active ? '$primary' : '$textSecondary'}>
              {a.label}
            </P>
          </YStack>
        ))}
      </XStack>

      {empty ? (
        <EmptyState icon="📊" title={emptyTitle ?? ''} subtitle={emptyHint} />
      ) : (
        <YStack gap="$2">
          <XStack gap="$2">
            <P size={5} weight="b" caps color="$textTertiary" flex={2}>
              {' '}
            </P>
            <P size={5} weight="b" caps color="$textTertiary" flex={1} textAlign="right">
              {liveHeader}
            </P>
            <P size={5} weight="b" caps color="$textTertiary" flex={1} textAlign="right">
              {baselineHeader}
            </P>
            <P size={5} weight="b" caps color="$textTertiary" flex={1} textAlign="right">
              {deltaHeader}
            </P>
          </XStack>
          {rows.map((r) => (
            <XStack key={r.label} gap="$2" alignItems="center" borderTopWidth={1} borderTopColor="$borderColor" paddingTop="$2">
              <P size={4} weight="m" color="$textPrimary" flex={2}>
                {r.label}
              </P>
              <P size={4} weight="b" color="$textPrimary" flex={1} textAlign="right">
                {r.live}
              </P>
              <P size={4} color="$textSecondary" flex={1} textAlign="right">
                {r.baseline}
              </P>
              <P size={4} weight="b" color={toneColor(r.tone)} flex={1} textAlign="right">
                {r.delta}
              </P>
            </XStack>
          ))}
          <P size={5} color="$textTertiary">
            {caption}
          </P>
        </YStack>
      )}
    </YStack>
  )
}
