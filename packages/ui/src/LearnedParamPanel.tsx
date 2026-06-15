import { TriangleAlert } from '@tamagui/lucide-icons'
import { XStack, YStack } from 'tamagui'
import { P } from './typography'

/** Props for {@link LearnedParamPanel}. */
export interface LearnedParamPanelProps {
  title: string
  subtitle?: string
  /** Section label, e.g. "Learned cycle time". */
  metricLabel: string
  /** Pre-formatted standard + learned values (e.g. "70m", "76m"). */
  standardText: string
  learnedText: string
  /** Signed delta badge text, e.g. "+8%". */
  deltaText: string
  /** 0–1 learned confidence. */
  confidence: number
  /** Sample basis line, e.g. "Learned from 12 actuals." */
  basisText: string
  /** "settled — holding steady" copy (convergence beat). */
  settledText: string
  /** Optional tool-wear trigger: { title, body } → the amber signal box (D56). */
  trigger?: { title: string; body: string }
}

/**
 * LearnedParamPanel — the **convergence render** (phase 3, FS12): a learned value
 * shown as ONE settled step (standard struck-through → learned, a two-point track —
 * NOT a time series), rising confidence, the sample basis, and the triggering
 * signal (tool-wear). Click-to-open from a board bar. Presentational; the values
 * are computed upstream (learning.read). This is also the structured "why" the
 * Phase-5 narration surface will verbalise.
 *
 * @example
 * <LearnedParamPanel title="FG-1003 · Press Line A" metricLabel="Learned cycle time"
 *   standardText="70m" learnedText="76m" deltaText="+8%" confidence={0.86}
 *   basisText="Learned from 12 actuals." settledText="settled — holding steady" />
 */
export function LearnedParamPanel({
  title,
  subtitle,
  metricLabel,
  standardText,
  learnedText,
  deltaText,
  confidence,
  basisText,
  settledText,
  trigger,
}: LearnedParamPanelProps) {
  const pct = Math.round(Math.max(0, Math.min(1, confidence)) * 100)
  return (
    <YStack backgroundColor="$surface" borderWidth={1} borderColor="$borderColor" borderRadius="$5" overflow="hidden">
      <YStack padding="$4" borderBottomWidth={1} borderBottomColor="$borderColor" gap="$1">
        <P size={3} weight="b" color="$textPrimary">
          {title}
        </P>
        {subtitle ? (
          <P size={6} color="$textSecondary">
            {subtitle}
          </P>
        ) : null}
      </YStack>
      <YStack padding="$4" gap="$3">
        <P size={8} weight="b" color="$textSecondary">
          {metricLabel.toUpperCase()}
        </P>
        {/* the settled step: standard → learned (one move, not motion) */}
        <XStack alignItems="center" gap="$3">
          <P size={4} color="$textSecondary" style={{ textDecorationLine: 'line-through' }}>
            {standardText}
          </P>
          <P size={3} color="$ml">
            →
          </P>
          <P size={2} weight="b" color="$textPrimary">
            {learnedText}
          </P>
          <XStack backgroundColor="$mlSoft" borderRadius="$3" paddingHorizontal="$2" paddingVertical="$0.5">
            <P size={6} weight="b" color="$ml">
              {deltaText}
            </P>
          </XStack>
        </XStack>
        {/* two-point track: standard mark → learned mark */}
        <XStack height={6} borderRadius={999} backgroundColor="$surfaceRaised" position="relative">
          <YStack position="absolute" left="18%" top={-3} width={12} height={12} borderRadius={999} backgroundColor="$textSecondary" />
          <YStack position="absolute" left="72%" top={-3} width={12} height={12} borderRadius={999} backgroundColor="$ml" />
        </XStack>
        {/* confidence */}
        <XStack alignItems="center" gap="$3">
          <XStack flex={1} height={6} borderRadius="$2" backgroundColor="$surfaceRaised" overflow="hidden">
            <YStack width={`${pct}%`} backgroundColor="$ml" />
          </XStack>
          <P size={5} weight="b">
            {pct}%
          </P>
        </XStack>
        <P size={6} color="$textSecondary">
          {basisText} {settledText}
        </P>
        {trigger ? (
          <XStack gap="$3" alignItems="flex-start" backgroundColor="$surfaceRaised" borderRadius="$4" padding="$3">
            <YStack width={26} height={26} borderRadius="$3" backgroundColor="$warningSoft" alignItems="center" justifyContent="center">
              <TriangleAlert size={15} color="$warning" />
            </YStack>
            <YStack flex={1} gap="$0.5">
              <P size={6} weight="b" color="$textPrimary">
                {trigger.title}
              </P>
              <P size={6} color="$textSecondary">
                {trigger.body}
              </P>
            </YStack>
          </XStack>
        ) : null}
      </YStack>
    </YStack>
  )
}
