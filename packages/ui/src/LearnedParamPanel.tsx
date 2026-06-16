import { TriangleAlert } from '@tamagui/lucide-icons'
import { XStack, YStack } from 'tamagui'
import { StatusPill, type StatusTone } from './StatusPill'
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
  /** Optional status (e.g. at-risk) → a {@link StatusPill} in the top-right of the header. */
  status?: { label: string; tone: StatusTone }
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
  /** Identity / schedule facts repeated at the top so the panel stands alone on
   *  both platforms (the click/tap detail never assumes the hover preview was seen). */
  scheduleRows?: { label: string; value: string }[]
  /** Performance section label (e.g. "Performance — planned vs actual"). */
  performanceLabel?: string
  /** Planned-vs-actual rows; absent/empty → renders {@link performanceEmptyText}. */
  performanceRows?: { label: string; value: string; tone?: 'ok' | 'warn' | 'bad' }[]
  /** Shown in the performance section when the version has no actuals for this op. */
  performanceEmptyText?: string
  /** Forward-looking prediction statement (phase 4) — e.g. "Predicted to cross
   *  ~14:00 · conf 0.8 · 2h"; rendered as a settled warning block (FS18). */
  prediction?: string
}

const PERF_TONE = { ok: '$success', warn: '$warning', bad: '$danger' } as const

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
  status,
  metricLabel,
  standardText,
  sourceText,
  learned,
  standardNote,
  secondary,
  scheduleRows,
  performanceLabel,
  performanceRows,
  performanceEmptyText,
  prediction,
}: LearnedParamPanelProps) {
  const isLearned = Boolean(learned)
  return (
    <YStack backgroundColor="$surface" borderWidth={1} borderColor="$borderColor" borderRadius="$5" overflow="hidden">
      <YStack padding="$4" borderBottomWidth={1} borderBottomColor="$borderColor" gap="$1">
        <XStack justifyContent="space-between" alignItems="flex-start" gap="$2">
          <YStack flex={1} gap="$1">
            <H level={4} color="$textPrimary">
              {title}
            </H>
            {subtitle ? (
              <P size={4} color="$textSecondary">
                {subtitle}
              </P>
            ) : null}
          </YStack>
          {status ? <StatusPill tone={status.tone}>{status.label}</StatusPill> : null}
        </XStack>
        {scheduleRows && scheduleRows.length > 0 ? (
          <YStack gap="$1.5" marginTop="$2">
            {scheduleRows.map((r) => (
              <XStack key={r.label} justifyContent="space-between" gap="$3" alignItems="center">
                <P size={5} weight="b" caps color="$textTertiary">
                  {r.label}
                </P>
                <P size={3} weight="m" color="$textPrimary">
                  {r.value}
                </P>
              </XStack>
            ))}
          </YStack>
        ) : null}
      </YStack>
      <YStack padding="$4" gap="$3">
        {prediction ? (
          <YStack backgroundColor="$warningSoft" borderRadius="$4" padding="$3" gap="$1">
            <P size={3} color="$textPrimary">
              {prediction}
            </P>
          </YStack>
        ) : null}
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

        {/* Performance — planned-vs-actual for this op (this version's actuals);
            "no actuals yet" when none. Self-contained (shown on web + native). */}
        {performanceLabel ? (
          <YStack gap="$2" marginTop="$1" borderTopWidth={1} borderTopColor="$borderColor" paddingTop="$3">
            <P size={5} weight="b" caps color="$textTertiary">
              {performanceLabel}
            </P>
            {performanceRows && performanceRows.length > 0 ? (
              performanceRows.map((r) => (
                <XStack key={r.label} justifyContent="space-between" gap="$3" alignItems="center">
                  <P size={4} color="$textSecondary">
                    {r.label}
                  </P>
                  <P size={3} weight="m" color={r.tone ? PERF_TONE[r.tone] : '$textPrimary'}>
                    {r.value}
                  </P>
                </XStack>
              ))
            ) : (
              <P size={3} color="$textSecondary">
                {performanceEmptyText}
              </P>
            )}
          </YStack>
        ) : null}
      </YStack>
    </YStack>
  )
}
