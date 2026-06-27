import type { ReactNode } from 'react'
import type { ViewStyle } from 'react-native'
import { Check } from '@tamagui/lucide-icons'
import { XStack, YStack } from 'tamagui'
import { AppButton } from './AppButton'
import { StatusPill } from './StatusPill'
import { H, P } from './typography'

/** A resolved costed-KPI cell (value already formatted; delta optional). */
export interface OptionKpiCell {
  label: string
  value: string
  /** Signed delta vs base, pre-formatted (e.g. "+0.04", "−$0.12"); omit if none. */
  delta?: string
  tone?: 'up' | 'down' | 'neutral'
  /** Optional secondary line under the value (e.g. "4 orders" beneath the late-HOURS headline). */
  caption?: string
}

/** Props for {@link OptionCard}. */
export interface OptionCardProps {
  rank: string
  label: string
  recommended?: boolean
  recommendedLabel: string
  feasible: boolean
  infeasibleReason?: string | null
  scoreLabel: string
  score: number
  kpis: OptionKpiCell[]
  /** The structured rationale (a <RationaleView/>), always shown when expanded. */
  rationale?: ReactNode
  /** The narration (a <NarrationBlock/>), shown alongside the rationale. */
  narration?: ReactNode
  expanded?: boolean
  onToggle?: () => void
  applyCta: string
  appliedLabel: string
  onApply?: () => void
  applying?: boolean
  applied?: boolean
  /** Hide the Apply control (preview mode — the caller applies separately). */
  hideApply?: boolean
  /** Fixed card width — set when laid out in a horizontal scroller (cards don't shrink). */
  width?: number
  /** Cap the card width (a lone option may fill up to this). */
  maxWidth?: number
  /** Extra root style (e.g. web scroll-snap). The card keeps its CONTENT height; a stretched row makes
   *  every card match the tallest — do NOT pass `flex:1` here (it would zero the height in a scroller). */
  style?: ViewStyle
}

const toneColor = (tone?: OptionKpiCell['tone']) =>
  tone === 'up' ? '$success' : tone === 'down' ? '$danger' : '$textSecondary'

/**
 * OptionCard — one ranked what-if option (Cockpit, D55): header (rank · label ·
 * recommended/infeasible), the **costed KPI row** (deltas vs base), and — when
 * expanded — the **structured rationale** with **narration alongside** and the
 * **Apply** control. Apply is live the moment the rationale exists (never waits on
 * narration). Pure presentation; the screen supplies resolved strings + handlers.
 */
export function OptionCard({
  rank,
  label,
  recommended,
  recommendedLabel,
  feasible,
  infeasibleReason,
  scoreLabel,
  score,
  kpis,
  rationale,
  narration,
  expanded,
  onToggle,
  applyCta,
  appliedLabel,
  onApply,
  applying,
  applied,
  hideApply,
  width,
  maxWidth,
  style,
}: OptionCardProps) {
  return (
    <YStack
      backgroundColor="$surface"
      borderWidth={1}
      borderColor={recommended ? '$primary' : '$borderColor'}
      borderRadius="$5"
      overflow="hidden"
      opacity={feasible ? 1 : 0.7}
      width={width}
      maxWidth={maxWidth}
      flexShrink={width != null ? 0 : undefined}
      style={style}
    >
      <XStack
        padding="$3.5"
        gap="$3"
        alignItems="center"
        justifyContent="space-between"
        {...(onToggle && feasible ? { cursor: 'pointer', onPress: onToggle } : {})}
      >
        <XStack
          gap="$2.5"
          alignItems="center"
          flex={1}
        >
          <P
            size={4}
            weight="b"
            color="$textTertiary"
          >
            {rank}
          </P>
          <YStack
            flex={1}
            gap="$0.5"
          >
            <H
              level={4}
              color="$textPrimary"
            >
              {label}
            </H>
            {feasible ? (
              <P
                size={5}
                color="$textTertiary"
              >
                {scoreLabel} {score}
              </P>
            ) : (
              <P
                size={5}
                color="$danger"
              >
                {infeasibleReason}
              </P>
            )}
          </YStack>
        </XStack>
        {recommended && feasible ? <StatusPill tone="active">{recommendedLabel}</StatusPill> : null}
        {!feasible ? <StatusPill tone="danger">×</StatusPill> : null}
      </XStack>

      {feasible ? (
        <XStack
          flexWrap="wrap"
          gap="$4"
          paddingHorizontal="$3.5"
          paddingBottom="$3"
        >
          {kpis.map((k) => (
            <YStack
              key={k.label}
              gap="$0.5"
              minWidth={72}
            >
              <P
                size={5}
                weight="b"
                caps
                color="$textTertiary"
              >
                {k.label}
              </P>
              <P
                size={3}
                weight="b"
                color="$textPrimary"
              >
                {k.value}
              </P>
              {k.caption ? (
                <P
                  size={5}
                  color="$textTertiary"
                >
                  {k.caption}
                </P>
              ) : null}
              {k.delta ? (
                <P
                  size={5}
                  weight="m"
                  color={toneColor(k.tone)}
                >
                  {k.delta}
                </P>
              ) : null}
            </YStack>
          ))}
        </XStack>
      ) : null}

      {expanded && feasible ? (
        <YStack
          flexGrow={1}
          gap="$3.5"
          padding="$3.5"
          borderTopWidth={1}
          borderTopColor="$borderColor"
        >
          {rationale}
          {narration}
          {/* Apply pins to the BOTTOM (marginTop:auto) so it aligns across equal-height cards. */}
          {hideApply ? null : applied ? (
            <XStack
              marginTop="auto"
              gap="$2"
              alignItems="center"
            >
              <Check
                size={15}
                color="$success"
              />
              <P
                size={3}
                weight="m"
                color="$success"
              >
                {appliedLabel}
              </P>
            </XStack>
          ) : (
            <AppButton
              marginTop="auto"
              variant="primary"
              size="$3"
              loading={applying}
              onPress={onApply}
            >
              {applyCta}
            </AppButton>
          )}
        </YStack>
      ) : null}
    </YStack>
  )
}
