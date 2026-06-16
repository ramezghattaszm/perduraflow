import { TriangleAlert } from '@tamagui/lucide-icons'
import { XStack, YStack } from 'tamagui'
import { H, P } from './typography'

/** The learned (ml) settled-step detail — present only when a value has been adopted. */
export interface LearnedStep {
  /** Pre-formatted learned value (e.g. "76m"). */
  learnedText: string
  /** Signed delta badge text, e.g. "+8%". */
  deltaText: string
  /** 0–1 learned confidence. */
  confidence: number
  /** Sample basis line, e.g. "Learned from 12 actuals." */
  basisText: string
  /** "settled — holding steady" copy (convergence beat). */
  settledText: string
  /** Optional tool-wear trigger → the amber signal box (D56). */
  trigger?: { title: string; body: string }
}

/** Props for {@link LearnedParamPanel}. */
export interface LearnedParamPanelProps {
  title: string
  subtitle?: string
  /** Section label, e.g. "Learned cycle time" (learned) or "Cycle time" (standard). */
  metricLabel: string
  /** The standard baseline value text (always shown — struck-through in the learned state). */
  standardText: string
  /** Source badge text — e.g. "ml" or "std". */
  sourceText: string
  /** Learned state: present → render the std→learned settled step; absent → standard state. */
  learned?: LearnedStep
  /** Standard state: the "no learned adjustment yet" explanation. */
  standardNote?: string
  /** Standard state: an optional secondary row, e.g. { label: "Setup", value: "30m" }. */
  secondary?: { label: string; value: string }
}

/**
 * LearnedParamPanel — the per-operation detail opened by selecting **any** board
 * bar (no dead clicks). Two states:
 * - **learned (ml):** the convergence render (FS12) — standard struck-through →
 *   learned, a two-point track (NOT a time series), rising confidence, the sample
 *   basis, and the tool-wear trigger (D56).
 * - **standard (std):** the operation's standard time(s) with `source = standard`
 *   and an explicit "no learned adjustment yet" note (not enough actuals to adopt).
 * Presentational; values are computed upstream. Also the structured "why" the
 * Phase-5 narration surface will verbalise.
 */
export function LearnedParamPanel({
  title,
  subtitle,
  metricLabel,
  standardText,
  sourceText,
  learned,
  standardNote,
  secondary,
}: LearnedParamPanelProps) {
  const isLearned = Boolean(learned)
  return (
    <YStack backgroundColor="$surface" borderWidth={1} borderColor="$borderColor" borderRadius="$5" overflow="hidden">
      <YStack padding="$4" borderBottomWidth={1} borderBottomColor="$borderColor" gap="$1">
        <H level={4} color="$textPrimary">
          {title}
        </H>
        {subtitle ? (
          <P size={4} color="$textSecondary">
            {subtitle}
          </P>
        ) : null}
      </YStack>
      <YStack padding="$4" gap="$3">
        <XStack alignItems="center" justifyContent="space-between" gap="$2">
          <P size={5} weight="b" caps color="$textTertiary">
            {metricLabel}
          </P>
          <XStack
            backgroundColor={isLearned ? '$mlSoft' : '$surfaceRaised'}
            borderRadius="$3"
            paddingHorizontal="$2"
            paddingVertical="$0.5"
          >
            <P size={5} weight="b" color={isLearned ? '$ml' : '$textSecondary'}>
              {sourceText}
            </P>
          </XStack>
        </XStack>

        {learned ? (
          <>
            {/* the settled step: standard → learned (one move, not motion) */}
            <XStack alignItems="center" gap="$3">
              <P size={3} color="$textSecondary" style={{ textDecorationLine: 'line-through' }}>
                {standardText}
              </P>
              <P size={3} color="$ml">
                →
              </P>
              <H level={3} color="$textPrimary">
                {learned.learnedText}
              </H>
              <XStack backgroundColor="$warningSoft" borderRadius="$3" paddingHorizontal="$2" paddingVertical="$0.5">
                <P size={5} weight="b" color="$warning">
                  {learned.deltaText}
                </P>
              </XStack>
            </XStack>
            {/* two-point track: standard mark → learned mark */}
            <XStack height={6} borderRadius={999} backgroundColor="$surfaceRaised" position="relative">
              <YStack position="absolute" left="18%" top={-3} width={12} height={12} borderRadius={999} backgroundColor="$textSecondary" />
              <YStack position="absolute" left="72%" top={-3} width={12} height={12} borderRadius={999} backgroundColor="$ml" />
            </XStack>
            <XStack alignItems="center" gap="$3">
              <XStack flex={1} height={6} borderRadius="$2" backgroundColor="$surfaceRaised" overflow="hidden">
                <YStack width={`${Math.round(Math.max(0, Math.min(1, learned.confidence)) * 100)}%`} backgroundColor="$ml" />
              </XStack>
              <P size={3} weight="b">
                {Math.round(Math.max(0, Math.min(1, learned.confidence)) * 100)}%
              </P>
            </XStack>
            <XStack alignItems="center" gap="$2" flexWrap="wrap">
              <P size={3} color="$textSecondary">
                {learned.basisText}
              </P>
              <P size={5} weight="m" color="$success">
                {learned.settledText}
              </P>
            </XStack>
            {learned.trigger ? (
              <XStack gap="$3" alignItems="flex-start" backgroundColor="$surfaceRaised" borderRadius="$4" padding="$3">
                <YStack width={26} height={26} borderRadius="$3" backgroundColor="$warningSoft" alignItems="center" justifyContent="center">
                  <TriangleAlert size={15} color="$warning" />
                </YStack>
                <YStack flex={1} gap="$0.5">
                  <P size={3} weight="b" color="$textPrimary">
                    {learned.trigger.title}
                  </P>
                  <P size={3} color="$textSecondary">
                    {learned.trigger.body}
                  </P>
                </YStack>
              </XStack>
            ) : null}
          </>
        ) : (
          <>
            {/* standard state: the operation's standard time(s), no adjustment yet */}
            <XStack alignItems="baseline" gap="$3">
              <H level={3} color="$textPrimary">
                {standardText}
              </H>
              {secondary ? (
                <P size={4} color="$textSecondary">
                  {secondary.label} {secondary.value}
                </P>
              ) : null}
            </XStack>
            {standardNote ? (
              <P size={3} color="$textSecondary">
                {standardNote}
              </P>
            ) : null}
          </>
        )}
      </YStack>
    </YStack>
  )
}
